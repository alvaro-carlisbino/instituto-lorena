-- Fase 0 dos apps: espelho do sistema de centro cirúrgico (MySQL c7lorenaap) no Supabase.
--
-- Por quê: o app do paciente (e qualquer relatório do CRM) não pode falar com o
-- MySQL do cPanel. O sistema PHP/CI4 continua sendo a fonte de ESCRITA — o centro
-- cirúrgico roda com paciente na mesa e não se reescreve. Aqui é espelho de LEITURA,
-- unidirecional, idempotente, chaveado pelo id do MySQL.
--
-- O que NÃO vem no espelho, de propósito:
--   • cirurgia.anamnese e cirurgia.observacoes — texto clínico livre. Nada no app
--     do paciente usa, e mirrorar aumenta superfície de vazamento à toa. Quando o
--     prontuário no CRM precisar, é só adicionar coluna e refazer o full sync.
--   • cliente.email / cliente.senha — credenciais do sistema PHP.
--
-- Fuso: os datetime do MySQL não têm timezone e o servidor roda em UTC-3
-- (validado: now()=14:26 vs utc_timestamp()=17:26). O sync converte assumindo
-- America/Sao_Paulo antes de gravar em timestamptz.

-- ---------------------------------------------------------------------------
-- 1) Tabelas de apoio (cadastros do sistema de cirurgia)
-- ---------------------------------------------------------------------------

create table if not exists public.srg_staff (
  id                int primary key,                         -- cliente.id no MySQL
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  nome              text,
  tipo              text,                                    -- ADMIN|MEDICO|ANESTESISTA|IMPLANTADOR|SECRETARIA
  status            text,                                    -- ATIVO|INATIVO|AGUARDANDO|EM_APROVACAO
  telefone          text,
  app_user_id       text references public.app_users (id),   -- vínculo opcional com o usuário do CRM
  deleted_at        timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);
create index if not exists srg_staff_tipo_idx on public.srg_staff (tenant_id, tipo) where deleted_at is null;

create table if not exists public.srg_areas (
  id                int primary key,                         -- area.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  titulo            text,
  ordem             int,
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);

create table if not exists public.srg_categories (
  id                int primary key,                         -- categoria.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  titulo            text,
  ordem             int,
  ativo             boolean,
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);

create table if not exists public.srg_plates (
  id                int primary key,                         -- placa.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  nome              text,
  numero            smallint,
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) Cirurgia
-- ---------------------------------------------------------------------------

create table if not exists public.srg_surgeries (
  id                 int primary key,                        -- cirurgia.id
  tenant_id          text not null default 'instituto-lorena' references public.tenants (id),

  -- identidade do paciente: no MySQL é varchar solto, sem vínculo nenhum
  paciente_nome      text,
  paciente_prontuario text,                                  -- extraído do prefixo "5480 - " quando existe
  lead_id            text references public.leads (id) on delete set null,
  shosp_prontuario   text,
  match_status       text not null default 'pendente',       -- pendente|auto|manual|sem_match|ignorado
  match_score        numeric,                                -- 1.0 = nome idêntico normalizado
  matched_at         timestamptz,
  matched_by         uuid,

  dia                date,
  hora_inicio        timestamptz,
  dt_fim             timestamptz,
  status             text,                                   -- AGUARDANDO|EM_PROCESSO|FINALIZADA
  sala               text,
  idade              int,
  meta               int,
  medico_id          int references public.srg_staff (id),
  anestesista_id     int references public.srg_staff (id),

  -- agregados recalculados a cada sync (evita somar 8.700 linhas em toda leitura)
  total_extraidos    int not null default 0,
  total_implantados  int not null default 0,

  deleted_at         timestamptz,
  source_created_at  timestamptz,
  source_updated_at  timestamptz,
  synced_at          timestamptz not null default now()
);
create index if not exists srg_surgeries_dia_idx    on public.srg_surgeries (tenant_id, dia desc) where deleted_at is null;
create index if not exists srg_surgeries_lead_idx   on public.srg_surgeries (tenant_id, lead_id)  where lead_id is not null;
create index if not exists srg_surgeries_pront_idx  on public.srg_surgeries (tenant_id, shosp_prontuario) where shosp_prontuario is not null;
create index if not exists srg_surgeries_match_idx  on public.srg_surgeries (tenant_id, match_status);

create table if not exists public.srg_surgery_areas (
  id                int primary key,                         -- cirurgia_area.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  surgery_id        int not null references public.srg_surgeries (id) on delete cascade,
  area_id           int references public.srg_areas (id),
  meta              int,
  tipo              smallint,
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);
create index if not exists srg_surgery_areas_surgery_idx on public.srg_surgery_areas (surgery_id) where deleted_at is null;

create table if not exists public.srg_stages (
  id                int primary key,                         -- cirurgia_etapa.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  surgery_id        int not null references public.srg_surgeries (id) on delete cascade,
  etapa             text,                                    -- PRE-CIRURGICO|ANESTESIA1|PRE_INSICOES|ANESTESIA2|EXTRACAO|IMPLANTE|RPA|ALTA|ALTA_ANESTESICA
  tipo              text,                                    -- INICIO|CONCLUIDO
  horario           timestamptz,
  observacoes       text,
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);
create index if not exists srg_stages_surgery_idx on public.srg_stages (surgery_id, horario) where deleted_at is null;

create table if not exists public.srg_hours (
  id                int primary key,                         -- cirurgia_hora.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  surgery_id        int not null references public.srg_surgeries (id) on delete cascade,
  hora              smallint,
  mamba             int,
  tipo              text,                                    -- EXTRACAO|IMPLANTACAO|CONTAGEM|IMPLANTACAO(D|E|C)
  status            text,                                    -- PAUSE|PLAY
  implantador_d     int references public.srg_staff (id),
  auxiliar_d        int references public.srg_staff (id),
  auxiliar_d2       int references public.srg_staff (id),
  implantador_e     int references public.srg_staff (id),
  auxiliar_e        int references public.srg_staff (id),
  auxiliar_e2       int references public.srg_staff (id),
  implantador_c     int references public.srg_staff (id),
  auxiliar_c        int references public.srg_staff (id),
  auxiliar_c2       int references public.srg_staff (id),
  inicio_d          timestamptz,
  inicio_e          timestamptz,
  inicio_c          timestamptz,
  dt_fim            timestamptz,
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);
create index if not exists srg_hours_surgery_idx on public.srg_hours (surgery_id, hora) where deleted_at is null;

create table if not exists public.srg_follicles_extracted (
  id                int primary key,                         -- cirurgia_foliculo_extraido.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  surgery_id        int not null references public.srg_surgeries (id) on delete cascade,
  plate_id          int references public.srg_plates (id),
  hour_id           int,                                     -- cirurgia_hora.id (sem FK: hora pode vir depois no sync)
  quantidade1       int,
  quantidade2       int,
  lapidado          boolean,
  medico_id         int references public.srg_staff (id),
  numero            smallint,
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);
create index if not exists srg_fol_ext_surgery_idx on public.srg_follicles_extracted (surgery_id) where deleted_at is null;

create table if not exists public.srg_follicles_implanted (
  id                int primary key,                         -- cirurgia_foliculo_implantado.id
  tenant_id         text not null default 'instituto-lorena' references public.tenants (id),
  surgery_id        int not null references public.srg_surgeries (id) on delete cascade,
  extracted_id      int,                                     -- cirurgia_foliculo_extraidoFK
  surgery_area_id   int,                                     -- cirurgia_areaFK
  hour_id           int,                                     -- cirurgia_horaFK
  quantidade        int,
  regiao            text,                                    -- DIREITA|CENTRO|ESQUERDA
  deleted_at        timestamptz,
  source_updated_at timestamptz,
  synced_at         timestamptz not null default now()
);
create index if not exists srg_fol_imp_surgery_idx on public.srg_follicles_implanted (surgery_id) where deleted_at is null;
create index if not exists srg_fol_imp_area_idx    on public.srg_follicles_implanted (surgery_area_id) where deleted_at is null;

create table if not exists public.srg_sync_state (
  key                     text primary key,                  -- nome da tabela de origem
  last_run_at             timestamptz,
  last_source_updated_at  timestamptz,                       -- watermark do dtAlteracao já trazido
  rows_upserted           int not null default 0,
  ok                      boolean not null default true,
  error                   text
);

-- ---------------------------------------------------------------------------
-- 3) Recalcular os agregados de folículos de uma cirurgia
--    (chamado pelo sync depois de gravar os lotes)
-- ---------------------------------------------------------------------------

create or replace function public.srg_refresh_totals(p_surgery_ids int[] default null)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare n int;
begin
  with alvo as (
    select s.id
    from public.srg_surgeries s
    where p_surgery_ids is null or s.id = any (p_surgery_ids)
  ),
  calc as (
    select a.id,
           coalesce((select sum(coalesce(e.quantidade1, 0) + coalesce(e.quantidade2, 0))
                     from public.srg_follicles_extracted e
                     where e.surgery_id = a.id and e.deleted_at is null), 0) as ext,
           coalesce((select sum(coalesce(i.quantidade, 0))
                     from public.srg_follicles_implanted i
                     where i.surgery_id = a.id and i.deleted_at is null), 0) as imp
    from alvo a
  )
  update public.srg_surgeries s
     set total_extraidos   = calc.ext,
         total_implantados = calc.imp
    from calc
   where s.id = calc.id
     and (s.total_extraidos is distinct from calc.ext or s.total_implantados is distinct from calc.imp);

  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function public.srg_refresh_totals(int[]) from public, anon;
grant execute on function public.srg_refresh_totals(int[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4) RLS — espelho da cirurgia é dado clínico: só membro de polo 'clinic' lê.
--    Escrita é exclusiva do sync (service_role, que ignora RLS).
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'srg_staff', 'srg_areas', 'srg_categories', 'srg_plates',
    'srg_surgeries', 'srg_surgery_areas', 'srg_stages', 'srg_hours',
    'srg_follicles_extracted', 'srg_follicles_implanted', 'srg_sync_state'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s read clinic" on public.%I', t, t);
    execute format($p$
      create policy "%s read clinic" on public.%I
        for select to authenticated
        using (exists (
          select 1
          from public.tenant_members m
          join public.tenants tn on tn.id = m.tenant_id
          where m.auth_user_id = auth.uid()
            and tn.polo_type = 'clinic'
        ))
    $p$, t, t);
  end loop;
end $$;

-- O vínculo paciente↔lead é a única coluna que a equipe edita à mão (tela de
-- conferência no CRM). Update restrito a essas colunas via RPC (item 5), então
-- nenhuma policy de UPDATE direto é criada aqui de propósito.

-- ---------------------------------------------------------------------------
-- 5) Vínculo cirurgia ↔ paciente
-- ---------------------------------------------------------------------------

-- Normaliza nome para comparação: sem acento, minúsculo, sem prefixo de
-- prontuário ("5480 - fulano"), sem pontuação e com espaços colapsados.
-- STABLE, não IMMUTABLE: unaccent() depende do dicionário instalado e é STABLE.
-- Marcar como immutable aqui deixaria índice funcional mentir depois.
create or replace function public.srg_norm_name(p text)
returns text
language sql
stable
set search_path = public
as $fn$
  select nullif(
    trim(regexp_replace(
      regexp_replace(
        unaccent(lower(regexp_replace(coalesce(p, ''), '^\s*[0-9]+\s*-\s*', ''))),
        '[^a-z0-9 ]', ' ', 'g'),
      '\s+', ' ', 'g')),
    '')
$fn$;

-- Casa cirurgias pendentes contra o espelho Shosp. Só grava vínculo quando o
-- nome normalizado bate em EXATAMENTE um paciente — nome ambíguo (dois "joão
-- carlos da cunha") fica pendente para conferência humana, nunca chuta.
create or replace function public.srg_match_patients(p_only_pending boolean default true)
returns table (matched int, ambiguous int, unmatched int)
language plpgsql
security definer
set search_path = public
as $fn$
declare v_matched int := 0; v_amb int := 0; v_unm int := 0;
begin
  with alvo as (
    select s.id, public.srg_norm_name(s.paciente_nome) as nm
    from public.srg_surgeries s
    where s.deleted_at is null
      and (not p_only_pending or s.match_status = 'pendente')
      and public.srg_norm_name(s.paciente_nome) is not null
  ),
  cand as (
    select a.id,
           (select count(*) from public.shosp_patients p
             where public.srg_norm_name(p.nome) = a.nm) as n,
           (select min(p.prontuario) from public.shosp_patients p
             where public.srg_norm_name(p.nome) = a.nm) as pront
    from alvo a
  ),
  upd as (
    update public.srg_surgeries s
       set shosp_prontuario = case when c.n = 1 then c.pront else s.shosp_prontuario end,
           lead_id          = case when c.n = 1
                                   then (select sp.lead_id from public.shosp_patients sp
                                          where sp.prontuario = c.pront)
                                   else s.lead_id end,
           match_status     = case when c.n = 1 then 'auto'
                                   when c.n > 1 then 'pendente'
                                   else 'sem_match' end,
           match_score      = case when c.n = 1 then 1.0 else null end,
           matched_at       = case when c.n = 1 then now() else s.matched_at end
      from cand c
     where s.id = c.id
    returning c.n
  )
  select count(*) filter (where n = 1),
         count(*) filter (where n > 1),
         count(*) filter (where n = 0)
    into v_matched, v_amb, v_unm
  from upd;

  -- Prontuário embutido no nome ("5480 - fulano") é vínculo explícito e ganha
  -- de qualquer casamento por nome.
  update public.srg_surgeries s
     set paciente_prontuario = m.pront,
         shosp_prontuario    = m.pront,
         lead_id             = coalesce(
                                 (select sp.lead_id from public.shosp_patients sp where sp.prontuario = m.pront),
                                 s.lead_id),
         match_status        = 'auto',
         match_score         = 1.0,
         matched_at          = now()
    from (
      select id, (regexp_match(coalesce(paciente_nome, ''), '^\s*([0-9]+)\s*-\s*'))[1] as pront
      from public.srg_surgeries
      where deleted_at is null
        and paciente_nome ~ '^\s*[0-9]+\s*-\s*'
    ) m
   where s.id = m.id
     and m.pront is not null
     and exists (select 1 from public.shosp_patients sp where sp.prontuario = m.pront);

  return query select v_matched, v_amb, v_unm;
end $fn$;

revoke all on function public.srg_match_patients(boolean) from public, anon;
grant execute on function public.srg_match_patients(boolean) to service_role, authenticated;

-- Vínculo manual (tela de conferência). Só membro de polo clínica.
create or replace function public.srg_link_patient(p_surgery_id int, p_prontuario text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (
    select 1 from public.tenant_members m
    join public.tenants tn on tn.id = m.tenant_id
    where m.auth_user_id = auth.uid() and tn.polo_type = 'clinic'
  ) then
    raise exception 'sem permissao';
  end if;

  if p_prontuario is null then                       -- desvincular / marcar como sem match
    update public.srg_surgeries
       set lead_id = null, shosp_prontuario = null,
           match_status = 'ignorado', match_score = null,
           matched_at = now(), matched_by = auth.uid()
     where id = p_surgery_id;
    return;
  end if;

  if not exists (select 1 from public.shosp_patients where prontuario = p_prontuario) then
    raise exception 'prontuario % nao existe no espelho Shosp', p_prontuario;
  end if;

  update public.srg_surgeries s
     set shosp_prontuario = p_prontuario,
         lead_id          = (select sp.lead_id from public.shosp_patients sp where sp.prontuario = p_prontuario),
         match_status     = 'manual',
         match_score      = null,
         matched_at       = now(),
         matched_by       = auth.uid()
   where s.id = p_surgery_id;
end $fn$;

revoke all on function public.srg_link_patient(int, text) from public, anon;
grant execute on function public.srg_link_patient(int, text) to authenticated;
