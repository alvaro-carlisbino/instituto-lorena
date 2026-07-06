-- Custo por cirurgia/paciente (pedido do Álvaro 07/jul): valorar as SAÍDAS de
-- estoque para fechar a cadeia kit → paciente (lead) → Shosp com controle de gastos.
--   • stock_movements ganha unit_cost_cents (custo unitário no momento do movimento;
--     null = movimento antigo/não valorado — a UI mostra "parcial").
--   • Entradas passam a carimbar o custo (recebimento de OC e import de NF-e, no app).
--   • Saída do kit usa o custo REAL do lote (lote ← entrada valorada), com fallback
--     pro último custo de compra do item (views abaixo).
--   • stock_kit_costs soma o custo em materiais de cada kit consumido — base do
--     "gasto por paciente" na ficha do lead.

alter table public.stock_movements add column if not exists unit_cost_cents integer;

-- Último custo conhecido por item: entradas valoradas + linhas de OC (histórico
-- de antes desta migration, quando o movimento ainda não carregava custo).
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
) c
order by tenant_id, item_id, at desc;

-- Custo do lote = custo da entrada valorada mais recente daquele lote.
create or replace view public.stock_batch_costs
  with (security_invoker = on) as
select distinct on (m.tenant_id, m.batch_id)
  m.tenant_id, m.batch_id, m.unit_cost_cents
from public.stock_movements m
where m.batch_id is not null
  and m.kind = 'entrada'
  and m.unit_cost_cents is not null
  and m.unit_cost_cents > 0
order by m.tenant_id, m.batch_id, m.created_at desc;

-- Custo em materiais por kit consumido (fully_costed=false ⇒ tem item sem custo,
-- o total mostrado é parcial).
create or replace view public.stock_kit_costs
  with (security_invoker = on) as
select
  k.tenant_id,
  k.id as kit_id,
  k.lead_id,
  sum(abs(m.qty_delta) * coalesce(m.unit_cost_cents, 0))::bigint as total_cost_cents,
  bool_and(m.unit_cost_cents is not null) as fully_costed
from public.stock_kits k
join public.stock_movements m on m.ref_type = 'stock_kit' and m.ref_id = k.id::text
where k.status = 'consumido'
group by k.tenant_id, k.id;

grant select on public.stock_item_last_costs to authenticated;
grant select on public.stock_item_last_costs to service_role;
grant select on public.stock_batch_costs to authenticated;
grant select on public.stock_batch_costs to service_role;
grant select on public.stock_kit_costs to authenticated;
grant select on public.stock_kit_costs to service_role;
