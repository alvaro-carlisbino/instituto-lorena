create table if not exists public.app_users (
  id text primary key,
  name text not null,
  role text not null,
  active boolean not null default true,
  email text not null default '',
  auth_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_profiles (
  auth_user_id uuid primary key,
  email text not null,
  display_name text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipelines (
  id text primary key,
  name text not null,
  board_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_stages (
  id text primary key,
  pipeline_id text not null references public.pipelines(id) on delete cascade,
  name text not null,
  position int not null,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id text primary key,
  patient_name text not null,
  phone text not null,
  source text not null,
  created_at timestamptz not null,
  position int not null default 1,
  score int not null,
  temperature text not null,
  owner_id text not null references public.app_users(id),
  pipeline_id text not null references public.pipelines(id),
  stage_id text not null references public.pipeline_stages(id),
  summary text not null,
  custom_fields jsonb not null default '{}'::jsonb
);

create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references public.leads(id) on delete cascade,
  patient_name text not null,
  channel text not null,
  direction text not null,
  author text not null,
  content text not null,
  happened_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.channel_configs (
  id text primary key,
  name text not null,
  enabled boolean not null default true,
  sla_minutes int not null default 15,
  auto_reply boolean not null default false,
  priority int not null default 1,
  driver text not null default 'manual',
  field_mapping jsonb not null default '{}'::jsonb,
  credentials_ref text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.metric_configs (
  id text primary key,
  label text not null,
  value numeric not null default 0,
  target numeric not null default 0,
  unit text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_fields (
  id text primary key,
  label text not null,
  field_type text not null,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  field_key text not null,
  section text not null default '',
  sort_order int not null default 0,
  visible_in text[] not null default array['kanban_card','lead_detail','list','capture_form']::text[],
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workflow_fields_field_key_lower_idx on public.workflow_fields (lower(field_key));

create table if not exists public.permission_profiles (
  id text primary key,
  role text not null,
  can_edit_boards boolean not null default false,
  can_route_leads boolean not null default false,
  can_manage_users boolean not null default false,
  can_view_tv_panel boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_rules (
  id text primary key,
  name text not null,
  channel text not null,
  enabled boolean not null default true,
  trigger text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tv_widgets (
  id text primary key,
  title text not null,
  widget_type text not null,
  metric_key text not null,
  enabled boolean not null default true,
  position int not null default 1,
  layout jsonb not null default '{}'::jsonb,
  widget_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dashboard_widgets (
  id text primary key,
  title text not null,
  metric_key text not null,
  enabled boolean not null default true,
  position int not null default 1,
  layout jsonb not null default '{}'::jsonb,
  widget_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_views (
  id text primary key,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_settings (
  id text primary key,
  timezone text not null default 'America/Sao_Paulo',
  date_format text not null default 'dd/MM/yyyy',
  week_starts_on int not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.org_settings (id) values ('default') on conflict (id) do nothing;

alter table public.leads add column if not exists position int not null default 1;
alter table public.leads add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text not null,
  target_table text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'queued',
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_tasks (
  id text primary key,
  lead_id text not null references public.leads(id) on delete cascade,
  title text not null,
  assignee_id text references public.app_users(id) on delete set null,
  due_at timestamptz,
  status text not null default 'open',
  task_type text not null default 'follow_up',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_rules (
  id text primary key,
  name text not null,
  enabled boolean not null default true,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  action_type text not null,
  action_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_templates (
  id text primary key,
  name text not null,
  nps_question text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.survey_dispatches (
  id text primary key,
  template_id text not null references public.survey_templates(id) on delete cascade,
  lead_id text not null references public.leads(id) on delete cascade,
  sent_at timestamptz not null default now(),
  channel text not null default 'in_app',
  created_at timestamptz not null default now()
);

create table if not exists public.survey_responses (
  id text primary key,
  dispatch_id text not null references public.survey_dispatches(id) on delete cascade,
  score int not null,
  comment text,
  responded_at timestamptz not null default now()
);

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.app_profiles where auth_user_id = auth.uid() limit 1),
    'sdr'
  );
$$;

-- Lookup permission_profiles without RLS (avoids recursion: can_manage_users → SELECT permission_profiles → policy → can_manage_users).
create or replace function public.permission_profile_can_manage_users_for_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select pp.can_manage_users
      from public.permission_profiles pp
      where lower(pp.role) = lower(trim(p_role))
      limit 1
    ),
    false
  );
$$;

revoke all on function public.permission_profile_can_manage_users_for_role(text) from public;
grant execute on function public.permission_profile_can_manage_users_for_role(text) to authenticated;
grant execute on function public.permission_profile_can_manage_users_for_role(text) to service_role;

create or replace function public.can_manage_users()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() = 'admin'
    or public.permission_profile_can_manage_users_for_role(public.current_profile_role());
$$;

create or replace function public.can_route_leads()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() in ('admin', 'gestor');
$$;

create or replace function public.can_edit_boards()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() in ('admin', 'gestor');
$$;

create or replace function public.can_view_tv_panel()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() in ('admin', 'gestor', 'sdr');
$$;

-- Deduplication for webhook: match lead by digits-only phone.
create or replace function public.find_lead_id_by_phone_digits(p_digits text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.leads l
  where length(p_digits) >= 10
    and regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = p_digits
  limit 1
$$;

revoke all on function public.find_lead_id_by_phone_digits(text) from public;
grant execute on function public.find_lead_id_by_phone_digits(text) to service_role;

create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.audit_logs (actor_id, actor_email, action, target_table, target_id, metadata)
  values (
    auth.uid(),
    auth.jwt() ->> 'email',
    tg_op,
    tg_table_name,
    coalesce(new.id::text, old.id::text),
    case
      when tg_op = 'DELETE' then jsonb_build_object('old', to_jsonb(old))
      when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      else jsonb_build_object('new', to_jsonb(new))
    end
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_role_write()
returns trigger
language plpgsql
security definer
as $$
declare
  is_service_role boolean;
begin
  is_service_role := coalesce((auth.jwt() ->> 'role') = 'service_role', false);

  if is_service_role then
    return coalesce(new, old);
  end if;

  if tg_table_name in ('app_users', 'permission_profiles') and not public.can_manage_users() then
    raise exception 'forbidden: requires can_manage_users';
  end if;

  if tg_table_name in (
    'pipelines', 'pipeline_stages', 'workflow_fields', 'data_views', 'org_settings',
    'automation_rules', 'survey_templates'
  ) and not public.can_edit_boards() then
    raise exception 'forbidden: requires can_edit_boards';
  end if;

  if tg_table_name in (
    'leads', 'interactions', 'channel_configs', 'metric_configs', 'notification_rules',
    'tv_widgets', 'dashboard_widgets', 'lead_tasks', 'survey_dispatches', 'survey_responses'
  ) and not public.can_route_leads() then
    raise exception 'forbidden: requires can_route_leads';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_app_users on public.app_users;
create trigger audit_app_users after insert or update or delete on public.app_users for each row execute function public.log_audit();

drop trigger if exists audit_pipelines on public.pipelines;
create trigger audit_pipelines after insert or update or delete on public.pipelines for each row execute function public.log_audit();

drop trigger if exists audit_pipeline_stages on public.pipeline_stages;
create trigger audit_pipeline_stages after insert or update or delete on public.pipeline_stages for each row execute function public.log_audit();

drop trigger if exists audit_channel_configs on public.channel_configs;
create trigger audit_channel_configs after insert or update or delete on public.channel_configs for each row execute function public.log_audit();

drop trigger if exists audit_metric_configs on public.metric_configs;
create trigger audit_metric_configs after insert or update or delete on public.metric_configs for each row execute function public.log_audit();

drop trigger if exists audit_workflow_fields on public.workflow_fields;
create trigger audit_workflow_fields after insert or update or delete on public.workflow_fields for each row execute function public.log_audit();

drop trigger if exists audit_permission_profiles on public.permission_profiles;
create trigger audit_permission_profiles after insert or update or delete on public.permission_profiles for each row execute function public.log_audit();

drop trigger if exists audit_notification_rules on public.notification_rules;
create trigger audit_notification_rules after insert or update or delete on public.notification_rules for each row execute function public.log_audit();

drop trigger if exists audit_tv_widgets on public.tv_widgets;
create trigger audit_tv_widgets after insert or update or delete on public.tv_widgets for each row execute function public.log_audit();

drop trigger if exists audit_dashboard_widgets on public.dashboard_widgets;
create trigger audit_dashboard_widgets after insert or update or delete on public.dashboard_widgets for each row execute function public.log_audit();

drop trigger if exists audit_data_views on public.data_views;
create trigger audit_data_views after insert or update or delete on public.data_views for each row execute function public.log_audit();

drop trigger if exists audit_org_settings on public.org_settings;
create trigger audit_org_settings after insert or update or delete on public.org_settings for each row execute function public.log_audit();

drop trigger if exists audit_webhook_jobs on public.webhook_jobs;
create trigger audit_webhook_jobs after insert or update or delete on public.webhook_jobs for each row execute function public.log_audit();

drop trigger if exists enforce_app_users on public.app_users;
create trigger enforce_app_users before insert or update or delete on public.app_users for each row execute function public.enforce_role_write();

drop trigger if exists enforce_pipelines on public.pipelines;
create trigger enforce_pipelines before insert or update or delete on public.pipelines for each row execute function public.enforce_role_write();

drop trigger if exists enforce_pipeline_stages on public.pipeline_stages;
create trigger enforce_pipeline_stages before insert or update or delete on public.pipeline_stages for each row execute function public.enforce_role_write();

drop trigger if exists enforce_leads on public.leads;
create trigger enforce_leads before insert or update or delete on public.leads for each row execute function public.enforce_role_write();

drop trigger if exists enforce_interactions on public.interactions;
create trigger enforce_interactions before insert or update or delete on public.interactions for each row execute function public.enforce_role_write();

drop trigger if exists enforce_channel_configs on public.channel_configs;
create trigger enforce_channel_configs before insert or update or delete on public.channel_configs for each row execute function public.enforce_role_write();

drop trigger if exists enforce_metric_configs on public.metric_configs;
create trigger enforce_metric_configs before insert or update or delete on public.metric_configs for each row execute function public.enforce_role_write();

drop trigger if exists enforce_workflow_fields on public.workflow_fields;
create trigger enforce_workflow_fields before insert or update or delete on public.workflow_fields for each row execute function public.enforce_role_write();

drop trigger if exists enforce_permission_profiles on public.permission_profiles;
create trigger enforce_permission_profiles before insert or update or delete on public.permission_profiles for each row execute function public.enforce_role_write();

drop trigger if exists enforce_notification_rules on public.notification_rules;
create trigger enforce_notification_rules before insert or update or delete on public.notification_rules for each row execute function public.enforce_role_write();

drop trigger if exists enforce_tv_widgets on public.tv_widgets;
create trigger enforce_tv_widgets before insert or update or delete on public.tv_widgets for each row execute function public.enforce_role_write();

drop trigger if exists enforce_dashboard_widgets on public.dashboard_widgets;
create trigger enforce_dashboard_widgets before insert or update or delete on public.dashboard_widgets for each row execute function public.enforce_role_write();

drop trigger if exists enforce_data_views on public.data_views;
create trigger enforce_data_views before insert or update or delete on public.data_views for each row execute function public.enforce_role_write();

drop trigger if exists enforce_org_settings on public.org_settings;
create trigger enforce_org_settings before insert or update or delete on public.org_settings for each row execute function public.enforce_role_write();

drop trigger if exists enforce_lead_tasks on public.lead_tasks;
create trigger enforce_lead_tasks before insert or update or delete on public.lead_tasks for each row execute function public.enforce_role_write();

drop trigger if exists enforce_automation_rules on public.automation_rules;
create trigger enforce_automation_rules before insert or update or delete on public.automation_rules for each row execute function public.enforce_role_write();

drop trigger if exists enforce_survey_templates on public.survey_templates;
create trigger enforce_survey_templates before insert or update or delete on public.survey_templates for each row execute function public.enforce_role_write();

drop trigger if exists enforce_survey_dispatches on public.survey_dispatches;
create trigger enforce_survey_dispatches before insert or update or delete on public.survey_dispatches for each row execute function public.enforce_role_write();

drop trigger if exists enforce_survey_responses on public.survey_responses;
create trigger enforce_survey_responses before insert or update or delete on public.survey_responses for each row execute function public.enforce_role_write();

alter table public.app_users enable row level security;
alter table public.app_profiles enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.interactions enable row level security;
alter table public.channel_configs enable row level security;
alter table public.metric_configs enable row level security;
alter table public.workflow_fields enable row level security;
alter table public.permission_profiles enable row level security;
alter table public.notification_rules enable row level security;
alter table public.tv_widgets enable row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.data_views enable row level security;
alter table public.org_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.webhook_jobs enable row level security;
alter table public.lead_tasks enable row level security;
alter table public.automation_rules enable row level security;
alter table public.survey_templates enable row level security;
alter table public.survey_dispatches enable row level security;
alter table public.survey_responses enable row level security;

drop policy if exists "profiles self select" on public.app_profiles;
drop policy if exists "profiles self upsert" on public.app_profiles;
drop policy if exists "profiles self update" on public.app_profiles;
drop policy if exists "profiles admin manage" on public.app_profiles;
create policy "profiles self select"
  on public.app_profiles
  for select
  using (auth.uid() = auth_user_id or public.current_profile_role() = 'admin');
create policy "profiles self upsert"
  on public.app_profiles
  for insert
  with check (auth.uid() = auth_user_id and role = 'sdr');
create policy "profiles self update"
  on public.app_profiles
  for update
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);
create policy "profiles admin manage"
  on public.app_profiles
  for all
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

drop policy if exists "app users read auth" on public.app_users;
drop policy if exists "app users admin manage" on public.app_users;
create policy "app users read auth"
  on public.app_users
  for select
  using (auth.role() = 'authenticated');
create policy "app users admin manage"
  on public.app_users
  for all
  using (public.can_manage_users())
  with check (public.can_manage_users());

drop policy if exists "pipelines read auth" on public.pipelines;
drop policy if exists "pipelines edit boards" on public.pipelines;
create policy "pipelines read auth"
  on public.pipelines
  for select
  using (auth.role() = 'authenticated');
create policy "pipelines edit boards"
  on public.pipelines
  for all
  using (public.can_edit_boards())
  with check (public.can_edit_boards());

drop policy if exists "pipeline stages read auth" on public.pipeline_stages;
drop policy if exists "pipeline stages edit boards" on public.pipeline_stages;
create policy "pipeline stages read auth"
  on public.pipeline_stages
  for select
  using (auth.role() = 'authenticated');
create policy "pipeline stages edit boards"
  on public.pipeline_stages
  for all
  using (public.can_edit_boards())
  with check (public.can_edit_boards());

drop policy if exists "leads read auth" on public.leads;
drop policy if exists "leads route manage" on public.leads;
create policy "leads read auth"
  on public.leads
  for select
  using (auth.role() = 'authenticated');
create policy "leads route manage"
  on public.leads
  for all
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "interactions read auth" on public.interactions;
drop policy if exists "interactions route manage" on public.interactions;
create policy "interactions read auth"
  on public.interactions
  for select
  using (auth.role() = 'authenticated');
create policy "interactions route manage"
  on public.interactions
  for all
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "channels read auth" on public.channel_configs;
drop policy if exists "channels route manage" on public.channel_configs;
create policy "channels read auth"
  on public.channel_configs
  for select
  using (auth.role() = 'authenticated');
create policy "channels route manage"
  on public.channel_configs
  for all
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "metrics read auth" on public.metric_configs;
drop policy if exists "metrics route manage" on public.metric_configs;
create policy "metrics read auth"
  on public.metric_configs
  for select
  using (auth.role() = 'authenticated');
create policy "metrics route manage"
  on public.metric_configs
  for all
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "workflow read auth" on public.workflow_fields;
drop policy if exists "workflow edit boards" on public.workflow_fields;
create policy "workflow read auth"
  on public.workflow_fields
  for select
  using (auth.role() = 'authenticated');
create policy "workflow edit boards"
  on public.workflow_fields
  for all
  using (public.can_edit_boards())
  with check (public.can_edit_boards());

drop policy if exists "data_views read auth" on public.data_views;
drop policy if exists "data_views edit boards" on public.data_views;
create policy "data_views read auth"
  on public.data_views
  for select
  using (auth.role() = 'authenticated');
create policy "data_views edit boards"
  on public.data_views
  for all
  using (public.can_edit_boards())
  with check (public.can_edit_boards());

drop policy if exists "org_settings read auth" on public.org_settings;
drop policy if exists "org_settings edit boards" on public.org_settings;
create policy "org_settings read auth"
  on public.org_settings
  for select
  using (auth.role() = 'authenticated');
create policy "org_settings edit boards"
  on public.org_settings
  for all
  using (public.can_edit_boards())
  with check (public.can_edit_boards());

drop policy if exists "lead_tasks read auth" on public.lead_tasks;
drop policy if exists "lead_tasks route manage" on public.lead_tasks;
create policy "lead_tasks read auth" on public.lead_tasks for select using (auth.role() = 'authenticated');
create policy "lead_tasks route manage" on public.lead_tasks for all using (public.can_route_leads()) with check (public.can_route_leads());

drop policy if exists "automation_rules read auth" on public.automation_rules;
drop policy if exists "automation_rules edit boards" on public.automation_rules;
create policy "automation_rules read auth" on public.automation_rules for select using (auth.role() = 'authenticated');
create policy "automation_rules edit boards" on public.automation_rules for all using (public.can_edit_boards()) with check (public.can_edit_boards());

drop policy if exists "survey_templates read auth" on public.survey_templates;
drop policy if exists "survey_templates edit boards" on public.survey_templates;
create policy "survey_templates read auth" on public.survey_templates for select using (auth.role() = 'authenticated');
create policy "survey_templates edit boards" on public.survey_templates for all using (public.can_edit_boards()) with check (public.can_edit_boards());

drop policy if exists "survey_dispatches read auth" on public.survey_dispatches;
drop policy if exists "survey_dispatches route manage" on public.survey_dispatches;
create policy "survey_dispatches read auth" on public.survey_dispatches for select using (auth.role() = 'authenticated');
create policy "survey_dispatches route manage" on public.survey_dispatches for all using (public.can_route_leads()) with check (public.can_route_leads());

drop policy if exists "survey_responses read auth" on public.survey_responses;
drop policy if exists "survey_responses route manage" on public.survey_responses;
create policy "survey_responses read auth" on public.survey_responses for select using (auth.role() = 'authenticated');
create policy "survey_responses route manage" on public.survey_responses for all using (public.can_route_leads()) with check (public.can_route_leads());

drop policy if exists "permissions read auth" on public.permission_profiles;
drop policy if exists "permissions admin manage" on public.permission_profiles;
create policy "permissions read auth"
  on public.permission_profiles
  for select
  using (auth.role() = 'authenticated');
create policy "permissions admin manage"
  on public.permission_profiles
  for all
  using (public.can_manage_users())
  with check (public.can_manage_users());

drop policy if exists "notifications read auth" on public.notification_rules;
drop policy if exists "notifications route manage" on public.notification_rules;
create policy "notifications read auth"
  on public.notification_rules
  for select
  using (auth.role() = 'authenticated');
create policy "notifications route manage"
  on public.notification_rules
  for all
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "tv widgets read panel" on public.tv_widgets;
drop policy if exists "tv widgets route manage" on public.tv_widgets;
create policy "tv widgets read panel"
  on public.tv_widgets
  for select
  using (public.can_view_tv_panel());
create policy "tv widgets route manage"
  on public.tv_widgets
  for all
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "dashboard widgets read auth" on public.dashboard_widgets;
drop policy if exists "dashboard widgets route manage" on public.dashboard_widgets;
create policy "dashboard widgets read auth"
  on public.dashboard_widgets
  for select
  using (auth.role() = 'authenticated');
create policy "dashboard widgets route manage"
  on public.dashboard_widgets
  for all
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "audit logs admin read" on public.audit_logs;
create policy "audit logs admin read"
  on public.audit_logs
  for select
  using (public.can_manage_users());

drop policy if exists "audit logs insert by session user" on public.audit_logs;
create policy "audit logs insert by session user"
  on public.audit_logs
  for insert
  with check (actor_id is not null and actor_id = auth.uid());

drop policy if exists "webhook jobs admin read" on public.webhook_jobs;
drop policy if exists "webhook jobs admin write" on public.webhook_jobs;
create policy "webhook jobs admin read"
  on public.webhook_jobs
  for select
  using (public.can_manage_users());
create policy "webhook jobs admin write"
  on public.webhook_jobs
  for all
  using (public.can_manage_users())
  with check (public.can_manage_users());

drop policy if exists "public read app_users" on public.app_users;
drop policy if exists "public write app_users" on public.app_users;
drop policy if exists "public read app_profiles" on public.app_profiles;
drop policy if exists "public write app_profiles" on public.app_profiles;
drop policy if exists "public read pipelines" on public.pipelines;
drop policy if exists "public write pipelines" on public.pipelines;
drop policy if exists "public read pipeline_stages" on public.pipeline_stages;
drop policy if exists "public write pipeline_stages" on public.pipeline_stages;
drop policy if exists "public read leads" on public.leads;
drop policy if exists "public write leads" on public.leads;
drop policy if exists "public read interactions" on public.interactions;
drop policy if exists "public write interactions" on public.interactions;
drop policy if exists "public read channel_configs" on public.channel_configs;
drop policy if exists "public write channel_configs" on public.channel_configs;
drop policy if exists "public read metric_configs" on public.metric_configs;
drop policy if exists "public write metric_configs" on public.metric_configs;
drop policy if exists "public read workflow_fields" on public.workflow_fields;
drop policy if exists "public write workflow_fields" on public.workflow_fields;
drop policy if exists "public read permission_profiles" on public.permission_profiles;
drop policy if exists "public write permission_profiles" on public.permission_profiles;
drop policy if exists "public read notification_rules" on public.notification_rules;
drop policy if exists "public write notification_rules" on public.notification_rules;
drop policy if exists "public read tv_widgets" on public.tv_widgets;
drop policy if exists "public write tv_widgets" on public.tv_widgets;
drop policy if exists "public read dashboard_widgets" on public.dashboard_widgets;
drop policy if exists "public write dashboard_widgets" on public.dashboard_widgets;
