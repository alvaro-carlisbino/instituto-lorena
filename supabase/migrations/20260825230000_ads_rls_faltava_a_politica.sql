-- ─────────────────────────────────────────────────────────────────────────────
-- Faltava a política, não o grant
--
-- `meta_ads_insights`, `meta_ads_vigia_log` e `ctwa_aberturas` nasceram com
-- `enable row level security` e `grant select to authenticated`, e NENHUMA
-- policy. Com RLS ligada e nenhuma política, o grant não vale nada: o Postgres
-- nega tudo. A tela /ads abriu com "permission denied for table
-- meta_ads_insights" na primeira vez que alguém entrou.
--
-- O erro apareceu porque a tela mostra a mensagem em vez de engolir. Se ela
-- tivesse renderizado zerada, o buraco ficaria semanas escondido.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Insights de anúncio pertencem a um polo ──────────────────────────────
alter table public.meta_ads_insights
  add column if not exists tenant_id text not null default 'instituto-lorena';

drop policy if exists "meta_ads_insights tenant read" on public.meta_ads_insights;
create policy "meta_ads_insights tenant read" on public.meta_ads_insights
  for select using (tenant_id = current_tenant_id());

-- ── 2. Avisos do vigia ──────────────────────────────────────────────────────
alter table public.meta_ads_vigia_log
  add column if not exists tenant_id text not null default 'instituto-lorena';

drop policy if exists "meta_ads_vigia_log tenant read" on public.meta_ads_vigia_log;
create policy "meta_ads_vigia_log tenant read" on public.meta_ads_vigia_log
  for select using (tenant_id = current_tenant_id());

-- ── 3. Frases de abertura dos anúncios ──────────────────────────────────────
drop policy if exists "ctwa_aberturas tenant read" on public.ctwa_aberturas;
create policy "ctwa_aberturas tenant read" on public.ctwa_aberturas
  for select using (tenant_id = current_tenant_id());

-- Escrita continua só do servidor: service_role ignora RLS, e não há política
-- de insert/update de propósito. Quem alimenta é cron, não gente.
