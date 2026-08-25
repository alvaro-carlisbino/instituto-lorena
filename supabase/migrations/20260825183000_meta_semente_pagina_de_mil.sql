-- ─────────────────────────────────────────────────────────────────────────────
-- A semente do público não cabia numa página
--
-- `crm_meta_audience_seed('conversa')` devolve 1.600 hashes. A primeira carga
-- subiu 1.000 e respondeu `ok: true`. O PostgREST corta em 1.000 linhas e não
-- avisa: a função não errou, a resposta não veio truncada com aviso, o log
-- disse sucesso. Faltaram 600 pessoas em silêncio.
--
-- Agora a função pagina. O chamador pede lote por lote até vir menos que o
-- pedido, e aí sabe que acabou. Ordenar por hash é o que garante página
-- estável entre chamadas.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.crm_meta_audience_seed(text);

create or replace function public.crm_meta_audience_seed(
  camada text default 'paciente',
  lote int default 500,
  deslocamento int default 0
)
returns table (hash text)
language sql
security definer
set search_path = public, extensions
as $$
  with tel as (
    select case
             when length(d) between 12 and 13 and left(d, 2) = '55' then d
             when length(d) in (10, 11) then '55' || d
           end as t
    from (
      select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d
      from (
        select cs.phone as p from clinic_sales cs
          where camada in ('paciente','conversa') and cs.tenant_id = 'instituto-lorena'
        union all
        select l.phone from shosp_appointments a join leads l on l.id = a.lead_id
          where camada in ('paciente','conversa')
        union all
        select l.phone from leads l
          where camada in ('paciente','conversa')
            and l.tenant_id = 'instituto-lorena' and l.shosp_prontuario is not null
        union all
        select l.phone from leads l
          where camada = 'conversa'
            and l.tenant_id = 'instituto-lorena' and l.deleted_at is null
            and exists (
              select 1 from interactions i
              where i.lead_id = l.id and i.direction = 'in' and i.channel = 'whatsapp'
            )
      ) fontes
    ) limpos
  ),
  h as (
    select distinct encode(digest(t, 'sha256'), 'hex') as hx
    from tel where t is not null
  )
  select hx from h
  order by hx
  limit greatest(least(lote, 1000), 1)
  offset greatest(deslocamento, 0);
$$;

revoke all on function public.crm_meta_audience_seed(text, int, int) from public, anon, authenticated;
grant execute on function public.crm_meta_audience_seed(text, int, int) to service_role;

-- Contagem à parte, para o chamador saber o tamanho antes de paginar e conferir
-- depois se subiu tudo. Sem isso, truncar volta a passar despercebido.
create or replace function public.crm_meta_audience_seed_total(camada text default 'paciente')
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select count(*)
  from generate_series(0, 50000, 1000) as o(off)
  cross join lateral public.crm_meta_audience_seed(camada, 1000, o.off) s;
$$;

revoke all on function public.crm_meta_audience_seed_total(text) from public, anon, authenticated;
grant execute on function public.crm_meta_audience_seed_total(text) to service_role;
