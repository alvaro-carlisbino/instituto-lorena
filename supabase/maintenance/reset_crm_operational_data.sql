-- Reset operacional do CRM
-- MANTÉM: app_users, funis, canais, crm_ai_configs, org_settings, templates, regras, etc.
-- Apaga: leads (e cascade: interações, mídias, estados de conversa, tarefas, inquéritos por lead),
--        fila webhook_jobs, threads do assistente de UI, audit_logs.
--
-- Opção A (recomendada, após migração maintenance_reset_crm_function):
--   select public.maintenance_reset_crm_data();
--
-- Opção B (script raw no SQL Editor): desativa triggers de permissão na sessão.
--   Requer permissão para session_replication_role (utilizador postgres no Supabase).

begin;
set local session_replication_role = 'replica';

truncate public.crm_assistant_threads cascade;

truncate public.webhook_jobs restart identity;

delete from public.leads;

truncate public.audit_logs restart identity;

set local session_replication_role = 'origin';
commit;
