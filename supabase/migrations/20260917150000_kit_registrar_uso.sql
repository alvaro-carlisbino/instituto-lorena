-- Registrar uso do kit marcando o que foi USADO, inclusive além do que saiu na bandeja.
--
-- Até aqui o "Registrar uso" só aceitava marcar o que voltou, limitado ao que saiu. Na cirurgia
-- a bandeja leva 6 Ringer e a equipe usa 9: para lançar os 3 a mais era preciso fechar o
-- registro, abrir "Editar kit" e subir a quantidade. Aqui as duas coisas vão juntas, numa
-- transação: a linha que usou a mais baixa a diferença por FEFO (_stock_kit_saida) e sobe a
-- quantidade; o que voltou segue por stock_kit_devolver, que também fecha o kit.
--
-- p_linhas = [{"kit_item_id": "...", "voltou": 2, "a_mais": 0}, ...]

create or replace function public.stock_kit_registrar_uso(
  p_kit_id uuid,
  p_linhas jsonb,
  p_fechar boolean default true
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_marca record;
  v_linha public.stock_kit_items%rowtype;
  v_devolucoes jsonb := '[]'::jsonb;
  v_a_mais numeric := 0;
begin
  select * into v_kit from public.stock_kits where id = p_kit_id for update;
  if not found then raise exception 'Kit não encontrado.'; end if;
  if v_kit.status = 'cancelado' then raise exception 'Kit cancelado não recebe registro de uso.'; end if;

  for v_marca in
    select (e->>'kit_item_id')::uuid as kit_item_id,
           coalesce((e->>'voltou')::numeric, 0) as voltou,
           coalesce((e->>'a_mais')::numeric, 0) as a_mais
      from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) e
  loop
    if v_marca.voltou < 0 or v_marca.a_mais < 0 then raise exception 'Quantidade inválida.'; end if;
    if v_marca.voltou > 0 and v_marca.a_mais > 0 then
      raise exception 'A mesma linha não pode ter devolução e uso a mais.';
    end if;

    if v_marca.a_mais > 0 then
      select * into v_linha from public.stock_kit_items
       where id = v_marca.kit_item_id and kit_id = p_kit_id for update;
      if not found then raise exception 'Item % não pertence a este kit.', v_marca.kit_item_id; end if;
      perform public._stock_kit_saida(v_kit, v_linha.item_id, v_marca.a_mais, 'usado a mais na cirurgia');
      update public.stock_kit_items set qty = qty + v_marca.a_mais where id = v_linha.id;
      v_a_mais := v_a_mais + v_marca.a_mais;
    elsif v_marca.voltou > 0 then
      v_devolucoes := v_devolucoes || jsonb_build_array(
        jsonb_build_object('kit_item_id', v_marca.kit_item_id, 'qty', v_marca.voltou));
    end if;
  end loop;

  return public.stock_kit_devolver(p_kit_id, v_devolucoes, p_fechar) || jsonb_build_object('a_mais', v_a_mais);
end;
$$;

revoke all on function public.stock_kit_registrar_uso(uuid, jsonb, boolean) from public, anon;
grant execute on function public.stock_kit_registrar_uso(uuid, jsonb, boolean) to authenticated, service_role;
