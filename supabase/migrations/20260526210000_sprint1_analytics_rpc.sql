-- =============================================================================
-- Sprint 1 — RPC tenant_analytics_summary
-- =============================================================================
-- Devolve em uma chamada: resumo (totais), funil por etapa, top motivos de perda,
-- leads parados (>3 dias na etapa) e métricas por SDR. Escopado por tenant via
-- current_tenant_id(). Frontend consome via fetchAnalytics().
-- =============================================================================

create or replace function public.tenant_analytics_summary(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
  v_since timestamptz := now() - make_interval(days => greatest(1, p_days));
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
    left join public.leads l on l.stage_id = s.id and l.tenant_id = v_tenant
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
    select lost_reason, count(*) as cnt
    from public.leads
    where tenant_id = v_tenant
      and excluded_from_metrics = false
      and lost_reason is not null
      and created_at >= v_since
    group by lost_reason
    order by cnt desc
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
      and excluded_from_metrics = false
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
    left join public.app_users u on u.id = l.owner_id and u.tenant_id = v_tenant
    where l.tenant_id = v_tenant
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
    and created_at >= v_since;

  return jsonb_build_object(
    'summary', coalesce(v_summary, '{}'::jsonb),
    'funnel', coalesce(v_funnel, '[]'::jsonb),
    'lost_reasons', coalesce(v_lost, '[]'::jsonb),
    'stuck_leads', coalesce(v_stuck, '[]'::jsonb),
    'by_sdr', coalesce(v_sdr, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.tenant_analytics_summary(int) from public;
grant execute on function public.tenant_analytics_summary(int) to authenticated;
