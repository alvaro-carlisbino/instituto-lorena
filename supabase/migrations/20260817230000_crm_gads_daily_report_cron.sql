-- Relatório diário do Google Ads do Tricopill no WhatsApp do dono (crm-gads-daily-report).
-- 11:00 UTC = 8h em Maringá. Sem bearer: a função tem verify_jwt=false (pg_cron não assina JWT,
-- ver crm_cron_auth_gotcha). JÁ AGENDADO em prod em 17/08/2026 (jobid 41) via MCP; este arquivo
-- registra a intenção no repo. Idempotente: desagenda antes de agendar.
do $$
begin
  perform cron.unschedule('crm-gads-daily-report-job');
exception when others then null;
end $$;
select cron.schedule(
  'crm-gads-daily-report-job',
  '0 11 * * *',
  $$ select net.http_post(
      url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-gads-daily-report',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := '{}'::jsonb
  ); $$
);
