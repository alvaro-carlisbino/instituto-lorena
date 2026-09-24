-- Editar kit sem erro ao diminuir o "Saiu" (24/09/2026).
--
-- A enfermagem monta o kit e, na mesma hora, acerta a bandeja no Editar kit: marca "Voltou" no
-- que não entrou e depois baixa o "Saiu". A função recusava ("Já voltaram 5 desta linha ao
-- estoque; a quantidade não pode ficar abaixo disso"), e foi o erro de edição de 24/09 (kit da
-- Ilsa, Propofol 10 saíram, 5 voltaram).
--
-- Regra nova: diminuir o "Saiu" tira primeiro do que já voltou. Essas unidades já estão no
-- estoque, então só a linha muda (saiu e voltou descem juntos) e o "Usado" fica igual. Só o que
-- passar do que voltou sai do usado e volta ao estoque, como antes.
--
-- E o custo do kit montado (ainda sem registro de uso) passa a existir em stock_kit_costs: o
-- material já saiu do estoque, e a lista mostrava "≈" pelo último preço de compra enquanto a conta
-- impressa usava o custo da baixa. Os dois números agora são o mesmo.

create or replace function public.stock_kit_alterar_linha(p_kit_item_id uuid, p_qty numeric, p_cobranca_cents integer default null, p_avulso boolean default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_linha public.stock_kit_items%rowtype;
  v_kit public.stock_kits%rowtype;
  v_dif numeric;
  v_do_voltou numeric := 0;
  v_ao_estoque numeric := 0;
begin
  select * into v_linha from public.stock_kit_items where id = p_kit_item_id for update;
  if not found then raise exception 'Linha do kit não encontrada.'; end if;
  select * into v_kit from public.stock_kits where id = v_linha.kit_id for update;
  if v_kit.status = 'cancelado' then raise exception 'Kit cancelado não pode ser editado.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantidade inválida. Para tirar o item, use remover.'; end if;

  v_dif := p_qty - v_linha.qty;
  if v_dif > 0 then
    perform public._stock_kit_saida(v_kit, v_linha.item_id, v_dif, 'kit editado (quantidade aumentada)');
  elsif v_dif < 0 then
    -- Primeiro do que já voltou (já está no estoque, nada a movimentar), depois do usado.
    v_do_voltou := least(-v_dif, v_linha.returned_qty);
    v_ao_estoque := -v_dif - v_do_voltou;
    if v_ao_estoque > 0 then
      perform public._stock_kit_entrada(v_kit, v_linha.item_id, v_ao_estoque, 'kit editado (quantidade reduzida)');
    end if;
  end if;

  update public.stock_kit_items
     set qty = p_qty,
         returned_qty = returned_qty - v_do_voltou,
         charge_cents = coalesce(greatest(0, p_cobranca_cents), charge_cents),
         is_extra = coalesce(p_avulso, is_extra)
   where id = p_kit_item_id;
  return jsonb_build_object('diferenca', v_dif, 'do_voltou', v_do_voltou, 'ao_estoque', v_ao_estoque);
end;
$$;

create or replace view public.stock_kit_costs with (security_invoker = on) as
  select k.tenant_id,
         k.id as kit_id,
         k.lead_id,
         (sum((-m.qty_delta) * coalesce(m.unit_cost_cents, 0)::numeric))::bigint as total_cost_cents,
         bool_and(m.unit_cost_cents is not null) filter (where m.kind = 'saida') as fully_costed
    from public.stock_kits k
    join public.stock_movements m on m.ref_type = 'stock_kit' and m.ref_id = k.id::text
   where k.status in ('montado', 'consumido')
   group by k.tenant_id, k.id;
