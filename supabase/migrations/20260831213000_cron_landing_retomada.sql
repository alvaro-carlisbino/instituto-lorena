-- Cron da retomada do lead da landing.
--
-- De hora em hora, entre 9h e 18h de Maringá (12–21 UTC), de segunda a sexta. A janela é
-- estreita de propósito: a rotina ABRE TAREFA para a equipe, e tarefa que nasce às 3h da
-- manhã de domingo vence antes de alguém ter tido chance de pegá-la. A guarda anti-ban do
-- `crm-send-message` ainda decide se a mensagem sai de fato.
--
-- O segredo NÃO mora neste arquivo: o repositório é público. Ele fica em
-- `public.app_cron_secrets` (chave `landing_retomada`) e no secret
-- `LANDING_RETOMADA_CRON_SECRET` da função. Sem o par batendo, a função devolve 401 —
-- ela NEGA na ausência de segredo, em vez de liberar como o irmão `crm-followup-scheduler`.

select cron.unschedule('crm-landing-retomada-job')
where exists (select 1 from cron.job where jobname = 'crm-landing-retomada-job');

select cron.schedule(
  'crm-landing-retomada-job',
  '10 12-21 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-landing-retomada',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'landing_retomada'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
