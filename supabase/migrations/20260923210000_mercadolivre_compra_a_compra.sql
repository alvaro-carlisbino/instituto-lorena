-- MERCADO LIVRE SE CLASSIFICA COMPRA A COMPRA, EM QUALQUER TELA.
--
-- 23/set/2026. Depois de 20260923200000 (centro "Pessoal ou empresa?"), o financeiro precisa dizer
-- o centro de cada compra do Mercado Livre olhando o pedido. O "aplicar aos iguais" de qualquer
-- tela (Gastos, Extrato) mandava um padrão como "MERCADOLIVRE*MERCADOL", que casa com todas: uma
-- classificação virava todas, e a regra nova ganhava da MERCADOLIVRE nas próximas. A tela já não
-- oferece o padrão (padraoDaRegra); aqui a função o ignora, para aba antiga ou tela esquecida.

CREATE OR REPLACE FUNCTION public.crm_classificar_saida(p_transaction_id uuid, p_centro text, p_pattern text DEFAULT NULL::text, p_detalhe text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant text := public.current_tenant_id();
  v_centro text;
  v_detalhe text := nullif(btrim(coalesce(p_detalhe, '')), '');
  v_cat uuid;
  v_rule uuid;
  v_pattern text := nullif(btrim(coalesce(p_pattern, '')), '');
  n integer := 0;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  select cc.name into v_centro
  from public.fin_cost_centers cc
  where cc.tenant_id = v_tenant and lower(cc.name) = lower(btrim(p_centro)) and cc.active;
  if v_centro is null then
    raise exception 'centro de custo não existe: %', p_centro;
  end if;
  v_cat := public.crm_categoria_do_centro(v_tenant, v_centro);

  -- Detalhe novo nasce da própria classificação: obrigar a cadastrar antes é a diferença entre
  -- alguém detalhar o gasto e alguém deixar em branco. Ele fica na lista para a próxima vez.
  if v_detalhe is not null then
    insert into public.fin_cost_details (tenant_id, cost_center, name)
    values (v_tenant, v_centro, v_detalhe)
    on conflict (tenant_id, lower(cost_center), lower(name)) do nothing;
    -- Vale o nome já cadastrado, para "ferias" não virar um segundo "Férias" na lista.
    select d.name into v_detalhe
    from public.fin_cost_details d
    where d.tenant_id = v_tenant and lower(d.cost_center) = lower(v_centro)
      and lower(d.name) = lower(v_detalhe);
  end if;

  -- Classificado à mão: sai do rastro de regra, senão "desfazer regra" apagaria a escolha.
  update public.fin_transactions t
     set cost_center = v_centro, cost_detail = v_detalhe, category_id = v_cat, category_rule_id = null
   where t.id = p_transaction_id and t.tenant_id = v_tenant and t.direction = 'out';
  if not found then
    raise exception 'lançamento não encontrado';
  end if;

  -- Compra que só o pedido explica (Mercado Livre: o mesmo nome em toda compra) não vira regra,
  -- venha o padrão de qualquer tela. Senão classificar UMA carimbaria todas as outras e as
  -- próximas, e a regra "MERCADOLIVRE" → "Pessoal ou empresa?" perderia para a mais longa.
  if v_pattern is not null and (
       public.crm_texto_casa(v_pattern, 'MERCADOLIVRE')
       or exists (
         select 1
         from public.fin_transactions t
         join public.fin_category_rules r
           on r.tenant_id = t.tenant_id and r.cost_center = 'Pessoal ou empresa?'
         where t.id = p_transaction_id
           and (public.crm_texto_casa(t.description, r.pattern) or public.crm_texto_casa(t.counterparty, r.pattern))
       )) then
    v_pattern := null;
  end if;

  if v_pattern is not null and length(v_pattern) >= 4 then
    insert into public.fin_category_rules (tenant_id, pattern, category_id, direction, cost_center, cost_detail)
    values (v_tenant, v_pattern, v_cat, 'out', v_centro, v_detalhe)
    on conflict (tenant_id, lower(pattern), coalesce(direction, 'all'))
    do update set category_id = excluded.category_id,
                  cost_center = excluded.cost_center,
                  cost_detail = excluded.cost_detail
    returning id into v_rule;

    update public.fin_transactions t
       set cost_center = v_centro, cost_detail = v_detalhe, category_id = v_cat, category_rule_id = v_rule
     where t.tenant_id = v_tenant
       and t.direction = 'out'
       and t.id <> p_transaction_id
       and (t.cost_center is null or t.category_rule_id = v_rule)
       and (public.crm_texto_casa(t.description, v_pattern) or public.crm_texto_casa(t.counterparty, v_pattern));
    get diagnostics n = row_count;
  end if;

  return n;
end $function$;
