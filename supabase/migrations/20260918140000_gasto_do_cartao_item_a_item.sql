-- O gasto do cartão passa a ser o ITEM da fatura, não o boleto da fatura inteira.
--
-- Pedido do financeiro em 18/09/2026: "a fatura de cartão ele está puxando um valor total, eu
-- queria os itens detalhados, para saber o que foi gasto em cada item — e cuidado para não
-- duplicar". O alerta é o ponto: os dois lados da mesma despesa já existem no banco. As compras
-- entram em `fin_transactions` pela conta do cartão (kind 'carteira'), e o pagamento da fatura
-- entra pela conta corrente como "BOLETO PAGO Fatura Carta". Contar os dois dobra a despesa.
--
-- Até aqui o gasto olhava só `kind = 'banco'`, então o cartão aparecia como uma linha só: em
-- julho/2026, R$ 55.618,04 de "BOLETO PAGO Fatura Carta" (dois boletos, sem detalhe) no lugar
-- das 89 compras que somam R$ 34.038,25. Dava para pagar, não para saber o que foi comprado.
--
-- A troca, decidida com o Álvaro: a despesa pesa no MÊS DA COMPRA. A compra de 28/06 sai da
-- fatura paga em 14/07 e volta para junho, que é quando ela aconteceu. Os totais por mês de
-- maio a setembro mudam — não é erro novo, é a mesma despesa saindo do mês do caixa para o mês
-- do fato.
--
-- Fica de fora, de propósito: crédito recebido no cartão ('in' na carteira). Nesta conta ele
-- tanto pode ser estorno de compra (abateria o gasto) quanto pagamento parcial da fatura (não
-- abate nada), e o extrato não distingue os dois. Abater por chute seria inventar desconto.

-- Pagamento de fatura de cartão visto do lado da conta corrente. É a única saída de banco que
-- sai do gasto — e sai porque ela já está contada, item a item, do lado do cartão.
create or replace function public.crm_e_pagamento_de_fatura(p_descricao text)
returns boolean
language sql
immutable
as $function$
  -- O Itaú escreve "BOLETO  PAGO Fatura Carta" (com espaço dobrado e cortado no meio da
  -- palavra), e o débito automático vem como "Débito automático ITAU MC 1509-4113". Casar por
  -- pedaço, nunca por igualdade: a frase muda de banco para banco e de cartão para cartão.
  --
  -- "BUSINESS      4004-2658" é o mesmo pagamento com outra cara — o cartão da empresa passou a
  -- ser quitado assim em 17/08/2026, e o valor bate no centavo com a fatura (R$ 33.702,85 em
  -- 15/08, R$ 20.663,91 em 15/09). Sem esta linha, o cartão da empresa apareceria duas vezes
  -- justamente nos meses mais recentes. O telefone do banco no fim é o que segura o padrão:
  -- "business" sozinho casaria com qualquer fornecedor que tenha a palavra no nome.
  select coalesce(p_descricao, '') ~* '(fatura +cart|pagamento +de +fatura|pagto +fatura|d[ée]bito +autom[aá]tico +itau +mc|business +[0-9]{4}-?[0-9]{4})';
$function$;

comment on function public.crm_e_pagamento_de_fatura(text) is
  'Saída da conta corrente que quita fatura de cartão. Não é despesa: a despesa são os itens da fatura, que entram pela conta do cartão.';

-- Função nova nasce executável por todo mundo, e toda função em `public` vira RPC no PostgREST.
-- Esta só olha o texto que recebe, mas quem a chama de verdade são as duas funções abaixo, que
-- rodam como dono. Ninguém precisa dela pela porta da frente.
revoke all on function public.crm_e_pagamento_de_fatura(text) from public, anon, authenticated;

-- Saída efetiva (alimenta o gráfico por categoria e o rateio): agora banco + cartão.
create or replace function public.crm_saidas_efetivas(p_de date, p_ate date)
returns table(
  transaction_id uuid, data date, descricao text, amount_cents bigint,
  category_id uuid, categoria text, cost_center text, origem text
)
language sql
stable
security definer
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
      and not (a.kind = 'banco' and public.crm_e_pagamento_de_fatura(t.description))
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

revoke all on function public.crm_saidas_efetivas(date, date) from public, anon;
grant execute on function public.crm_saidas_efetivas(date, date) to authenticated;

-- Gastos: mesma regra, mais a coluna `conta`. A tela mostrava data, descrição e valor, e quem
-- lia não tinha como saber de onde aquilo saiu — em 18/09/2026 o financeiro passou a manhã
-- procurando no extrato do Itaú Empresas uma saída que era de outra conta. Dizer a conta é
-- barato e evita a caçada.
drop function if exists public.crm_saidas_tudo(date, date);
create function public.crm_saidas_tudo(p_de date, p_ate date)
returns table(
  origem text, id text, data date, descricao text, contraparte text, amount_cents bigint,
  categoria text, centro_custo text, conciliado boolean, nao_e_gasto boolean,
  possivel_duplicado boolean, status text, conta text, do_cartao boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 1) o que de fato saiu: da conta corrente e do cartão (o item, não a fatura)
  select 'banco', t.id::text, t.date,
         coalesce(t.description, ''), coalesce(t.counterparty, ''),
         abs(t.amount_cents)::bigint, c.name, t.cost_center,
         t.reconciled_ref_id is not null,
         coalesce(c.name ilike '%não é despesa%', false),
         -- O Open Finance devolve o lançamento PENDENTE com um id e, quando compensa, com outro.
         -- A cópia criada antes, igual em conta, dia, descrição e valor, é a pendente que ficou.
         (t.source = 'openfinance' and exists (
           select 1 from public.fin_transactions d
           where d.tenant_id = t.tenant_id and d.account_id = t.account_id
             and d.date = t.date and d.amount_cents = t.amount_cents
             and coalesce(d.description, '') = coalesce(t.description, '')
             and d.id <> t.id and d.source = 'openfinance'
             and d.created_at > t.created_at + interval '1 hour'
         )),
         'pago', a.name, a.kind = 'carteira'
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  left join public.fin_categories c on c.id = t.category_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind in ('banco', 'carteira')
    and t.direction = 'out'
    and not (a.kind = 'banco' and public.crm_e_pagamento_de_fatura(t.description))
    and t.date between p_de and p_ate
    and public.current_user_can_finance()
  union all
  -- 2) compromisso que ainda não apareceu no extrato (senão conta duas vezes)
  select 'a pagar', p.id::text, p.due_date,
         coalesce(p.description, ''), coalesce(nullif(p.counterparty, ''), s.name, ''),
         p.amount_cents::bigint, c.name, p.cost_center, false,
         coalesce(c.name ilike '%não é despesa%', false),
         false,
         p.status, null::text, false
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

revoke all on function public.crm_saidas_tudo(date, date) from public, anon;
grant execute on function public.crm_saidas_tudo(date, date) to authenticated;
