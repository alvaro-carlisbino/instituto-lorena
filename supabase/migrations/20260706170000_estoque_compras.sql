-- Estoque + Compras + Contas a pagar (pedido do Álvaro 06/jul):
--   • Estoque próprio no sistema (clínica sobe manual por enquanto; Bling continua
--     sendo a fonte do Tricopill; `source` já prevê 'shosp'/'bling' pra fase 2).
--   • Ordens de compra com fluxo solicitada → aprovada → comprada → recebida
--     (o recebimento dá ENTRADA no estoque via stock_movements).
--   • Notas fiscais de compra (com anexo) e boletos/parcelas com vencimento —
--     base da agenda/projeção de pagamentos.
--
--   Tudo multi-tenant (tenant_id default current_tenant_id(), mesmo padrão de
--   payment_reconciliation): clínica e Tricopill usam as mesmas tabelas isoladas por RLS.

-- 1) Fornecedores
create table if not exists public.stock_suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  name       text not null,
  cnpj       text,
  phone      text,
  email      text,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_suppliers_tenant_idx on public.stock_suppliers (tenant_id, active, name);

-- 2) Itens de estoque
create table if not exists public.stock_items (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  name       text not null,
  sku        text,
  category   text,
  unit       text not null default 'un',          -- un | cx | ml | g | ...
  min_qty    numeric not null default 0,          -- alerta de estoque mínimo
  source     text not null default 'manual',      -- 'manual' | 'shosp' | 'bling' (fases futuras)
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_items_tenant_idx on public.stock_items (tenant_id, active, name);

-- 3) Movimentos (livro-razão: saldo = soma dos deltas; entrada +, saída -, ajuste livre)
create table if not exists public.stock_movements (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  item_id    uuid not null references public.stock_items (id) on delete cascade,
  kind       text not null default 'entrada',     -- 'entrada' | 'saida' | 'ajuste'
  qty_delta  numeric not null,                    -- sinal já aplicado (saída negativa)
  reason     text,                                -- ex.: 'compra', 'uso em procedimento', 'inventário'
  ref_type   text,                                -- 'purchase_order' quando entrada veio de OC
  ref_id     text,
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_item_idx on public.stock_movements (tenant_id, item_id, created_at desc);

-- Saldo por item (security_invoker: respeita a RLS de quem consulta)
create or replace view public.stock_balances
  with (security_invoker = on) as
select
  i.tenant_id,
  i.id as item_id,
  coalesce(sum(m.qty_delta), 0) as qty,
  max(m.created_at) as last_movement_at
from public.stock_items i
left join public.stock_movements m on m.item_id = i.id
group by i.tenant_id, i.id;

-- 4) Ordens de compra
create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default public.current_tenant_id() references public.tenants (id),
  code          text not null,                     -- 'OC-...' gerado no app
  supplier_id   uuid references public.stock_suppliers (id),
  status        text not null default 'solicitada',-- solicitada | aprovada | comprada | recebida | cancelada
  expected_date date,
  total_cents   integer not null default 0,
  note          text,
  requested_by  uuid default auth.uid(),
  approved_by   uuid,
  approved_at   timestamptz,
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists purchase_orders_tenant_idx on public.purchase_orders (tenant_id, status, created_at desc);

create table if not exists public.purchase_order_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null default public.current_tenant_id() references public.tenants (id),
  po_id           uuid not null references public.purchase_orders (id) on delete cascade,
  item_id         uuid references public.stock_items (id),  -- null = item livre (não movimenta estoque)
  description     text not null,
  qty             numeric not null,
  unit_cost_cents integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items (tenant_id, po_id);

-- 5) Notas fiscais de compra (anexo no bucket crm-lead-attachments)
create table if not exists public.purchase_invoices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default public.current_tenant_id() references public.tenants (id),
  supplier_id  uuid references public.stock_suppliers (id),
  po_id        uuid references public.purchase_orders (id),
  number       text not null,
  issue_date   date,
  total_cents  integer not null default 0,
  storage_path text,
  file_name    text,
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists purchase_invoices_tenant_idx on public.purchase_invoices (tenant_id, issue_date desc);

-- 6) Boletos / parcelas a pagar (agenda e projeção de pagamentos saem daqui)
create table if not exists public.payable_installments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null default public.current_tenant_id() references public.tenants (id),
  invoice_id        uuid references public.purchase_invoices (id) on delete set null,
  supplier_id       uuid references public.stock_suppliers (id),
  po_id             uuid references public.purchase_orders (id),
  description       text not null,
  due_date          date not null,
  amount_cents      integer not null,
  status            text not null default 'aberto', -- 'aberto' | 'pago' | 'cancelado'
  paid_at           timestamptz,
  paid_amount_cents integer,
  payment_method    text,                           -- 'boleto' | 'pix' | 'cartao' | 'transferencia' | 'dinheiro'
  barcode           text,                           -- linha digitável do boleto
  storage_path      text,                           -- anexo (boleto/comprovante)
  file_name         text,
  note              text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payable_installments_due_idx on public.payable_installments (tenant_id, status, due_date);

-- 7) RLS — mesmo padrão de payment_reconciliation: tenant lê/escreve só o que é dele.
do $$
declare t text;
begin
  foreach t in array array[
    'stock_suppliers', 'stock_items', 'stock_movements',
    'purchase_orders', 'purchase_order_items', 'purchase_invoices', 'payable_installments'
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

grant select on public.stock_balances to authenticated;
grant select on public.stock_balances to service_role;
