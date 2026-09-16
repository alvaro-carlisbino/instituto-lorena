-- Linha em que a IA NÃO fala (16/set/2026).
--
-- A Aline ganhou um WhatsApp só dela (W-API). Nesse número quem responde é ela: a Sofia não
-- faz primeiro atendimento, não faz plantão à noite e não manda follow-up com voz de IA.
--
-- Até aqui a única chave era por POLO (`crm_ai_configs`) ou por CONVERSA
-- (`crm_conversation_line_states`). Nenhuma das duas serve: desligar no polo cala a linha SDR
-- da clínica, e desligar por conversa só vale depois que alguém já respondeu. A pessoa nova
-- que escreve para a Aline levaria o menu da Sofia antes.
--
-- Onde é lida:
--   • `evaluateCrmAiAutoReplyGate` (_shared/crmAiAutoReply.ts): skip `linha_sem_ia`. Cobre a
--     resposta ao inbound, o buffer, a retomada do vigia de atendimento, o "responder com a
--     IA" do painel e a re-checagem antes do envio.
--   • `crm-send-message`: recusa rotina com voz de IA (follow-up, cadência, reengajamento,
--     carrinho) quando o lead está nesta linha. Lembrete de cirurgia e confirmação de
--     pagamento continuam saindo: são aviso, não conversa.
--
-- Default true: nenhuma linha existente muda de comportamento.
alter table public.whatsapp_channel_instances
  add column if not exists ai_auto_reply boolean not null default true;

comment on column public.whatsapp_channel_instances.ai_auto_reply is
  'false = linha só da equipe: a IA não responde nem manda follow-up por ela. Ver 20260916220000.';
