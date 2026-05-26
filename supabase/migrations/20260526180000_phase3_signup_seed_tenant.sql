-- =============================================================================
-- Phase 3 — Signup público + seed de tenant default (whitelabel multi-tenant)
-- =============================================================================
-- Permite que um usuário recém-cadastrado (auth.users) crie a própria clínica
-- (tenant + app_users + estruturas padrão) sem precisar de super_admin.
--
-- Funções:
--   - public.seed_tenant_defaults(p_new_tenant_id) — popula pipelines, stages,
--     workflow_fields, lead_tag_definitions, crm_ai_configs e org_settings com
--     defaults genéricos de clínica médica.
--   - public.signup_create_tenant(p_slug, p_name, p_brand) — chamada pelo wizard
--     de onboarding logo após auth.signUp. SECURITY DEFINER para bypassar a RLS
--     de tenants. Idempotente: se o auth user já tem tenant, devolve.
--
-- Estratégia de IDs: como `pipelines.id`, `pipeline_stages.id` etc. são TEXT
-- PRIMARY KEY globais, todos os IDs gerados aqui são prefixados com
-- `<tenant_slug>__` para evitar colisão entre clínicas.
-- =============================================================================

create or replace function public.seed_tenant_defaults(p_new_tenant_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := p_new_tenant_id || '__';
  v_pipeline_capt text := v_prefix || 'pipeline-captacao';
  v_pipeline_atend text := v_prefix || 'pipeline-atendimento';
begin
  if not exists (select 1 from public.tenants where id = p_new_tenant_id) then
    raise exception 'tenant % não existe', p_new_tenant_id;
  end if;

  -- Idempotência: se já tem pipelines, abortamos (seed só roda uma vez).
  if exists (select 1 from public.pipelines where tenant_id = p_new_tenant_id) then
    return;
  end if;

  -- === Pipelines + stages padrão ===
  insert into public.pipelines (id, tenant_id, name)
  values
    (v_pipeline_capt,  p_new_tenant_id, 'Captação'),
    (v_pipeline_atend, p_new_tenant_id, 'Atendimento')
  on conflict (id) do nothing;

  insert into public.pipeline_stages (id, tenant_id, pipeline_id, name, position)
  values
    (v_prefix || 'capt-novo',         p_new_tenant_id, v_pipeline_capt,  'Novo',         1),
    (v_prefix || 'capt-triagem',      p_new_tenant_id, v_pipeline_capt,  'Triagem',      2),
    (v_prefix || 'capt-qualificado',  p_new_tenant_id, v_pipeline_capt,  'Qualificado',  3),
    (v_prefix || 'capt-perdido',      p_new_tenant_id, v_pipeline_capt,  'Perdido',      4),
    (v_prefix || 'atend-agendado',    p_new_tenant_id, v_pipeline_atend, 'Agendado',     1),
    (v_prefix || 'atend-confirmado',  p_new_tenant_id, v_pipeline_atend, 'Confirmado',   2),
    (v_prefix || 'atend-realizado',   p_new_tenant_id, v_pipeline_atend, 'Realizado',    3),
    (v_prefix || 'atend-no-show',     p_new_tenant_id, v_pipeline_atend, 'No-show',      4)
  on conflict (id) do nothing;

  -- === Workflow fields padrão ===
  insert into public.workflow_fields (id, tenant_id, field_key, label, field_type, required, section, sort_order, visible_in, options, validation)
  values
    (v_prefix || 'wf-name',  p_new_tenant_id, 'patient_name',     'Nome',                'text',     true,  'Identificação', 1,  array['kanban_card','lead_detail','list','capture_form']::text[], '[]'::jsonb, '{}'::jsonb),
    (v_prefix || 'wf-phone', p_new_tenant_id, 'phone',            'Telefone/WhatsApp',   'tel',      true,  'Identificação', 2,  array['kanban_card','lead_detail','list','capture_form']::text[], '[]'::jsonb, '{}'::jsonb),
    (v_prefix || 'wf-email', p_new_tenant_id, 'email',            'E-mail',              'email',    false, 'Identificação', 3,  array['lead_detail','capture_form']::text[],                  '[]'::jsonb, '{}'::jsonb),
    (v_prefix || 'wf-tipo',  p_new_tenant_id, 'tipo_consulta',    'Tipo de consulta',    'text',     false, 'Comercial',     10, array['kanban_card','lead_detail','capture_form']::text[],    '[]'::jsonb, '{}'::jsonb),
    (v_prefix || 'wf-data',  p_new_tenant_id, 'data_preferida',   'Data preferida',      'date',     false, 'Comercial',     11, array['lead_detail','capture_form']::text[],                  '[]'::jsonb, '{}'::jsonb),
    (v_prefix || 'wf-prim',  p_new_tenant_id, 'primeira_consulta','Primeira consulta?',  'boolean',  false, 'Comercial',     12, array['lead_detail','capture_form']::text[],                  '[]'::jsonb, '{}'::jsonb),
    (v_prefix || 'wf-obs',   p_new_tenant_id, 'observacoes',      'Observações',         'textarea', false, 'Operacional',   20, array['lead_detail']::text[],                                  '[]'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  -- === Tags padrão ===
  insert into public.lead_tag_definitions (id, tenant_id, name, color)
  values
    (v_prefix || 'tag-quente',  p_new_tenant_id, 'Quente', '#ef4444'),
    (v_prefix || 'tag-morno',   p_new_tenant_id, 'Morno',  '#f59e0b'),
    (v_prefix || 'tag-frio',    p_new_tenant_id, 'Frio',   '#3b82f6'),
    (v_prefix || 'tag-vip',     p_new_tenant_id, 'VIP',    '#a855f7')
  on conflict (id) do nothing;

  -- === Config IA default (1 row id='default' por tenant; demais campos via DEFAULT) ===
  insert into public.crm_ai_configs (id, tenant_id)
  values ('default', p_new_tenant_id)
  on conflict (tenant_id, id) do nothing;

  -- === Org settings (1 row id='default' por tenant; demais campos via DEFAULT) ===
  insert into public.org_settings (id, tenant_id)
  values ('default', p_new_tenant_id)
  on conflict (tenant_id, id) do nothing;

  -- NOTA: crm_followup_configs não é seedada — cada row representa uma mensagem
  -- (day_number + template). Cliente configura via UI em Settings > Follow-up.
end;
$$;

revoke all on function public.seed_tenant_defaults(text) from public;
grant execute on function public.seed_tenant_defaults(text) to service_role;
-- authenticated não chama direto — só via signup_create_tenant.

-- === signup_create_tenant: ponte segura entre auth.signUp e tenant criado ===
create or replace function public.signup_create_tenant(
  p_slug text,
  p_name text,
  p_brand jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_slug text;
  v_existing_tenant text;
  v_user_id text;
begin
  if v_uid is null then
    raise exception 'signup_create_tenant: usuário não autenticado';
  end if;

  -- Idempotência: se o auth user já está vinculado a um tenant via app_users,
  -- devolvemos esse (não tentamos criar de novo).
  select tenant_id, id into v_existing_tenant, v_user_id
    from public.app_users
   where auth_user_id = v_uid
   limit 1;
  if v_existing_tenant is not null then
    return v_existing_tenant;
  end if;

  -- Normaliza slug.
  v_slug := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]', '-', 'g'));
  v_slug := regexp_replace(v_slug, '-+', '-', 'g');
  v_slug := regexp_replace(v_slug, '^-|-$', '', 'g');
  if length(v_slug) < 3 then
    raise exception 'slug inválido (mínimo 3 caracteres alfanuméricos após normalização)';
  end if;

  -- Se slug já existe, anexa sufixo random.
  while exists (select 1 from public.tenants where id = v_slug) loop
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  select email into v_email from auth.users where id = v_uid;

  insert into public.tenants (id, name, brand_config, active)
  values (v_slug, coalesce(nullif(trim(p_name), ''), v_slug), coalesce(p_brand, '{}'::jsonb), true);

  v_user_id := 'admin-' || substr(md5(v_uid::text), 1, 12);
  insert into public.app_users (id, tenant_id, name, email, role, active, auth_user_id)
  values (
    v_user_id,
    v_slug,
    coalesce(split_part(v_email, '@', 1), 'Admin'),
    coalesce(v_email, ''),
    'admin',
    true,
    v_uid
  );

  insert into public.app_profiles (auth_user_id, tenant_id, email, display_name, role)
  values (v_uid, v_slug, coalesce(v_email, ''), coalesce(split_part(v_email, '@', 1), 'Admin'), 'admin')
  on conflict (auth_user_id) do update
    set tenant_id = excluded.tenant_id,
        role = 'admin';

  perform public.seed_tenant_defaults(v_slug);

  insert into public.tenant_integrations (tenant_id) values (v_slug)
  on conflict (tenant_id) do nothing;

  return v_slug;
end;
$$;

revoke all on function public.signup_create_tenant(text, text, jsonb) from public;
grant execute on function public.signup_create_tenant(text, text, jsonb) to authenticated;
