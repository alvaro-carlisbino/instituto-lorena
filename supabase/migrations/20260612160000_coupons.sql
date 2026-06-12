-- =============================================================================
-- Cupons de desconto (códigos cadastrados pelo lojista) — escopo por tenant.
-- =============================================================================
-- A IA de vendas (Tricopill) e a tela de Links de Pagamento aplicam o cupom no
-- valor antes de gerar o link (PagBank/PIX ou e.Rede/cartão). O uso (`uses`) só é
-- contabilizado quando o pagamento CONFIRMA (webhook PagBank / aprovação Rede),
-- não na geração do link — assim carrinho abandonado não queima o cupom.
create table if not exists public.coupons (
  tenant_id        text not null,
  code             text not null,
  kind             text not null default 'percent' check (kind in ('percent', 'fixed')),
  value            int  not null check (value > 0),          -- percent: 1..100 | fixed: centavos
  active           boolean not null default true,
  valid_from       timestamptz,
  valid_until      timestamptz,
  max_uses         int,                                      -- null = ilimitado
  uses             int not null default 0,
  min_amount_cents int not null default 0,                  -- valor mínimo do pedido p/ valer
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, code)
);

alter table public.coupons enable row level security;
drop policy if exists "coupons tenant read" on public.coupons;
create policy "coupons tenant read" on public.coupons
  for select to authenticated using (tenant_id = public.current_tenant_id());
grant select on public.coupons to authenticated;
grant all on public.coupons to service_role;

-- Auditoria do desconto aplicado em cada checkout.
alter table public.pagbank_checkouts add column if not exists coupon_code   text;
alter table public.pagbank_checkouts add column if not exists discount_cents int not null default 0;
alter table public.rede_payments     add column if not exists coupon_code   text;
alter table public.rede_payments     add column if not exists discount_cents int not null default 0;

-- Incremento atómico de uso (chamado quando o pagamento confirma).
create or replace function public.increment_coupon_use(p_tenant text, p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.coupons
     set uses = uses + 1, updated_at = now()
   where tenant_id = p_tenant and code = p_code;
$$;
