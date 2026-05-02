-- Acumula mensagens curtas do mesmo lead antes de uma única resposta IA (WhatsApp).

alter table public.crm_conversation_states
  add column if not exists ai_inbound_burst_text text,
  add column if not exists ai_inbound_burst_updated_at timestamptz;

alter table public.crm_ai_configs
  add column if not exists inbound_burst_debounce_ms integer not null default 0;

comment on column public.crm_ai_configs.inbound_burst_debounce_ms is
  'WhatsApp: 0 = imediato (omissão). >0 acumula rajada até esta pausa após o último inbound. ManyChat síncrono não usa buffer.';
