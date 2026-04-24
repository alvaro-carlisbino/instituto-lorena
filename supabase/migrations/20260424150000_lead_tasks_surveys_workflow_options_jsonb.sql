-- workflow_fields.options: text[] -> jsonb (suporta { "value", "label" } e strings legadas)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workflow_fields'
      and column_name = 'options' and udt_name = '_text'
  ) then
    alter table public.workflow_fields alter column options drop default;
    alter table public.workflow_fields
      alter column options type jsonb using coalesce(to_jsonb(options), '[]'::jsonb);
    alter table public.workflow_fields alter column options set default '[]'::jsonb;
  end if;
end $$;

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

alter table public.lead_tasks enable row level security;
alter table public.automation_rules enable row level security;
alter table public.survey_templates enable row level security;
alter table public.survey_dispatches enable row level security;
alter table public.survey_responses enable row level security;

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
