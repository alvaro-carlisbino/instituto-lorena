-- =============================================================================
-- Sprint 1 — Analytics, motivo de perda, exclusão de métricas, toggle auto-scheduling
-- =============================================================================
-- (1) leads.lost_reason  — código já lê (crmSupabase.ts), mas coluna não existia.
--     Bug latente em produção. Adiciona como text nullable.
-- (2) leads.excluded_from_metrics — flag por lead pra equipe/fornecedor (não
--     contam em dashboard nem em workload de SDR).
-- (3) leads.stage_entered_at — quando o lead entrou na etapa atual. Trigger
--     BEFORE UPDATE atualiza ao mover entre etapas. Permite "tempo na etapa".
-- (4) crm_ai_configs.auto_scheduling_enabled — feature flag por tenant.
--     Default false (Lorena fica desligada como é hoje). Outros tenants podem
--     ligar via Settings → IA.
-- =============================================================================

-- === (1) lost_reason ===
alter table public.leads
  add column if not exists lost_reason text null;
comment on column public.leads.lost_reason is
  'Motivo de perda do lead. Usado em analytics quando o lead chega em etapa "perdida". Livre ou enum-like do frontend.';

-- === (2) excluded_from_metrics ===
alter table public.leads
  add column if not exists excluded_from_metrics boolean not null default false;
comment on column public.leads.excluded_from_metrics is
  'Quando true, este lead não conta em dashboards, conversões nem em workload de SDR. Usado para classificar equipe/fornecedor/teste.';

create index if not exists leads_excluded_from_metrics_idx
  on public.leads(tenant_id)
  where excluded_from_metrics = false;

-- === (3) stage_entered_at ===
alter table public.leads
  add column if not exists stage_entered_at timestamptz not null default now();
comment on column public.leads.stage_entered_at is
  'Carimba quando o lead entrou na etapa atual. Trigger atualiza ao mover entre etapas. Permite cálculo de tempo na etapa.';

-- Backfill: pra leads existentes, usa updated_at se houver, senão created_at, senão now().
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='leads' and column_name='updated_at'
  ) then
    execute $sql$
      update public.leads
         set stage_entered_at = coalesce(updated_at, created_at, now())
       where stage_entered_at = now()::timestamptz
         and updated_at is not null
    $sql$;
  end if;
end$$;

create or replace function public._stamp_lead_stage_entered_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists leads_stamp_stage_entered_at on public.leads;
create trigger leads_stamp_stage_entered_at
  before update on public.leads
  for each row execute function public._stamp_lead_stage_entered_at();

-- === (4) auto_scheduling_enabled ===
alter table public.crm_ai_configs
  add column if not exists auto_scheduling_enabled boolean not null default false;
comment on column public.crm_ai_configs.auto_scheduling_enabled is
  'Permite à IA chamar book_appointment automaticamente. Default false; cliente liga em Settings → IA. Lorena permanece desligada.';
