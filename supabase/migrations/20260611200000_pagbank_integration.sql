-- =============================================================================
-- PagBank — Checkout / Link de Pagamento para o polo de vendas (Tricopill).
-- =============================================================================
-- A config fica por polo em tenant_integrations.pagbank: { token?, env?, base_url? }.
-- env 'sandbox' (default) usa qa/sandbox; 'prod' usa api.pagseguro.com. O token
-- pode vir daqui OU do secret global PAGBANK_API_TOKEN (fallback).
alter table public.tenant_integrations
  add column if not exists pagbank jsonb not null default '{}'::jsonb;

comment on column public.tenant_integrations.pagbank is
  'Config PagBank por polo: { token?: text, env?: sandbox|prod, base_url?: text }';

-- Tricopill começa em sandbox (vira prod trocando env para "prod").
update public.tenant_integrations
   set pagbank = jsonb_build_object('env', 'sandbox')
 where tenant_id = 'tricopill'
   and (pagbank is null or pagbank = '{}'::jsonb);

-- Mapeia cada checkout gerado ao lead/polo — o webhook de pagamento usa isto para
-- mover o lead para "Pago". Também serve de auditoria dos links gerados.
create table if not exists public.pagbank_checkouts (
  checkout_id  text primary key,
  tenant_id    text not null,
  lead_id      text,
  reference_id text,
  amount_cents int,
  kit          text,
  pay_link     text,
  status       text not null default 'created',
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index if not exists pagbank_checkouts_lead_idx on public.pagbank_checkouts(lead_id);
create index if not exists pagbank_checkouts_ref_idx on public.pagbank_checkouts(reference_id);

alter table public.pagbank_checkouts enable row level security;
drop policy if exists "pagbank_checkouts tenant read" on public.pagbank_checkouts;
create policy "pagbank_checkouts tenant read" on public.pagbank_checkouts
  for select to authenticated using (tenant_id = public.current_tenant_id());
grant select on public.pagbank_checkouts to authenticated;
grant all on public.pagbank_checkouts to service_role;
