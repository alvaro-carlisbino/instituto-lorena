-- Métricas da agenda Shosp (clínica inteira): volume por médico, por plano, por
-- dia + taxa de cancelamento. Baseado em shosp_appointments (sync full_agenda).
-- A Shosp registra Agendado/Confirmado/Desmarcado — NÃO comparecimento; e a grade
-- geral não traz o serviço (só por-paciente), então não há métrica de receita aqui.

create or replace function public.crm_shosp_agenda_metrics(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  create temp table _fut on commit drop as
  select * from public.shosp_appointments
  where data >= current_date and data < current_date + (p_days || ' days')::interval;

  select jsonb_build_object(
    'range_dias', p_days,
    'total', (select count(*) from _fut),
    'cancelados', (select count(*) from _fut where status ilike 'desmarc%' or status ilike 'cancel%'),
    'taxa_cancelamento_pct', (select round(100.0 * count(*) filter (where status ilike 'desmarc%' or status ilike 'cancel%') / nullif(count(*),0), 1) from _fut),
    'por_medico', (select coalesce(jsonb_agg(x order by (x->>'total')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'prestador', coalesce(prestador,'?'),
          'total', count(*),
          'cancelados', count(*) filter (where status ilike 'desmarc%' or status ilike 'cancel%')
        ) x
        from _fut group by prestador) m),
    'por_plano', (select coalesce(jsonb_agg(x order by (x->>'total')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('plano', coalesce(plano_saude,'?'), 'total', count(*)) x
        from _fut group by plano_saude) pl),
    'por_dia', (select coalesce(jsonb_agg(x order by x->>'dia'), '[]'::jsonb) from (
        select jsonb_build_object('dia', data::text, 'total', count(*)) x
        from _fut group by data) d)
  ) into v;
  return v;
end $$;

grant execute on function public.crm_shosp_agenda_metrics(int) to authenticated, service_role;
