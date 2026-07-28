-- Shosp: cortar o consumo da API para caber na cota.
--
-- Contexto (28/jul/2026): a API da Shosp devolve HTTP 429 "Limit Exceeded" em
-- TODOS os endpoints, e a agenda não sincroniza desde 09/jul — 19 dias cego. O
-- cron continuou rodando de 15 em 15 minutos, respondendo ok e carimbando
-- `last_appointments_sync_at`, porque o 429 era tratado como "não veio nada".
--
-- A conta do consumo antigo, por dia:
--   crm-shosp-sync        96 rodadas x ~65 chamadas (5 referências + busca de
--                         paciente + 25 agendas)                 ~= 6.240
--   crm-shosp-full-agenda  8 rodadas x 16 chamadas (8 prestadores
--                         x 2 blocos de 31 dias)                 ~=   128
--                                                          TOTAL ~= 6.400/dia
--                                                                ~= 192.000/mês
-- Para uma clínica com 2.341 agendamentos no total. Era só questão de tempo.
--
-- Consumo novo, por dia:
--   crm-shosp-sync         24 rodadas x ~16 chamadas             ~=   384
--   crm-shosp-full-agenda   2 rodadas x 16 x nº de unidades      ~=    64
--   crm-shosp-references    1 rodada  x 5                        ~=     5
--                                                          TOTAL ~=   453/dia
-- Cerca de 14x menos. O passo `references` saiu do laço de alta frequência:
-- unidade/prestador/serviço mudam raramente, não a cada 15 minutos.

-- Sync operacional (casar lead com paciente + agenda de quem já está casado):
-- de 15 em 15 min para de hora em hora, com lotes menores.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'crm-shosp-sync'),
  schedule := '13 * * * *',
  command := $job$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-shosp',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc'),
    body := '{"mode":"sync","steps":["match","appointments"],"matchLimit":6,"apptLimit":10}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- Grade completa (base das métricas por unidade/prestador): de 3 em 3 horas para
-- 2x por dia. Agora varre TODAS as unidades, então cada rodada custa mais.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'crm-shosp-full-agenda'),
  schedule := '20 6,18 * * *',
  command := $job$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-shosp',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc'),
    body := '{"mode":"sync","steps":["full_agenda"],"diasTotal":45}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- Tabelas de referência (unidade, prestador, serviço, especialidade, plano):
-- 1x por dia, de madrugada. É este passo que descobre uma unidade NOVA — quando
-- Londrina entrar no Shosp, ela aparece aqui e a grade passa a varrê-la sozinha.
select cron.schedule(
  'crm-shosp-references',
  '40 5 * * *',
  $job$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-shosp',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneWZwbW52bGtteXh0dWNieGJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDUzNzgsImV4cCI6MjA5MjAyMTM3OH0.p7bgCdk4IxDdOr55VWoslHKoYTjXkt810vpdxQk5Lyc'),
    body := '{"mode":"sync","steps":["references"]}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
