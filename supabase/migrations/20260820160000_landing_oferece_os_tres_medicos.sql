-- ─────────────────────────────────────────────────────────────────────────────
-- A landing passa a oferecer os TRÊS médicos, e não só a primeira vaga
--
-- Todo mundo pede a Dra. Lorena, e ela é o recurso mais escasso da casa: opera
-- quase todo dia e atende consulta de manhã. Antes, a página mostrava um botão por
-- horário e escolhia sozinha o profissional (o de menor ordem), o que fazia duas
-- coisas ruins ao mesmo tempo: escondia o Dr. Matheus e a Dra. Jaqueline quando a
-- Dra. Lorena tinha vaga, e não dava alternativa quando ela não tinha.
--
-- Agora a agenda devolve TODOS os profissionais livres em cada horário, e existe
-- uma função que responde a pergunta que o paciente realmente faz: "com quem eu
-- consigo, e quando?". Profissional sem vaga aparece assim mesmo, com a resposta
-- honesta, em vez de sumir da tela.
--
-- Os três atendem todos os tipos, como está escrito no próprio script da Sofia:
-- "Disponível para todos os tipos de atendimento. Realiza também consulta online."
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clinic_booking_prestadores
  add column if not exists credencial text not null default '',
  add column if not exists descricao text not null default '';

comment on column public.clinic_booking_prestadores.credencial is
  'CRM/RQE como aparece na página. Vem da Shosp (siglaConselhoProfissional), não do meu chute.';

update public.clinic_booking_prestadores set
  credencial = 'CRM 33717 | RQE 27798',
  descricao = 'Especialista em saúde e restauração capilar, criadora do método Transplante Capilar Regenerativo®.',
  objetivos = array['transplante_masculino','transplante_feminino','sobrancelha','barba','tratamento','nao_sei']
where codigo_prestador = '2';

update public.clinic_booking_prestadores set
  credencial = 'CRM 43183 PR',
  descricao = 'Avaliação clínica capilar individualizada, com acompanhamento detalhado de cada caso.',
  objetivos = array['transplante_masculino','transplante_feminino','sobrancelha','barba','tratamento','nao_sei']
where codigo_prestador = '5';

update public.clinic_booking_prestadores set
  credencial = 'CRM 51433 PR',
  descricao = 'Foco em saúde capilar e cuidado individualizado, com avaliação atenciosa de cada paciente.',
  objetivos = array['transplante_masculino','transplante_feminino','sobrancelha','barba','tratamento','nao_sei']
where codigo_prestador = '8';

-- ── Agenda: um registro por horário E por profissional ──────────────────────
drop function if exists public.clinica_agenda_publica(text, int, text);

create or replace function public.clinica_agenda_publica(
  p_unidade text default null,
  p_dias int default null,
  p_objetivo text default null,
  p_prestador text default null
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
  -- Dia em que o médico está no centro cirúrgico. A Shosp não sabe disto.
  cirurgia as (
    select distinct s.dia, s.medico_id
    from public.srg_surgeries s
    where s.deleted_at is null
      and s.status in ('AGUARDANDO', 'EM_PROCESSO', 'FINALIZADA')
      and s.dia >= current_date - 1
  ),
  candidato as (
    select
      u.id as unidade_id,
      pr.codigo_prestador,
      pr.rotulo_publico,
      pr.sort_order,
      pr.max_por_dia,
      ((s.dia + s.horario::time) at time zone c.tz) as slot_at,
      s.dia,
      s.horario::time as hora,
      exists (
        select 1 from cirurgia cir
        where cir.dia = s.dia and cir.medico_id = pr.srg_medico_id
      ) as dia_de_cirurgia,
      pr.hora_inicio,
      pr.hora_fim,
      pr.hora_inicio_cirurgia,
      pr.hora_fim_cirurgia
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
     and (p_prestador is null or pr.codigo_prestador = p_prestador)
    where s.dia between (now() at time zone c.tz)::date and (now() at time zone c.tz)::date + c.dias
  ),
  no_turno as (
    select k.*
    from candidato k
    where case
            when k.dia_de_cirurgia then
              k.hora_inicio_cirurgia is not null
              and k.hora >= k.hora_inicio_cirurgia
              and k.hora < k.hora_fim_cirurgia
            else
              k.hora >= k.hora_inicio and k.hora < k.hora_fim
          end
      and exists (
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
      and (
        select count(*)
        from public.clinic_prebookings p
        where p.tenant_id = 'instituto-lorena'
          and p.codigo_prestador = k.codigo_prestador
          and p.status in ('pendente', 'confirmado')
          and (p.slot_at at time zone (select tz from cfg))::date = k.dia
      ) < k.max_por_dia
  )
  select k.unidade_id, k.slot_at, k.codigo_prestador, k.rotulo_publico
  from no_turno k
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
  order by k.slot_at, k.sort_order
$fn$;

comment on function public.clinica_agenda_publica(text, int, text, text) is
  'Horários livres por profissional: agenda da Shosp, menos cirurgia, fora do turno, feriado, expediente, teto diário e o que a landing já reservou.';

revoke all on function public.clinica_agenda_publica(text, int, text, text) from public;
grant execute on function public.clinica_agenda_publica(text, int, text, text) to anon, authenticated;

-- ── "Com quem eu consigo, e quando?" ────────────────────────────────────────
create or replace function public.clinica_profissionais_publicos(
  p_unidade text default null,
  p_objetivo text default null,
  p_dias int default null
)
returns table (
  codigo_prestador text,
  profissional text,
  credencial text,
  descricao text,
  vagas int,
  proxima timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  with ag as (
    select * from public.clinica_agenda_publica(p_unidade, p_dias, p_objetivo, null)
  )
  select
    pr.codigo_prestador,
    pr.rotulo_publico,
    pr.credencial,
    pr.descricao,
    count(ag.slot_at)::int,
    min(ag.slot_at)
  from public.clinic_booking_prestadores pr
  left join ag on ag.codigo_prestador = pr.codigo_prestador
  where pr.tenant_id = 'instituto-lorena'
    and pr.active
    and (p_objetivo is null or p_objetivo = any (pr.objetivos))
    and (p_unidade is null or pr.unidade_id = p_unidade)
  group by pr.codigo_prestador, pr.rotulo_publico, pr.credencial, pr.descricao, pr.sort_order
  order by pr.sort_order
$fn$;

comment on function public.clinica_profissionais_publicos(text, text, int) is
  'Quem atende e quando tem a próxima vaga. Profissional sem vaga aparece com zero, para a página dizer a verdade em vez de esconder.';

revoke all on function public.clinica_profissionais_publicos(text, text, int) from public;
grant execute on function public.clinica_profissionais_publicos(text, text, int) to anon, authenticated;
