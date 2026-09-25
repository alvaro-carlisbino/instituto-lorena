-- BOLETO DE FATURA QUE NÃO É DO CARTÃO LIGADO AO SISTEMA.
--
-- Desde 18/09 (20260918140000) todo boleto de fatura que sai da conta corrente fica FORA do
-- gasto, porque as compras do cartão já entram item a item pela conta do cartão; contar o boleto
-- também dobraria a despesa. Isso só vale para o cartão cujas compras estão aqui: o Itaú Empresas
-- Mastercard final 4310.
--
-- A clínica paga outros boletos de fatura cujas compras NÃO estão no sistema. De jun a ago/2026:
-- 19/06 R$ 2.082,59, um dos dois de julho (14/07 R$ 28.665,47 ou 17/07 R$ 26.952,57) e 18/08
-- R$ 1.964,38. Pela regra antiga eles sumiam de Gastos e do DRE: dinheiro que saiu e não virou
-- despesa em lugar nenhum. O financeiro acha que é cartão pessoal do Dr. pago com dinheiro da
-- clínica; o 17/09 mostrou também um "Itaú Empresas Visa Internacional" que nunca foi ligado.
--
-- Só quem tem o comprovante sabe de qual cartão é cada boleto. Então a marca é explícita, posta
-- por uma pessoa: `fatura_sem_compras`. Boleto marcado conta como saída comum, com o centro que o
-- financeiro der (Retirada sócios, se foi gasto pessoal; o centro da clínica, se foi despesa dela
-- noutro cartão). Sem a marca, continua fora, como antes.
--
-- Coluna própria em vez de "boleto com centro de custo conta": regra de classificação carimba
-- centro em lote (no insert e ao aplicar regra), e um carimbo por engano no boleto do Mastercard
-- faria a fatura dele contar em dobro sem ninguém ter decidido nada.

alter table public.fin_transactions
  add column if not exists fatura_sem_compras boolean not null default false;

comment on column public.fin_transactions.fatura_sem_compras is
  'Boleto de fatura de um cartão cujas compras não estão no sistema: conta no gasto pelo valor do boleto. Só crm_fatura_sem_compras escreve.';

-- 1) Tudo que saiu: o boleto marcado entra como qualquer saída do banco.
create or replace function public.crm_saidas_tudo(p_de date, p_ate date)
 returns table(origem text, id text, data date, descricao text, contraparte text, amount_cents bigint, categoria text, centro_custo text, conciliado boolean, nao_e_gasto boolean, possivel_duplicado boolean, status text, conta text, do_cartao boolean, centro_detalhe text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- 1) o que de fato saiu: da conta corrente e do cartão (o item, não a fatura)
  select 'banco', t.id::text, t.date,
         coalesce(t.description, ''), coalesce(t.counterparty, ''),
         abs(t.amount_cents)::bigint, c.name, t.cost_center,
         t.reconciled_ref_id is not null,
         coalesce(c.name ilike '%não é despesa%', false),
         (t.source = 'openfinance' and exists (
           select 1 from public.fin_transactions d
           where d.tenant_id = t.tenant_id and d.account_id = t.account_id
             and d.date = t.date and d.amount_cents = t.amount_cents
             and coalesce(d.description, '') = coalesce(t.description, '')
             and d.id <> t.id and d.source = 'openfinance'
             and d.created_at > t.created_at + interval '1 hour'
         )),
         'pago', a.name, a.kind = 'carteira', t.cost_detail
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  left join public.fin_categories c on c.id = t.category_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind in ('banco', 'carteira')
    and t.direction = 'out'
    -- Boleto do cartão ligado fica fora (as compras dele já contam); o de outro cartão, marcado, entra.
    and not (a.kind = 'banco' and public.crm_e_pagamento_de_fatura(t.description) and not t.fatura_sem_compras)
    and t.date between p_de and p_ate
    and public.current_user_can_finance()
  union all
  -- 2) compromisso que ainda não apareceu no extrato (senão conta duas vezes)
  select 'a pagar', p.id::text, p.due_date,
         coalesce(p.description, ''), coalesce(nullif(p.counterparty, ''), s.name, ''),
         p.amount_cents::bigint, c.name, p.cost_center, false,
         coalesce(c.name ilike '%não é despesa%', false),
         false,
         p.status, null::text, false, p.cost_detail
  from public.payable_installments p
  left join public.fin_categories c on c.id = p.category_id
  left join public.stock_suppliers s on s.id = p.supplier_id
  where p.tenant_id = public.current_tenant_id()
    and p.due_date between p_de and p_ate
    and p.status <> 'cancelado'
    and not exists (
      select 1 from public.fin_transactions t2
      where t2.tenant_id = p.tenant_id and t2.reconciled_ref_type = 'payable' and t2.reconciled_ref_id = p.id
    )
    and public.current_user_can_finance()
  order by 3 desc;
$function$;

-- 2) As linhas que o DRE lê.
create or replace function public.crm_saidas_efetivas(p_de date, p_ate date)
 returns table(transaction_id uuid, data date, descricao text, amount_cents bigint, category_id uuid, categoria text, cost_center text, origem text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select t.id, t.date, coalesce(t.description, t.counterparty, '') as descricao,
           abs(t.amount_cents) as cents, t.category_id, t.cost_center,
           (select coalesce(sum(s.amount_cents), 0) from public.fin_transaction_splits s
             where s.transaction_id = t.id) as rateado
    from public.fin_transactions t
    join public.fin_accounts a on a.id = t.account_id
    where t.tenant_id = public.current_tenant_id()
      and a.kind in ('banco', 'carteira')
      and t.direction = 'out'
      -- Sem esta linha a despesa do cartão contaria duas vezes: nos itens e no boleto da fatura.
      -- O boleto de outro cartão (marcado) não tem itens aqui, então conta ele mesmo.
      and not (a.kind = 'banco' and public.crm_e_pagamento_de_fatura(t.description) and not t.fatura_sem_compras)
      and t.date between p_de and p_ate
      and public.current_user_can_finance()
  )
  select b.id, b.date, b.descricao, s.amount_cents::bigint, s.category_id, c.name, s.cost_center, 'rateio'
  from base b join public.fin_transaction_splits s on s.transaction_id = b.id
  left join public.fin_categories c on c.id = s.category_id
  union all
  select b.id, b.date, b.descricao, b.cents::bigint, b.category_id, c.name, b.cost_center, 'lancamento'
  from base b left join public.fin_categories c on c.id = b.category_id where b.rateado = 0
  union all
  select b.id, b.date, b.descricao, (b.cents - b.rateado)::bigint, null::uuid, null::text, null::text, 'sobra'
  from base b where b.rateado > 0 and b.rateado < b.cents;
$function$;

-- 3) Gasto por detalhe (relatório "em quê").
create or replace function public.crm_gasto_por_detalhe(p_de date, p_ate date, p_centro text default null::text)
 returns table(centro text, detalhe text, qtd bigint, amount_cents bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(t.cost_center, 'Sem centro de custo'),
         coalesce(t.cost_detail, 'Sem detalhe'),
         count(*)::bigint,
         sum(abs(t.amount_cents))::bigint
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind in ('banco', 'carteira')
    and t.direction = 'out'
    and not (a.kind = 'banco' and public.crm_e_pagamento_de_fatura(t.description) and not t.fatura_sem_compras)
    and t.date between p_de and p_ate
    and (p_centro is null or lower(t.cost_center) = lower(p_centro))
    and public.current_user_can_finance()
  group by 1, 2
  order by 4 desc;
$function$;

-- 4) Marcar e desmarcar. Marcar exige o centro na mesma chamada: boleto marcado e sem centro
--    cairia em "falta classificar" com um valor que ninguém sabe de onde veio. Nunca vira regra:
--    o boleto de fatura tem a mesma cara para todos os cartões.
create or replace function public.crm_fatura_sem_compras(
  p_transaction_id uuid,
  p_marcar boolean,
  p_centro text default null,
  p_detalhe text default null
) returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant text := public.current_tenant_id();
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  perform 1
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  where t.id = p_transaction_id and t.tenant_id = v_tenant
    and a.kind = 'banco' and t.direction = 'out'
    and public.crm_e_pagamento_de_fatura(t.description);
  if not found then
    raise exception 'não é boleto de fatura de cartão desta conta';
  end if;

  if p_marcar then
    if nullif(btrim(coalesce(p_centro, '')), '') is null then
      raise exception 'escolha o centro de custo do boleto';
    end if;
    update public.fin_transactions set fatura_sem_compras = true
     where id = p_transaction_id and tenant_id = v_tenant;
    perform public.crm_classificar_saida(p_transaction_id, p_centro, null, p_detalhe);
  else
    -- De volta ao cartão: o boleto não tem centro, quem tem são as compras.
    update public.fin_transactions
       set fatura_sem_compras = false, cost_center = null, cost_detail = null,
           category_id = null, category_rule_id = null
     where id = p_transaction_id and tenant_id = v_tenant;
  end if;
end $function$;

revoke execute on function public.crm_fatura_sem_compras(uuid, boolean, text, text) from public, anon;
grant execute on function public.crm_fatura_sem_compras(uuid, boolean, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
