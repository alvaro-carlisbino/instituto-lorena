-- Embalagem e custo por unidade de uso.
--
-- A nota vende caixa ("LUVA CIRURGICA 7,0 ESTERIL C/200 PARES", 1 CX a R$ 239,40) e a enfermagem
-- conta par (518). Sem fator, a entrada somava 1 e o custo do par virava o preço da caixa: o valor
-- em estoque multiplicava saldo em pares por preço de caixa.

-- 1) Fator aprendido por item: {"ean:7891234567890": 200, "nome:luva cirurgica 7,0 esteril c/200 pares-becare": 200}
--    Chave "nome:" é o xProd sem lote/validade, minúsculo e sem acento (src/lib/nfeEmbalagem.ts).
alter table public.stock_items
  add column if not exists pack_factors jsonb not null default '{}'::jsonb;

comment on column public.stock_items.pack_factors is
  'Unidades do item por unidade da nota, por EAN ("ean:") e por nome da nota sem lote ("nome:"). Aprendido na importação manual.';

-- 2) Custo de referência por unidade de uso, fixado por inventário. Entra na mesma disputa de
--    "mais recente" do último custo: a próxima compra (já convertida) passa na frente sozinha.
alter table public.stock_items
  add column if not exists reference_cost_cents integer,
  add column if not exists reference_cost_at timestamptz;

comment on column public.stock_items.reference_cost_cents is
  'Custo por unidade do item fixado por inventário (compras antigas entraram com preço de caixa).';

create or replace view public.stock_item_last_costs
  with (security_invoker = on) as
select distinct on (tenant_id, item_id)
  tenant_id, item_id, unit_cost_cents, at
from (
  select m.tenant_id, m.item_id, m.unit_cost_cents, m.created_at as at
  from public.stock_movements m
  where m.kind = 'entrada' and m.unit_cost_cents is not null and m.unit_cost_cents > 0
  union all
  select poi.tenant_id, poi.item_id, poi.unit_cost_cents, poi.created_at as at
  from public.purchase_order_items poi
  where poi.item_id is not null and poi.unit_cost_cents > 0
  union all
  select i.tenant_id, i.id as item_id, i.reference_cost_cents, i.reference_cost_at as at
  from public.stock_items i
  where i.reference_cost_cents > 0 and i.reference_cost_at is not null
) c
order by tenant_id, item_id, at desc;

grant select on public.stock_item_last_costs to authenticated;
grant select on public.stock_item_last_costs to service_role;
