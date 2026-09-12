-- O alarme que faltou em 11/09/2026: linha muda.
--
-- O QUE ACONTECEU. Às 14:36 a linha da clínica (wa-wapi-mpyi00su, +55 44 9149-3656) travou
-- DENTRO da W-API. Parou de receber nos dois sentidos, mas `/message/send-text` continuou
-- devolvendo messageId — o CRM gravou 9 envios entre 14:36 e 15:21 e nenhum chegou ao
-- paciente. `whatsapp_line_health` seguiu dizendo "connected", com o último evento de 20/08:
-- o provedor não manda evento de queda quando quem trava é a instância dele. Voltou sozinha
-- às 16:03, cerca de 1h30 depois, e reentregou de uma vez 31 mensagens de entrada.
--
-- Ninguém no sistema percebeu. Quem percebeu foi a atendente, porque o paciente respondeu
-- no celular dela.
--
-- O QUE ESTE VIGIA PERGUNTA, e que não depende do provedor contar nada:
-- "por que ninguém escreve para uma linha que está mandando mensagem?"
--
-- O silêncio é contado DENTRO da janela de atendimento (nunca desde a madrugada: o primeiro
-- ensaio mostrou toda linha amanhecendo "muda há 13 horas"). Passados 30 min de silêncio na
-- janela ele sonda o status-instance com 10s de paciência, e daí as provas valem diferente:
--   * sonda NÃO RESPONDE -> instância travada (11/09). Prova direta: avisa já, com 30 min.
--     Conserto: reiniciar ou reconectar no painel da W-API.
--   * sonda diz connected -> só suspeita. Linha de vendas tem buraco de uma hora por conta
--     própria, então aqui exigimos 90 min de silêncio E 3 saídas no meio dele. É a
--     assinatura do gancho morto (03/09); conserto: reescrever o PUT update-webhook-received,
--     que resolveu em 8 segundos naquele dia.
--
-- Quem recebe: DM pela linha do OUTRO polo (a caída não consegue avisar que caiu), para
-- `notifications.line_watch_phones` do polo afetado (a clínica não tinha telefone nenhum
-- configurado, que é por que ninguém foi avisado em 11/09), mais notificação in-app para
-- admin/gestor/sdr do polo. Um aviso por hora por linha, e um aviso de volta quando a
-- entrada retoma. `{"dry":true}` mede sem avisar; `{"ensaio":"<instance_id>"}` prova o
-- caminho do aviso sem esperar uma queda.
--
-- O que ele NÃO faz, de propósito: não pausa a linha (pausar bloqueia também o envio manual
-- da atendente, e isso é decisão de operação) e não fala com paciente.
--
-- Regra e testes: supabase/functions/_shared/whatsapp/lineWatch.ts (+ .test.ts, 13 casos).
-- Função: supabase/functions/crm-linha-vigia (verify_jwt=false + x-cron-secret).

-- Segredo do cron. Gerado uma vez; a env LINHA_VIGIA_CRON_SECRET da edge function tem de
-- ter o MESMO valor (a função NEGA quando a env está vazia).
insert into public.app_cron_secrets (key, secret)
values ('linha_vigia', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

select cron.unschedule('crm-linha-vigia-job')
where exists (select 1 from cron.job where jobname = 'crm-linha-vigia-job');

select cron.schedule(
  'crm-linha-vigia-job',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-linha-vigia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'linha_vigia'), '')
    ),
    body := '{}'::jsonb,
    -- A sonda é de 10s por linha e são duas linhas; 60s cobre a rodada inteira com folga.
    timeout_milliseconds := 60000
  );
  $cron$
);
