-- ─────────────────────────────────────────────────────────────────────────────
-- Reabordagem dos leads de formulário antigos: "consulta", e sem pedir desculpa.
--
-- A fila `leadform_backlog` (20260820170000_ligar_formulario_tem_de_caminhar) gravou o
-- texto pronto em cada item, com o nome já dentro. Para quem tinha deixado o contato
-- havia mais de 15 dias, a mensagem terminava assim:
--
--   "... pra saber sobre tratamento capilar e acabamos não te respondendo, desculpa a
--    demora. Ainda faz sentido eu te explicar como funciona a avaliação?"
--
-- Dois erros, apontados pela clínica em 24/09/2026 quando as primeiras saíram:
--   • o atendimento se chama CONSULTA. "Avaliação" faz o paciente esperar uma etapa
--     gratuita antes de pagar (mesma regra do prompt da Sofia e da landing, 03/09).
--   • "acabamos não te respondendo" não é verdade: a equipe entrou em contato.
--
-- Só os itens ainda pendentes. O que já saiu, saiu.
-- ─────────────────────────────────────────────────────────────────────────────

update public.whatsapp_outreach_queue
   set message = replace(
         message,
         ' e acabamos não te respondendo, desculpa a demora. Ainda faz sentido eu te explicar como funciona a avaliação?',
         '. Ainda faz sentido eu te explicar como funciona a consulta?'
       )
 where source = 'leadform_backlog'
   and status = 'pending'
   and message like '% e acabamos não te respondendo, desculpa a demora. Ainda faz sentido eu te explicar como funciona a avaliação?';


-- ── Os outros textos guardados que chamavam de avaliação ─────────────────────
-- Varredura no mesmo dia. Ficam de fora, de propósito: a regra de automação
-- "Capilar: apos avaliacao" (título de tarefa interna, o paciente não vê) e a mensagem
-- rápida "Valores Consulta", que já diz consulta e usa avaliação como o que acontece
-- dentro dela.

update public.crm_followup_configs
   set message_template = replace(message_template, 'agendar sua avaliação', 'agendar sua consulta'),
       updated_at = now()
 where tenant_id = 'instituto-lorena'
   and message_template like '%agendar sua avaliação%';

update public.crm_quick_messages
   set content = replace(content, 'um horário para avaliação?', 'um horário para a sua consulta?'),
       updated_at = now()
 where tenant_id = 'instituto-lorena'
   and content like '%um horário para avaliação?%';
