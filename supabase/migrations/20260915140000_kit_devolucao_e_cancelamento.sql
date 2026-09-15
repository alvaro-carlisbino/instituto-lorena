-- Kit cirúrgico: devolver o que não foi usado e cancelar kit já usado.
--
-- A baixa acontece na MONTAGEM (createKit). Até aqui só havia dois caminhos depois dela:
-- "consumido" (não mexia no estoque) ou "cancelado" (só para kit montado, estornava tudo).
-- Na operação a bandeja volta com sobra, e a sobra ficava fora do estoque para sempre.
--
-- As duas operações são funções porque gravam em quatro tabelas (movimento, livro de
-- controlados, item do kit, kit). Pelo navegador, uma falha no meio deixava o estoque
-- devolvido e o kit dizendo o contrário. Aqui é tudo ou nada.
--
-- security invoker: roda com a RLS de quem clicou, e o polo sai do próprio kit.

alter table public.stock_kit_items
  add column if not exists returned_qty numeric not null default 0;

do $$ begin
  alter table public.stock_kit_items
    add constraint stock_kit_items_returned_qty_ck check (returned_qty >= 0 and returned_qty <= qty);
exception when duplicate_object then null;
end $$;

alter table public.stock_kits
  add column if not exists cancelled_at timestamptz;

-- Custo do kit passa a ser LÍQUIDO: o que saiu menos o que voltou. Antes somava abs() de
-- todo movimento do kit, então uma devolução aumentaria o custo em vez de reduzir.
create or replace view public.stock_kit_costs
with (security_invoker = on) as
select k.tenant_id,
       k.id as kit_id,
       k.lead_id,
       sum(-m.qty_delta * coalesce(m.unit_cost_cents, 0)::numeric)::bigint as total_cost_cents,
       bool_and(m.unit_cost_cents is not null) filter (where m.kind = 'saida') as fully_costed
  from public.stock_kits k
  join public.stock_movements m on m.ref_type = 'stock_kit' and m.ref_id = k.id::text
 where k.status = 'consumido'
 group by k.tenant_id, k.id;

-- Devolve a sobra, linha a linha do kit. p_devolucoes = [{"kit_item_id": "...", "qty": 2}, ...]
-- p_fechar = true também marca o kit como usado (é o "Registrar uso" da tela).
create or replace function public.stock_kit_devolver(
  p_kit_id uuid,
  p_devolucoes jsonb,
  p_fechar boolean default true
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_dev record;
  v_linha public.stock_kit_items%rowtype;
  v_item public.stock_items%rowtype;
  v_lote record;
  v_falta numeric;
  v_parte numeric;
  v_mov uuid;
  v_movimentos int := 0;
  v_unidades numeric := 0;
  v_controlados int := 0;
begin
  select * into v_kit from public.stock_kits where id = p_kit_id for update;
  if not found then raise exception 'Kit não encontrado.'; end if;
  if v_kit.status = 'cancelado' then raise exception 'Kit cancelado não recebe devolução.'; end if;

  for v_dev in
    select (e->>'kit_item_id')::uuid as kit_item_id, (e->>'qty')::numeric as qty
      from jsonb_array_elements(coalesce(p_devolucoes, '[]'::jsonb)) e
  loop
    if v_dev.qty is null or v_dev.qty <= 0 then continue; end if;

    select * into v_linha from public.stock_kit_items
     where id = v_dev.kit_item_id and kit_id = p_kit_id for update;
    if not found then raise exception 'Item % não pertence a este kit.', v_dev.kit_item_id; end if;
    select * into v_item from public.stock_items where id = v_linha.item_id;
    if v_linha.returned_qty + v_dev.qty > v_linha.qty then
      raise exception 'Devolução maior do que saiu no kit (%: saiu %, já voltou %).',
        coalesce(v_linha.label, v_item.name), v_linha.qty, v_linha.returned_qty;
    end if;
    v_falta := v_dev.qty;

    -- Volta para os lotes de onde saiu, pelo que ainda está fora (saída menos o que já voltou).
    -- Lote de validade mais longa primeiro: o FEFO tirou os que vencem antes, e é mais provável
    -- que a sobra da bandeja seja a última unidade tirada.
    for v_lote in
      select m.batch_id,
             m.warehouse_id,
             -sum(m.qty_delta) as fora,
             max(m.unit_cost_cents) filter (where m.kind = 'saida') as custo
        from public.stock_movements m
        left join public.stock_batches b on b.id = m.batch_id
       where m.ref_type = 'stock_kit' and m.ref_id = p_kit_id::text and m.item_id = v_linha.item_id
       group by m.batch_id, m.warehouse_id, b.expires_on
      having -sum(m.qty_delta) > 0
       order by b.expires_on desc nulls last
    loop
      exit when v_falta <= 0;
      v_parte := least(v_falta, v_lote.fora);
      insert into public.stock_movements
        (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
      values
        (v_kit.tenant_id, v_linha.item_id, 'entrada', v_parte, 'sobra do kit (devolução)',
         v_kit.name || coalesce(' · ' || v_kit.patient_name, ''), 'stock_kit', p_kit_id::text,
         v_lote.batch_id, v_lote.warehouse_id, v_lote.custo)
      returning id into v_mov;
      v_movimentos := v_movimentos + 1;
      if v_item.controlled then
        insert into public.controlled_substance_log
          (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
        values
          (v_kit.tenant_id, v_linha.item_id, v_lote.batch_id, v_mov, 'entrada', v_parte,
           v_kit.patient_name, 'Devolução de sobra do kit');
        v_controlados := v_controlados + 1;
      end if;
      v_falta := v_falta - v_parte;
    end loop;

    if v_falta > 0 then
      raise exception 'O estoque não registra saída suficiente de "%" neste kit para devolver %.',
        v_item.name, v_dev.qty;
    end if;

    update public.stock_kit_items set returned_qty = returned_qty + v_dev.qty where id = v_linha.id;
    v_unidades := v_unidades + v_dev.qty;
  end loop;

  if p_fechar and v_kit.status = 'montado' then
    update public.stock_kits set status = 'consumido', consumed_at = now() where id = p_kit_id;
  end if;

  return jsonb_build_object('movimentos', v_movimentos, 'unidades', v_unidades, 'controlados', v_controlados);
end;
$$;

-- Cancela kit montado OU já usado: devolve tudo que ainda está fora, lote a lote.
create or replace function public.stock_kit_cancelar(p_kit_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_lote record;
  v_mov uuid;
  v_movimentos int := 0;
  v_controlados int := 0;
begin
  select * into v_kit from public.stock_kits where id = p_kit_id for update;
  if not found then raise exception 'Kit não encontrado.'; end if;
  if v_kit.status = 'cancelado' then raise exception 'Este kit já está cancelado.'; end if;

  for v_lote in
    select m.item_id, m.batch_id, m.warehouse_id,
           -sum(m.qty_delta) as fora,
           max(m.unit_cost_cents) filter (where m.kind = 'saida') as custo,
           bool_or(i.controlled) as controlado
      from public.stock_movements m
      join public.stock_items i on i.id = m.item_id
     where m.ref_type = 'stock_kit' and m.ref_id = p_kit_id::text
     group by m.item_id, m.batch_id, m.warehouse_id
    having -sum(m.qty_delta) > 0
  loop
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
    values
      (v_kit.tenant_id, v_lote.item_id, 'entrada', v_lote.fora, 'kit cancelado (estorno)',
       v_kit.name || coalesce(' · ' || v_kit.patient_name, ''), 'stock_kit', p_kit_id::text,
       v_lote.batch_id, v_lote.warehouse_id, v_lote.custo)
    returning id into v_mov;
    v_movimentos := v_movimentos + 1;
    if v_lote.controlado then
      insert into public.controlled_substance_log
        (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
      values
        (v_kit.tenant_id, v_lote.item_id, v_lote.batch_id, v_mov, 'entrada', v_lote.fora,
         v_kit.patient_name, 'Kit cancelado');
      v_controlados := v_controlados + 1;
    end if;
  end loop;

  update public.stock_kits set status = 'cancelado', cancelled_at = now() where id = p_kit_id;
  return jsonb_build_object('movimentos', v_movimentos, 'controlados', v_controlados);
end;
$$;

revoke all on function public.stock_kit_devolver(uuid, jsonb, boolean) from public, anon;
revoke all on function public.stock_kit_cancelar(uuid) from public, anon;
grant execute on function public.stock_kit_devolver(uuid, jsonb, boolean) to authenticated, service_role;
grant execute on function public.stock_kit_cancelar(uuid) to authenticated, service_role;
