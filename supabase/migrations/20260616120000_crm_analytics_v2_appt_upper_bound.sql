-- Correção do over-count de "Agendados" no funil real (crm_analytics_v2):
--   A versão anterior (20260615130611) passou a contar os agendamentos pela DATA
--   da consulta a partir do início do período, mas SEM limite superior
--   (`a.data >= p_start::date`, sem `<= p_end`). Resultado: ao filtrar um período
--   curto (ex.: 15/06 a 15/06) o card "Agendados" passava a contar TODAS as
--   consultas daquele dia EM DIANTE — toda a agenda futura entrava na conta
--   (4 consultas do dia viravam 9). Numa clínica com agenda cheia pra frente,
--   qualquer janela curta ficava inflada.
--
--   Correção: o funil (Agendados/Compareceram/No-show/Cancelados) passa a contar
--   apenas consultas cuja DATA cai DENTRO do período selecionado [p_start, p_end].
--   É o significado natural de um filtro de período numa agenda. As métricas de
--   volume/etapa/perda (coorte de leads CRIADOS no período) seguem inalteradas.
--
--   Obs.: a tabela espelho shosp_appointments só guarda a data da CONSULTA (coluna
--   `data`); não há data de "quando foi marcada". Logo, "Agendados do período" =
--   consultas marcadas PARA esse período (não "marcações feitas nesse período").

create or replace function public.crm_analytics_v2(
  p_start timestamptz default (now() - interval '30 days'),
  p_end timestamptz default now(),
  p_source text default null,
  p_owner text default null
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
    and (p_owner is null or l.owner_id = p_owner);

  -- Agendamentos Shosp por lead com a DATA da consulta DENTRO do período
  -- [p_start, p_end] (agora com limite superior — corrige o over-count).
  -- comparecido é PROXY: consulta passada não cancelada/faltou = compareceu.
  create temp table _appt on commit drop as
  select a.lead_id,
         bool_or(a.status ilike 'agendad%' or a.status ilike 'confirmad%') as agendado,
         bool_or(
           a.status ilike 'atendid%' or a.status ilike 'comparec%' or a.status ilike 'realizad%'
           or (a.data < current_date and (a.status ilike 'agendad%' or a.status ilike 'confirmad%'))
         ) as comparecido,
         bool_or(a.status ilike 'falt%' or (a.status ilike '%compareceu%' and a.status ilike 'n%')) as no_show,
         bool_or(a.status ilike 'cancelad%' or a.status ilike 'desmarc%') as cancelado
  from public.shosp_appointments a
  where a.lead_id is not null
    and a.data >= p_start::date
    and a.data <= p_end::date
  group by a.lead_id;

  select jsonb_build_object(
    'total_leads', (select count(*) from _leads),
    'ativos', (select count(*) from _leads where lost_reason is null),
    'perdidos', (select count(*) from _leads where lost_reason is not null),
    'com_shosp', (select count(*) from _leads where shosp_prontuario is not null),
    'excluidos', (select count(*) from public.leads where deleted_at is null and coalesce(excluded_from_metrics,false) = true)
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
  -- do período, respeitando os filtros de origem/responsável.
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
    and (p_owner is null or l.owner_id = p_owner);

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

  v_result := jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'summary', v_summary,
    'by_source', v_by_source,
    'shosp_funnel', v_shosp_funnel,
    'by_stage', v_by_stage,
    'by_sdr', v_by_sdr,
    'lost_reasons', v_lost,
    'time_in_stage', v_time_stage
  );
  return v_result;
end;
$$;

grant execute on function public.crm_analytics_v2(timestamptz, timestamptz, text, text) to authenticated, service_role;
