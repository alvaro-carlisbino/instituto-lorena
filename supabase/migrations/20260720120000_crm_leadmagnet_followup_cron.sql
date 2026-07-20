-- Agenda o crm-leadmagnet-followup (lembrete por e-mail de quem pegou o cupom no
-- popup e não comprou). 1x/dia às 12:00 UTC = 09:00 BRT. verify_jwt=false (config.toml),
-- então não depende do vault.service_role_key; x-cron-secret opcional.
-- ⚠️ Nasce em DRY-RUN: só envia e-mail de verdade com LEADMAGNET_FOLLOWUP_ENABLED='true'.
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('crm-leadmagnet-followup-job');
exception when others then null;
end$$;

select cron.schedule(
  'crm-leadmagnet-followup-job',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-leadmagnet-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('vault.cron_inbox_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
