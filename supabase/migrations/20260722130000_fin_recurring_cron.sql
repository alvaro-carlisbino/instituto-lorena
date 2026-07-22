-- Agenda o crm-fin-recurring (gera despesas/receitas recorrentes do mês).
-- 1x/dia às 09:00 UTC = 06:00 BRT (madrugada, antes de o time abrir o painel, para as
-- contas do mês já aparecerem na agenda de contas a pagar/receber).
--
-- verify_jwt=false na função (ver config.toml) → não dependemos do vault.service_role_key
-- (que devolve 401, ver "cron auth gotcha"). x-cron-secret é opcional; se
-- FIN_RECURRING_CRON_SECRET estiver vazio, a função aceita. A função é idempotente:
-- carimba last_generated_on e não duplica no mesmo mês, então rodar todo dia é seguro.

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('crm-fin-recurring-job');
exception when others then null;
end$$;

select cron.schedule(
  'crm-fin-recurring-job',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-fin-recurring',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('vault.cron_inbox_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
