-- Estoque por setor que funciona no dia a dia (pedido da enfermagem, 23/09/2026).
--
-- Problema: os modelos de kit não tinham setor, então todo kit baixava do Principal. Quando a
-- enfermagem passasse material para o Centro Cirúrgico ou o SPA, o kit tiraria de onde o
-- material já não está: Principal negativo, setor que nunca baixa.
--
-- Regra única (kit, baixa manual e bipagem): sai do setor escolhido, lote que vence antes
-- primeiro; o que o setor não tiver sai do setor padrão (Principal, o almoxarifado); só o que
-- nem o Principal tiver fica negativo, no setor escolhido. A cirurgia nunca trava por falta de
-- transferência, e o saldo de cada lugar continua certo.

create or replace function public._stock_fefo_setor(p_tenant text, p_item_id uuid, p_setor uuid, p_qty numeric)
returns table(lote_id uuid, parte numeric, custo_cents integer, setor_id uuid)
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_padrao uuid;
  v_lugar uuid;
  v_saldo numeric;
  v_aqui numeric;
  v_falta numeric := p_qty;
  v_f record;
begin
  if p_qty <= 0 then return; end if;
  select w.id into v_padrao from public.stock_warehouses w
   where w.tenant_id = p_tenant and w.is_default and w.active
   order by w.created_at limit 1;

  -- Saldo conta tudo, com ou sem lote: a contagem de 14/09 lançou muito item sem lote, e o
  -- _stock_fefo sozinho só enxerga lote. Ele escolhe os lotes; aqui se decide quanto sai de onde.
  foreach v_lugar in array array_remove(array[p_setor, case when v_padrao <> p_setor then v_padrao end], null) loop
    exit when v_falta <= 0;
    select coalesce(sum(m.qty_delta), 0) into v_saldo from public.stock_movements m
     where m.tenant_id = p_tenant and m.item_id = p_item_id and m.warehouse_id = v_lugar;
    v_aqui := least(v_falta, greatest(v_saldo, 0));
    if v_aqui > 0 then
      for v_f in select * from public._stock_fefo(p_tenant, p_item_id, v_lugar, v_aqui) loop
        lote_id := v_f.lote_id; parte := v_f.parte; custo_cents := v_f.custo_cents; setor_id := v_lugar;
        return next;
      end loop;
      v_falta := v_falta - v_aqui;
    end if;
  end loop;

  -- Nem o setor nem o Principal têm: fica negativo no setor escolhido, para a contagem achar.
  if v_falta > 0 then
    lote_id := null; parte := v_falta; custo_cents := null; setor_id := p_setor;
    return next;
  end if;
end;
$$;

grant execute on function public._stock_fefo_setor(text, uuid, uuid, numeric) to authenticated;

create or replace function public._stock_kit_saida(p_kit stock_kits, p_item_id uuid, p_qty numeric, p_motivo text)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_item public.stock_items%rowtype;
  v_setor uuid;
  v_custo_item integer;
  v_fatia record;
  v_mov uuid;
  v_n int := 0;
begin
  if p_qty <= 0 then return 0; end if;
  select * into v_item from public.stock_items where id = p_item_id;
  if not found then raise exception 'Item de estoque não encontrado.'; end if;
  v_setor := coalesce(p_kit.warehouse_id, (
    select w.id from public.stock_warehouses w
     where w.tenant_id = p_kit.tenant_id and w.is_default and w.active
     order by w.created_at limit 1
  ));
  select c.unit_cost_cents into v_custo_item from public.stock_item_last_costs c
   where c.tenant_id = p_kit.tenant_id and c.item_id = p_item_id;

  for v_fatia in select f.lote_id, f.parte, f.custo_cents, f.setor_id
                   from public._stock_fefo_setor(p_kit.tenant_id, p_item_id, v_setor, p_qty) f
  loop
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
    values
      (p_kit.tenant_id, p_item_id, 'saida', -v_fatia.parte, p_motivo,
       p_kit.name || coalesce(' · ' || p_kit.patient_name, ''), 'stock_kit', p_kit.id::text,
       v_fatia.lote_id, v_fatia.setor_id, coalesce(v_fatia.custo_cents, v_custo_item))
    returning id into v_mov;
    if v_item.controlled then
      insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
      values (p_kit.tenant_id, p_item_id, v_fatia.lote_id, v_mov, 'saida', v_fatia.parte, p_kit.patient_name, p_motivo);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.stock_baixar(p_setor uuid, p_itens jsonb, p_motivo text default null, p_paciente text default null, p_origem text default 'manual')
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_tenant text := (select public.current_tenant_id());
  v_setor uuid;
  v_linha record;
  v_item public.stock_items%rowtype;
  v_custo_item integer;
  v_fatia record;
  v_mov uuid;
  v_movimentos int := 0;
  v_controlados int := 0;
  v_paciente text := nullif(btrim(p_paciente), '');
  v_motivo text := coalesce(nullif(btrim(p_motivo), ''), 'saída');
begin
  if v_tenant is null then raise exception 'Sem polo ativo.'; end if;
  if coalesce(p_origem, '') not in ('manual', 'bipagem') then raise exception 'Origem de baixa inválida.'; end if;
  v_setor := coalesce(p_setor, (select public.stock_setor_padrao()));
  if not exists (select 1 from public.stock_warehouses w where w.id = v_setor and w.tenant_id = v_tenant and w.active) then
    raise exception 'Setor de estoque não encontrado.';
  end if;

  for v_linha in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     where nullif(e->>'item_id', '') is not null and coalesce((e->>'qty')::numeric, 0) > 0
     group by 1
  loop
    select * into v_item from public.stock_items i where i.id = v_linha.item_id and i.tenant_id = v_tenant;
    if not found then raise exception 'Item de estoque não encontrado.'; end if;
    if v_item.controlled and v_paciente is null then
      raise exception 'Saída de "%" (controlado) precisa do nome do paciente.', v_item.name;
    end if;
    select c.unit_cost_cents into v_custo_item from public.stock_item_last_costs c
     where c.tenant_id = v_tenant and c.item_id = v_linha.item_id;

    for v_fatia in select f.lote_id, f.parte, f.custo_cents, f.setor_id
                     from public._stock_fefo_setor(v_tenant, v_linha.item_id, v_setor, v_linha.qty) f
    loop
      insert into public.stock_movements
        (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, batch_id, warehouse_id, unit_cost_cents)
      values
        (v_tenant, v_linha.item_id, 'saida', -v_fatia.parte, v_motivo,
         case when v_paciente is not null then 'Paciente: ' || v_paciente end,
         case when p_origem = 'bipagem' then 'bipagem' end,
         v_fatia.lote_id, v_fatia.setor_id, coalesce(v_fatia.custo_cents, v_custo_item))
      returning id into v_mov;
      v_movimentos := v_movimentos + 1;
      if v_item.controlled then
        insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
        values (v_tenant, v_linha.item_id, v_fatia.lote_id, v_mov, 'saida', v_fatia.parte, v_paciente, v_motivo);
        v_controlados := v_controlados + 1;
      end if;
    end loop;
  end loop;

  if v_movimentos = 0 then raise exception 'Inclua ao menos um item com quantidade.'; end if;
  return jsonb_build_object('movimentos', v_movimentos, 'controlados', v_controlados);
end;
$$;

-- Cada modelo baixa do setor onde o kit é usado. Só preenche o que está vazio: modelo que
-- alguém já apontou para um setor fica como está.
update public.kit_templates t
   set warehouse_id = w.id, updated_at = now()
  from public.stock_warehouses w
 where t.warehouse_id is null
   and t.tenant_id = 'instituto-lorena'
   and w.tenant_id = t.tenant_id
   and w.active
   and w.code = case t.setor when 'cirurgia' then 'CC' when 'spa' then 'SPA' end;

