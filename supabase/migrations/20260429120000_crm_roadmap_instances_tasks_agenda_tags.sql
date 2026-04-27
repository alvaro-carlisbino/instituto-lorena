-- === WhatsApp channel instances (Evolution) ===
create table if not exists public.whatsapp_channel_instances (
  id text primary key,
  label text not null,
  evolution_instance_name text not null,
  phone_e164 text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (evolution_instance_name)
);

alter table public.leads
  add column if not exists whatsapp_instance_id text references public.whatsapp_channel_instances(id) on delete set null;

create index if not exists leads_whatsapp_instance_id_idx on public.leads(whatsapp_instance_id);

-- === Lead tasks: ordering + attachments ===
alter table public.lead_tasks
  add column if not exists sort_order int not null default 0;

create table if not exists public.lead_task_attachments (
  id uuid primary key default gen_random_uuid(),
  lead_task_id text not null references public.lead_tasks(id) on delete cascade,
  storage_path text not null,
  file_name text not null default '',
  mime_type text,
  file_size int,
  created_at timestamptz not null default now()
);

create index if not exists lead_task_attachments_task_id_idx on public.lead_task_attachments(lead_task_id);

-- === Rooms & appointments (internal calendar) ===
create table if not exists public.rooms (
  id text primary key,
  name text not null,
  active boolean not null default true,
  slot_minutes int not null default 30,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id text primary key,
  lead_id text not null references public.leads(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('draft', 'confirmed', 'cancelled')),
  attendance_status text not null default 'expected' check (attendance_status in ('expected', 'checked_in', 'no_show')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_lead_id_idx on public.appointments(lead_id);
create index if not exists appointments_starts_at_idx on public.appointments(starts_at);
create index if not exists appointments_room_time_idx on public.appointments(room_id, starts_at, ends_at);

-- First free slot: returns first room + interval within window (day bounds passed from caller)
create or replace function public.find_first_appointment_slot(
  p_starts_on date,
  p_ends_on date,
  p_duration_minutes int
)
returns table (room_id text, slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
as $$
declare
  d date;
  step interval := (greatest(5, p_duration_minutes) || ' minutes')::interval;
  day_start timestamptz;
  day_end timestamptz;
  r record;
  cand_start timestamptz;
  cand_end timestamptz;
  tz text;
  overlap_exists boolean;
begin
  select coalesce((select timezone from public.org_settings where id = 'default' limit 1), 'America/Sao_Paulo') into tz;

  d := p_starts_on;
  while d <= p_ends_on loop
    day_start := (d::text || ' 00:00:00')::timestamp at time zone tz;
    day_end := (d::text || ' 23:59:59')::timestamp at time zone tz;

    for r in
      select rm.id as rid, rm.slot_minutes
      from public.rooms rm
      where rm.active = true
      order by rm.sort_order, rm.name
    loop
      cand_start := day_start;
      while cand_start + (greatest(r.slot_minutes, p_duration_minutes) || ' minutes')::interval <= day_end + interval '1 second' loop
        cand_end := cand_start + (p_duration_minutes || ' minutes')::interval;

        select exists(
          select 1 from public.appointments a
          where a.room_id = r.rid
            and a.status <> 'cancelled'
            and a.starts_at < cand_end
            and a.ends_at > cand_start
        ) into overlap_exists;

        if not overlap_exists then
          room_id := r.rid;
          slot_start := cand_start;
          slot_end := cand_end;
          return next;
          return;
        end if;

        cand_start := cand_start + step;
      end loop;
    end loop;

    d := d + 1;
  end loop;

  return;
end;
$$;

revoke all on function public.find_first_appointment_slot(date, date, int) from public;
grant execute on function public.find_first_appointment_slot(date, date, int) to authenticated;
grant execute on function public.find_first_appointment_slot(date, date, int) to service_role;

-- === In-app notifications (per auth user) ===
create table if not exists public.app_inbox_notifications (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text not null,
  read_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists app_inbox_notifications_user_created_idx
  on public.app_inbox_notifications(auth_user_id, created_at desc);

-- === Lead tags (M:N) ===
create table if not exists public.lead_tag_definitions (
  id text primary key,
  name text not null,
  color text not null default '#6366f1',
  created_at timestamptz not null default now()
);

create table if not exists public.lead_tag_assignments (
  lead_id text not null references public.leads(id) on delete cascade,
  tag_id text not null references public.lead_tag_definitions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lead_id, tag_id)
);

create index if not exists lead_tag_assignments_tag_id_idx on public.lead_tag_assignments(tag_id);

-- RLS
alter table public.whatsapp_channel_instances enable row level security;
alter table public.lead_task_attachments enable row level security;
alter table public.rooms enable row level security;
alter table public.appointments enable row level security;
alter table public.app_inbox_notifications enable row level security;
alter table public.lead_tag_definitions enable row level security;
alter table public.lead_tag_assignments enable row level security;

drop policy if exists "wa_instances read auth" on public.whatsapp_channel_instances;
create policy "wa_instances read auth"
  on public.whatsapp_channel_instances for select
  to authenticated
  using (true);

drop policy if exists "wa_instances manage" on public.whatsapp_channel_instances;
create policy "wa_instances manage"
  on public.whatsapp_channel_instances for all
  to authenticated
  using (public.can_manage_users())
  with check (public.can_manage_users());

drop policy if exists "lead_task_attachments read" on public.lead_task_attachments;
create policy "lead_task_attachments read"
  on public.lead_task_attachments for select
  to authenticated
  using (true);

drop policy if exists "lead_task_attachments route" on public.lead_task_attachments;
create policy "lead_task_attachments route"
  on public.lead_task_attachments for all
  to authenticated
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "rooms read" on public.rooms;
create policy "rooms read"
  on public.rooms for select to authenticated using (true);

drop policy if exists "rooms route" on public.rooms;
create policy "rooms route"
  on public.rooms for all
  to authenticated
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "appointments read" on public.appointments;
create policy "appointments read"
  on public.appointments for select
  to authenticated
  using (true);

drop policy if exists "appointments route" on public.appointments;
create policy "appointments route"
  on public.appointments for all
  to authenticated
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "inbox notifs own" on public.app_inbox_notifications;
create policy "inbox notifs own"
  on public.app_inbox_notifications for all
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- In-app: only own rows; inserts via service_role (edge). No enforce_role_write on this table
-- so users can mark read without can_route_leads.

drop policy if exists "lead_tag_defs read" on public.lead_tag_definitions;
create policy "lead_tag_defs read"
  on public.lead_tag_definitions for select to authenticated using (true);

drop policy if exists "lead_tag_defs route" on public.lead_tag_definitions;
create policy "lead_tag_defs route"
  on public.lead_tag_definitions for all
  to authenticated
  using (public.can_route_leads())
  with check (public.can_route_leads());

drop policy if exists "lead_tag_assign read" on public.lead_tag_assignments;
create policy "lead_tag_assign read"
  on public.lead_tag_assignments for select to authenticated using (true);

drop policy if exists "lead_tag_assign route" on public.lead_tag_assignments;
create policy "lead_tag_assign route"
  on public.lead_tag_assignments for all
  to authenticated
  using (public.can_route_leads())
  with check (public.can_route_leads());

-- Extend enforce_role_write for new domain tables
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

  if tg_table_name in ('app_users', 'permission_profiles', 'whatsapp_channel_instances') and not public.can_manage_users() then
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
    'tv_widgets', 'dashboard_widgets', 'lead_tasks', 'survey_dispatches', 'survey_responses',
    'lead_task_attachments', 'rooms', 'appointments', 'lead_tag_definitions', 'lead_tag_assignments'
  ) and not public.can_route_leads() then
    raise exception 'forbidden: requires can_route_leads';
  end if;

  return coalesce(new, old);
end;
$$;

-- Audit / enforce triggers
drop trigger if exists enforce_whatsapp_channel_instances on public.whatsapp_channel_instances;
create trigger enforce_whatsapp_channel_instances
  before insert or update or delete on public.whatsapp_channel_instances
  for each row execute function public.enforce_role_write();

drop trigger if exists enforce_lead_task_attachments on public.lead_task_attachments;
create trigger enforce_lead_task_attachments
  before insert or update or delete on public.lead_task_attachments
  for each row execute function public.enforce_role_write();

drop trigger if exists enforce_rooms on public.rooms;
create trigger enforce_rooms
  before insert or update or delete on public.rooms
  for each row execute function public.enforce_role_write();

drop trigger if exists enforce_appointments on public.appointments;
create trigger enforce_appointments
  before insert or update or delete on public.appointments
  for each row execute function public.enforce_role_write();

drop trigger if exists enforce_lead_tag_definitions on public.lead_tag_definitions;
create trigger enforce_lead_tag_definitions
  before insert or update or delete on public.lead_tag_definitions
  for each row execute function public.enforce_role_write();

drop trigger if exists enforce_lead_tag_assignments on public.lead_tag_assignments;
create trigger enforce_lead_tag_assignments
  before insert or update or delete on public.lead_tag_assignments
  for each row execute function public.enforce_role_write();

-- Storage: lead task attachments
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-lead-attachments', 'crm-lead-attachments', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "crm_lead_att insert" on storage.objects;
create policy "crm_lead_att insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-lead-attachments');

drop policy if exists "crm_lead_att select" on storage.objects;
create policy "crm_lead_att select"
  on storage.objects for select to authenticated
  using (bucket_id = 'crm-lead-attachments');

drop policy if exists "crm_lead_att update" on storage.objects;
create policy "crm_lead_att update"
  on storage.objects for update to authenticated
  using (bucket_id = 'crm-lead-attachments')
  with check (bucket_id = 'crm-lead-attachments');

drop policy if exists "crm_lead_att delete" on storage.objects;
create policy "crm_lead_att delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'crm-lead-attachments');

-- Seed: uma sala padrão e uma etiqueta de exemplo (idempotente)
-- Desliga triggers de perfil: migração corre sem JWT de utilizador
alter table public.rooms disable trigger enforce_rooms;
insert into public.rooms (id, name, active, slot_minutes, sort_order)
values ('room-1', 'Sala 1', true, 30, 0)
on conflict (id) do nothing;
alter table public.rooms enable trigger enforce_rooms;

alter table public.lead_tag_definitions disable trigger enforce_lead_tag_definitions;
insert into public.lead_tag_definitions (id, name, color)
values ('tag-vip', 'VIP', '#a855f7')
on conflict (id) do nothing;
alter table public.lead_tag_definitions enable trigger enforce_lead_tag_definitions;
