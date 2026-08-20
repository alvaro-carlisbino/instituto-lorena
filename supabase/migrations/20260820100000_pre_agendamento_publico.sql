-- ─────────────────────────────────────────────────────────────────────────────
-- Pré-agendamento público (landing /consulta)
--
-- O problema: a clínica fecha 0,4% dos leads. Todo mundo que clica no anúncio cai
-- no mesmo balde de WhatsApp e a atendente gasta o dia perguntando as mesmas cinco
-- coisas para quem só estava passeando. A landing inverte isso: a própria pessoa
-- responde a triagem, recebe uma estimativa feita com as cirurgias REAIS da casa
-- (clinica_referencia_por_area) e escolhe um horário. Quem escolhe horário é fila
-- de trabalho; quem não escolhe continua lead, mas não ocupa a agenda de ninguém.
--
-- É PRÉ-agendamento de propósito: nada entra na Shosp sozinho. A pessoa reserva,
-- a equipe confirma. Assim um bot ou um trote não sujam a agenda da Dra., e a
-- cota da API da Shosp (que já estoura em 429) não entra no caminho crítico.
--
-- Quem escreve aqui é a edge function `crm-agendar-publico` com service_role. A
-- chave anon só enxerga DUAS funções de leitura, e as duas devolvem apenas
-- horário livre e endereço de unidade — nada de pessoa. Ver supabase_rpc_aberta_anon.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Configuração geral do pré-agendamento ────────────────────────────────────
create table if not exists public.clinic_booking_settings (
  tenant_id text primary key default 'instituto-lorena',
  active boolean not null default true,
  timezone text not null default 'America/Sao_Paulo',
  -- Antecedência mínima: horário que começa em menos de N horas não aparece,
  -- senão alguém reserva 08:00 às 07:50 e ninguém da equipe viu a tempo.
  lead_time_hours int not null default 18,
  -- Até quantos dias à frente a landing mostra agenda.
  horizon_days int not null default 21,
  -- Quantos prestadores de consulta podem estar ocupados no mesmo horário da
  -- Shosp antes de o horário sumir da landing. A agenda da casa tem médico e spa
  -- no mesmo relógio; contar TUDO zeraria a disponibilidade.
  max_consultas_por_horario int not null default 2,
  -- Número que a landing usa nos botões de WhatsApp (o da clínica, nunca o do Tricopill).
  whatsapp_e164 text not null default '5544991493656',
  updated_at timestamptz not null default now()
);

comment on table public.clinic_booking_settings is
  'Regras do pré-agendamento público: antecedência, horizonte e o WhatsApp que a landing mostra.';

insert into public.clinic_booking_settings (tenant_id)
values ('instituto-lorena')
on conflict (tenant_id) do nothing;

-- ── Unidades oferecidas na landing ───────────────────────────────────────────
create table if not exists public.clinic_booking_units (
  id text primary key,
  tenant_id text not null default 'instituto-lorena',
  rotulo text not null,
  cidade text not null default '',
  uf text not null default '',
  endereco text not null default '',
  modalidade text not null default 'presencial' check (modalidade in ('presencial', 'online')),
  -- Código da unidade na Shosp, para conferir a agenda real antes de oferecer o
  -- horário. Nulo = unidade que a Shosp não espelha (não dá para conferir).
  shosp_codigo_unidade text,
  active boolean not null default true,
  sort_order int not null default 0
);

comment on table public.clinic_booking_units is
  'Unidades que a landing pode oferecer. Sem janela ativa a unidade não aparece.';

insert into public.clinic_booking_units (id, rotulo, cidade, uf, endereco, modalidade, shosp_codigo_unidade, active, sort_order)
values
  ('maringa', 'Maringá', 'Maringá', 'PR', 'Av. Nóbrega, 814 · Zona 4 · Maringá/PR', 'presencial', '1', true, 0),
  ('online', 'Consulta online', '', '', 'Por vídeo, de onde você estiver', 'online', '1', true, 1),
  -- Londrina existe e está no site, mas ninguém me passou os dias de atendimento
  -- de lá. Fica desligada: unidade sem janela vira promessa que a agenda não cumpre.
  ('londrina', 'Londrina', 'Londrina', 'PR', '', 'presencial', null, false, 2)
on conflict (id) do nothing;

-- ── Janelas de atendimento (a grade que vira horário) ────────────────────────
create table if not exists public.clinic_booking_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'instituto-lorena',
  unidade_id text not null references public.clinic_booking_units(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),   -- 0 = domingo (mesmo eixo do extract(dow))
  hora_inicio time not null,
  hora_fim time not null,
  slot_minutes int not null default 30 check (slot_minutes between 5 and 240),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (hora_fim > hora_inicio)
);

create index if not exists clinic_booking_windows_unidade_idx
  on public.clinic_booking_windows (tenant_id, unidade_id, weekday);

comment on table public.clinic_booking_windows is
  'Grade semanal por unidade. A landing gera os horários a partir daqui e desconta o que já está ocupado.';

-- Grade inicial tirada do histórico real de consultas da casa (seg-sex, manhã
-- 09:00-12:00 e tarde 13:30-17:00, em blocos de 30min). A equipe muda pela tela.
insert into public.clinic_booking_windows (unidade_id, weekday, hora_inicio, hora_fim, slot_minutes)
select u.id, d.weekday, t.inicio, t.fim, 30
from (values ('maringa'), ('online')) as u(id)
cross join (values (1), (2), (3), (4), (5)) as d(weekday)
cross join (values (time '09:00', time '12:00'), (time '13:30', time '17:00')) as t(inicio, fim)
where not exists (
  select 1 from public.clinic_booking_windows w
  where w.unidade_id = u.id and w.weekday = d.weekday and w.hora_inicio = t.inicio
);

-- ── Dias fechados (feriado, congresso, viagem da Dra.) ───────────────────────
create table if not exists public.clinic_booking_blackouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'instituto-lorena',
  unidade_id text references public.clinic_booking_units(id) on delete cascade,  -- nulo = todas
  dia date not null,
  motivo text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists clinic_booking_blackouts_dia_idx
  on public.clinic_booking_blackouts (tenant_id, dia);

comment on table public.clinic_booking_blackouts is
  'Dias em que a landing não oferece horário. unidade_id nulo fecha todas as unidades.';

-- ── O pré-agendamento em si ──────────────────────────────────────────────────
create table if not exists public.clinic_prebookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'instituto-lorena',
  -- Código curto que a pessoa vê na tela e repete no WhatsApp ("PA-7K3M").
  protocolo text not null,
  lead_id text references public.leads(id) on delete set null,
  nome text not null,
  telefone text not null,                  -- só dígitos, com DDI
  unidade_id text not null references public.clinic_booking_units(id) on delete restrict,
  slot_at timestamptz not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'confirmado', 'cancelado', 'compareceu', 'faltou')),
  objetivo text not null default '',       -- transplante masculino, sobrancelha, tratamento…
  grau text not null default '',           -- estágio na escala de Norwood
  urgencia text not null default '',       -- quando quer resolver: o filtro que mais separa
  cidade text not null default '',
  score int not null default 0,            -- 0-100, calculado na triagem
  temperatura text not null default 'warm' check (temperatura in ('cold', 'warm', 'hot')),
  estimativa_min int,                      -- unidades foliculares (quartis reais da casa)
  estimativa_max int,
  respostas jsonb not null default '{}'::jsonb,
  atribuicao jsonb,                        -- gclid, utm, fbclid, referrer
  origem text not null default 'landing',
  user_agent text,
  observacao text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmado_em timestamptz,
  confirmado_por uuid,
  cancelado_em timestamptz,
  cancelado_motivo text
);

-- Duas pessoas não pegam o mesmo horário: a corrida é resolvida aqui, no banco,
-- e a segunda recebe "esse horário acabou de ser reservado" em vez de um vazamento.
create unique index if not exists clinic_prebookings_slot_unico
  on public.clinic_prebookings (tenant_id, unidade_id, slot_at)
  where status in ('pendente', 'confirmado');

create index if not exists clinic_prebookings_fila_idx
  on public.clinic_prebookings (tenant_id, status, slot_at);
create index if not exists clinic_prebookings_telefone_idx
  on public.clinic_prebookings (tenant_id, telefone, created_at desc);
create index if not exists clinic_prebookings_lead_idx
  on public.clinic_prebookings (lead_id);

comment on table public.clinic_prebookings is
  'Horário reservado pelo paciente na landing. PRÉ: só vira consulta na Shosp depois que a equipe confirma.';

drop trigger if exists clinic_prebookings_touch on public.clinic_prebookings;
create trigger clinic_prebookings_touch
  before update on public.clinic_prebookings
  for each row execute function public.touch_updated_at();

-- ── RLS: equipe lê e trabalha a fila; anon não toca em nada disto ────────────
alter table public.clinic_booking_settings enable row level security;
alter table public.clinic_booking_units enable row level security;
alter table public.clinic_booking_windows enable row level security;
alter table public.clinic_booking_blackouts enable row level security;
alter table public.clinic_prebookings enable row level security;

drop policy if exists "booking_settings tenant" on public.clinic_booking_settings;
create policy "booking_settings tenant" on public.clinic_booking_settings
  for all to authenticated
  using (public.is_staff_user() and tenant_id = public.current_tenant_id())
  with check (public.is_staff_user() and tenant_id = public.current_tenant_id());

drop policy if exists "booking_units tenant" on public.clinic_booking_units;
create policy "booking_units tenant" on public.clinic_booking_units
  for all to authenticated
  using (public.is_staff_user() and tenant_id = public.current_tenant_id())
  with check (public.is_staff_user() and tenant_id = public.current_tenant_id());

drop policy if exists "booking_windows tenant" on public.clinic_booking_windows;
create policy "booking_windows tenant" on public.clinic_booking_windows
  for all to authenticated
  using (public.is_staff_user() and tenant_id = public.current_tenant_id())
  with check (public.is_staff_user() and tenant_id = public.current_tenant_id());

drop policy if exists "booking_blackouts tenant" on public.clinic_booking_blackouts;
create policy "booking_blackouts tenant" on public.clinic_booking_blackouts
  for all to authenticated
  using (public.is_staff_user() and tenant_id = public.current_tenant_id())
  with check (public.is_staff_user() and tenant_id = public.current_tenant_id());

-- Escrita da fila: a equipe confirma, cancela e carimba comparecimento. O INSERT
-- fica com a edge function (service_role), que é quem valida telefone e corrida.
drop policy if exists "prebookings tenant read" on public.clinic_prebookings;
create policy "prebookings tenant read" on public.clinic_prebookings
  for select to authenticated
  using (public.is_staff_user() and tenant_id = public.current_tenant_id());

drop policy if exists "prebookings tenant update" on public.clinic_prebookings;
create policy "prebookings tenant update" on public.clinic_prebookings
  for update to authenticated
  using (public.is_staff_user() and tenant_id = public.current_tenant_id())
  with check (public.is_staff_user() and tenant_id = public.current_tenant_id());

drop policy if exists "prebookings tenant insert" on public.clinic_prebookings;
create policy "prebookings tenant insert" on public.clinic_prebookings
  for insert to authenticated
  with check (public.is_staff_user() and tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.clinic_booking_settings to authenticated;
grant select, insert, update, delete on public.clinic_booking_units to authenticated;
grant select, insert, update, delete on public.clinic_booking_windows to authenticated;
grant select, insert, update, delete on public.clinic_booking_blackouts to authenticated;
grant select, insert, update on public.clinic_prebookings to authenticated;

-- ── Leitura pública 1: unidades que a landing pode oferecer ──────────────────
create or replace function public.clinica_unidades_publicas()
returns table (id text, rotulo text, cidade text, uf text, endereco text, modalidade text)
language sql
stable
security definer
set search_path = public
as $fn$
  select u.id, u.rotulo, u.cidade, u.uf, u.endereco, u.modalidade
  from public.clinic_booking_units u
  where u.tenant_id = 'instituto-lorena'
    and u.active
    and exists (
      select 1 from public.clinic_booking_windows w
      where w.unidade_id = u.id and w.active
    )
  order by u.sort_order, u.rotulo
$fn$;

comment on function public.clinica_unidades_publicas() is
  'Unidades com agenda aberta na landing. Só endereço de clínica, nenhum dado de pessoa.';

revoke all on function public.clinica_unidades_publicas() from public;
grant execute on function public.clinica_unidades_publicas() to anon, authenticated;

-- ── Leitura pública 2: horários livres ───────────────────────────────────────
-- Devolve APENAS instante livre + unidade. Não diz quem marcou, nem quantos
-- pacientes existem: quem lê descobre o mesmo que descobriria ligando na recepção.
create or replace function public.clinica_agenda_publica(p_unidade text default null, p_dias int default null)
returns table (unidade_id text, slot_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  with cfg as (
    select
      s.timezone as tz,
      s.lead_time_hours as lead_h,
      least(coalesce(p_dias, s.horizon_days), 60) as dias,
      s.max_consultas_por_horario as cap_agenda,
      s.active as ativo
    from public.clinic_booking_settings s
    where s.tenant_id = 'instituto-lorena'
  ),
  dia as (
    select g::date as d
    from cfg c,
         generate_series(
           (now() at time zone c.tz)::date,
           (now() at time zone c.tz)::date + c.dias,
           interval '1 day'
         ) g
  ),
  janela as (
    select w.unidade_id, w.weekday, w.hora_inicio, w.hora_fim, w.slot_minutes, u.shosp_codigo_unidade
    from public.clinic_booking_windows w
    join public.clinic_booking_units u on u.id = w.unidade_id and u.active
    where w.tenant_id = 'instituto-lorena'
      and w.active
      and (p_unidade is null or w.unidade_id = p_unidade)
  ),
  candidato as (
    select
      j.unidade_id,
      j.shosp_codigo_unidade,
      g.local_ts,
      (g.local_ts at time zone c.tz) as slot_at
    from dia d
    join janela j on j.weekday = extract(dow from d.d)
    cross join cfg c
    cross join lateral generate_series(
      (d.d + j.hora_inicio)::timestamp,
      (d.d + j.hora_fim)::timestamp - make_interval(mins => j.slot_minutes),
      make_interval(mins => j.slot_minutes)
    ) g(local_ts)
    where not exists (
      select 1 from public.clinic_booking_blackouts b
      where b.tenant_id = 'instituto-lorena'
        and b.dia = d.d
        and (b.unidade_id is null or b.unidade_id = j.unidade_id)
    )
  )
  select k.unidade_id, k.slot_at
  from candidato k
  cross join cfg c
  where c.ativo
    and k.slot_at >= now() + make_interval(hours => c.lead_h)
    and not exists (
      select 1 from public.clinic_prebookings p
      where p.tenant_id = 'instituto-lorena'
        and p.unidade_id = k.unidade_id
        and p.slot_at = k.slot_at
        and p.status in ('pendente', 'confirmado')
    )
    and (
      k.shosp_codigo_unidade is null
      or (
        select count(distinct upper(coalesce(a.prestador, '')))
        from public.shosp_appointments a
        where a.codigo_unidade = k.shosp_codigo_unidade
          and a.data = k.local_ts::date
          and left(coalesce(a.horario, ''), 5) = to_char(k.local_ts, 'HH24:MI')
          and a.status in ('Agendado', 'Confirmado')
      ) < c.cap_agenda
    )
  order by k.slot_at
$fn$;

comment on function public.clinica_agenda_publica(text, int) is
  'Horários livres da landing: grade menos blackout, menos pré-agendamento e menos o que a Shosp já tem ocupado.';

revoke all on function public.clinica_agenda_publica(text, int) from public;
grant execute on function public.clinica_agenda_publica(text, int) to anon, authenticated;
