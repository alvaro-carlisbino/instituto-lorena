-- Fila de retry de download de mídia inbound do W-API. O webhook (crm-wapi-webhook)
-- enfileira aqui quando o download falha na hora (áudio costuma estourar o timeout),
-- e o worker crm-wapi-media-retry (cron */2) reprocessa fora da requisição e grava
-- em crm_media_items quando consegue. Só edge functions (service_role) tocam a fila.
create table if not exists public.crm_media_retry_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  lead_id text not null,
  interaction_id text,
  whatsapp_instance_id text,
  message_id text not null,
  media_type text not null,
  media jsonb not null,
  caption text,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now()
);

create index if not exists crm_media_retry_jobs_due_idx
  on public.crm_media_retry_jobs (status, next_attempt_at);

alter table public.crm_media_retry_jobs enable row level security;
