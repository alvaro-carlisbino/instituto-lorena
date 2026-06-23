-- Atribuição por VENDA (não por lead): cruza pagamentos pagos (rede_payments) com a
-- origem do lead (attribution_*), revelando qual canal/campanha/anúncio gera COMPRA.
-- security_invoker → respeita a RLS de leads (escopo por tenant) quando lido pelo painel.
--
-- NOTA: depende de attribution_channel/attribution_campaign/attribution_ad_id estarem
-- preenchidos no lead (capturados no inbound). Enquanto a captura não estiver ligada,
-- a view roda mas tudo cai em 'desconhecido'.
create or replace view crm_sales_attribution
with (security_invoker = on) as
with leadbase as (
  select
    tenant_id,
    coalesce(nullif(attribution_channel, ''), 'desconhecido') as channel,
    coalesce(nullif(attribution_campaign, ''), '(sem campanha)') as campaign,
    coalesce(nullif(attribution_ad_id, ''), '(sem anúncio)') as ad_id,
    id
  from leads
  where deleted_at is null
),
sales as (
  select
    lead_id,
    count(*) filter (where status = 'paid') as pagos,
    sum(amount_cents) filter (where status = 'paid') as receita_cents
  from rede_payments
  group by lead_id
)
select
  lb.tenant_id,
  lb.channel,
  lb.campaign,
  lb.ad_id,
  count(distinct lb.id) as leads,
  count(distinct lb.id) filter (where s.pagos > 0) as compradores,
  coalesce(sum(s.receita_cents), 0) / 100.0 as receita_reais,
  round(100.0 * count(distinct lb.id) filter (where s.pagos > 0) / nullif(count(distinct lb.id), 0), 1) as conversao_pct
from leadbase lb
left join sales s on s.lead_id = lb.id
group by 1, 2, 3, 4;
