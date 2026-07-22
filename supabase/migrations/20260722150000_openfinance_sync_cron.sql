-- Agenda o crm-openfinance-sync (puxa transações do Open Finance/Pluggy pro razão de caixa).
-- 1x/dia às 08:00 UTC = 05:00 BRT (madrugada; o Pluggy já atualizou os itens no fim da noite).
-- Idempotente (dedup por tenant/conta/id da transação), então rodar todo dia é seguro.
-- verify_jwt=false na função (config.toml); x-cron-secret opcional (OPENFINANCE_CRON_SECRET).

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('crm-openfinance-sync-job');
exception when others then null;
end$$;

select cron.schedule(
  'crm-openfinance-sync-job',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-openfinance-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('vault.cron_inbox_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
