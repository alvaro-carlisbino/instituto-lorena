-- Resposta mais rápida: sem espera de rajada por omissão (evita silêncio longo e timeouts).

alter table public.crm_ai_configs
  alter column inbound_burst_debounce_ms set default 0;

update public.crm_ai_configs
set
  inbound_burst_debounce_ms = 0,
  updated_at = now()
where id = 'default'
  and inbound_burst_debounce_ms = 4000;
