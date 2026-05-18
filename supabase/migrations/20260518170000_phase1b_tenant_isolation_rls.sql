-- =============================================================================
-- Phase 1B — Isolamento de tenants via RLS (cutover)
-- =============================================================================
-- Adiciona UMA policy `AS RESTRICTIVE` por tabela tenant-scoped:
--   USING (tenant_id = current_tenant_id())
--   WITH CHECK (tenant_id = current_tenant_id())
--
-- Policies restritivas são ANDed com as permissivas existentes — ou seja,
-- mantemos toda a lógica de permissões antiga (can_route_leads, can_edit_boards,
-- can_manage_users, etc.) e adicionamos por cima o filtro de tenant. Tem que
-- passar nos dois: ter o role correto E pertencer ao mesmo tenant da linha.
--
-- service_role mantém BYPASSRLS, então as Edge Functions (webhooks) continuam
-- escrevendo livremente. A garantia de tenant correto vem do auto-stamp trigger
-- da Fase 1A.
--
-- Com apenas o tenant 'instituto-lorena' hoje, esta migration é no-op funcional —
-- todas as queries continuam vendo as mesmas linhas. O ganho aparece quando o
-- segundo tenant for criado.
-- =============================================================================

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
    -- Garante RLS ligada (todas as tenant-scoped já têm, mas idempotente)
    execute format('alter table public.%I enable row level security', t);

    -- Recria a policy restritiva (idempotente)
    execute format('drop policy if exists "tenant_isolation" on public.%I', t);
    execute format(
      'create policy "tenant_isolation" on public.%I as restrictive for all to public using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())',
      t
    );
  end loop;
end$$;
