-- Último custo de compra: segue o item juntado e não conta devolução de kit como compra.
--
-- 1) A nota entra com o nome do fornecedor ("CANULA DE GUEDEL N 04 - PROTEC") e a enfermagem
--    conta pelo nome dela ("CÂNULA GUEDEL Nº 4"). Juntar os dois (replaced_by, na contagem de
--    14/09 ou por stock_item_juntar) leva o SALDO para o item contado como 'ajuste', mas a
--    ENTRADA da nota, que carrega o preço, fica no item de origem. Esta view só lia entrada do
--    próprio item: o item contado seguia "sem custo" no kit, na conta do paciente e no valor do
--    estoque. Em 14/09 isso foi remendado à mão com reference_cost_cents em 132 itens.
--    Agora o custo considera também os itens juntados nele (dois níveis; a junção recusa
--    destino já juntado, então hoje a cadeia tem um). Só herda de item com a MESMA unidade: a
--    nota de "LUVA CIRURGICA 7,0 ESTERIL C/200 PARES" é por caixa e o item contado é por par.
--
-- 2) Devolução de kit, estorno de kit cancelado, transferência e junção gravam kind='entrada'
--    com o custo do LOTE. Não é compra, e o lote pode ter preço de caixa: DEXAMETASONA EV
--    aparecia a R$ 97,00 a ampola e FENTANIL EV a R$ 98,50 porque a devolução de 17/09 ficou
--    como "último custo". Ficam de fora.
--
-- 3) Empate de horário (mesma nota, duas linhas do item) desempata pelo menor custo, em vez de
--    sair um ou outro a cada consulta.
--
-- Sem recursão de propósito: _stock_kit_saida, stock_baixar e stock_transferir leem esta view
-- item a item, e o filtro por item precisa chegar ao índice (0,6 ms por item; a versão com
-- WITH RECURSIVE recalculava o catálogo inteiro a cada linha do kit, 9 ms).
--
-- Medido antes de aplicar, contra a view antiga: 7 itens mudam, nenhum para pior (DEXAMETASONA
-- 9700→76, FENTANIL 9850→197, CEFUROXIMA 740→719, CLEXANE 1245→959, RINGER 587→597, e 2
-- inativos).

create or replace view public.stock_item_last_costs
  with (security_invoker = on) as
select distinct on (x.tenant_id, x.item_id)
  x.tenant_id, x.item_id, x.unit_cost_cents, x.at
from (
  -- o próprio item
  select m.tenant_id, m.item_id, m.unit_cost_cents, m.created_at as at
    from public.stock_movements m
   where m.kind = 'entrada' and m.unit_cost_cents > 0
     and coalesce(m.ref_type, '') not in ('stock_kit', 'stock_transfer', 'estorno', 'juncao')
  union all
  select poi.tenant_id, poi.item_id, poi.unit_cost_cents, poi.created_at
    from public.purchase_order_items poi
   where poi.item_id is not null and poi.unit_cost_cents > 0
  union all
  select i.tenant_id, i.id, i.reference_cost_cents, i.reference_cost_at
    from public.stock_items i
   where i.reference_cost_cents > 0 and i.reference_cost_at is not null
  union all
  -- item juntado nele (e o juntado no juntado), mesma unidade
  select d.tenant_id, d.id, c.unit_cost_cents, c.at
    from public.stock_items d
    join lateral (
      select o.id from public.stock_items o
       where o.replaced_by = d.id and o.tenant_id = d.tenant_id
         and lower(btrim(coalesce(o.unit, ''))) = lower(btrim(coalesce(d.unit, '')))
      union all
      select g.id from public.stock_items o
        join public.stock_items g on g.replaced_by = o.id and g.tenant_id = o.tenant_id
       where o.replaced_by = d.id and o.tenant_id = d.tenant_id
         and lower(btrim(coalesce(o.unit, ''))) = lower(btrim(coalesce(d.unit, '')))
         and lower(btrim(coalesce(g.unit, ''))) = lower(btrim(coalesce(d.unit, '')))
    ) f on true
    join lateral (
      select m.unit_cost_cents, m.created_at as at
        from public.stock_movements m
       where m.tenant_id = d.tenant_id and m.item_id = f.id
         and m.kind = 'entrada' and m.unit_cost_cents > 0
         and coalesce(m.ref_type, '') not in ('stock_kit', 'stock_transfer', 'estorno', 'juncao')
      union all
      select poi.unit_cost_cents, poi.created_at
        from public.purchase_order_items poi
       where poi.item_id = f.id and poi.unit_cost_cents > 0
      union all
      select o.reference_cost_cents, o.reference_cost_at
        from public.stock_items o
       where o.id = f.id and o.reference_cost_cents > 0 and o.reference_cost_at is not null
    ) c on true
) x
order by x.tenant_id, x.item_id, x.at desc, x.unit_cost_cents;

grant select on public.stock_item_last_costs to authenticated;
grant select on public.stock_item_last_costs to service_role;
