-- O sino do CRM caía com 500 em horário comercial (201 de 234 erros 5xx em 24h, 15/09/2026).
--
-- A busca é `select ... from app_inbox_notifications order by created_at desc limit 25` e a
-- RLS faz o resto. As duas regras chamavam auth.uid(), current_tenant_id() e is_super_admin()
-- sem subselect, então o Postgres avaliava as funções LINHA A LINHA nas 48 mil notificações e
-- não usava o índice (auth_user_id, created_at desc): seq scan de 2,2 s com o banco parado,
-- estouro do statement_timeout de 8 s com a clínica usando.
--
-- `(select f())` vira initplan: a função roda uma vez por consulta e o filtro por
-- auth_user_id casa com o índice. Mesma regra, mesmo resultado, só a forma muda.

alter policy "inbox notifs own" on public.app_inbox_notifications
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

alter policy tenant_isolation on public.app_inbox_notifications
  using ((tenant_id = (select public.current_tenant_id())) or (select public.is_super_admin()))
  with check ((tenant_id = (select public.current_tenant_id())) or (select public.is_super_admin()));

-- webhook_jobs: 35 mil linhas e can_manage_users() por linha nas duas regras.
alter policy "webhook jobs admin read" on public.webhook_jobs
  using ((select public.can_manage_users()));

alter policy "webhook jobs admin write" on public.webhook_jobs
  using ((select public.can_manage_users()))
  with check ((select public.can_manage_users()));
