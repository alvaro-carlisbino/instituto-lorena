-- Agenda o crm-reengage-scheduler (reativação + recompra "sem fim" do Tricopill).
-- 1x/dia às 14:00 UTC = 11:00 BRT (horário comercial, boa taxa de leitura no zap).
--
-- A função sobe com verify_jwt=false (ver config.toml), então NÃO dependemos do
-- vault.service_role_key (que devolve 401 — ver nota "cron auth gotcha"). Passamos
-- só o x-cron-secret opcional; se REENGAGE_CRON_SECRET estiver vazio, a função aceita.
--
-- ⚠️ A função nasce em DRY-RUN. Só dispara WhatsApp de verdade quando a env
--    REENGAGE_ENABLED='true' estiver setada nas secrets da função.

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('crm-reengage-scheduler-job');
exception when others then null;
end$$;

select cron.schedule(
  'crm-reengage-scheduler-job',
  '0 14 * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-reengage-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('vault.cron_inbox_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
