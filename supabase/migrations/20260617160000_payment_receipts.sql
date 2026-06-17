-- Comprovantes de pagamento (Instituto Lorena + qualquer polo).
--   A SDR anexa o comprovante (foto/PDF) de um pagamento (rede_payments / cartão).
--   Tabela SEPARADA de propósito: rede_payments só tem policy de SELECT (writes são
--   service_role via edge function). Assim a SDR pode ANEXAR comprovante mas nunca
--   alterar valor/status do pagamento — controle e segurança. O arquivo em si vai
--   pro bucket `crm-lead-attachments` (mesma infra dos anexos de tarefa).
--
--   tenant_id default current_tenant_id() (preenche sozinho a partir do polo do
--   login) e a RLS confina leitura/escrita ao polo. Um pagamento pode ter mais de
--   um comprovante (ex.: PIX do paciente + recibo da maquininha).

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  payment_id text not null,                 -- rede_payments.id (cartão) — extensível a outros métodos
  payment_method text not null default 'card',
  storage_path text not null,               -- objeto no bucket crm-lead-attachments
  file_name text,
  mime_type text,
  file_size bigint,
  note text,                                -- observação opcional da SDR
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists payment_receipts_payment_idx on public.payment_receipts (tenant_id, payment_id);
create index if not exists payment_receipts_created_idx on public.payment_receipts (created_at desc);

alter table public.payment_receipts enable row level security;

drop policy if exists "payment_receipts tenant read" on public.payment_receipts;
create policy "payment_receipts tenant read" on public.payment_receipts
  for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists "payment_receipts tenant insert" on public.payment_receipts;
create policy "payment_receipts tenant insert" on public.payment_receipts
  for insert to authenticated with check (tenant_id = public.current_tenant_id());

drop policy if exists "payment_receipts tenant delete" on public.payment_receipts;
create policy "payment_receipts tenant delete" on public.payment_receipts
  for delete to authenticated using (tenant_id = public.current_tenant_id());

grant select, insert, delete on public.payment_receipts to authenticated;
