-- Migração Consolidada: Otimizações de CRM Fase 1 e 2

-- 1. Melhorias na tabela de Leads
alter table public.leads
add column if not exists conversation_status text default 'new',
add column if not exists last_interaction_at timestamptz default now(),
add column if not exists lost_reason text;

create index if not exists idx_leads_last_interaction on public.leads(last_interaction_at);

-- 2. Sistema de Mensagens Rápidas (Atalhos /)
create table if not exists public.crm_quick_messages (
  id uuid primary key default gen_random_uuid(),
  shortcut text not null unique,
  content text not null,
  category text,
  sort_order int default 0,
  created_at timestamptz default now()
);

alter table public.crm_quick_messages enable row level security;
create policy "Allow all for quick messages" on public.crm_quick_messages for all to authenticated using (true);

-- 3. Sistema de Follow-up (D1/D3/D5)
create table if not exists public.crm_followup_configs (
  id uuid primary key default gen_random_uuid(),
  pipeline_id text not null,
  day_number int not null, -- 1, 3, 5
  message_template text not null,
  enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(pipeline_id, day_number)
);

create table if not exists public.crm_lead_followup_state (
  lead_id text primary key references public.leads(id) on delete cascade,
  current_step int default 0,
  last_sent_at timestamptz,
  status text not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.crm_followup_configs enable row level security;
alter table public.crm_lead_followup_state enable row level security;
create policy "Allow all for followup configs" on public.crm_followup_configs for all to authenticated using (true);
create policy "Allow all for lead followup state" on public.crm_lead_followup_state for all to authenticated using (true);

-- 4. Automação de Agendamento (Cron)
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'crm-followup-worker-job',
  '10 * * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-followup-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('vault.service_role_key', true)
    )
  );
  $$
);
