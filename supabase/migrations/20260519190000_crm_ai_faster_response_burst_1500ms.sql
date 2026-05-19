-- Reduz `inbound_burst_debounce_ms` de 4000ms (4s) para 1500ms (1.5s).
-- Com WhatsApp Cloud API oficial, a latência de entrega é baixa e o agrupamento
-- de mensagens em rajada ainda funciona com 1.5s (cobre humanos digitando duas
-- mensagens emendadas). Economia média: ~2.5s por resposta.

alter table public.crm_ai_configs
  alter column inbound_burst_debounce_ms set default 1500;

update public.crm_ai_configs
set inbound_burst_debounce_ms = 1500,
    updated_at = now()
where id = 'default'
  and inbound_burst_debounce_ms = 4000;
