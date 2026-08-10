-- Identidade do paciente para os apps + acervo de fotos clínicas.
--
-- Chave de identidade é o CPF, não o telefone: dos 690 pacientes no espelho Shosp,
-- 676 têm CPF (98%), 658 e-mail (95%) e só 325 celular (47%). Login por WhatsApp
-- sozinho deixaria metade dos pacientes de fora.
--
-- Princípio de acesso: o paciente NÃO ganha policy de leitura em tabela do CRM.
-- Ele fala com RPCs SECURITY DEFINER que devolvem exatamente o que a tela precisa.
-- Superfície mínima: se amanhã alguém abrir uma policy no CRM, o paciente continua
-- sem enxergar nada além do que estas funções entregam.

create table if not exists public.patient_accounts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  auth_user_id      uuid unique references auth.users (id) on delete cascade,
  cpf               text not null,
  nome              text,
  shosp_prontuario  text references public.shosp_patients (prontuario),
  lead_id           text references public.leads (id) on delete set null,
  email             text,
  phone             text,
  status            text not null default 'ativo',
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, cpf)
);
create index if not exists patient_accounts_pront_idx on public.patient_accounts (shosp_prontuario);

alter table public.patient_accounts enable row level security;
drop policy if exists "patient_accounts self" on public.patient_accounts;
create policy "patient_accounts self" on public.patient_accounts
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_staff_user());

create extension if not exists pgcrypto;

create table if not exists public.patient_otps (
  tenant_id           text not null default 'instituto-lorena' references public.tenants (id),
  cpf                 text not null,
  code_hash           text not null,
  channel             text,
  destination_masked  text,
  expires_at          timestamptz not null,
  attempts            int not null default 0,
  last_sent_at        timestamptz not null default now(),
  primary key (tenant_id, cpf)
);
alter table public.patient_otps enable row level security;
revoke all on table public.patient_otps from anon, authenticated;
-- sem policy: só service_role (edge de login) toca nesta tabela.

insert into storage.buckets (id, name, public, file_size_limit)
values ('paciente-fotos', 'paciente-fotos', false, 26214400)
on conflict (id) do nothing;

create table if not exists public.patient_photos (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null default 'instituto-lorena' references public.tenants (id),
  shosp_prontuario   text not null references public.shosp_patients (prontuario),
  lead_id            text references public.leads (id) on delete set null,
  surgery_id         int references public.srg_surgeries (id) on delete set null,
  storage_path       text not null unique,               -- <prontuario>/<marco>/<angulo>-<uuid>.jpg
  angle              text not null,                      -- frontal|topo|coroa|lateral_d|lateral_e|nuca|hairline
  milestone          text not null,                      -- pre_op|d0|d7|d15|m1|m3|m6|m9|m12|m18
  taken_at           timestamptz not null default now(),
  taken_by           uuid,
  source             text not null default 'equipe',     -- equipe|paciente|whatsapp
  visible_to_patient boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now()
);
create index if not exists patient_photos_pront_idx
  on public.patient_photos (shosp_prontuario, milestone, angle);

alter table public.patient_photos enable row level security;
drop policy if exists "patient_photos staff" on public.patient_photos;
create policy "patient_photos staff" on public.patient_photos
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

-- Consentimento por prontuário: lead_id só existe em 28% dos pacientes Shosp,
-- então não serve de chave para consentimento de imagem.
alter table public.patient_consents add column if not exists shosp_prontuario text;
create index if not exists patient_consents_pront_idx on public.patient_consents (shosp_prontuario, purpose);

create or replace function public.current_patient_prontuario()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select pa.shosp_prontuario
  from public.patient_accounts pa
  where pa.auth_user_id = auth.uid()
    and pa.status = 'ativo'
    and pa.shosp_prontuario is not null
  limit 1
$fn$;

revoke all on function public.current_patient_prontuario() from public, anon;
grant execute on function public.current_patient_prontuario() to authenticated, service_role;

-- Storage: a pasta raiz do arquivo é o prontuário. Paciente lê a própria pasta;
-- equipe lê e escreve tudo. Bucket é privado — acesso só por URL assinada.
drop policy if exists "paciente_fotos paciente le" on storage.objects;
create policy "paciente_fotos paciente le" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'paciente-fotos'
    and public.current_patient_prontuario() is not null
    and (storage.foldername(name))[1] = public.current_patient_prontuario()
  );

drop policy if exists "paciente_fotos equipe" on storage.objects;
create policy "paciente_fotos equipe" on storage.objects
  for all to authenticated
  using (bucket_id = 'paciente-fotos' and public.is_staff_user())
  with check (bucket_id = 'paciente-fotos' and public.is_staff_user());

create or replace function public.patient_me()
returns table (nome text, cpf text, prontuario text, email text, phone text)
language sql
stable
security definer
set search_path = public
as $fn$
  select pa.nome, pa.cpf, pa.shosp_prontuario, pa.email, pa.phone
  from public.patient_accounts pa
  where pa.auth_user_id = auth.uid() and pa.status = 'ativo'
$fn$;

-- Cirurgias do paciente logado, com total de folículos, quebra por área e a
-- linha do tempo das etapas. É a tela "minha cirurgia".
create or replace function public.patient_surgeries()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with pront as (select public.current_patient_prontuario() as p),
  cir as (
    select s.*
    from public.srg_surgeries s, pront
    where pront.p is not null
      and s.shosp_prontuario = pront.p
      and s.deleted_at is null
  )
  select coalesce(jsonb_agg(x order by x->>'dia' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',                c.id,
      'dia',               c.dia,
      'status',            c.status,
      'meta',              c.meta,
      'total_extraidos',   c.total_extraidos,
      'total_implantados', c.total_implantados,
      'areas', coalesce((
        select jsonb_agg(jsonb_build_object('area', a.titulo, 'meta', sa.meta, 'implantados', ai.q)
                         order by a.ordem)
        from public.srg_surgery_areas sa
        join public.srg_areas a on a.id = sa.area_id
        cross join lateral (
          select coalesce(sum(i.quantidade), 0) as q
          from public.srg_follicles_implanted i
          where i.surgery_area_id = sa.id and i.deleted_at is null
        ) ai
        where sa.surgery_id = c.id and sa.deleted_at is null
      ), '[]'::jsonb),
      'etapas', coalesce((
        select jsonb_agg(jsonb_build_object('etapa', e.etapa, 'tipo', e.tipo, 'horario', e.horario)
                         order by e.horario)
        from public.srg_stages e
        where e.surgery_id = c.id and e.deleted_at is null and e.horario is not null
      ), '[]'::jsonb)
    ) as x
    from cir c
  ) t
$fn$;

create or replace function public.patient_appointments()
returns table (data date, horario text, servico text, prestador text, status text)
language sql
stable
security definer
set search_path = public
as $fn$
  select a.data, a.horario, a.servico, a.prestador, a.status
  from public.shosp_appointments a
  where public.current_patient_prontuario() is not null
    and a.prontuario = public.current_patient_prontuario()
  order by a.data desc
$fn$;

create or replace function public.patient_photos_list()
returns table (id uuid, storage_path text, angle text, milestone text, taken_at timestamptz, surgery_id int)
language sql
stable
security definer
set search_path = public
as $fn$
  select f.id, f.storage_path, f.angle, f.milestone, f.taken_at, f.surgery_id
  from public.patient_photos f
  where public.current_patient_prontuario() is not null
    and f.shosp_prontuario = public.current_patient_prontuario()
    and f.visible_to_patient
  order by f.taken_at
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.patient_me()',
    'public.patient_surgeries()',
    'public.patient_appointments()',
    'public.patient_photos_list()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
