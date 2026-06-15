-- A policy "app users read auth" usava auth.role()='authenticated' (função legada/instável).
-- Troca por auth.uid() (confiável) para qualquer usuário autenticado ler a lista da equipe.
alter policy "app users read auth" on public.app_users
  using ((select auth.uid()) is not null);
