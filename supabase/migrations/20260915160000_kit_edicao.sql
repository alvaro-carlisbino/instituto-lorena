-- Editar kit já montado: pôr item, mudar quantidade, tirar item, excluir o kit.
--
-- A enfermagem monta a bandeja antes e a cirurgia pede mais (ou menos) do que o modelo. Até
-- aqui a única saída era cancelar o kit inteiro e montar de novo, o que ninguém faz no meio
-- do dia, então a conta do paciente ficava errada. Cada edição mexe no estoque na hora, do
-- mesmo jeito que a montagem: saída por FEFO com custo do lote, livro de controlados.

-- Saída de um item para o kit, por FEFO. O que faltar de lote sai sem lote, com o último custo.
create or replace function public._stock_kit_saida(p_kit public.stock_kits, p_item_id uuid, p_qty numeric, p_motivo text)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.stock_items%rowtype;
  v_lote record;
  v_falta numeric := p_qty;
  v_parte numeric;
  v_custo_item integer;
  v_mov uuid;
  v_n int := 0;
begin
  if p_qty <= 0 then return 0; end if;
  select * into v_item from public.stock_items where id = p_item_id;
  if not found then raise exception 'Item de estoque não encontrado.'; end if;
  select unit_cost_cents into v_custo_item from public.stock_item_last_costs
   where tenant_id = p_kit.tenant_id and item_id = p_item_id;

  for v_lote in
    select b.batch_id, b.qty, c.unit_cost_cents as custo
      from public.stock_batch_balances b
      left join public.stock_batch_costs c on c.batch_id = b.batch_id and c.tenant_id = b.tenant_id
     where b.tenant_id = p_kit.tenant_id and b.item_id = p_item_id and b.qty > 0
     order by b.expires_on asc nulls last
  loop
    exit when v_falta <= 0;
    v_parte := least(v_falta, v_lote.qty);
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, unit_cost_cents)
    values
      (p_kit.tenant_id, p_item_id, 'saida', -v_parte, p_motivo,
       p_kit.name || coalesce(' · ' || p_kit.patient_name, ''), 'stock_kit', p_kit.id::text,
       v_lote.batch_id, coalesce(v_lote.custo, v_custo_item))
    returning id into v_mov;
    if v_item.controlled then
      insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
      values (p_kit.tenant_id, p_item_id, v_lote.batch_id, v_mov, 'saida', v_parte, p_kit.patient_name, p_motivo);
    end if;
    v_falta := v_falta - v_parte;
    v_n := v_n + 1;
  end loop;

  if v_falta > 0 then
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, unit_cost_cents)
    values
      (p_kit.tenant_id, p_item_id, 'saida', -v_falta, p_motivo,
       p_kit.name || coalesce(' · ' || p_kit.patient_name, ''), 'stock_kit', p_kit.id::text, null, v_custo_item)
    returning id into v_mov;
    if v_item.controlled then
      insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
      values (p_kit.tenant_id, p_item_id, null, v_mov, 'saida', v_falta, p_kit.patient_name, p_motivo);
    end if;
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

-- Volta ao estoque o que saiu para o kit, nos lotes de onde saiu (validade mais longa primeiro).
create or replace function public._stock_kit_entrada(p_kit public.stock_kits, p_item_id uuid, p_qty numeric, p_motivo text)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.stock_items%rowtype;
  v_lote record;
  v_falta numeric := p_qty;
  v_parte numeric;
  v_mov uuid;
  v_n int := 0;
begin
  if p_qty <= 0 then return 0; end if;
  select * into v_item from public.stock_items where id = p_item_id;
  for v_lote in
    select m.batch_id, m.warehouse_id, -sum(m.qty_delta) as fora,
           max(m.unit_cost_cents) filter (where m.kind = 'saida') as custo
      from public.stock_movements m
      left join public.stock_batches b on b.id = m.batch_id
     where m.ref_type = 'stock_kit' and m.ref_id = p_kit.id::text and m.item_id = p_item_id
     group by m.batch_id, m.warehouse_id, b.expires_on
    having -sum(m.qty_delta) > 0
     order by b.expires_on desc nulls last
  loop
    exit when v_falta <= 0;
    v_parte := least(v_falta, v_lote.fora);
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
    values
      (p_kit.tenant_id, p_item_id, 'entrada', v_parte, p_motivo,
       p_kit.name || coalesce(' · ' || p_kit.patient_name, ''), 'stock_kit', p_kit.id::text,
       v_lote.batch_id, v_lote.warehouse_id, v_lote.custo)
    returning id into v_mov;
    if v_item.controlled then
      insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
      values (p_kit.tenant_id, p_item_id, v_lote.batch_id, v_mov, 'entrada', v_parte, p_kit.patient_name, p_motivo);
    end if;
    v_falta := v_falta - v_parte;
    v_n := v_n + 1;
  end loop;
  if v_falta > 0 then
    raise exception 'O estoque não registra saída suficiente de "%" neste kit para devolver %.', v_item.name, p_qty;
  end if;
  return v_n;
end;
$$;

-- Pôr item num kit montado ou usado (a cirurgia pediu mais). Baixa na hora.
create or replace function public.stock_kit_adicionar_item(
  p_kit_id uuid,
  p_item_id uuid,
  p_qty numeric,
  p_avulso boolean default true,
  p_cobranca_cents integer default 0
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_linha uuid;
begin
  select * into v_kit from public.stock_kits where id = p_kit_id for update;
  if not found then raise exception 'Kit não encontrado.'; end if;
  if v_kit.status = 'cancelado' then raise exception 'Kit cancelado não pode ser editado.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantidade inválida.'; end if;

  insert into public.stock_kit_items (tenant_id, kit_id, item_id, qty, is_extra, charge_cents)
  values (v_kit.tenant_id, p_kit_id, p_item_id, p_qty, coalesce(p_avulso, true), greatest(0, coalesce(p_cobranca_cents, 0)))
  returning id into v_linha;
  perform public._stock_kit_saida(v_kit, p_item_id, p_qty, 'item incluído no kit');
  return v_linha;
end;
$$;

-- Muda quantidade (baixa ou devolve a diferença), cobrança e marcação de avulso de uma linha.
create or replace function public.stock_kit_alterar_linha(
  p_kit_item_id uuid,
  p_qty numeric,
  p_cobranca_cents integer default null,
  p_avulso boolean default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_linha public.stock_kit_items%rowtype;
  v_kit public.stock_kits%rowtype;
  v_dif numeric;
begin
  select * into v_linha from public.stock_kit_items where id = p_kit_item_id for update;
  if not found then raise exception 'Linha do kit não encontrada.'; end if;
  select * into v_kit from public.stock_kits where id = v_linha.kit_id for update;
  if v_kit.status = 'cancelado' then raise exception 'Kit cancelado não pode ser editado.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantidade inválida. Para tirar o item, use remover.'; end if;
  if p_qty < v_linha.returned_qty then
    raise exception 'Já voltaram % desta linha ao estoque; a quantidade não pode ficar abaixo disso.', v_linha.returned_qty;
  end if;

  v_dif := p_qty - v_linha.qty;
  if v_dif > 0 then
    perform public._stock_kit_saida(v_kit, v_linha.item_id, v_dif, 'kit editado (quantidade aumentada)');
  elsif v_dif < 0 then
    perform public._stock_kit_entrada(v_kit, v_linha.item_id, -v_dif, 'kit editado (quantidade reduzida)');
  end if;

  update public.stock_kit_items
     set qty = p_qty,
         charge_cents = coalesce(greatest(0, p_cobranca_cents), charge_cents),
         is_extra = coalesce(p_avulso, is_extra)
   where id = p_kit_item_id;
  return jsonb_build_object('diferenca', v_dif);
end;
$$;

-- Tira a linha do kit: o que ainda está fora volta ao estoque.
create or replace function public.stock_kit_remover_linha(p_kit_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_linha public.stock_kit_items%rowtype;
  v_kit public.stock_kits%rowtype;
  v_fora numeric;
begin
  select * into v_linha from public.stock_kit_items where id = p_kit_item_id for update;
  if not found then raise exception 'Linha do kit não encontrada.'; end if;
  select * into v_kit from public.stock_kits where id = v_linha.kit_id for update;
  if v_kit.status = 'cancelado' then raise exception 'Kit cancelado não pode ser editado.'; end if;
  v_fora := v_linha.qty - v_linha.returned_qty;
  perform public._stock_kit_entrada(v_kit, v_linha.item_id, v_fora, 'item tirado do kit');
  delete from public.stock_kit_items where id = p_kit_item_id;
  return jsonb_build_object('devolvido', v_fora);
end;
$$;

-- Excluir kit lançado errado: devolve o que estiver fora (cancelando) e apaga o registro.
-- Os movimentos de estoque ficam, porque são o histórico do saldo; somados dão zero.
create or replace function public.stock_kit_excluir(p_kit_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_cancel jsonb := '{}'::jsonb;
begin
  select * into v_kit from public.stock_kits where id = p_kit_id for update;
  if not found then raise exception 'Kit não encontrado.'; end if;
  if v_kit.status <> 'cancelado' then
    v_cancel := public.stock_kit_cancelar(p_kit_id);
  end if;
  delete from public.stock_kit_items where kit_id = p_kit_id;
  delete from public.stock_kits where id = p_kit_id;
  return v_cancel;
end;
$$;

revoke all on function public._stock_kit_saida(public.stock_kits, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public._stock_kit_entrada(public.stock_kits, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.stock_kit_adicionar_item(uuid, uuid, numeric, boolean, integer) from public, anon;
revoke all on function public.stock_kit_alterar_linha(uuid, numeric, integer, boolean) from public, anon;
revoke all on function public.stock_kit_remover_linha(uuid) from public, anon;
revoke all on function public.stock_kit_excluir(uuid) from public, anon;
grant execute on function public.stock_kit_adicionar_item(uuid, uuid, numeric, boolean, integer) to authenticated, service_role;
grant execute on function public.stock_kit_alterar_linha(uuid, numeric, integer, boolean) to authenticated, service_role;
grant execute on function public.stock_kit_remover_linha(uuid) to authenticated, service_role;
grant execute on function public.stock_kit_excluir(uuid) to authenticated, service_role;
