-- Protocolos de tratamento no CRM (além do tratamento capilar):
--   • Catálogo de protocolos da clínica (treatment_protocols) — nome, categoria,
--     nº de sessões previstas, intervalo sugerido e preço base.
--   • Protocolo atribuído ao paciente (lead_treatment_protocols) — snapshot do
--     nome/sessões/preço na atribuição (catálogo pode mudar depois).
--   • Sessões realizadas (lead_protocol_sessions) — data, profissional, obs.
--   • Funil "PROTOCOLOS DE TRATAMENTO" ao lado do TRATAMENTO CAPILAR, com SLAs
--     e follow-ups no mesmo padrão dos funis existentes.

-- 1) Catálogo de protocolos
create table if not exists public.treatment_protocols (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null default public.current_tenant_id() references public.tenants (id),
  name            text not null,
  category        text,                        -- ex.: 'capilar' | 'facial' | 'corporal' | 'injetável'…
  sessions_planned int not null default 1,
  interval_days   int,                         -- intervalo sugerido entre sessões
  default_price   numeric,
  description     text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists treatment_protocols_tenant_idx
  on public.treatment_protocols (tenant_id, active, name);

-- 2) Protocolo do paciente (vínculo com o lead do CRM)
create table if not exists public.lead_treatment_protocols (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default public.current_tenant_id() references public.tenants (id),
  lead_id          text not null references public.leads (id) on delete cascade,
  protocol_id      uuid references public.treatment_protocols (id),
  name             text not null,              -- snapshot do nome na atribuição
  sessions_planned int not null default 1,     -- snapshot (ajustável por paciente)
  price            numeric,
  status           text not null default 'ativo', -- 'ativo' | 'pausado' | 'concluido' | 'cancelado'
  started_on       date not null default current_date,
  finished_on      date,
  note             text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists lead_treatment_protocols_lead_idx
  on public.lead_treatment_protocols (tenant_id, lead_id);
create index if not exists lead_treatment_protocols_status_idx
  on public.lead_treatment_protocols (tenant_id, status, created_at desc);

-- 3) Sessões realizadas
create table if not exists public.lead_protocol_sessions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default public.current_tenant_id() references public.tenants (id),
  lead_protocol_id uuid not null references public.lead_treatment_protocols (id) on delete cascade,
  session_number   int not null,
  performed_on     date not null default current_date,
  performed_by     text,
  note             text,
  created_at       timestamptz not null default now(),
  unique (tenant_id, lead_protocol_id, session_number)
);
create index if not exists lead_protocol_sessions_protocol_idx
  on public.lead_protocol_sessions (tenant_id, lead_protocol_id, session_number);

-- 4) RLS — mesmo padrão das tabelas do estoque
do $$
declare t text;
begin
  foreach t in array array[
    'treatment_protocols', 'lead_treatment_protocols', 'lead_protocol_sessions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s tenant read" on public.%I', t, t);
    execute format('create policy "%s tenant read" on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant insert" on public.%I', t, t);
    execute format('create policy "%s tenant insert" on public.%I for insert to authenticated with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant update" on public.%I', t, t);
    execute format('create policy "%s tenant update" on public.%I for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant delete" on public.%I', t, t);
    execute format('create policy "%s tenant delete" on public.%I for delete to authenticated using (tenant_id = public.current_tenant_id())', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 5) Funil "PROTOCOLOS DE TRATAMENTO" (irmão do TRATAMENTO CAPILAR).
-- session_replication_role: desativa triggers enforce_role_write/auto-stamp
-- durante o seed (migration roda sem JWT de app) — mesmo padrão dos seeds antigos.
set session_replication_role = 'replica';

insert into public.pipelines (id, tenant_id, name, board_config)
values (
  'pipeline-protocolos',
  'instituto-lorena',
  'PROTOCOLOS DE TRATAMENTO',
  '{"stageSlaMinutes": {"pt-novo": 20, "pt-avaliacao": 120, "pt-plano": 240, "pt-sessoes": 0, "pt-concluido": 0}}'::jsonb
)
on conflict (id) do nothing;

insert into public.pipeline_stages (id, tenant_id, pipeline_id, name, position) values
  ('pt-novo',      'instituto-lorena', 'pipeline-protocolos', 'Novo',                    0),
  ('pt-avaliacao', 'instituto-lorena', 'pipeline-protocolos', 'Avaliação',               1),
  ('pt-plano',     'instituto-lorena', 'pipeline-protocolos', 'Plano e orçamento',       2),
  ('pt-sessoes',   'instituto-lorena', 'pipeline-protocolos', 'Em protocolo (sessões)',  3),
  ('pt-concluido', 'instituto-lorena', 'pipeline-protocolos', 'Protocolo concluído',     4)
on conflict (id) do nothing;

-- Follow-ups do funil novo (mesmo tom do funil capilar)
insert into public.crm_followup_configs (tenant_id, pipeline_id, day_number, message_template, enabled)
select 'instituto-lorena', v.pipeline_id, v.day_number, v.message_template, v.enabled
from (
  values
    ('pipeline-protocolos', 1, '{{name}}, como está se sentindo com o protocolo? Precisa de algo da equipe?', true::boolean),
    ('pipeline-protocolos', 3, '{{name}}, quer agendar a próxima sessão ou tirar dúvidas sobre o protocolo?', true),
    ('pipeline-protocolos', 5, '{{name}}, seguimos disponíveis. Responda quando puder.', true)
) as v(pipeline_id, day_number, message_template, enabled)
where not exists (
  select 1 from public.crm_followup_configs c
  where c.pipeline_id = v.pipeline_id and c.day_number = v.day_number
);

set session_replication_role = 'origin';
