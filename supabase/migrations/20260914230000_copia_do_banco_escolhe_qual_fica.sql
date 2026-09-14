-- APAGAR CÓPIA DO BANCO ESCOLHENDO QUAL FICA.
--
-- 14/set/2026. Um boleto de R$ 1.581,05 apareceu TRÊS vezes em 03/09: duas como
-- "SISPAG FORNECEDORES" (o lote ainda pendente, gravado duas vezes na rodada das 00:08) e uma
-- como "BOLETO PAGO PORTO S COMP" (o compensado, na rodada das 07:07). A cópia com descrição
-- diferente não passava na regra de "outro igual", que exigia a mesma descrição, e o financeiro
-- não conseguia apagar.
--
-- Agora quem apaga diz qual lançamento FICA. O banco confere que é a mesma conta, o mesmo dia e
-- o mesmo valor; a descrição pode ser outra, porque é justamente o que muda do pendente para o
-- compensado. Sem dizer qual fica, vale a regra antiga (descrição igual).

drop function if exists public.crm_excluir_lancamento_repetido(uuid, text);

create or replace function public.crm_excluir_lancamento_repetido(
  p_id uuid,
  p_motivo text default null,
  p_fica uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.fin_transactions%rowtype;
  v_fica uuid;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  select * into v from public.fin_transactions t
  where t.id = p_id and t.tenant_id = public.current_tenant_id()
  for update;
  if not found then
    raise exception 'lançamento não encontrado';
  end if;
  if v.reconciled_ref_id is not null then
    raise exception 'este lançamento está conciliado com uma conta; desfaça a conciliação antes';
  end if;

  if p_fica is not null then
    select d.id into v_fica
    from public.fin_transactions d
    where d.id = p_fica and d.id <> v.id
      and d.tenant_id = v.tenant_id and d.account_id = v.account_id
      and d.date = v.date and d.amount_cents = v.amount_cents;
    if v_fica is null then
      raise exception 'o lançamento que fica precisa ser da mesma conta, do mesmo dia e do mesmo valor';
    end if;
  else
    -- O que fica é o gravado por último: a cópia velha é a pendente que o banco substituiu.
    select d.id into v_fica
    from public.fin_transactions d
    where d.tenant_id = v.tenant_id and d.account_id = v.account_id
      and d.date = v.date and d.amount_cents = v.amount_cents
      and coalesce(d.description, '') = coalesce(v.description, '')
      and d.id <> v.id
    order by d.created_at desc
    limit 1;
    if v_fica is null then
      raise exception 'não existe outro lançamento igual: este não é cópia, é pagamento de verdade';
    end if;
  end if;

  -- A classificação feita na cópia passa para o que fica, se ele ainda não tiver.
  update public.fin_transactions d
     set cost_center = coalesce(d.cost_center, v.cost_center),
         category_id = case when d.cost_center is null and v.cost_center is not null then v.category_id else coalesce(d.category_id, v.category_id) end,
         category_rule_id = case when d.cost_center is null and v.cost_center is not null then v.category_rule_id else d.category_rule_id end,
         note = coalesce(d.note, v.note),
         counterparty = case
           when v.counterparty is not null and v.counterparty is distinct from v.description
             and (d.counterparty is null or d.counterparty = d.description)
           then v.counterparty else d.counterparty end
   where d.id = v_fica;

  update public.fin_transaction_splits s
     set transaction_id = v_fica
   where s.transaction_id = v.id
     and not exists (select 1 from public.fin_transaction_splits x where x.transaction_id = v_fica);

  insert into public.fin_lancamentos_excluidos (tenant_id, origem, ref_id, motivo, snapshot)
  values (v.tenant_id, 'banco', v.id, coalesce(nullif(btrim(p_motivo), ''), 'Cópia repetida do banco'), to_jsonb(v));

  delete from public.fin_transactions where id = v.id;
  return v_fica;
end $$;

revoke all on function public.crm_excluir_lancamento_repetido(uuid, text, uuid) from public, anon;
grant execute on function public.crm_excluir_lancamento_repetido(uuid, text, uuid) to authenticated;
