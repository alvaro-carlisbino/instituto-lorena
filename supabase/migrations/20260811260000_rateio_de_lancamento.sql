-- RATEIO — um pagamento que cobriu duas coisas.
--
-- Um PIX de R$ 10.000 que pagou R$ 7.000 de fornecedor e R$ 3.000 de marketing só tinha duas
-- saídas ruins: classificar tudo como uma coisa (e mentir em R$ 3.000) ou deixar sem categoria
-- (e sumir do relatório). Nas duas o DRE sai errado.
--
-- O rateio mora em tabela PRÓPRIA, e essa é a decisão que importa: `fin_transactions` é o que o
-- banco disse, e o que o banco disse não se mexe. Editar o lançamento pra caber na nossa
-- interpretação destrói a única fonte confiável que existe — no dia que a conciliação discordar
-- do extrato, ninguém saberia mais qual dos dois foi alterado. O rateio é leitura nossa por
-- cima, e some sem deixar rastro se estiver errado.

create table if not exists public.fin_transaction_splits (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),
  transaction_id uuid not null references public.fin_transactions (id) on delete cascade,
  -- sempre positivo; a direção é a do lançamento pai
  amount_cents integer not null check (amount_cents > 0),
  category_id uuid references public.fin_categories (id) on delete set null,
  cost_center text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid()
);

create index if not exists fin_transaction_splits_txn_idx
  on public.fin_transaction_splits (transaction_id);
create index if not exists fin_transaction_splits_tenant_idx
  on public.fin_transaction_splits (tenant_id);

alter table public.fin_transaction_splits enable row level security;

drop policy if exists "fin_transaction_splits finance read" on public.fin_transaction_splits;
create policy "fin_transaction_splits finance read" on public.fin_transaction_splits
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_transaction_splits finance write" on public.fin_transaction_splits;
create policy "fin_transaction_splits finance write" on public.fin_transaction_splits
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance())
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

-- ────────────────────────────────────────── as linhas que o relatório deve enxergar

/**
 * Saídas "efetivas" do período: o lançamento explodido pelo rateio, quando existe rateio.
 *
 * É a peça que faz o rateio valer alguma coisa. Sem ela o usuário rateia, vê os pedaços na tela
 * do lançamento, e o gráfico por categoria continua mostrando o valor cheio numa categoria só —
 * ou seja, o trabalho dele não aparece em lugar nenhum, que é pior do que não ter a função.
 *
 * Rateio parcial conta o resto como não classificado, em vez de fingir que o lançamento inteiro
 * está resolvido: quem rateou R$ 7.000 de R$ 10.000 ainda deve R$ 3.000 de explicação.
 */
create or replace function public.crm_saidas_efetivas(p_de date, p_ate date)
returns table (
  transaction_id uuid,
  data date,
  descricao text,
  amount_cents bigint,
  category_id uuid,
  categoria text,
  cost_center text,
  origem text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select t.id, t.date, coalesce(t.description, t.counterparty, '') as descricao,
           abs(t.amount_cents) as cents, t.category_id, t.cost_center,
           (select coalesce(sum(s.amount_cents), 0) from public.fin_transaction_splits s
             where s.transaction_id = t.id) as rateado
    from public.fin_transactions t
    join public.fin_accounts a on a.id = t.account_id
    where t.tenant_id = public.current_tenant_id()
      and a.kind = 'banco'
      and t.direction = 'out'
      and t.date between p_de and p_ate
      and public.current_user_can_finance()
  )
  -- pedaços rateados
  select b.id, b.date, b.descricao, s.amount_cents::bigint, s.category_id, c.name, s.cost_center, 'rateio'
  from base b
  join public.fin_transaction_splits s on s.transaction_id = b.id
  left join public.fin_categories c on c.id = s.category_id
  union all
  -- lançamento sem rateio nenhum: vale inteiro, com a categoria dele
  select b.id, b.date, b.descricao, b.cents::bigint, b.category_id, c.name, b.cost_center, 'lancamento'
  from base b
  left join public.fin_categories c on c.id = b.category_id
  where b.rateado = 0
  union all
  -- sobra de rateio parcial: ainda deve explicação
  select b.id, b.date, b.descricao, (b.cents - b.rateado)::bigint, null::uuid, null::text, null::text, 'sobra'
  from base b
  where b.rateado > 0 and b.rateado < b.cents;
$$;

revoke all on function public.crm_saidas_efetivas(date, date) from public, anon;
grant execute on function public.crm_saidas_efetivas(date, date) to authenticated;

-- O gráfico por categoria passa a ler as linhas efetivas.
create or replace function public.crm_saida_por_categoria(p_de date, p_ate date)
returns table (categoria text, category_id uuid, qtd bigint, amount_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(e.categoria, 'Sem categoria'), e.category_id,
         count(*)::bigint, sum(e.amount_cents)::bigint
  from public.crm_saidas_efetivas(p_de, p_ate) e
  group by 1, 2
  order by 4 desc;
$$;

revoke all on function public.crm_saida_por_categoria(date, date) from public, anon;
grant execute on function public.crm_saida_por_categoria(date, date) to authenticated;

/**
 * Substitui o rateio inteiro de um lançamento numa transação só.
 *
 * Substituir em vez de acumular porque a tela edita a lista toda; inserir incremental deixaria
 * pedaço órfão a cada salvamento. E valida o total contra o lançamento: rateio que soma mais do
 * que saiu da conta é dinheiro inventado, e inventar no lugar que existe pra dizer a verdade
 * seria o pior tipo de bug.
 */
create or replace function public.crm_salvar_rateio(p_transaction_id uuid, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total_lancamento integer;
  total_itens integer;
  n integer;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  select abs(amount_cents) into total_lancamento
  from public.fin_transactions
  where id = p_transaction_id and tenant_id = public.current_tenant_id();
  if total_lancamento is null then
    raise exception 'lançamento não encontrado neste polo';
  end if;

  select coalesce(sum((x->>'amount_cents')::integer), 0) into total_itens
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x;

  if total_itens > total_lancamento then
    raise exception 'o rateio soma % e o lançamento é %', total_itens, total_lancamento;
  end if;

  delete from public.fin_transaction_splits
   where transaction_id = p_transaction_id and tenant_id = public.current_tenant_id();

  insert into public.fin_transaction_splits (transaction_id, amount_cents, category_id, cost_center, note)
  select p_transaction_id,
         (x->>'amount_cents')::integer,
         nullif(x->>'category_id', '')::uuid,
         nullif(x->>'cost_center', ''),
         nullif(x->>'note', '')
  from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.crm_salvar_rateio(uuid, jsonb) from public, anon;
grant execute on function public.crm_salvar_rateio(uuid, jsonb) to authenticated;
