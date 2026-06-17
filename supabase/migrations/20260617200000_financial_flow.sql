-- Fluxo financeiro: dados do cliente na cobrança, comprovante automático e conciliação.
--   Objetivos (pedido do cliente 17/jun):
--     • Nome e telefone obrigatórios e PERSISTIDOS na cobrança (vão pro Bling/NF).
--     • Comprovante AUTOMÁTICO (cartão + Pix) — nunca perder a prova do recebimento.
--     • Conciliação bancária: marcar pago↔extrato, com registro e organização.
--
--   Segurança preservada: rede_payments/pagbank_checkouts continuam write-only via
--   service_role (a SDR não altera valor/status). A conciliação vive em tabela à parte
--   (mesmo padrão de payment_receipts) para a SDR poder conciliar sem tocar na cobrança.

-- 1) Dados do cliente na cobrança (CPF para casar com NF-e/Bling). phone já existe em rede_payments.
alter table public.rede_payments     add column if not exists customer_doc text;
alter table public.pagbank_checkouts  add column if not exists phone         text;
alter table public.pagbank_checkouts  add column if not exists customer_doc  text;
alter table public.pagbank_checkouts  add column if not exists bling_order_id text;

-- 2) Comprovante automático: storage_path passa a ser opcional (comprovante "auto" pode ser
--    só a prova estruturada do gateway, sem arquivo), e marcamos a origem + os dados do gateway.
alter table public.payment_receipts alter column storage_path drop not null;
alter table public.payment_receipts add column if not exists source    text not null default 'manual'; -- 'manual' | 'auto'
alter table public.payment_receipts add column if not exists auto_data jsonb;                            -- prova do gateway (TID/autorização/e2e/bandeira/parcelas)

-- Um comprovante automático por pagamento (idempotência: webhook/retry não duplica).
create unique index if not exists payment_receipts_auto_uniq
  on public.payment_receipts (payment_id, payment_method)
  where source = 'auto';

-- 3) Conciliação bancária — uma marcação por pagamento (cartão OU pix). RW pela SDR (tenant),
--    sem tocar na cobrança. bank_ref = identificador no extrato (NSU/E2E/linha do CSV).
create table if not exists public.payment_reconciliation (
  id uuid primary key default gen_random_uuid(),
  tenant_id      text not null default public.current_tenant_id(),
  payment_id     text not null,
  payment_method text not null default 'card',           -- 'card' (Rede) | 'pix' (PagBank)
  bank_ref       text,                                   -- NSU/E2E/ref do extrato
  bank_amount_cents int,                                 -- valor batido no extrato (p/ divergência)
  matched_source text,                                   -- 'manual' | 'csv_import'
  note           text,
  reconciled_by  uuid default auth.uid(),
  reconciled_at  timestamptz not null default now(),
  unique (tenant_id, payment_id, payment_method)
);

create index if not exists payment_reconciliation_idx
  on public.payment_reconciliation (tenant_id, payment_method, reconciled_at desc);

alter table public.payment_reconciliation enable row level security;

drop policy if exists "payment_reconciliation tenant read" on public.payment_reconciliation;
create policy "payment_reconciliation tenant read" on public.payment_reconciliation
  for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists "payment_reconciliation tenant insert" on public.payment_reconciliation;
create policy "payment_reconciliation tenant insert" on public.payment_reconciliation
  for insert to authenticated with check (tenant_id = public.current_tenant_id());

drop policy if exists "payment_reconciliation tenant update" on public.payment_reconciliation;
create policy "payment_reconciliation tenant update" on public.payment_reconciliation
  for update to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "payment_reconciliation tenant delete" on public.payment_reconciliation;
create policy "payment_reconciliation tenant delete" on public.payment_reconciliation
  for delete to authenticated using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.payment_reconciliation to authenticated;
grant all on public.payment_reconciliation to service_role;
