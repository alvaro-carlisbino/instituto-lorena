-- Fase 1 Shosp: tabelas espelho (sync de leitura da API Shosp).
-- Escrita só via service role (edge function crm-shosp mode=sync); leitura autenticada.

create table if not exists public.shosp_reference (
  kind text not null,            -- unidade | especialidade | prestador | servico | planosaude
  codigo text not null,
  nome text,
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (kind, codigo)
);

create table if not exists public.shosp_patients (
  prontuario text primary key,
  nome text,
  cpf text,
  celular text,
  telefone text,
  email text,
  lead_id text references public.leads(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists shosp_patients_lead_idx on public.shosp_patients(lead_id);

create table if not exists public.shosp_appointments (
  codigo_agendamento text primary key,
  prontuario text,
  lead_id text references public.leads(id) on delete set null,
  codigo_unidade text,
  codigo_prestador text,
  prestador text,
  servico text,
  plano_saude text,
  data date,
  horario text,
  status text,
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists shosp_appointments_lead_idx on public.shosp_appointments(lead_id);
create index if not exists shosp_appointments_data_idx on public.shosp_appointments(data);
create index if not exists shosp_appointments_status_idx on public.shosp_appointments(status);

-- Liga o lead CRM ao paciente Shosp.
alter table public.leads add column if not exists shosp_prontuario text;
create index if not exists leads_shosp_prontuario_idx on public.leads(shosp_prontuario);

-- Estado do sync (para processar leads em lotes e marcar timestamps).
create table if not exists public.shosp_sync_state (
  id text primary key default 'default',
  last_reference_sync_at timestamptz,
  last_match_sync_at timestamptz,
  last_appointments_sync_at timestamptz,
  notes text
);
insert into public.shosp_sync_state (id) values ('default') on conflict (id) do nothing;

alter table public.shosp_reference enable row level security;
alter table public.shosp_patients enable row level security;
alter table public.shosp_appointments enable row level security;
alter table public.shosp_sync_state enable row level security;

create policy "shosp_reference read auth" on public.shosp_reference
  for select using (auth.role() = 'authenticated');
create policy "shosp_patients read auth" on public.shosp_patients
  for select using (auth.role() = 'authenticated');
create policy "shosp_appointments read auth" on public.shosp_appointments
  for select using (auth.role() = 'authenticated');
create policy "shosp_sync_state read auth" on public.shosp_sync_state
  for select using (auth.role() = 'authenticated');
