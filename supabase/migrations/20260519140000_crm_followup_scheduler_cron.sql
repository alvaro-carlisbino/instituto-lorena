-- Agenda o `crm-followup-scheduler` (a nova máquina de follow-up de 6 mensagens
-- em janelas de 1h/2h/4h/8h/16h/24h após o último inbound sem resposta).
--
-- Contexto: a migration 20260504_crm_optimizations.sql só agendou o worker
-- antigo (`crm-followup-worker`), que apenas registava no histórico sem enviar
-- DM. Como o scheduler novo nunca foi agendado, nenhum follow-up chegava ao
-- paciente — e o badge "Follow-up" do Kanban nunca aparecia porque a UI lê de
-- `crm_lead_followup_state`, que o scheduler agora espelha.
--
-- Cron `*/5 * * * *` = a cada 5 minutos. As janelas (1h+) toleram bem este
-- intervalo e mantemos o custo baixo. Header `x-cron-secret` casa com a env
-- `CRON_INBOX_SECRET` exigida pela função.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Remove agendamento anterior se existir (migration idempotente)
do $$
begin
  perform cron.unschedule('crm-followup-scheduler-job');
exception when others then
  null;
end$$;

select cron.schedule(
  'crm-followup-scheduler-job',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-followup-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('vault.cron_inbox_secret', true), ''),
      'Authorization', 'Bearer ' || coalesce(current_setting('vault.service_role_key', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
