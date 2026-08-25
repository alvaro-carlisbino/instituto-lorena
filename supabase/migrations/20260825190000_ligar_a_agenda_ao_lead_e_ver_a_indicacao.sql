-- ─────────────────────────────────────────────────────────────────────────────
-- Ligar a agenda ao lead, e enxergar a indicação sem inventar dado
--
-- Dois buracos que apareceram medindo o funil da clínica em 25/08/2026:
--
-- 1. Só 32,8% dos agendamentos de agosto têm `lead_id`. A automação que devolve
--    "agendou" para a Meta (crm-meta-ads-sync) só alcança o terço ligado: os
--    outros dois terços da agenda são invisíveis para o algoritmo. Há 2.793
--    agendamentos sem lead, e 750 casam por nome, 209 por prontuário.
--
-- 2. Das 45 cirurgias de jul+ago, 19 (R$ 414.630, 30% do faturamento) são de
--    gente que NUNCA foi lead. É a indicação aparecendo no dado. O campo
--    `origin` está vazio em 95,4% das vendas, então hoje isso não se mede.
--
-- O que este arquivo NÃO faz de propósito: preencher `origin` por dedução.
-- Um paciente cujo lead veio por `meta_whatsapp` pode ter sido indicado e só
-- ter escrito no WhatsApp. Carimbar "Instagram" ali destruiria justamente o
-- campo que precisa virar confiável. A medição sai numa VIEW derivada; o campo
-- continua sendo do humano.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Nome vira chave ──────────────────────────────────────────────────────
--
-- Shosp e CRM escrevem o mesmo paciente de jeitos diferentes: acento, caixa,
-- espaço duplo. Sem uma chave comum, "José Carlos" e "JOSE  CARLOS" são duas
-- pessoas.
create or replace function public.crm_nome_chave(t text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(trim(regexp_replace(
    translate(coalesce(t, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
    '\s+', ' ', 'g')));
$$;

grant execute on function public.crm_nome_chave(text) to authenticated, service_role;

-- ── 1. Ligar agendamento ao lead ────────────────────────────────────────────
--
-- Prontuário primeiro (é chave de verdade), nome depois. O nome só liga quando
-- casa com EXATAMENTE UM lead: homônimo ligado errado é pior que não ligado,
-- porque contamina o sinal que vai para a Meta.
create or replace function public.crm_shosp_ligar_agendamentos()
returns table (por_prontuario int, por_nome int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pront int := 0;
  v_nome  int := 0;
begin
  with alvo as (
    select a.codigo_agendamento, l.id as lead_id
    from shosp_appointments a
    join leads l
      on l.tenant_id = 'instituto-lorena'
     and l.deleted_at is null
     and l.shosp_prontuario is not null
     and l.shosp_prontuario = a.prontuario
    where a.lead_id is null and a.prontuario is not null
  ), upd as (
    update shosp_appointments a set lead_id = alvo.lead_id
    from alvo where a.codigo_agendamento = alvo.codigo_agendamento
    returning 1
  ) select count(*) into v_pront from upd;

  with cand as (
    select a.codigo_agendamento,
           public.crm_nome_chave(a.payload->>'paciente') as chave
    from shosp_appointments a
    where a.lead_id is null and coalesce(a.payload->>'paciente','') <> ''
  ), unico as (
    -- Um nome, um lead. Nome repetido em dois cadastros fica de fora.
    select public.crm_nome_chave(l.patient_name) as chave, min(l.id) as lead_id, count(*) as quantos
    from leads l
    where l.tenant_id = 'instituto-lorena' and l.deleted_at is null
      and coalesce(l.patient_name,'') <> ''
    group by 1
    having count(*) = 1
  ), alvo as (
    select c.codigo_agendamento, u.lead_id
    from cand c join unico u on u.chave = c.chave
    where c.chave <> ''
  ), upd as (
    update shosp_appointments a set lead_id = alvo.lead_id
    from alvo where a.codigo_agendamento = alvo.codigo_agendamento
    returning 1
  ) select count(*) into v_nome from upd;

  return query select v_pront, v_nome;
end;
$$;

revoke all on function public.crm_shosp_ligar_agendamentos() from public, anon, authenticated;
grant execute on function public.crm_shosp_ligar_agendamentos() to service_role;

-- ── 2. De onde veio a venda, sem chutar ─────────────────────────────────────
--
-- Quatro estados, do mais forte ao mais fraco:
--   'declarada'        = alguém preencheu `origin`. Vence sempre.
--   'anuncio_formulario' = o lead tem campanha da Meta. É prova, não indício.
--   'conversa_digital'   = o lead existe e entrou por WhatsApp ou Instagram.
--   'sem_rastro_digital' = não existe lead nenhum. Candidato a indicação,
--                          boca a boca ou paciente que voltou. NÃO é conclusão.
create or replace view public.v_clinic_sales_origem as
select
  cs.id,
  cs.tenant_id,
  cs.kind,
  cs.sold_at,
  cs.value_cents,
  cs.patient_name,
  cs.origin as origem_declarada,
  case
    when coalesce(nullif(trim(cs.origin),''),'') <> ''            then 'declarada'
    when l.attribution_channel is not null                        then 'anuncio_formulario'
    when l.id is not null and l.source in ('meta_whatsapp','whatsapp','meta_instagram')
                                                                  then 'conversa_digital'
    when l.id is not null                                         then 'outro_cadastro'
    else 'sem_rastro_digital'
  end as origem_inferida,
  l.id as lead_id,
  l.source as lead_source,
  l.attribution_campaign
from clinic_sales cs
left join leads l on l.id = cs.lead_id;

comment on view public.v_clinic_sales_origem is
  'De onde a venda veio, por evidência. "sem_rastro_digital" é candidato a indicação, não conclusão: o campo origin continua sendo do humano.';

alter view public.v_clinic_sales_origem set (security_invoker = on);
revoke all on public.v_clinic_sales_origem from anon;
grant select on public.v_clinic_sales_origem to authenticated, service_role;

-- ── 3. Backfill agora ───────────────────────────────────────────────────────
select * from public.crm_shosp_ligar_agendamentos();

-- ── 4. Manter ligado ────────────────────────────────────────────────────────
--
-- Roda depois da sincronização do Shosp (minuto 13 de cada hora), para pegar o
-- agendamento novo antes do próximo envio de CAPI, que sai de 30 em 30.
select cron.unschedule('crm-shosp-ligar-lead-job') where exists (
  select 1 from cron.job where jobname = 'crm-shosp-ligar-lead-job'
);

select cron.schedule(
  'crm-shosp-ligar-lead-job',
  '18 * * * *',
  $cron$ select public.crm_shosp_ligar_agendamentos(); $cron$
);
