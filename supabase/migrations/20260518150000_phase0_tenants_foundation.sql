-- =============================================================================
-- Phase 0 — Multi-tenant foundations (aditiva, non-breaking)
-- =============================================================================
-- Cria a tabela `tenants`, liga cada `app_users` a um tenant e expõe o helper
-- `current_tenant_id()` para o restante do código.
--
-- Nesta fase NADA das tabelas de domínio (leads, interactions, etc.) ganha
-- `tenant_id` — isso fica para a Fase 1, depois desta migração estar verificada
-- em produção. O objetivo aqui é desbloquear o frontend para ler branding
-- por tenant e firmar o contrato `current_tenant_id()` que a Fase 1 vai usar.
--
-- Roteamento: o tenant vem do usuário logado (app_users.tenant_id), não da URL.
-- O path `/t/:slug` é cosmético; o filtro real de dados na Fase 1 será via RLS
-- usando `current_tenant_id()`.
-- =============================================================================

create table if not exists public.tenants (
  id text primary key,
  name text not null,
  brand_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed do tenant atual. Tudo o que existe hoje pertence a 'instituto-lorena'.
insert into public.tenants (id, name, brand_config)
values (
  'instituto-lorena',
  'Instituto Lorena Visentainer',
  jsonb_build_object(
    'app_name', 'Instituto Lorena CRM',
    'logo_url', null,
    'primary_color', '#0ea5e9',
    'accent_color', '#22d3ee',
    'support_phone', null,
    'support_email', null
  )
)
on conflict (id) do nothing;

-- === app_users.tenant_id ===
-- Coluna nullable na criação para que o backfill seja seguro, depois NOT NULL.
-- session_replication_role = replica desativa o trigger enforce_role_write durante
-- o backfill (a migration roda sem JWT, então can_manage_users() é false).
alter table public.app_users
  add column if not exists tenant_id text references public.tenants(id) on delete restrict;

set session_replication_role = 'replica';
update public.app_users
   set tenant_id = 'instituto-lorena'
 where tenant_id is null;
set session_replication_role = 'origin';

alter table public.app_users alter column tenant_id set not null;

create index if not exists app_users_tenant_id_idx on public.app_users(tenant_id);

-- === current_tenant_id() — identifica o tenant do usuário autenticado ===
-- SECURITY DEFINER porque precisamos consultar app_users mesmo quando a RLS
-- da Fase 1 restringir as próprias linhas — caso contrário entramos em loop.
create or replace function public.current_tenant_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.app_users
  where auth_user_id = auth.uid()
  limit 1
$$;

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_tenant_id() to service_role;

-- === RLS de tenants ===
alter table public.tenants enable row level security;

drop policy if exists "tenants read own" on public.tenants;
create policy "tenants read own"
  on public.tenants for select
  to authenticated
  using (id = public.current_tenant_id());

-- Por enquanto não definimos policy de escrita: tenants são gerenciados
-- via service_role (Fase 3 traz o role `super_admin` e o CRUD na UI).

grant select on public.tenants to authenticated;
grant all on public.tenants to service_role;

-- === Trigger de updated_at em tenants ===
create or replace function public._tenants_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public._tenants_set_updated_at();
