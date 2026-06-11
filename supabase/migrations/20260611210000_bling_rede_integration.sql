-- =============================================================================
-- Bling (ERP, OAuth2) e Rede/Itaú (cartão) — config por polo.
-- =============================================================================
-- bling: tokens OAuth rotativos { access_token, refresh_token, expires_at,
--   account_name?, connected_at? }. O client_id/client_secret do app ficam em
--   secrets globais (BLING_CLIENT_ID/BLING_CLIENT_SECRET), não no DB.
-- rede: { pv?, token?, env? } para a API e.Rede (link/cobrança de cartão).
alter table public.tenant_integrations
  add column if not exists bling jsonb not null default '{}'::jsonb;
alter table public.tenant_integrations
  add column if not exists rede jsonb not null default '{}'::jsonb;

comment on column public.tenant_integrations.bling is
  'Tokens OAuth Bling v3 (rotativos): { access_token, refresh_token, expires_at, account_name?, connected_at? }';
comment on column public.tenant_integrations.rede is
  'Config Rede/Itaú e.Rede: { pv?, token?, env? }';

-- Garante linha de integrações para o polo Tricopill.
insert into public.tenant_integrations (tenant_id) values ('tricopill')
on conflict (tenant_id) do nothing;
