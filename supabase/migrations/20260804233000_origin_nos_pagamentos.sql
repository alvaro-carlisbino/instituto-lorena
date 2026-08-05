-- Origem do pedido virou dado, não mais adivinhação.
--
-- Não existia campo de origem em rede_payments/asaas_payments, então o selo do /pedidos era
-- derivado do LEAD (best-effort). Deu errado no caso Thais Ferrero (04/ago): ela comprou pelo
-- site, mas como já tinha falado com o bot em julho o lead carrega `whatsapp_instance_id` pra
-- sempre — o pedido apareceu como "WhatsApp" e a Ingrid foi procurar uma conversa de venda que
-- nunca existiu. E a heurística é estrutural: origem é do PEDIDO, não do cliente. O mesmo
-- cliente compra pelo site hoje e pelo bot mês que vem.
--
-- Agora quem CRIA a cobrança carimba: bot = whatsapp, painel = manual, loja = site (repo do
-- site), ciclo de assinatura = assinatura.
--
-- Backfill DELIBERADAMENTE parcial: só preenche o que dá pra provar. `lead_id is null` NÃO
-- vira 'site' (era o que a tela fazia) porque link de pagamento gerado à mão pela equipe também
-- nasce sem lead — a Lais Cantanhede é exatamente isso e sairia marcada como Site. Linha sem
-- prova fica NULL e a tela continua caindo na heurística antiga, que é o comportamento de hoje.

alter table public.rede_payments add column if not exists origin text;
alter table public.asaas_payments add column if not exists origin text;

comment on column public.rede_payments.origin is
  'Onde o pedido nasceu: site | whatsapp | manual | assinatura. Carimbado na criação do intent. NULL = linha antiga, a tela cai na heurística pelo lead.';
comment on column public.asaas_payments.origin is
  'Onde o pedido nasceu: site | whatsapp | manual | assinatura. Carimbado na criação do intent. NULL = linha antiga, a tela cai na heurística pelo lead.';

-- Ciclo de assinatura: o id 'sub-…' é prova suficiente.
update public.asaas_payments set origin = 'assinatura'
where origin is null and id like 'sub-%';

-- Loja: o checkout do site grava custom_fields.origin='site' no lead, e os leads criados pelo
-- storefront têm id 'site-…'. Vale MAIS que a instância do W-API (o caso Thais).
update public.rede_payments p set origin = 'site'
from public.leads l
where p.origin is null and l.id = p.lead_id
  and (l.custom_fields->>'origin' = 'site' or p.lead_id like 'site-%');

update public.asaas_payments p set origin = 'site'
from public.leads l
where p.origin is null and l.id = p.lead_id
  and (l.custom_fields->>'origin' = 'site' or p.lead_id like 'site-%');

-- Bot de vendas: lead com instância W-API ou origem whatsapp/meta, e sem marca de site.
update public.rede_payments p set origin = 'whatsapp'
from public.leads l
where p.origin is null and l.id = p.lead_id
  and (l.whatsapp_instance_id is not null or l.source ~* '^(whatsapp|meta)');

update public.asaas_payments p set origin = 'whatsapp'
from public.leads l
where p.origin is null and l.id = p.lead_id
  and (l.whatsapp_instance_id is not null or l.source ~* '^(whatsapp|meta)');

create index if not exists rede_payments_origin_idx on public.rede_payments (tenant_id, origin);
create index if not exists asaas_payments_origin_idx on public.asaas_payments (tenant_id, origin);
