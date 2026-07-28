-- Funil real (crm_analytics_v2): dois consertos de honestidade da métrica.
--
-- 1) VAZAMENTO DE UM DIA POR FUSO (causa do "ontem não agendamos nada e o card
--    mostra 7"). O front manda o período em horário local: 27/07 00:00 e
--    27/07 23:59:59 (-03:00). O banco roda em UTC, então `p_end::date` virava
--    2026-07-28 — e o filtro `a.data <= p_end::date` passava a incluir a agenda
--    do DIA SEGUINTE inteiro. No caso relatado: 4 consultas de 27/07 + 3 de
--    28/07 = os 7 do card. Qualquer janela curta ficava inflada em 1 dia.
--    Correção: converter os limites para a data LOCAL da clínica
--    (America/Sao_Paulo) antes de comparar com `shosp_appointments.data`, que é
--    `date` (dia da consulta, sem fuso).
--
-- 2) FRESCOR DA AGENDA. O espelho da Shosp pode congelar sem ninguém perceber
--    (cota 429 deixou a agenda parada de 09 a 28/jul). A RPC passa a devolver
--    `agenda_sync` = { ultimo_sync, dias_atras } para a tela avisar que o número
--    de consultas é uma foto velha, em vez de apresentá-lo como dado do dia.
--
-- Não muda a semântica das outras métricas: Leads/Ativos/Perdidos seguem sendo a
-- coorte de leads CRIADOS no período; Agendados/Compareceram/No-show seguem
-- contando consultas cuja DATA cai no período (a Shosp não informa quando o
-- agendamento foi marcado — só a data em que a consulta acontece).

create or replace function public.crm_analytics_v2(
  p_start timestamptz default (now() - interval '30 days'),
  p_end timestamptz default now(),
  p_source text default null,
  p_owner text default null,
  p_tenant text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_summary jsonb;
  v_by_source jsonb;
  v_shosp_funnel jsonb;
  v_by_stage jsonb;
  v_by_sdr jsonb;
  v_lost jsonb;
  v_time_stage jsonb;
  v_agenda_sync jsonb;
  v_start_dia date := (p_start at time zone 'America/Sao_Paulo')::date;
  v_end_dia date := (p_end at time zone 'America/Sao_Paulo')::date;
begin
  -- Leads CRIADOS no período (coorte) — base de volume/etapa/perda.
  create temp table _leads on commit drop as
  select l.id, l.source, l.owner_id, l.stage_id, l.pipeline_id, l.created_at,
         l.lost_reason, l.conversation_status, l.stage_entered_at, l.shosp_prontuario
  from public.leads l
  where l.deleted_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and l.created_at >= p_start and l.created_at <= p_end
    and (p_source is null or l.source = p_source)
    and (p_owner is null or l.owner_id = p_owner)
    and (p_tenant is null or l.tenant_id = p_tenant);

  -- Agendamentos Shosp por lead com a DATA da consulta dentro do período, usando
  -- o dia LOCAL da clínica (evita o vazamento de 1 dia descrito acima).
  -- comparecido é PROXY: consulta passada não cancelada/faltou = compareceu.
  create temp table _appt on commit drop as
  select a.lead_id,
         bool_or(a.status ilike 'agendad%' or a.status ilike 'confirmad%') as agendado,
         bool_or(
           a.status ilike 'atendid%' or a.status ilike 'comparec%' or a.status ilike 'realizad%'
           or (a.data < (now() at time zone 'America/Sao_Paulo')::date
               and (a.status ilike 'agendad%' or a.status ilike 'confirmad%'))
         ) as comparecido,
         bool_or(a.status ilike 'falt%' or (a.status ilike '%compareceu%' and a.status ilike 'n%')) as no_show,
         bool_or(a.status ilike 'cancelad%' or a.status ilike 'desmarc%') as cancelado
  from public.shosp_appointments a
  where a.lead_id is not null
    and a.data >= v_start_dia
    and a.data <= v_end_dia
  group by a.lead_id;

  select jsonb_build_object(
    'total_leads', (select count(*) from _leads),
    'ativos', (select count(*) from _leads where lost_reason is null),
    'perdidos', (select count(*) from _leads where lost_reason is not null),
    'com_shosp', (select count(*) from _leads where shosp_prontuario is not null),
    'excluidos', (select count(*) from public.leads
                  where deleted_at is null and coalesce(excluded_from_metrics,false) = true
                    and (p_tenant is null or tenant_id = p_tenant))
  ) into v_summary;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_by_source from (
    select jsonb_build_object(
      'source', coalesce(l.source, 'desconhecido'),
      'total', count(*),
      'agendados', count(*) filter (where la.agendado or la.comparecido),
      'comparecidos', count(*) filter (where la.comparecido),
      'perdidos', count(*) filter (where l.lost_reason is not null),
      'conversao_pct', round(100.0 * count(*) filter (where la.agendado or la.comparecido) / nullif(count(*),0), 1)
    ) as x
    from _leads l left join _appt la on la.lead_id = l.id
    group by l.source order by count(*) desc
  ) s;

  -- Funil headline: TODOS os leads (qualquer data de criação) com consulta DENTRO
  -- do período, respeitando os filtros de origem/responsável/tenant.
  select jsonb_build_object(
    'leads_agendados', count(*) filter (where la.agendado or la.comparecido),
    'leads_comparecidos', count(*) filter (where la.comparecido),
    'leads_no_show', count(*) filter (where la.no_show),
    'leads_cancelados', count(*) filter (where la.cancelado)
  ) into v_shosp_funnel
  from _appt la
  join public.leads l on l.id = la.lead_id
  where l.deleted_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and (p_source is null or l.source = p_source)
    and (p_owner is null or l.owner_id = p_owner)
    and (p_tenant is null or l.tenant_id = p_tenant);

  select coalesce(jsonb_agg(x order by (x->>'position')::int), '[]'::jsonb) into v_by_stage from (
    select jsonb_build_object(
      'pipeline_id', l.pipeline_id, 'stage_id', l.stage_id,
      'stage_name', ps.name, 'position', coalesce(ps.position, 0), 'count', count(*)
    ) as x
    from _leads l left join public.pipeline_stages ps on ps.id = l.stage_id
    where l.lost_reason is null
    group by l.pipeline_id, l.stage_id, ps.name, ps.position
  ) st;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_by_sdr from (
    select jsonb_build_object(
      'owner_id', l.owner_id, 'owner_name', coalesce(u.name, 'Sem responsável'),
      'total', count(*), 'perdidos', count(*) filter (where l.lost_reason is not null),
      'agendados', count(*) filter (where la.agendado or la.comparecido),
      'conversao_pct', round(100.0 * count(*) filter (where la.agendado or la.comparecido) / nullif(count(*),0), 1)
    ) as x
    from _leads l
    left join _appt la on la.lead_id = l.id
    left join public.app_users u on u.id = l.owner_id
    group by l.owner_id, u.name order by count(*) desc
  ) sd;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_lost from (
    select jsonb_build_object('reason', l.lost_reason, 'count', count(*)) as x
    from _leads l where l.lost_reason is not null
    group by l.lost_reason order by count(*) desc limit 10
  ) lr;

  select coalesce(jsonb_agg(x order by (x->>'avg_days')::numeric desc), '[]'::jsonb) into v_time_stage from (
    select jsonb_build_object(
      'stage_id', l.stage_id, 'stage_name', ps.name,
      'leads', count(*),
      'avg_days', round(avg(extract(epoch from (now() - coalesce(l.stage_entered_at, l.created_at))) / 86400.0)::numeric, 1)
    ) as x
    from _leads l left join public.pipeline_stages ps on ps.id = l.stage_id
    where l.lost_reason is null and l.conversation_status not in ('lost','closed')
    group by l.stage_id, ps.name
  ) ts;

  -- Frescor do espelho da agenda: se a Shosp parou de sincronizar, os números de
  -- consulta são uma foto velha e a tela precisa dizer isso.
  select jsonb_build_object(
    'ultimo_sync', max(a.synced_at),
    'dias_atras', case when max(a.synced_at) is null then null
                  else floor(extract(epoch from (now() - max(a.synced_at))) / 86400.0)::int end
  ) into v_agenda_sync
  from public.shosp_appointments a;

  v_result := jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end,
                                'dia_inicio', v_start_dia, 'dia_fim', v_end_dia),
    'summary', v_summary,
    'by_source', v_by_source,
    'shosp_funnel', v_shosp_funnel,
    'by_stage', v_by_stage,
    'by_sdr', v_by_sdr,
    'lost_reasons', v_lost,
    'time_in_stage', v_time_stage,
    'agenda_sync', v_agenda_sync
  );
  return v_result;
end;
$$;

grant execute on function public.crm_analytics_v2(timestamptz, timestamptz, text, text, text) to authenticated, service_role;
