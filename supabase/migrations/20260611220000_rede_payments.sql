-- =============================================================================
-- e.Rede — cobranças por cartão (checkout próprio /pagar/:id).
-- =============================================================================
-- Uma "intenção de pagamento": o CRM cria a cobrança e devolve a URL /pagar/<id>;
-- o cliente abre, digita o cartão, e o edge crm-rede-pay chama /v1/transactions.
create table if not exists public.rede_payments (
  id           text primary key,
  tenant_id    text not null,
  lead_id      text,
  amount_cents int not null,
  description  text not null default 'Pagamento',
  installments int not null default 1,
  status       text not null default 'pending',  -- pending | paid | failed
  tid          text,
  return_code  text,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index if not exists rede_payments_tenant_idx on public.rede_payments(tenant_id);
create index if not exists rede_payments_lead_idx on public.rede_payments(lead_id);

alter table public.rede_payments enable row level security;
drop policy if exists "rede_payments tenant read" on public.rede_payments;
create policy "rede_payments tenant read" on public.rede_payments
  for select to authenticated using (tenant_id = public.current_tenant_id());
grant select on public.rede_payments to authenticated;
grant all on public.rede_payments to service_role;
