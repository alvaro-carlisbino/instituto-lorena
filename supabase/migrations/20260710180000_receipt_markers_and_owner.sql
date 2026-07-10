-- Comprovante de venda "sempre enviar": marcas por venda pra o vigia (crm-payment-confirm-watch)
-- reenviar comprovantes perdidos sem duplicar. group = grupo do financeiro; owner = cópia 1:1 do dono.
alter table public.rede_payments  add column if not exists receipt_group_sent_at timestamptz;
alter table public.rede_payments  add column if not exists receipt_owner_sent_at timestamptz;
alter table public.asaas_payments add column if not exists receipt_group_sent_at timestamptz;
alter table public.asaas_payments add column if not exists receipt_owner_sent_at timestamptz;

-- Token protegido pra ações administrativas de edge (ex.: recover_failed do crm-meta-leadform-webhook).
-- O valor do token é gravado direto no banco (fora do git). Sem policies => só service_role lê.
create table if not exists public.app_edge_tokens (
  name text primary key,
  token text not null,
  created_at timestamptz not null default now()
);
alter table public.app_edge_tokens enable row level security;
