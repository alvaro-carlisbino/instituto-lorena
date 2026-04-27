-- Reset operacional do CRM — executar no Supabase: SQL Editor (role postgres / bypass RLS).
-- Apaga conversas, leads, mídias, fila de webhooks, threads do assistente interno e logs de auditoria.
-- MANTÉM: utilizadores (app_users), funis, canais, crm_ai_configs, org_settings, pesquisas (templates vazias), regras, etc.
--
-- Antes de correr em produção, confirme backup se necessário.

begin;

truncate public.crm_assistant_threads cascade;

truncate public.webhook_jobs restart identity;

delete from public.leads;

truncate public.audit_logs restart identity;

commit;
