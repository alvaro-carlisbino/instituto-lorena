-- Semente de COMPRADORES para o público da Meta.
--
-- Por quê: os lookalikes de prospecção nascem de "FORMULÁRIO PREENCHIDO TC
-- CONSULTA". Formulário rendeu 1 venda em 801 leads, então pedir à Meta "ache
-- gente parecida com quem preenche formulário" está trazendo exatamente isso:
-- gente que preenche e não compra. A semente certa é quem PAGOU.
--
-- Duas camadas novas:
--   'comprador'     — quem comprou transplante (procedure_label 'Tc %')
--   'comprador_all' — quem comprou qualquer coisa paga na clínica
--
-- O telefone vem de duas fontes porque nenhuma das duas é completa sozinha:
-- `clinic_sales.phone` e o cadastro do Shosp do mesmo prontuário.
--
-- O hash continua saindo DAQUI DE DENTRO, em SHA-256: número em claro não passa
-- pela edge function nem aparece em log alto. Mesma disciplina de
-- crm_meta_audience_seed original.

create or replace function public.crm_meta_audience_seed(
  camada text default 'paciente',
  lote integer default 500,
  deslocamento integer default 0
)
returns table(hash text)
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
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

        -- Camadas de comprador. O telefone da venda e o do cadastro do Shosp
        -- entram os dois: a venda nem sempre tem telefone, e o prontuário nem
        -- sempre está casado.
        union all
        select cs.phone from clinic_sales cs
          where camada = 'comprador' and cs.tenant_id = 'instituto-lorena'
            and cs.procedure_label ilike 'Tc %'
        union all
        select coalesce(sp.celular, sp.telefone) from clinic_sales cs
          join shosp_patients sp on sp.prontuario = cs.shosp_prontuario
          where camada = 'comprador' and cs.tenant_id = 'instituto-lorena'
            and cs.procedure_label ilike 'Tc %'
        union all
        select cs.phone from clinic_sales cs
          where camada = 'comprador_all' and cs.tenant_id = 'instituto-lorena'
            and cs.value_cents > 0
        union all
        select coalesce(sp.celular, sp.telefone) from clinic_sales cs
          join shosp_patients sp on sp.prontuario = cs.shosp_prontuario
          where camada = 'comprador_all' and cs.tenant_id = 'instituto-lorena'
            and cs.value_cents > 0
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
$function$;

-- SECURITY DEFINER sobre dado de saúde: `public` no Supabase inclui `anon`, que
-- é a chave que a landing carrega no navegador de quem vem do anúncio.
revoke all on function public.crm_meta_audience_seed(text, integer, integer) from public, anon;
grant execute on function public.crm_meta_audience_seed(text, integer, integer) to service_role;

revoke all on function public.crm_meta_audience_seed_total(text) from public, anon;
grant execute on function public.crm_meta_audience_seed_total(text) to service_role;
