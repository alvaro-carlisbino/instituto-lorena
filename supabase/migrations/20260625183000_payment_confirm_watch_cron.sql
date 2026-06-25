-- Cron da rede de segurança de confirmação de pagamento (crm-payment-confirm-watch).
-- Roda a cada 2 min, detecta clientes que disseram que pagaram mas seguem sem pagamento
-- confirmado e notifica a equipe. Aplicado também via MCP em 2026-06-25; este arquivo
-- mantém o repo em sincronia. Auth: anon Bearer hardcoded (mesmo padrão do pix-poll —
-- current_setting('vault.service_role_key') dá 401 no contexto do pg_cron).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'crm-payment-confirm-watch-job') then
    perform cron.unschedule('crm-payment-confirm-watch-job');
  end if;
end $$;

select cron.schedule(
  'crm-payment-confirm-watch-job',
  '*/2 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-payment-confirm-watch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
