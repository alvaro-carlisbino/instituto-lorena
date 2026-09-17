-- Inventário por setor e finalização no banco; setor padrão trocado numa transação só.
--
-- 1) A contagem fotografava o saldo TOTAL e o ajuste entrava sem setor e sem lote. Com os
--    setores valendo de verdade (20260917190000), contar o SPA e ajustar o total apagaria o
--    que está no Centro Cirúrgico. E ajuste para menos sem lote deixava o lote com saldo que
--    não existe: o FEFO seguia tirando dele. Agora a contagem é de um setor; a sobra entra
--    sem lote e a falta sai dos lotes do setor por FEFO, tudo numa transação, apontando para
--    a contagem (ref_type stock_count), o que o kardex precisa para dizer "Inventário X".
--    A finalização pelo navegador não gravava ref_type nem ref_id.
-- 2) Trocar o setor padrão eram dois updates pelo navegador (tira de todos, marca o novo). Se
--    o segundo falhasse o polo ficava sem padrão, e movimento sem setor ficaria sem destino.

create or replace function public.stock_setor_tornar_padrao(p_setor uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_w public.stock_warehouses%rowtype;
begin
  select * into v_w from public.stock_warehouses w where w.id = p_setor and w.active;
  if not found then raise exception 'Setor não encontrado ou desativado.'; end if;
  update public.stock_warehouses
     set is_default = false, updated_at = now()
   where tenant_id = v_w.tenant_id and is_default and id <> p_setor;
  update public.stock_warehouses set is_default = true, updated_at = now() where id = p_setor;
end;
$$;
revoke all on function public.stock_setor_tornar_padrao(uuid) from public, anon;
grant execute on function public.stock_setor_tornar_padrao(uuid) to authenticated, service_role;

-- Setor padrão não se desativa: é para onde vai o movimento que não diz setor.
create or replace function public._stock_setor_padrao_ativo()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.is_default and old.active and not new.active then
    raise exception 'O setor padrão não pode ser desativado. Torne outro setor padrão antes.';
  end if;
  return new;
end;
$$;
revoke all on function public._stock_setor_padrao_ativo() from public, anon, authenticated;
drop trigger if exists stock_warehouses_padrao_ativo on public.stock_warehouses;
create trigger stock_warehouses_padrao_ativo
  before update on public.stock_warehouses
  for each row execute function public._stock_setor_padrao_ativo();

-- Abre a contagem de um setor. p_todos=false lista só o que o sistema diz que está no setor
-- (saldo diferente de zero) ou que tem endereço nele; o resto se inclui bipando.
create or replace function public.stock_inventario_abrir(p_rotulo text, p_setor uuid, p_todos boolean default false)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant text := (select public.current_tenant_id());
  v_setor uuid;
  v_count uuid;
begin
  if v_tenant is null then raise exception 'Sem polo ativo.'; end if;
  v_setor := coalesce(p_setor, (select public.stock_setor_padrao()));
  if not exists (select 1 from public.stock_warehouses w where w.id = v_setor and w.tenant_id = v_tenant and w.active) then
    raise exception 'Setor de estoque não encontrado.';
  end if;

  insert into public.stock_counts (label, warehouse_id)
  values (coalesce(nullif(btrim(p_rotulo), ''), 'Contagem'), v_setor)
  returning id into v_count;

  insert into public.stock_count_items (tenant_id, count_id, item_id, system_qty)
  select v_tenant, v_count, i.id, coalesce(s.qtd, 0)
    from public.stock_items i
    left join (
      select m.item_id, sum(m.qty_delta) as qtd
        from public.stock_movements m
       where m.tenant_id = v_tenant and m.warehouse_id = v_setor
       group by m.item_id
    ) s on s.item_id = i.id
   where i.tenant_id = v_tenant
     and i.active
     and i.replaced_by is null
     and (
       p_todos
       or coalesce(s.qtd, 0) <> 0
       or exists (
         select 1 from public.stock_item_locations il
         join public.stock_locations l on l.id = il.location_id
        where il.item_id = i.id and l.warehouse_id = v_setor and l.active
       )
     );
  return v_count;
end;
$$;
revoke all on function public.stock_inventario_abrir(text, uuid, boolean) from public, anon;
grant execute on function public.stock_inventario_abrir(text, uuid, boolean) to authenticated, service_role;

-- Inclui na contagem aberta um item que não estava na lista (achado na prateleira).
create or replace function public.stock_inventario_incluir(p_count uuid, p_item_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_c public.stock_counts%rowtype;
  v_setor uuid;
  v_linha uuid;
begin
  select * into v_c from public.stock_counts c where c.id = p_count;
  if not found then raise exception 'Contagem não encontrada.'; end if;
  if v_c.status <> 'aberta' then raise exception 'Esta contagem já foi %.', v_c.status; end if;
  select ci.id into v_linha from public.stock_count_items ci where ci.count_id = p_count and ci.item_id = p_item_id limit 1;
  if v_linha is not null then return v_linha; end if;
  v_setor := coalesce(v_c.warehouse_id, (
    select w.id from public.stock_warehouses w
     where w.tenant_id = v_c.tenant_id and w.is_default and w.active order by w.created_at limit 1));
  insert into public.stock_count_items (tenant_id, count_id, item_id, system_qty)
  select v_c.tenant_id, p_count, i.id,
         (select coalesce(sum(m.qty_delta), 0) from public.stock_movements m where m.item_id = i.id and m.warehouse_id = v_setor)
    from public.stock_items i
   where i.id = p_item_id and i.tenant_id = v_c.tenant_id
  returning id into v_linha;
  if v_linha is null then raise exception 'Item de estoque não encontrado.'; end if;
  return v_linha;
end;
$$;
revoke all on function public.stock_inventario_incluir(uuid, uuid) from public, anon;
grant execute on function public.stock_inventario_incluir(uuid, uuid) to authenticated, service_role;

-- Finaliza: cada item contado vai ao número contado NO SETOR, comparando com o saldo de agora
-- (não o fotografado), para não desfazer o que entrou ou saiu durante a contagem.
create or replace function public.stock_inventario_finalizar(p_count uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_c public.stock_counts%rowtype;
  v_setor uuid;
  v_l record;
  v_atual numeric;
  v_diff numeric;
  v_f record;
  v_custo integer;
  v_mov uuid;
  v_nota text;
  v_ajustados int := 0;
  v_movimentos int := 0;
begin
  select * into v_c from public.stock_counts c where c.id = p_count for update;
  if not found then raise exception 'Contagem não encontrada.'; end if;
  if v_c.status <> 'aberta' then raise exception 'Esta contagem já foi %.', v_c.status; end if;
  v_setor := coalesce(v_c.warehouse_id, (
    select w.id from public.stock_warehouses w
     where w.tenant_id = v_c.tenant_id and w.is_default and w.active order by w.created_at limit 1));

  for v_l in
    select ci.item_id, ci.counted_qty, i.controlled
      from public.stock_count_items ci
      join public.stock_items i on i.id = ci.item_id
     where ci.count_id = p_count and ci.counted_qty is not null
  loop
    select coalesce(sum(m.qty_delta), 0) into v_atual
      from public.stock_movements m where m.item_id = v_l.item_id and m.warehouse_id = v_setor;
    v_diff := v_l.counted_qty - v_atual;
    continue when v_diff = 0;
    v_ajustados := v_ajustados + 1;
    v_nota := format('%s: sistema %s, contado %s', v_c.label, trim_scale(v_atual), trim_scale(v_l.counted_qty));

    if v_diff > 0 then
      insert into public.stock_movements
        (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, warehouse_id)
      values
        (v_c.tenant_id, v_l.item_id, 'ajuste', v_diff, 'inventário', v_nota, 'stock_count', p_count::text, v_setor)
      returning id into v_mov;
      v_movimentos := v_movimentos + 1;
      if v_l.controlled then
        insert into public.controlled_substance_log (tenant_id, item_id, movement_id, action, qty, note)
        values (v_c.tenant_id, v_l.item_id, v_mov, 'entrada', v_diff, 'Inventário: ' || v_c.label);
      end if;
    else
      select c.unit_cost_cents into v_custo from public.stock_item_last_costs c
       where c.tenant_id = v_c.tenant_id and c.item_id = v_l.item_id;
      for v_f in select f.lote_id, f.parte, f.custo_cents from public._stock_fefo(v_c.tenant_id, v_l.item_id, v_setor, -v_diff) f
      loop
        insert into public.stock_movements
          (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
        values
          (v_c.tenant_id, v_l.item_id, 'ajuste', -v_f.parte, 'inventário', v_nota, 'stock_count', p_count::text,
           v_f.lote_id, v_setor, coalesce(v_f.custo_cents, v_custo))
        returning id into v_mov;
        v_movimentos := v_movimentos + 1;
        if v_l.controlled then
          insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, note)
          values (v_c.tenant_id, v_l.item_id, v_f.lote_id, v_mov, 'saida', v_f.parte, 'Inventário: ' || v_c.label);
        end if;
      end loop;
    end if;
  end loop;

  update public.stock_counts set status = 'finalizada', finalized_at = now() where id = p_count;
  return jsonb_build_object('ajustados', v_ajustados, 'movimentos', v_movimentos);
end;
$$;
revoke all on function public.stock_inventario_finalizar(uuid) from public, anon;
grant execute on function public.stock_inventario_finalizar(uuid) to authenticated, service_role;
