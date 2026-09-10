-- O follow-up de agendamento passa a ESPERAR o ritmo da linha dentro da rodada, e o cron
-- precisa esperar junto.
--
-- O QUE ACONTECEU (10/set/2026). Rita, Karina e Fátima receberam "Segue nosso vídeo
-- explicando como será a sua experiência de atendimento" — sem vídeo nenhum.
--
-- A guarda anti-ban exige 45–90s entre dois proativos da MESMA linha
-- (`whatsapp_line_policy.gap_min_segundos` + jitter). O laço da rotina despachava os 6
-- nomes da rodada em ~0,6s cada, então só o PRIMEIRO passava: os outros cinco levavam
-- `outbound_blocked:ritmo` e voltavam como 429. E o `functions.invoke` do supabase-js
-- engole o corpo do 429 — sobrava a frase "Edge Function returned a non-2xx status code",
-- que a rotina gravava como tentativa FALHADA. Duas tentativas e ela desistia do anexo,
-- por um defeito de vídeo que nunca existiu. O vídeo estava intacto no bucket o tempo
-- todo (12,7 MB, `institucional/instituto-lorena/primeira-consulta.mp4`), e saiu inteiro
-- para os dois primeiros nomes do dia (Maykel 12:35, Romuro 13:35) — os únicos que
-- chegaram a ser o primeiro da sua rodada.
--
-- O conserto mora na função (`crm-followup-agendamento`): ela lê o motivo REAL dentro da
-- `Response` do 429, não conta recusa de guarda como tentativa de vídeo, e espera os
-- segundos que a própria guarda pede antes de tentar o mesmo lead de novo.
--
-- ESTA MIGRAÇÃO é só o outro lado da espera: com `timeout_milliseconds = 120000` o
-- pg_net desistia da resposta no meio da primeira pausa, e a rodada terminaria sozinha
-- discutindo com um cliente que já foi embora. 300s cobre o orçamento de espera de 240s
-- da função com folga, e continua bem abaixo do teto de parede da Edge Function.

select cron.unschedule('crm-followup-agendamento-job')
where exists (select 1 from cron.job where jobname = 'crm-followup-agendamento-job');

select cron.schedule(
  'crm-followup-agendamento-job',
  '35 12-22 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-followup-agendamento',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'followup_agendamento'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);
