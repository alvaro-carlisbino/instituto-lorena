-- Lead de formulário nascia sem campanha, e o painel de ROI casa por campanha.
--
-- `GET /{leadgen_id}?fields=ad_id,adset_id,campaign_id` devolve 200 e OMITE os
-- três campos quando quem pergunta é o token de PÁGINA (só `leads_retrieval`).
-- Não é erro, não é aviso: o campo some da resposta. O webhook do formulário só
-- tem esse token, então todo lead pago nasceu com `is_organic:false` e campanha
-- vazia — e `v_ads_campanha_ate_venda`, que casa gasto com resultado por
-- `attribution_campaign`, não enxergava nenhum deles.
--
-- Quem enxerga é o token de ANÚNCIOS, que mora no crm-meta-ads-sync. Daí a
-- rotina nova (`action=atribuir`) e este cron: de 20 em 20 minutos ele pega
-- lead de formulário ainda sem campanha e pergunta pelo lado certo.
--
-- Roda 3 minutos antes do CAPI de propósito: quando o evento de resultado sai,
-- a campanha já está no lead. Idempotente — só olha quem está sem campanha.

select cron.schedule(
  'crm-meta-ads-atribuir-job',
  '7,27,47 * * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-meta-ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'meta_ads'), '')
    ),
    body := '{"action":"atribuir","dias":4}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
