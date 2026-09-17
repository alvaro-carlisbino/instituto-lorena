-- Montar kit numa chamada só, e editar kit volta a funcionar para a equipe.
--
-- 1) Montar um Kit Cirúrgico CC (90 linhas) levava 38 s. O navegador baixava item por item:
--    uma leitura de lote e um insert de movimento por item, em série, fora os custos. Cada ida
--    ao banco custa pouco, mas 180 delas somam. Aqui o kit, as linhas e a baixa por FEFO
--    acontecem numa transação, com o mesmo _stock_kit_saida da edição (custo do lote, livro de
--    controlados). Se algo falha no meio, nada fica meio baixado.
--
-- 2) _stock_kit_saida e _stock_kit_entrada nasceram sem grant para authenticated. Como as
--    funções que as chamam são security invoker, quem clicava era quem precisava do EXECUTE:
--    "permission denied for function _stock_kit_saida" ao pôr item, mudar quantidade ou tirar
--    item de um kit (login da Édina, 17/09). O grant não abre nada novo: as duas só inserem
--    movimento e livro de controlados, que a RLS do polo já deixa o mesmo usuário inserir.

grant execute on function public._stock_kit_saida(public.stock_kits, uuid, numeric, text) to authenticated;
grant execute on function public._stock_kit_entrada(public.stock_kits, uuid, numeric, text) to authenticated;

-- p_kit = {"template_id", "name", "lead_id", "clinic_sale_id", "patient_name", "procedure_label", "scheduled_for"}
-- p_itens = [{"item_id", "qty", "is_extra", "charge_cents", "label"}, ...]
create or replace function public.stock_kit_montar(p_kit jsonb, p_itens jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_linhas int;
  v_item record;
  v_movimentos int := 0;
  v_controlados int := 0;
begin
  insert into public.stock_kits
    (template_id, name, lead_id, clinic_sale_id, patient_name, procedure_label, scheduled_for)
  values (
    nullif(p_kit->>'template_id', '')::uuid,
    coalesce(nullif(btrim(p_kit->>'name'), ''), 'Kit'),
    nullif(p_kit->>'lead_id', ''),
    nullif(p_kit->>'clinic_sale_id', '')::uuid,
    nullif(btrim(p_kit->>'patient_name'), ''),
    nullif(btrim(p_kit->>'procedure_label'), ''),
    nullif(p_kit->>'scheduled_for', '')::date
  )
  returning * into v_kit;

  insert into public.stock_kit_items (tenant_id, kit_id, item_id, qty, is_extra, charge_cents, label)
  select v_kit.tenant_id, v_kit.id, (e->>'item_id')::uuid, (e->>'qty')::numeric,
         coalesce((e->>'is_extra')::boolean, false),
         greatest(0, coalesce(round((e->>'charge_cents')::numeric), 0))::int,
         nullif(btrim(e->>'label'), '')
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as x(e, ordem)
   where nullif(e->>'item_id', '') is not null
     and coalesce((e->>'qty')::numeric, 0) > 0
   order by ordem;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then raise exception 'O kit precisa de ao menos um item.'; end if;

  -- Uma baixa por produto: o mesmo item no modelo e como avulso sai junto, pelos mesmos lotes.
  for v_item in
    select item_id, sum(qty) as qty
      from public.stock_kit_items
     where kit_id = v_kit.id
     group by item_id
  loop
    v_movimentos := v_movimentos + public._stock_kit_saida(v_kit, v_item.item_id, v_item.qty, 'kit montado');
  end loop;

  select count(*) into v_controlados
    from public.controlled_substance_log l
    join public.stock_movements m on m.id = l.movement_id
   where m.ref_type = 'stock_kit' and m.ref_id = v_kit.id::text;

  return jsonb_build_object('kit_id', v_kit.id, 'linhas', v_linhas, 'movimentos', v_movimentos, 'controlados', v_controlados);
end;
$$;

revoke all on function public.stock_kit_montar(jsonb, jsonb) from public, anon;
grant execute on function public.stock_kit_montar(jsonb, jsonb) to authenticated, service_role;
