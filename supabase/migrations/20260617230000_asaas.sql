-- Asaas — gateway único de pagamento (cartão + Pix), substitui Rede e PagBank.
--   Config por polo em tenant_integrations.asaas: { apiKey, env: 'sandbox'|'prod', webhookToken?, base_url? }.
--   Cobranças em asaas_payments (mesmo padrão de rede_payments: SELECT por polo via RLS,
--   writes só service_role pelas edge functions — a SDR vê mas não altera valor/status).

alter table public.tenant_integrations add column if not exists asaas jsonb;

create table if not exists public.asaas_payments (
  id              text primary key,            -- shortId nosso (rota /pagar/<id> no cartão)
  tenant_id       text not null,
  lead_id         text,
  method          text not null default 'card',-- 'card' | 'pix'
  amount_cents    int  not null,
  description     text,
  installments    int  not null default 1,
  kit             text,
  coupon_code     text,
  discount_cents  int  not null default 0,
  customer_name   text,
  phone           text,
  customer_doc    text,                         -- CPF (dígitos)
  asaas_customer_id text,                       -- id do cliente no Asaas
  asaas_payment_id  text,                       -- id da cobrança no Asaas
  pix_payload     text,                         -- copia-e-cola (Pix)
  status          text not null default 'pending', -- pending|paid|failed
  return_code     text,                         -- status/erro do Asaas
  bling_order_id  text,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);

create index if not exists asaas_payments_tenant_idx  on public.asaas_payments (tenant_id, created_at desc);
create index if not exists asaas_payments_lead_idx    on public.asaas_payments (lead_id);
create index if not exists asaas_payments_asaas_idx   on public.asaas_payments (asaas_payment_id);

alter table public.asaas_payments enable row level security;

drop policy if exists "asaas_payments tenant read" on public.asaas_payments;
create policy "asaas_payments tenant read" on public.asaas_payments
  for select to authenticated using (tenant_id = public.current_tenant_id());

grant select on public.asaas_payments to authenticated;
grant all on public.asaas_payments to service_role;
