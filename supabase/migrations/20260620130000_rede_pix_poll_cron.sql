-- Cron do poller de PIX e.Rede: consulta os PIX pendentes e finaliza os pagos.
-- O PIX confirma de forma assíncrona; sem webhook cadastrado na Rede, o poller é a rede de
-- segurança (há também o botão "Verificar" no painel → crm-rede-link check_pix).
--
-- AUTH (pegadinha conhecida, ver memória crm_cron_auth_gotcha): current_setting('vault.*')
-- dá 401 no net.http_post do cron; por isso a ANON KEY vai HARDCODED no Bearer (é chave
-- pública/publishable). A função usa o service_role do PRÓPRIO ambiente dela internamente.
--
-- ⚠️ NÃO aplicar até validar a string de status "pago" da e.Rede (teste R$1). Quando aplicar:
--   select cron.schedule(...) abaixo (a cada 2 min).

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('crm-rede-pix-poll-job');
exception when others then
  null;
end$$;

select cron.schedule(
  'crm-rede-pix-poll-job',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-rede-pix-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc'
    ),
    body := '{}'::jsonb
  );
  $$
);
