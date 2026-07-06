-- Busca de paciente no espelho Shosp SEM sensibilidade a acento/caixa.
-- Motivo: ilike acha "joao" em "joao" mas NÃO em "João" — a busca do vínculo
-- lead↔Shosp falhava silenciosamente para qualquer nome acentuado.
-- Cada token do termo precisa aparecer no nome (ordem/parcial não importam).
-- (Aplicada em produção via Management API em 2026-07-06; idempotente.)

create extension if not exists unaccent;

create or replace function public.search_shosp_patients(q text)
returns setof shosp_patients
language sql
stable
as $fn$
  with toks as (
    select tok
    from unnest(regexp_split_to_array(trim(coalesce(q, '')), '\s+')) tok
    where length(tok) >= 2
    limit 6
  )
  select p.*
  from shosp_patients p
  where (select count(*) from toks) > 0
    and not exists (
      select 1 from toks t
      where unaccent(lower(coalesce(p.nome, ''))) not like '%' || unaccent(lower(t.tok)) || '%'
    )
  limit 25
$fn$;
