-- Roteamento por telefone (instância WhatsApp) + histórico de handoff entre linhas
-- Depende de whatsapp_channel_instances (migração 20260429120000_crm_roadmap_...)

alter table public.whatsapp_channel_instances
  add column if not exists entry_pipeline_id text references public.pipelines (id) on delete set null,
  add column if not exists entry_stage_id text references public.pipeline_stages (id) on delete set null,
  add column if not exists default_owner_id text references public.app_users (id) on delete set null,
  add column if not exists on_line_change text not null default 'keep_stage'
    check (on_line_change in ('keep_stage', 'use_entry'));

comment on column public.whatsapp_channel_instances.entry_pipeline_id is
  'Funil onde novos contactos desta linha entram. Vazio = primeiro funil/etapa global.';
comment on column public.whatsapp_channel_instances.on_line_change is
  'keep_stage: se o lead já existir e escrever por outra linha, mantém etapa. use_entry: aplica etapa/entrada desta linha.';

create table if not exists public.lead_wa_line_events (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads (id) on delete cascade,
  from_instance_id text references public.whatsapp_channel_instances (id) on delete set null,
  to_instance_id text not null references public.whatsapp_channel_instances (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists lead_wa_line_events_lead_id_idx
  on public.lead_wa_line_events (lead_id, created_at desc);

create index if not exists lead_wa_line_events_created_idx
  on public.lead_wa_line_events (created_at desc);

alter table public.lead_wa_line_events enable row level security;

create policy "lead_wa_line_events read"
  on public.lead_wa_line_events
  for select
  to authenticated
  using (true);

comment on table public.lead_wa_line_events is
  'Handoff: mensagem do mesmo lead por outro número/instância WhatsApp, para analytics e trilha de atendimento.';
