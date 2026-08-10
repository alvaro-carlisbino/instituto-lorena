-- Números públicos da clínica para a parte aberta do app (quem ainda não é
-- paciente). Só agregado, sem nenhum dado de pessoa, então pode ir para anon
-- sem virar o problema de supabase_rpc_aberta_anon.
-- Existem para o app não ter número chumbado, que envelhece e vira mentira.

create or replace function public.clinica_numeros_publicos()
returns table (cirurgias_realizadas int, foliculos_implantados bigint, desde_ano int)
language sql
stable
security definer
set search_path = public
as $fn$
  select count(*)::int,
         coalesce(sum(total_implantados), 0)::bigint,
         extract(year from min(dia))::int
  from public.srg_surgeries
  where deleted_at is null
    and status = 'FINALIZADA'
    and dia <= current_date
$fn$;

revoke all on function public.clinica_numeros_publicos() from public;
grant execute on function public.clinica_numeros_publicos() to anon, authenticated;

-- Base da calculadora de unidades foliculares do app.
-- Em vez de tabela genérica de internet, usa o histórico REAL da clínica: para
-- cada área, o 1º quartil / mediana / 3º quartil do que já foi implantado nas
-- cirurgias finalizadas. Quem responde "quanto eu preciso?" passa a ser o
-- resultado da casa, e o número acompanha a operação sozinho.
create or replace function public.clinica_referencia_por_area()
returns table (area text, ordem int, cirurgias int, leve int, medio int, avancado int)
language sql
stable
security definer
set search_path = public
as $fn$
  select a.titulo,
         a.ordem,
         count(*)::int,
         percentile_disc(0.25) within group (order by x.q)::int,
         percentile_disc(0.50) within group (order by x.q)::int,
         percentile_disc(0.75) within group (order by x.q)::int
  from public.srg_surgery_areas sa
  join public.srg_areas a on a.id = sa.area_id
  join public.srg_surgeries s on s.id = sa.surgery_id
  cross join lateral (
    select coalesce(sum(i.quantidade), 0) as q
    from public.srg_follicles_implanted i
    where i.surgery_area_id = sa.id and i.deleted_at is null
  ) x
  where sa.deleted_at is null
    and s.deleted_at is null
    and s.status = 'FINALIZADA'
    and x.q > 0
  group by a.titulo, a.ordem
  having count(*) >= 10          -- área com pouca amostra não vira referência
  order by a.ordem
$fn$;

revoke all on function public.clinica_referencia_por_area() from public;
grant execute on function public.clinica_referencia_por_area() to anon, authenticated;
