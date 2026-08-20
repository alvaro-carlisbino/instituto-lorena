-- ─────────────────────────────────────────────────────────────────────────────
-- A agenda da landing passa a ser a agenda da SHOSP
--
-- A primeira versão da /consulta montava os horários a partir de uma grade
-- própria (`clinic_booking_windows`) e só escondia o que o espelho de
-- agendamentos mostrava ocupado. Isso erra de três jeitos, e todos apareceram no
-- teste de 20/08:
--   1. inventava horário que não existe. A Dra. Lorena atende de hora em hora e
--      tem 10:45; a grade oferecia 09:30 e 13:30, que não existem na agenda dela.
--   2. oferecia dia FECHADO. 21/08 está "AGENDA FECHADA" para a Lorena e a landing
--      vendia seis horários nesse dia.
--   3. não dizia com QUEM era a consulta, então a equipe teria que adivinhar.
--
-- A resposta da Shosp (`/agenda/get/`) já traz a grade real por profissional e por
-- dia, com três tipos de linha: livre (`codigoHorario` sem agendamento), ocupada
-- (`codigoAgendamento`) e fechada (`restricao: AGENDA FECHADA`). O espelho antigo
-- jogava a linha LIVRE fora, que é justamente a que a landing precisa.
--
-- A partir daqui:
--   `shosp_agenda_slots`        = espelho dos horários LIVRES, direto da Shosp.
--   `clinic_booking_prestadores`= quem atende o quê (a landing só oferece médico
--                                 que atende aquele objetivo).
--   `clinic_booking_windows`    = deixa de ser fonte e vira MÁSCARA de horário
--                                 comercial (a Shosp abre 05:00 no template; a
--                                 clínica não vende 05:00).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Espelho dos horários livres ──────────────────────────────────────────────
create table if not exists public.shosp_agenda_slots (
  codigo_unidade text not null,
  codigo_prestador text not null,
  prestador text not null default '',
  dia date not null,
  horario text not null,                    -- 'HH:MM', como a Shosp devolve
  codigo_horario text,                      -- codigoHorario da Shosp (serve para agendar depois)
  synced_at timestamptz not null default now(),
  primary key (codigo_unidade, codigo_prestador, dia, horario)
);

create index if not exists shosp_agenda_slots_dia_idx on public.shosp_agenda_slots (dia, codigo_unidade);

comment on table public.shosp_agenda_slots is
  'Horários LIVRES lidos da agenda da Shosp. Some daqui = some da landing. Escrito só pelo sync (service_role).';

alter table public.shosp_agenda_slots enable row level security;

drop policy if exists "shosp_agenda_slots leitura equipe" on public.shosp_agenda_slots;
create policy "shosp_agenda_slots leitura equipe" on public.shosp_agenda_slots
  for select to authenticated using (public.is_staff_user());

grant select on public.shosp_agenda_slots to authenticated;

-- ── Quem atende o quê ────────────────────────────────────────────────────────
create table if not exists public.clinic_booking_prestadores (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'instituto-lorena',
  unidade_id text not null references public.clinic_booking_units(id) on delete cascade,
  codigo_prestador text not null,
  nome text not null,
  rotulo_publico text not null,
  -- Objetivos da triagem que este profissional atende. Vazio = nenhum, e aí ele
  -- não aparece na landing (é assim que se tira alguém do ar sem apagar nada).
  objetivos text[] not null default '{}',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, unidade_id, codigo_prestador)
);

comment on table public.clinic_booking_prestadores is
  'Ponte entre o objetivo que o paciente marcou na triagem e o profissional da Shosp que atende aquilo.';

alter table public.clinic_booking_prestadores enable row level security;

drop policy if exists "booking_prestadores tenant" on public.clinic_booking_prestadores;
create policy "booking_prestadores tenant" on public.clinic_booking_prestadores
  for all to authenticated
  using (public.is_staff_user() and tenant_id = public.current_tenant_id())
  with check (public.is_staff_user() and tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.clinic_booking_prestadores to authenticated;

-- Mapa inicial tirado do histórico real de serviços por profissional na Shosp.
insert into public.clinic_booking_prestadores (unidade_id, codigo_prestador, nome, rotulo_publico, objetivos, sort_order)
select u.id, v.codigo, v.nome, v.rotulo, v.objetivos, v.ordem
from (values
  ('2', 'LORENA VISENTAINER', 'Dra. Lorena Visentainer',
    array['transplante_masculino','transplante_feminino','sobrancelha','barba','tratamento','nao_sei'], 0),
  ('5', 'MATHEUS JUAN BRENNER DO AMARAL', 'Dr. Matheus Juan',
    array['transplante_masculino','transplante_feminino','tratamento','nao_sei'], 1),
  ('8', 'JAQUELINE AUGUSTO', 'Dra. Jaqueline Augusto',
    array['transplante_feminino','transplante_masculino','tratamento','nao_sei'], 2)
) as v(codigo, nome, rotulo, objetivos, ordem)
cross join (select id from public.clinic_booking_units where id in ('maringa', 'online')) u
on conflict (tenant_id, unidade_id, codigo_prestador) do nothing;

-- ── A reserva passa a saber com quem é ───────────────────────────────────────
alter table public.clinic_prebookings
  add column if not exists codigo_prestador text,
  add column if not exists prestador text not null default '',
  add column if not exists codigo_horario text;

comment on column public.clinic_prebookings.codigo_prestador is
  'Profissional da Shosp cujo horário foi reservado. Sem isto a equipe não sabe em qual agenda lançar.';

-- Dois pacientes podem marcar 10:00 no mesmo dia se forem médicos diferentes: a
-- trava é por profissional, não por relógio.
drop index if exists clinic_prebookings_slot_unico;
create unique index if not exists clinic_prebookings_slot_unico
  on public.clinic_prebookings (tenant_id, unidade_id, coalesce(codigo_prestador, ''), slot_at)
  where status in ('pendente', 'confirmado');

-- ── Máscara de horário comercial ─────────────────────────────────────────────
-- A grade deixa de gerar horário e passa só a limitar. O template da Shosp abre
-- 05:00 e sábado inteiro; a clínica atende de segunda a sexta em horário comercial.
update public.clinic_booking_windows
   set hora_inicio = time '08:00', hora_fim = time '18:00'
 where tenant_id = 'instituto-lorena';

delete from public.clinic_booking_windows w
 where w.tenant_id = 'instituto-lorena'
   and w.hora_inicio = time '08:00'
   and exists (
     select 1 from public.clinic_booking_windows w2
     where w2.unidade_id = w.unidade_id
       and w2.weekday = w.weekday
       and w2.hora_inicio = w.hora_inicio
       and w2.id < w.id
   );

comment on table public.clinic_booking_windows is
  'MÁSCARA de horário comercial por unidade e dia da semana. Não gera horário: só limita o que veio da Shosp.';

-- ── A agenda pública, agora com origem na Shosp ──────────────────────────────
drop function if exists public.clinica_agenda_publica(text, int);

create or replace function public.clinica_agenda_publica(
  p_unidade text default null,
  p_dias int default null,
  p_objetivo text default null
)
returns table (unidade_id text, slot_at timestamptz, codigo_prestador text, profissional text)
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
      s.active as ativo
    from public.clinic_booking_settings s
    where s.tenant_id = 'instituto-lorena'
  ),
  candidato as (
    select
      u.id as unidade_id,
      pr.codigo_prestador,
      pr.rotulo_publico,
      pr.sort_order,
      ((s.dia + s.horario::time) at time zone c.tz) as slot_at,
      s.dia,
      s.horario::time as hora
    from public.shosp_agenda_slots s
    cross join cfg c
    join public.clinic_booking_units u
      on u.shosp_codigo_unidade = s.codigo_unidade
     and u.active
     and (p_unidade is null or u.id = p_unidade)
    join public.clinic_booking_prestadores pr
      on pr.unidade_id = u.id
     and pr.codigo_prestador = s.codigo_prestador
     and pr.active
     and (p_objetivo is null or p_objetivo = any (pr.objetivos))
    where s.dia between (now() at time zone c.tz)::date and (now() at time zone c.tz)::date + c.dias
  ),
  dentro_do_expediente as (
    select k.*
    from candidato k
    where exists (
      select 1
      from public.clinic_booking_windows w
      where w.tenant_id = 'instituto-lorena'
        and w.unidade_id = k.unidade_id
        and w.active
        and w.weekday = extract(dow from k.dia)
        and k.hora >= w.hora_inicio
        and k.hora < w.hora_fim
    )
    and not exists (
      select 1
      from public.clinic_booking_blackouts b
      where b.tenant_id = 'instituto-lorena'
        and b.dia = k.dia
        and (b.unidade_id is null or b.unidade_id = k.unidade_id)
    )
  )
  -- Um botão por horário: se dois profissionais estão livres às 10:00, a landing
  -- mostra um horário só, com quem tiver a menor ordem. Escolher médico não é
  -- decisão de quem ainda não sabe se tem indicação.
  select distinct on (k.unidade_id, k.slot_at)
    k.unidade_id, k.slot_at, k.codigo_prestador, k.rotulo_publico
  from dentro_do_expediente k
  cross join cfg c
  where c.ativo
    and k.slot_at >= now() + make_interval(hours => c.lead_h)
    and not exists (
      select 1 from public.clinic_prebookings p
      where p.tenant_id = 'instituto-lorena'
        and p.unidade_id = k.unidade_id
        and p.slot_at = k.slot_at
        and coalesce(p.codigo_prestador, '') = k.codigo_prestador
        and p.status in ('pendente', 'confirmado')
    )
  order by k.unidade_id, k.slot_at, k.sort_order
$fn$;

comment on function public.clinica_agenda_publica(text, int, text) is
  'Horários que a landing pode oferecer: livres na agenda da Shosp, dentro do expediente, sem feriado e sem reserva nossa.';

revoke all on function public.clinica_agenda_publica(text, int, text) from public;
grant execute on function public.clinica_agenda_publica(text, int, text) to anon, authenticated;
