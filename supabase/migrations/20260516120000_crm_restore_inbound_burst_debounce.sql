-- Restaura o agrupamento de mensagens em rajada do WhatsApp / Instagram.
-- A migration 20260502160000_crm_faster_whatsapp_ai_defaults.sql tinha zerado
-- inbound_burst_debounce_ms para acelerar respostas, mas isso fez a IA responder
-- "Bom dia" e "Quero saber o valor" como duas mensagens separadas, mesmo quando
-- enviadas em sequência no mesmo contexto.
--
-- Volta para 4000 ms (4 s) por omissão. Pode ser ajustado em /configuracoes via
-- ConversationControl set_config (inboundBurstDebounceMs).

alter table public.crm_ai_configs
  alter column inbound_burst_debounce_ms set default 4000;

update public.crm_ai_configs
set
  inbound_burst_debounce_ms = 4000,
  updated_at = now()
where id = 'default'
  and inbound_burst_debounce_ms = 0;
