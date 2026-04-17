create table if not exists public.app_users (
  id text primary key,
  name text not null,
  role text not null,
  active boolean not null default true,
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
  score int not null,
  temperature text not null,
  owner_id text not null references public.app_users(id),
  pipeline_id text not null references public.pipelines(id),
  stage_id text not null references public.pipeline_stages(id),
  summary text not null
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

alter table public.app_users enable row level security;
alter table public.app_profiles enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.interactions enable row level security;

drop policy if exists "public read app_users" on public.app_users;
drop policy if exists "public read app_profiles" on public.app_profiles;
drop policy if exists "public read pipelines" on public.pipelines;
drop policy if exists "public read pipeline_stages" on public.pipeline_stages;
drop policy if exists "public read leads" on public.leads;
drop policy if exists "public read interactions" on public.interactions;

drop policy if exists "public write app_users" on public.app_users;
drop policy if exists "public write app_profiles" on public.app_profiles;
drop policy if exists "public write pipelines" on public.pipelines;
drop policy if exists "public write pipeline_stages" on public.pipeline_stages;
drop policy if exists "public write leads" on public.leads;
drop policy if exists "public write interactions" on public.interactions;

create policy "public read app_users" on public.app_users for select using (true);
create policy "public read app_profiles" on public.app_profiles for select using (true);
create policy "public read pipelines" on public.pipelines for select using (true);
create policy "public read pipeline_stages" on public.pipeline_stages for select using (true);
create policy "public read leads" on public.leads for select using (true);
create policy "public read interactions" on public.interactions for select using (true);

create policy "public write app_users" on public.app_users for all using (true) with check (true);
create policy "public write app_profiles" on public.app_profiles for all using (true) with check (true);
create policy "public write pipelines" on public.pipelines for all using (true) with check (true);
create policy "public write pipeline_stages" on public.pipeline_stages for all using (true) with check (true);
create policy "public write leads" on public.leads for all using (true) with check (true);
create policy "public write interactions" on public.interactions for all using (true) with check (true);
