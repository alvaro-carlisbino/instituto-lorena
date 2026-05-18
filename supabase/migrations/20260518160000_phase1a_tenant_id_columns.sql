-- =============================================================================
-- Phase 1A — tenant_id em todas as tabelas tenant-scoped (camada de dados)
-- =============================================================================
-- Adiciona coluna `tenant_id` (FK → tenants.id), faz backfill para
-- 'instituto-lorena', marca NOT NULL, cria índice e instala trigger
-- BEFORE INSERT que carimba o tenant_id do utilizador logado quando ausente.
--
-- Esta migration NÃO altera RLS — isso fica para a Fase 1B (cutover). Com
-- apenas um tenant existente hoje, todas as queries continuam vendo só dados
-- de 'instituto-lorena' mesmo sem o filtro tenant-aware nas policies.
--
-- session_replication_role = 'replica' desativa enforce_role_write e outros
-- triggers de segurança durante o backfill (a migration roda sem JWT de app).
-- =============================================================================

set session_replication_role = 'replica';

-- === Função de auto-stamp para INSERTs ===
-- Quando um INSERT chega sem tenant_id, tenta resolver via current_tenant_id()
-- (usuário logado). Se for service_role (webhook), cai temporariamente para
-- 'instituto-lorena' enquanto a Fase 2 não roteia webhooks por tenant.
create or replace function public._stamp_tenant_id()
returns trigger
language plpgsql
as $$
declare
  tid text;
begin
  if new.tenant_id is null then
    tid := public.current_tenant_id();
    if tid is null then
      tid := 'instituto-lorena';
    end if;
    new.tenant_id := tid;
  end if;
  return new;
end;
$$;

-- === Loop principal: 35 tabelas tenant-scoped ===
do $$
declare
  t text;
  tables text[] := array[
    'app_inbox_notifications',
    'app_profiles',
    'appointments',
    'audit_logs',
    'automation_rules',
    'channel_configs',
    'crm_ai_configs',
    'crm_assistant_messages',
    'crm_assistant_threads',
    'crm_conversation_states',
    'crm_followup_configs',
    'crm_lead_followup_state',
    'crm_media_items',
    'crm_quick_messages',
    'dashboard_widgets',
    'data_views',
    'interactions',
    'lead_tag_assignments',
    'lead_tag_definitions',
    'lead_task_attachments',
    'lead_tasks',
    'lead_wa_line_events',
    'leads',
    'metric_configs',
    'notification_rules',
    'org_settings',
    'pipeline_stages',
    'pipelines',
    'rooms',
    'survey_dispatches',
    'survey_responses',
    'survey_templates',
    'tv_widgets',
    'whatsapp_channel_instances',
    'workflow_fields'
  ];
begin
  foreach t in array tables loop
    -- 1) Adiciona coluna (idempotente)
    execute format(
      'alter table public.%I add column if not exists tenant_id text references public.tenants(id) on delete restrict',
      t
    );

    -- 2) Backfill — toda linha existente passa a pertencer a 'instituto-lorena'
    execute format(
      'update public.%I set tenant_id = ''instituto-lorena'' where tenant_id is null',
      t
    );

    -- 3) NOT NULL após backfill
    execute format(
      'alter table public.%I alter column tenant_id set not null',
      t
    );

    -- 4) Índice para queries filtradas
    execute format(
      'create index if not exists %I on public.%I(tenant_id)',
      t || '_tenant_id_idx',
      t
    );

    -- 5) Trigger auto-stamp
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_stamp_tenant_id',
      t
    );
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public._stamp_tenant_id()',
      t || '_stamp_tenant_id',
      t
    );
  end loop;
end$$;

-- =============================================================================
-- PKs compostas em tabelas singleton (id='default')
-- =============================================================================
-- org_settings, crm_ai_configs, crm_followup_configs e channel_configs hoje têm
-- uma única linha id='default'. Sem PK composta, um segundo tenant não conseguiria
-- ter sua própria linha 'default' (violação de UNIQUE). Como nenhuma FK aponta
-- pra essas tabelas, a troca é segura.
do $$
declare
  t text;
  singletons text[] := array[
    'org_settings',
    'crm_ai_configs',
    'crm_followup_configs',
    'channel_configs'
  ];
begin
  foreach t in array singletons loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      t,
      t || '_pkey'
    );
    execute format(
      'alter table public.%I add primary key (tenant_id, id)',
      t
    );
  end loop;
end$$;

set session_replication_role = 'origin';
