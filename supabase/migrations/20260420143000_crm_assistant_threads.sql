-- Histórico do assistente CRM: conversas por utilizador autenticado (RLS).

create table if not exists public.crm_assistant_threads (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  context jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.crm_assistant_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists crm_assistant_threads_user_updated_idx
  on public.crm_assistant_threads (auth_user_id, updated_at desc);

create index if not exists crm_assistant_messages_thread_created_idx
  on public.crm_assistant_messages (thread_id, created_at asc);

alter table public.crm_assistant_threads enable row level security;
alter table public.crm_assistant_messages enable row level security;

drop policy if exists "crm_assistant_threads own all" on public.crm_assistant_threads;
create policy "crm_assistant_threads own all"
  on public.crm_assistant_threads
  for all
  to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

drop policy if exists "crm_assistant_messages own via thread" on public.crm_assistant_messages;
create policy "crm_assistant_messages own via thread"
  on public.crm_assistant_messages
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.crm_assistant_threads t
      where t.id = thread_id and t.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.crm_assistant_threads t
      where t.id = thread_id and t.auth_user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.crm_assistant_threads to authenticated;
grant select, insert, update, delete on public.crm_assistant_messages to authenticated;
