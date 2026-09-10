-- O teto que manda na rodada é o de OCIOSIDADE, não o da parede.
--
-- A migração de 40 minutos atrás subiu o `timeout_milliseconds` do cron para 300s achando
-- que quem desistia primeiro era o pg_net. Não era: o Edge Runtime derruba a requisição
-- com `504 {"code":"IDLE_TIMEOUT","message":"Request idle timeout limit (150s) reached"}`
-- depois de 150s sem atividade — e uma rotina que dorme para respeitar o ritmo da linha é
-- exatamente uma requisição ociosa.
--
-- Provado no reenvio do vídeo às 17:19 de hoje: Rita recebeu às 17:20:07, Karina às
-- 17:21:48, e a Fátima ficou sem — a função morreu na segunda pausa de 100s. Uma espera
-- cabe com folga; duas nunca cabem.
--
-- Então a rodada encolhe e a frequência sobe. `ORCAMENTO_ESPERA_MS = 95s` deixa a função
-- fazer no máximo uma pausa (duas mensagens por rodada, ~100s de ponta a ponta), e o cron
-- passa a rodar de 15 em 15 minutos dentro da mesma janela de 9h–19h de Maringá.
--
-- 4 rodadas/hora × 11h × 2 mensagens = 88/dia, contra os 66 que o `cap_por_rodada = 6`
-- prometia e nunca entregou (na prática entregava 1 por rodada, porque só o primeiro nome
-- passava pela guarda e o resto queimava em `ritmo`).
--
-- `timeout_milliseconds` volta para 150000: esperar mais que o runtime aguenta é fingir.

select cron.unschedule('crm-followup-agendamento-job')
where exists (select 1 from cron.job where jobname = 'crm-followup-agendamento-job');

select cron.schedule(
  'crm-followup-agendamento-job',
  '5,20,35,50 12-22 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-followup-agendamento',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'followup_agendamento'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);

-- O `cap_por_rodada` deixa de ser uma promessa de 6 que a guarda nunca deixaria acontecer.
-- Dois é o que cabe numa invocação, e é o que a rotina passa a tentar.
update public.tenant_integrations
   set outreach = jsonb_set(outreach, '{agendamento,cap_por_rodada}', '2'::jsonb)
 where tenant_id = 'instituto-lorena'
   and outreach -> 'agendamento' is not null;
