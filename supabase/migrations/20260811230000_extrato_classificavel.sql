-- EXTRATO CLASSIFICÁVEL — a despesa da clínica existe, só não está classificada.
--
-- `fin_transactions.category_id` existia desde o começo e NADA no sistema escrevia nele. O
-- resultado é que o contas a pagar da clínica conhece 94 parcelas (R$ 122.832, todas vindas de
-- XML de nota de estoque) enquanto o extrato mostra R$ 1.234.336 de saída só em julho/2026.
-- Aluguel, folha, anestesista, imposto, energia, marketing: tudo sai da conta e nada disso vira
-- despesa classificada. Sem isso não existe DRE, nem margem, nem custo de cirurgia.
--
-- O dado já está no banco. O que faltava era poder dizer o que cada linha é — e não ter que
-- dizer de novo no mês seguinte, porque "PIX ENVIADO LAVANDERIA B" volta todo mês.

create table if not exists public.fin_category_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),
  -- trecho da descrição/contraparte do lançamento; casa por "contém", sem caixa
  pattern text not null check (length(btrim(pattern)) > 0),
  category_id uuid not null references public.fin_categories (id) on delete cascade,
  -- 'in' | 'out' | null (vale para os dois). Mesma contraparte pode ser despesa e receita.
  direction text check (direction in ('in', 'out')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid()
);

-- Mesma regra duas vezes só gera dúvida sobre qual venceu.
create unique index if not exists fin_category_rules_uniq
  on public.fin_category_rules (tenant_id, lower(pattern), coalesce(direction, 'all'));

create index if not exists fin_category_rules_tenant_idx
  on public.fin_category_rules (tenant_id);

alter table public.fin_category_rules enable row level security;

drop policy if exists "fin_category_rules finance read" on public.fin_category_rules;
create policy "fin_category_rules finance read" on public.fin_category_rules
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_category_rules finance insert" on public.fin_category_rules;
create policy "fin_category_rules finance insert" on public.fin_category_rules
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_category_rules finance update" on public.fin_category_rules;
create policy "fin_category_rules finance update" on public.fin_category_rules
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance())
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_category_rules finance delete" on public.fin_category_rules;
create policy "fin_category_rules finance delete" on public.fin_category_rules
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

-- ────────────────────────────────────────────── aplicar regra em lote

/**
 * Carimba a categoria em todo lançamento que casa com o padrão e ainda não tem categoria.
 *
 * `p_sobrescrever` existe para o caso de correção: classificou errado, corrige a regra e manda
 * de novo. Por padrão é false — regra nova não deve desfazer classificação feita à mão.
 */
create or replace function public.crm_aplicar_regra_categoria(
  p_pattern text,
  p_category_id uuid,
  p_direction text default null,
  p_sobrescrever boolean default false
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
     set category_id = p_category_id
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

revoke all on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean) from public, anon;
grant execute on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean) to authenticated;

-- ────────────────────────────────────────────── resumo do extrato

/**
 * Entrou e saiu por dia, e o quanto está classificado.
 *
 * `nao_classificado_cents` é o número que faz esta tela ter dono: enquanto ele for grande, o
 * gráfico de despesa por categoria está mentindo por omissão, e é melhor a tela dizer isso do
 * que desenhar uma pizza bonita sobre 10% do dinheiro.
 */
create or replace function public.crm_extrato_por_dia(p_de date, p_ate date)
returns table (
  dia date,
  entrou_cents bigint,
  saiu_cents bigint,
  saida_classificada_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select t.date,
         coalesce(sum(t.amount_cents) filter (where t.direction = 'in'), 0)::bigint,
         coalesce(sum(abs(t.amount_cents)) filter (where t.direction = 'out'), 0)::bigint,
         coalesce(sum(abs(t.amount_cents)) filter (where t.direction = 'out' and t.category_id is not null), 0)::bigint
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind = 'banco'
    and t.date between p_de and p_ate
    and public.current_user_can_finance()
  group by t.date
  order by t.date;
$$;

revoke all on function public.crm_extrato_por_dia(date, date) from public, anon;
grant execute on function public.crm_extrato_por_dia(date, date) to authenticated;

/** Saída do período por categoria. `null` = ainda não classificado, e aparece nomeado. */
create or replace function public.crm_saida_por_categoria(p_de date, p_ate date)
returns table (categoria text, category_id uuid, qtd bigint, amount_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(c.name, 'Sem categoria'), t.category_id, count(*)::bigint,
         sum(abs(t.amount_cents))::bigint
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  left join public.fin_categories c on c.id = t.category_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind = 'banco'
    and t.direction = 'out'
    and t.date between p_de and p_ate
    and public.current_user_can_finance()
  group by 1, 2
  order by 4 desc;
$$;

revoke all on function public.crm_saida_por_categoria(date, date) from public, anon;
grant execute on function public.crm_saida_por_categoria(date, date) to authenticated;
