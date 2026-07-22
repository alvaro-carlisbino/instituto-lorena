-- Sistema financeiro completo — foco na CLÍNICA (Instituto Lorena), que NÃO roda em
-- gateway: o dinheiro é Itaú + outros bancos + caixa/dinheiro. O financeiro dela é um
-- RAZÃO PRÓPRIO autônomo, onde a verdade é a conta bancária/caixa (fin_accounts) e a
-- conciliação bate contra o extrato (OFX/CSV agora; Open Finance depois).
--
-- Tricopill (polo de vendas) herda as mesmas tabelas por RLS — segue Bling-first, mas
-- pode usar contas/caixa/conciliação aqui também. Isolamento por tenant, mesmo padrão
-- de 20260706170000_estoque_compras.sql (loop do $$ foreach de policies; tenant_id
-- default current_tenant_id(); valores em centavos integer).
--
-- Reaproveita o que já existe: contas a pagar = payable_installments (só ganha
-- category_id/account_id); entrada de NF-e (nfeImport) e fornecedores (stock_suppliers)
-- seguem intactos.

-- 1) Contas bancárias e caixa — a "fonte" do dinheiro da clínica.
create table if not exists public.fin_accounts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default public.current_tenant_id() references public.tenants (id),
  name                 text not null,                       -- 'Itaú', 'Dinheiro/Caixa', ...
  kind                 text not null default 'banco',       -- 'banco' | 'caixa' | 'carteira'
  bank_name            text,
  branch               text,                                -- agência
  number               text,                                -- conta
  opening_balance_cents integer not null default 0,         -- saldo inicial (antes do 1º lançamento)
  active               boolean not null default true,
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists fin_accounts_tenant_idx on public.fin_accounts (tenant_id, active, name);

-- 2) Plano de contas — categorias de receita/despesa (com subcategoria opcional).
create table if not exists public.fin_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  name       text not null,
  kind       text not null default 'despesa',              -- 'receita' | 'despesa'
  parent_id  uuid references public.fin_categories (id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists fin_categories_tenant_idx on public.fin_categories (tenant_id, kind, active, name);

-- 3) Contas a receber — espelho de payable_installments para o lado das entradas.
create table if not exists public.fin_receivables (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default public.current_tenant_id() references public.tenants (id),
  description          text not null,
  customer_name        text,
  lead_id              text,                                -- vínculo opcional com o lead (leads.lead_id é text)
  category_id          uuid references public.fin_categories (id),
  account_id           uuid references public.fin_accounts (id),
  due_date             date not null,
  amount_cents         integer not null,
  status               text not null default 'aberto',      -- 'aberto' | 'recebido' | 'cancelado'
  received_at          timestamptz,
  received_amount_cents integer,
  method               text,                                -- 'pix' | 'cartao' | 'dinheiro' | 'transferencia' | 'boleto'
  storage_path         text,
  file_name            text,
  note                 text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists fin_receivables_due_idx on public.fin_receivables (tenant_id, status, due_date);

-- 4) Razão de caixa realizado — o que DE FATO entrou/saiu de uma conta. Base do fluxo de
--    caixa e da conciliação. amount_cents é ASSINADO (+ entrada / - saída); direction é
--    redundante mas facilita filtro/índice. Idempotência do import por (account, external_id).
create table if not exists public.fin_transactions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null default public.current_tenant_id() references public.tenants (id),
  account_id          uuid not null references public.fin_accounts (id) on delete cascade,
  date                date not null,
  amount_cents        integer not null,                    -- sinal aplicado: entrada > 0, saída < 0
  direction           text not null default 'out',         -- 'in' | 'out'
  category_id         uuid references public.fin_categories (id),
  description         text,
  counterparty        text,                                -- contraparte no extrato (nome/memo)
  source              text not null default 'manual',      -- 'manual' | 'ofx' | 'csv' | 'payable' | 'receivable'
  external_id         text,                                -- FITID (OFX) / hash da linha (CSV) p/ dedup
  reconciled_ref_type text,                                -- 'payable' | 'receivable' quando conciliado
  reconciled_ref_id   uuid,
  note                text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists fin_transactions_acc_idx on public.fin_transactions (tenant_id, account_id, date desc);
create index if not exists fin_transactions_cat_idx on public.fin_transactions (tenant_id, date);
-- Import não duplica: mesma conta + mesmo FITID/hash entra uma vez só. Índice único CHEIO
-- (não parcial) de propósito: no Postgres NULLs são distintos, então lançamentos manuais
-- (external_id nulo) não conflitam — e o ON CONFLICT do upsert (supabase-js) só casa com
-- índice cheio, não com parcial (`where ...`).
create unique index if not exists fin_transactions_external_uniq
  on public.fin_transactions (tenant_id, account_id, external_id);

-- 5) Modelos recorrentes — geram payable/receivable todo mês (aluguel, salários, ...).
create table if not exists public.fin_recurring (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null default public.current_tenant_id() references public.tenants (id),
  kind              text not null default 'payable',        -- 'payable' | 'receivable'
  description       text not null,
  category_id       uuid references public.fin_categories (id),
  account_id        uuid references public.fin_accounts (id),
  supplier_id       uuid references public.stock_suppliers (id),
  amount_cents      integer not null,
  day_of_month      integer not null default 1,             -- 1..28 (dia do vencimento)
  payment_method    text,
  active            boolean not null default true,
  last_generated_on date,                                   -- yyyy-mm-01 do último ciclo gerado
  note              text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists fin_recurring_tenant_idx on public.fin_recurring (tenant_id, active, day_of_month);

-- 6) Contas a pagar ganham categoria e conta (opcionais — não quebram o import de NF-e).
alter table public.payable_installments add column if not exists category_id uuid references public.fin_categories (id);
alter table public.payable_installments add column if not exists account_id  uuid references public.fin_accounts (id);

-- 7) RLS — mesmo padrão do estoque: cada tenant lê/escreve só o que é dele.
do $$
declare t text;
begin
  foreach t in array array[
    'fin_accounts', 'fin_categories', 'fin_receivables', 'fin_transactions', 'fin_recurring'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s tenant read" on public.%I', t, t);
    execute format('create policy "%s tenant read" on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant insert" on public.%I', t, t);
    execute format('create policy "%s tenant insert" on public.%I for insert to authenticated with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant update" on public.%I', t, t);
    execute format('create policy "%s tenant update" on public.%I for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant delete" on public.%I', t, t);
    execute format('create policy "%s tenant delete" on public.%I for delete to authenticated using (tenant_id = public.current_tenant_id())', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 8) Seed do plano de contas + contas iniciais (tenant_id EXPLÍCITO — current_tenant_id()
--    é nulo no contexto da migration). Guardado por "não existe ainda" pra ser idempotente
--    e não recriar se o usuário já tiver mexido. Vale pros dois polos existentes.
do $$
declare
  tid text;
  cat text;
  despesas text[] := array[
    'Aluguel', 'Salários e pró-labore', 'Fornecedores e insumos', 'Impostos e taxas',
    'Marketing e anúncios', 'Água/luz/telefone/internet', 'Taxas bancárias', 'Manutenção',
    'Pró-labore sócios', 'Outros'
  ];
  receitas text[] := array[
    'Consultas', 'Procedimentos e pacotes', 'Vendas de produtos', 'Outros'
  ];
begin
  foreach tid in array array['instituto-lorena', 'tricopill'] loop
    -- só semeia se o tenant existe e ainda não tem categorias
    if exists (select 1 from public.tenants where id = tid)
       and not exists (select 1 from public.fin_categories where tenant_id = tid) then
      foreach cat in array despesas loop
        insert into public.fin_categories (tenant_id, name, kind) values (tid, cat, 'despesa');
      end loop;
      foreach cat in array receitas loop
        insert into public.fin_categories (tenant_id, name, kind) values (tid, cat, 'receita');
      end loop;
    end if;

    -- contas iniciais (banco + caixa) só se o tenant ainda não tem nenhuma conta
    if exists (select 1 from public.tenants where id = tid)
       and not exists (select 1 from public.fin_accounts where tenant_id = tid) then
      insert into public.fin_accounts (tenant_id, name, kind, bank_name) values
        (tid, 'Itaú', 'banco', 'Itaú Unibanco'),
        (tid, 'Dinheiro / Caixa', 'caixa', null);
    end if;
  end loop;
end $$;
