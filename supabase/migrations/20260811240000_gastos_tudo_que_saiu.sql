-- TUDO QUE SAIU NUM LUGAR SÓ.
--
-- /gastos lia `payable_installments` e mostrava R$ 122.832 do ano inteiro — tudo vindo de XML
-- de nota de estoque. O extrato mostrava R$ 1.234.336 de saída só em julho/2026. As duas telas
-- estavam "certas", cada uma olhando metade: uma via o compromisso registrado, a outra via o
-- dinheiro saindo. Aluguel, folha, anestesista e imposto saem pelo banco e nunca foram
-- registrados como conta a pagar, então só existiam na metade que ninguém abria.
--
-- Aqui as duas viram uma. A conta a pagar JÁ conciliada com um lançamento do banco fica de
-- fora da união de propósito: ela e o lançamento são o mesmo dinheiro, e somar os dois
-- dobraria a despesa — que é exatamente o erro que a regra de "venda não vira lançamento de
-- caixa" evita do lado da receita.

-- Centro de custo no lançamento do banco: mesmo vocabulário de payable_installments, pra
-- saída paga pelo banco entrar no relatório junto com o que veio de nota.
alter table public.fin_transactions
  add column if not exists cost_center text;

comment on column public.fin_transactions.cost_center is
  'Centro de custo da SAÍDA, mesmo vocabulário de payable_installments.cost_center. É o que '
  'faz o gasto pago pelo banco aparecer em /gastos junto com o que veio de nota.';

create index if not exists fin_transactions_cost_center_idx
  on public.fin_transactions (tenant_id, cost_center)
  where cost_center is not null;

-- A regra de classificação carimba os DOIS campos: quem diz "isto é lavanderia" já sabe que
-- é Infraestrutura. Duas perguntas por lançamento é o que faz ninguém classificar nada.
alter table public.fin_category_rules
  add column if not exists cost_center text;

comment on column public.fin_category_rules.cost_center is
  'Centro de custo que a regra também carimba, junto com a categoria.';

-- Substitui a versão de 4 argumentos: duas assinaturas deixam a resolução do PostgREST
-- ambígua quando o cliente manda os parâmetros por nome.
drop function if exists public.crm_aplicar_regra_categoria(text, uuid, text, boolean);

create or replace function public.crm_aplicar_regra_categoria(
  p_pattern text,
  p_category_id uuid,
  p_direction text default null,
  p_sobrescrever boolean default false,
  p_cost_center text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  update public.fin_transactions t
     set category_id = p_category_id,
         -- coalesce e não atribuição direta: regra sem centro de custo não apaga o que
         -- alguém já classificou à mão.
         cost_center = coalesce(p_cost_center, t.cost_center)
   where t.tenant_id = public.current_tenant_id()
     and (p_direction is null or t.direction = p_direction)
     and (p_sobrescrever or t.category_id is null)
     and (
       coalesce(t.description, '') ilike '%' || p_pattern || '%'
       or coalesce(t.counterparty, '') ilike '%' || p_pattern || '%'
     );
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean, text) from public, anon;
grant execute on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean, text) to authenticated;

-- ────────────────────────────────────────────── a união

create or replace function public.crm_saidas_tudo(p_de date, p_ate date)
returns table (
  origem text, id text, data date, descricao text, contraparte text,
  amount_cents bigint, categoria text, centro_custo text, conciliado boolean
)
language sql
stable
security definer
set search_path = public
as $$
  -- 1) o que de fato saiu da conta
  select 'banco', t.id::text, t.date,
         coalesce(t.description, ''), coalesce(t.counterparty, ''),
         abs(t.amount_cents)::bigint, c.name, t.cost_center,
         t.reconciled_ref_id is not null
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  left join public.fin_categories c on c.id = t.category_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind = 'banco'
    and t.direction = 'out'
    and t.date between p_de and p_ate
    and public.current_user_can_finance()
  union all
  -- 2) compromisso que ainda NÃO apareceu no extrato; o já conciliado sairia em dobro
  select 'a pagar', p.id::text, p.due_date,
         coalesce(p.description, ''), coalesce(p.counterparty, ''),
         p.amount_cents::bigint, c.name, p.cost_center, false
  from public.payable_installments p
  left join public.fin_categories c on c.id = p.category_id
  where p.tenant_id = public.current_tenant_id()
    and p.due_date between p_de and p_ate
    and p.status <> 'cancelado'
    and not exists (
      select 1 from public.fin_transactions t2
      where t2.tenant_id = p.tenant_id
        and t2.reconciled_ref_type = 'payable'
        and t2.reconciled_ref_id = p.id
    )
    and public.current_user_can_finance()
  order by 3 desc;
$$;

revoke all on function public.crm_saidas_tudo(date, date) from public, anon;
grant execute on function public.crm_saidas_tudo(date, date) to authenticated;
