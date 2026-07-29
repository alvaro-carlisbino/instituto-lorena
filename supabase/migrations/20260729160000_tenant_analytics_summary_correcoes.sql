-- Resumo clássico do /analytics: quatro correções.
--
-- 1. LEAD APAGADO CONTAVA. `deleted_at` não aparecia UMA VEZ na função, nos 5 blocos. Em
--    30 dias eram 53 leads soft-deletados entrando no total (1.224 na tela contra 1.171
--    reais), e o painel v2, poucos centímetros acima NA MESMA PÁGINA, mostrava 1.171.
--    Pior: o card "Excluídos das métricas" marcava 0, o que fazia parecer que o total
--    estava limpo.
--
-- 2. O FUNIL IGNORAVA O PERÍODO. O bloco `stage_counts` não usava `v_since`, então os
--    botões 7/30/90/365 não moviam uma barra. "Novo lead" mostrava 72 em qualquer período
--    (67 deles apagados) quando em 30 dias são 5.
--
-- 3. "(sem SDR)" COM 382 LEADS ERA UMA PESSOA. O join era
--    `on u.id = l.owner_id AND u.tenant_id = v_tenant`, e o cadastro da Ingrid está com
--    `tenant_id='tricopill'` embora ela seja dona de leads da clínica. Existem ZERO leads
--    sem dono no período. Nomear alguém num relatório não é decisão de acesso (os leads já
--    estão escopados por tenant), então o filtro de tenant sai do join. Mudar o tenant do
--    cadastro dela é decisão de negócio e NÃO é feita aqui.
--
-- 4. "PARADOS HÁ MAIS DE 3 DIAS" NÃO CONSEGUIA ALERTAR. 155 leads compartilham o mesmo
--    `stage_entered_at` (2026-05-26 14:02:00.261532+00), carimbo do ALTER TABLE da migration
--    de 26/05. Como é o valor mais antigo do tenant, o `order by asc limit 10` ficava preso
--    nesse bloco para sempre e um lead que travasse hoje NUNCA apareceria. Esse carimbo não
--    é medição, é artefato: fica de fora. A lista também passa a excluir quem já foi perdido
--    E quem está em etapa TERMINAL (fechado, concluído, alta, cancelado), usando o mesmo
--    critério que o resto do sistema já aplica em `isWorkloadExcludedStageId` e no disparo
--    de NPS de fim de jornada: lead resolvido não está "parado", está pronto.

create or replace function public.tenant_analytics_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_since timestamptz := now() - make_interval(days => greatest(1, p_days));
  -- Carimbo do backfill de 26/05: não representa entrada real em etapa.
  v_backfill constant timestamptz := '2026-05-26 14:02:00.261532+00';
  v_funnel jsonb;
  v_lost jsonb;
  v_stuck jsonb;
  v_sdr jsonb;
  v_summary jsonb;
begin
  if v_tenant is null then
    return '{}'::jsonb;
  end if;

  with stage_counts as (
    select
      s.pipeline_id,
      p.name as pipeline_name,
      s.id as stage_id,
      s.name as stage_name,
      s.position,
      count(l.id) filter (where l.excluded_from_metrics = false) as active_count
    from public.pipeline_stages s
    join public.pipelines p on p.id = s.pipeline_id
    left join public.leads l
      on l.stage_id = s.id
     and l.tenant_id = v_tenant
     and l.deleted_at is null
     and l.created_at >= v_since
    where s.tenant_id = v_tenant
    group by s.pipeline_id, p.name, s.id, s.name, s.position
  )
  select jsonb_agg(jsonb_build_object(
    'pipeline_id', pipeline_id,
    'pipeline_name', pipeline_name,
    'stage_id', stage_id,
    'stage_name', stage_name,
    'position', position,
    'count', active_count
  ) order by pipeline_name, position)
  into v_funnel
  from stage_counts;

  select jsonb_agg(jsonb_build_object(
    'reason', coalesce(nullif(trim(lost_reason), ''), 'Sem motivo'),
    'count', cnt
  ) order by cnt desc)
  into v_lost
  from (
    select min(lost_reason) as lost_reason, count(*) as cnt
    from public.leads
    where tenant_id = v_tenant
      and deleted_at is null
      and excluded_from_metrics = false
      and lost_reason is not null
      and created_at >= v_since
    group by lower(btrim(lost_reason))
    order by count(*) desc
    limit 10
  ) t;

  select jsonb_agg(jsonb_build_object(
    'lead_id', id,
    'patient_name', patient_name,
    'stage_id', stage_id,
    'days_in_stage', extract(epoch from (now() - stage_entered_at))::int / 86400
  ) order by stage_entered_at asc)
  into v_stuck
  from (
    select id, patient_name, stage_id, stage_entered_at
    from public.leads
    where tenant_id = v_tenant
      and deleted_at is null
      and excluded_from_metrics = false
      and lost_reason is null
      -- Mesmo critério de etapa terminal usado em src/lib/followUpNps.ts.
      and stage_id not in ('fechado', 'tc-concluido', 'cx-alta')
      and stage_id not like '%fechado%'
      and stage_id not like '%encerrado%'
      and stage_id not like '%cancel%'
      and stage_entered_at is distinct from v_backfill
      and stage_entered_at < now() - interval '3 days'
    order by stage_entered_at asc
    limit 10
  ) t;

  select jsonb_agg(jsonb_build_object(
    'sdr_id', sdr_id,
    'sdr_name', sdr_name,
    'total_leads', total_leads,
    'lost_leads', lost_leads,
    'conversion_pct', case when total_leads > 0 then round(100.0 * (total_leads - lost_leads) / total_leads, 1) else 0 end
  ) order by total_leads desc)
  into v_sdr
  from (
    select
      coalesce(l.owner_id, 'unassigned') as sdr_id,
      coalesce(u.name, '(sem SDR)') as sdr_name,
      count(*) as total_leads,
      count(*) filter (where l.lost_reason is not null) as lost_leads
    from public.leads l
    left join public.app_users u on u.id = l.owner_id
    where l.tenant_id = v_tenant
      and l.deleted_at is null
      and l.excluded_from_metrics = false
      and l.created_at >= v_since
    group by l.owner_id, u.name
  ) t;

  select jsonb_build_object(
    'total_leads', count(*),
    'total_active', count(*) filter (where lost_reason is null),
    'total_lost', count(*) filter (where lost_reason is not null),
    'total_excluded', count(*) filter (where excluded_from_metrics = true),
    'period_days', p_days
  )
  into v_summary
  from public.leads
  where tenant_id = v_tenant
    and deleted_at is null
    and created_at >= v_since;

  return jsonb_build_object(
    'summary', coalesce(v_summary, '{}'::jsonb),
    'funnel', coalesce(v_funnel, '[]'::jsonb),
    'lost_reasons', coalesce(v_lost, '[]'::jsonb),
    'stuck_leads', coalesce(v_stuck, '[]'::jsonb),
    'by_sdr', coalesce(v_sdr, '[]'::jsonb)
  );
end;
$function$;
