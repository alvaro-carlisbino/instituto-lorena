-- Configurable CRM: custom lead fields, board config, channel mapping, layouts, data views, org settings, app user email.

alter table public.leads add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.workflow_fields add column if not exists field_key text;
alter table public.workflow_fields add column if not exists section text not null default '';
alter table public.workflow_fields add column if not exists sort_order int not null default 0;
alter table public.workflow_fields add column if not exists visible_in text[] not null default array['kanban_card','lead_detail','list','capture_form']::text[];
alter table public.workflow_fields add column if not exists validation jsonb not null default '{}'::jsonb;

update public.workflow_fields set field_key = id where field_key is null or trim(field_key) = '';

alter table public.workflow_fields alter column field_key set not null;

create unique index if not exists workflow_fields_field_key_lower_idx on public.workflow_fields (lower(field_key));

alter table public.pipelines add column if not exists board_config jsonb not null default '{}'::jsonb;

alter table public.channel_configs add column if not exists driver text not null default 'manual';
alter table public.channel_configs add column if not exists field_mapping jsonb not null default '{}'::jsonb;
alter table public.channel_configs add column if not exists credentials_ref text not null default '';

alter table public.tv_widgets add column if not exists layout jsonb not null default '{}'::jsonb;
alter table public.tv_widgets add column if not exists widget_config jsonb not null default '{}'::jsonb;

alter table public.dashboard_widgets add column if not exists layout jsonb not null default '{}'::jsonb;
alter table public.dashboard_widgets add column if not exists widget_config jsonb not null default '{}'::jsonb;

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

insert into public.org_settings (id) values ('default')
on conflict (id) do nothing;

alter table public.app_users add column if not exists email text not null default '';
alter table public.app_users add column if not exists auth_user_id uuid references auth.users (id) on delete set null;

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

  if tg_table_name in ('pipelines', 'pipeline_stages', 'workflow_fields', 'data_views', 'org_settings') and not public.can_edit_boards() then
    raise exception 'forbidden: requires can_edit_boards';
  end if;

  if tg_table_name in ('leads', 'interactions', 'channel_configs', 'metric_configs', 'notification_rules', 'tv_widgets', 'dashboard_widgets')
    and not public.can_route_leads() then
    raise exception 'forbidden: requires can_route_leads';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_data_views on public.data_views;
create trigger audit_data_views after insert or update or delete on public.data_views for each row execute function public.log_audit();

drop trigger if exists audit_org_settings on public.org_settings;
create trigger audit_org_settings after insert or update or delete on public.org_settings for each row execute function public.log_audit();

drop trigger if exists enforce_data_views on public.data_views;
create trigger enforce_data_views before insert or update or delete on public.data_views for each row execute function public.enforce_role_write();

drop trigger if exists enforce_org_settings on public.org_settings;
create trigger enforce_org_settings before insert or update or delete on public.org_settings for each row execute function public.enforce_role_write();

alter table public.data_views enable row level security;
alter table public.org_settings enable row level security;

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
