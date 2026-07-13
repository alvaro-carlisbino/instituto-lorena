-- Varredura de segurança dos leads de formulário Meta (Lead Ads), a cada 30 min.
-- Motivo: em 12/jul a Meta NÃO entregou o webhook de 1 lead (caso Paulo — estava
-- na planilha do gestor de tráfego e não tinha NENHUM evento aqui). O webhook ao
-- vivo segue sendo o caminho principal; o sweep lê /{form_id}/leads direto da
-- Graph e cria qualquer lead dos últimos 3 dias que tenha escapado. Idempotente.
--
-- A função sobe com verify_jwt=false (config.toml); a autenticação da ação é o
-- token em app_edge_tokens (mesmo esquema do recover_failed). NÃO usamos
-- vault.service_role_key (devolve 401 — ver "cron auth gotcha").

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('crm-meta-leadform-sweep-job');
exception when others then null;
end$$;

select cron.schedule(
  'crm-meta-leadform-sweep-job',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-meta-leadform-webhook',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'sweep_forms',
      'days', 3,
      'token', (select token from app_edge_tokens where name = 'meta_leadform_recover_token')
    )
  );
  $$
);
