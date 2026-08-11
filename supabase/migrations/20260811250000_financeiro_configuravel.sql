-- FINANCEIRO CONFIGURÁVEL — o que era código vira dado.
--
-- Três coisas impediam a clínica de operar isto como ERP:
--
-- 1. CENTRO DE CUSTO era um array `const` no fonte (`DEFAULT_COST_CENTERS`, 14 strings).
--    Criar "Tricoscopia" ou renomear "SPA" exigia deploy. Enquanto for código, o financeiro
--    depende de programador pra mudar a própria estrutura de custo.
--
-- 2. As REGRAS de classificação nasciam implícitas ao classificar um lançamento e não tinham
--    tela. Regra errada carimba centenas de linhas de uma vez e não havia como VER qual regra
--    fez o quê, nem desfazer. Poder aplicar em massa sem poder revisar é a pior combinação.
--
-- 3. CONTA A RECEBER não se editava: dava pra criar, receber e cancelar, e só. Valor errado
--    ou descrição trocada ficavam errados pra sempre.

-- ────────────────────────────────────────────── centros de custo como dado

create table if not exists public.fin_cost_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),
  name text not null check (length(btrim(name)) > 0),
  active boolean not null default true,
  -- ordem de exibição; empate cai no nome
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create unique index if not exists fin_cost_centers_uniq
  on public.fin_cost_centers (tenant_id, lower(name));

alter table public.fin_cost_centers enable row level security;

drop policy if exists "fin_cost_centers finance read" on public.fin_cost_centers;
create policy "fin_cost_centers finance read" on public.fin_cost_centers
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_cost_centers finance write" on public.fin_cost_centers;
create policy "fin_cost_centers finance write" on public.fin_cost_centers
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance())
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

-- Semeia com o que estava no código MAIS o que já existe nos dados. A segunda parte importa:
-- gasto importado de planilha trouxe centro que não estava na lista fixa, e sumir com ele na
-- migração perderia a classificação de quem já tinha sido feito à mão.
insert into public.fin_cost_centers (tenant_id, name, sort_order)
select t.id, v.nome, v.ord
from public.tenants t
cross join (values
  ('Centro Cirúrgico', 10), ('Pagamentos médicos', 20), ('Atendimento', 30),
  ('SPA', 40), ('Marketing', 50), ('RH/DP', 60), ('Salários e encargos', 65),
  ('Administrativo', 70), ('Infraestrutura', 80), ('Obra', 90),
  ('Impostos', 100), ('Benefícios', 110), ('Londrina', 120),
  ('Retirada sócios', 130), ('Devolução paciente', 140)
) v(nome, ord)
on conflict do nothing;

insert into public.fin_cost_centers (tenant_id, name, sort_order)
select p.tenant_id, btrim(p.cost_center), 200
from public.payable_installments p
where p.cost_center is not null and btrim(p.cost_center) <> ''
group by 1, 2
on conflict do nothing;

-- ────────────────────────────────────────────── rastro da regra no lançamento

-- Sem isto não dá pra responder "quem carimbou esta linha?" — e sem responder isso, desfazer
-- uma regra errada vira caça manual.
alter table public.fin_transactions
  add column if not exists category_rule_id uuid references public.fin_category_rules (id) on delete set null;

comment on column public.fin_transactions.category_rule_id is
  'Regra que carimbou a categoria, quando veio de regra e não da mão. É o que permite desfazer '
  'uma regra errada sem caçar linha por linha.';

create index if not exists fin_transactions_rule_idx
  on public.fin_transactions (tenant_id, category_rule_id)
  where category_rule_id is not null;

-- Passa a gravar o rastro ao aplicar.
create or replace function public.crm_aplicar_regra_categoria(
  p_pattern text,
  p_category_id uuid,
  p_direction text default null,
  p_sobrescrever boolean default false,
  p_cost_center text default null,
  p_rule_id uuid default null
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
         cost_center = coalesce(p_cost_center, t.cost_center),
         category_rule_id = coalesce(p_rule_id, t.category_rule_id)
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

revoke all on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean, text, uuid) from public, anon;
grant execute on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean, text, uuid) to authenticated;

/**
 * Desfaz uma regra: tira a categoria SÓ das linhas que aquela regra carimbou.
 *
 * O que foi classificado à mão fica intacto — é a diferença entre corrigir um erro e apagar o
 * trabalho de quem estava certo.
 */
create or replace function public.crm_desfazer_regra_categoria(p_rule_id uuid)
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
     set category_id = null, category_rule_id = null
   where t.tenant_id = public.current_tenant_id()
     and t.category_rule_id = p_rule_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.crm_desfazer_regra_categoria(uuid) from public, anon;
grant execute on function public.crm_desfazer_regra_categoria(uuid) to authenticated;

/** Quantos lançamentos cada regra carimbou — a tela precisa disso pra dar peso à regra. */
create or replace function public.crm_regras_categoria_uso()
returns table (rule_id uuid, usos bigint, amount_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.category_rule_id, count(*)::bigint, sum(abs(t.amount_cents))::bigint
  from public.fin_transactions t
  where t.tenant_id = public.current_tenant_id()
    and t.category_rule_id is not null
    and public.current_user_can_finance()
  group by 1;
$$;

revoke all on function public.crm_regras_categoria_uso() from public, anon;
grant execute on function public.crm_regras_categoria_uso() to authenticated;
