-- Núcleo de atendimento híbrido IA/Humano com contexto persistente e mídia.

create table if not exists public.crm_ai_configs (
  id text primary key default 'default',
  enabled boolean not null default true,
  default_owner_mode text not null default 'auto' check (default_owner_mode in ('human', 'ai', 'auto')),
  system_prompt text not null default '',
  prompt_by_stage jsonb not null default '{}'::jsonb,
  business_hours_start time not null default '08:00'::time,
  business_hours_end time not null default '20:00'::time,
  quiet_hours_enabled boolean not null default true,
  max_ai_replies_per_hour integer not null default 2,
  min_seconds_between_ai_replies integer not null default 240,
  updated_at timestamptz not null default now()
);

insert into public.crm_ai_configs (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.crm_conversation_states (
  lead_id text primary key references public.leads (id) on delete cascade,
  owner_mode text not null default 'auto' check (owner_mode in ('human', 'ai', 'auto')),
  ai_enabled boolean not null default true,
  prompt_override text,
  context_summary text,
  last_inbound_at timestamptz,
  last_ai_reply_at timestamptz,
  last_human_reply_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_media_items (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads (id) on delete cascade,
  interaction_id uuid references public.interactions (id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  media_type text not null check (media_type in ('audio', 'image', 'video', 'document', 'other')),
  mime_type text,
  external_media_id text,
  storage_path text,
  transcribed_text text,
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_media_items_lead_created_idx
  on public.crm_media_items (lead_id, created_at desc);

alter table public.crm_ai_configs enable row level security;
alter table public.crm_conversation_states enable row level security;
alter table public.crm_media_items enable row level security;

drop policy if exists "crm_ai_configs_read_authenticated" on public.crm_ai_configs;
create policy "crm_ai_configs_read_authenticated"
  on public.crm_ai_configs
  for select
  to authenticated
  using (true);

drop policy if exists "crm_conversation_states_rw_authenticated" on public.crm_conversation_states;
create policy "crm_conversation_states_rw_authenticated"
  on public.crm_conversation_states
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "crm_media_items_read_authenticated" on public.crm_media_items;
create policy "crm_media_items_read_authenticated"
  on public.crm_media_items
  for select
  to authenticated
  using (true);

grant select on public.crm_ai_configs to authenticated;
grant select, insert, update on public.crm_conversation_states to authenticated;
grant select on public.crm_media_items to authenticated;
