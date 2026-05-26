-- =============================================================================
-- Sprint 3 — Campos de billing no tenants (Stripe-ready)
-- =============================================================================
-- Adiciona plano, status, vínculo Stripe, trial e período pago atual.
--
-- Status semântico:
--   - 'trial'     → trial gratuito ativo até trial_ends_at
--   - 'active'    → assinatura paga em dia
--   - 'past_due'  → falha no pagamento, dar prazo de cortesia
--   - 'suspended' → bloqueio total (gate de login)
--   - 'canceled'  → assinatura cancelada (acesso até period_end)
--
-- Plano:
--   - 'starter' | 'pro' | 'scale' | 'lifetime' (lifetime = Instituto Lorena legado)
--
-- Tabela `billing_events` registra cada webhook do Stripe pra auditoria.
-- =============================================================================

alter table public.tenants
  add column if not exists plan text not null default 'trial';
alter table public.tenants
  add column if not exists status text not null default 'trial';
alter table public.tenants
  add column if not exists stripe_customer_id text null;
alter table public.tenants
  add column if not exists stripe_subscription_id text null;
alter table public.tenants
  add column if not exists trial_ends_at timestamptz null;
alter table public.tenants
  add column if not exists current_period_ends_at timestamptz null;

-- Constraint: valores válidos (não vamos enum porque migrations futuras precisam liberdade).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_status_check'
  ) then
    alter table public.tenants
      add constraint tenants_status_check
      check (status in ('trial','active','past_due','suspended','canceled'));
  end if;
end$$;

-- Garante que tenants existentes não fiquem em trial pra sempre.
-- Instituto Lorena (cliente piloto) ganha plano 'lifetime' / status 'active'
-- pra não ser bloqueada por trial expirado.
update public.tenants
   set plan = 'lifetime', status = 'active'
 where id = 'instituto-lorena'
   and status = 'trial';

-- Default trial de 14 dias pra novos tenants criados via signup_create_tenant.
-- Patch da signup_create_tenant pra carimbar trial_ends_at.
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
    raise exception 'signup_create_tenant: usuario nao autenticado';
  end if;
  select tenant_id, id into v_existing_tenant, v_user_id
    from public.app_users
   where auth_user_id = v_uid
   limit 1;
  if v_existing_tenant is not null then
    return v_existing_tenant;
  end if;
  v_slug := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9-]', '-', 'g'));
  v_slug := regexp_replace(v_slug, '-+', '-', 'g');
  v_slug := regexp_replace(v_slug, '^-|-$', '', 'g');
  if length(v_slug) < 3 then
    raise exception 'slug invalido';
  end if;
  while exists (select 1 from public.tenants where id = v_slug) loop
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  end loop;
  select email into v_email from auth.users where id = v_uid;

  insert into public.tenants (id, name, brand_config, active, plan, status, trial_ends_at)
  values (
    v_slug,
    coalesce(nullif(trim(p_name), ''), v_slug),
    coalesce(p_brand, '{}'::jsonb),
    true,
    'trial',
    'trial',
    now() + interval '14 days'
  );

  v_user_id := 'admin-' || substr(md5(v_uid::text), 1, 12);
  insert into public.app_users (id, tenant_id, name, email, role, active, auth_user_id)
  values (
    v_user_id, v_slug,
    coalesce(split_part(v_email, '@', 1), 'Admin'),
    coalesce(v_email, ''),
    'admin', true, v_uid
  );
  insert into public.app_profiles (auth_user_id, tenant_id, email, display_name, role)
  values (v_uid, v_slug, coalesce(v_email, ''), coalesce(split_part(v_email, '@', 1), 'Admin'), 'admin')
  on conflict (auth_user_id) do update
    set tenant_id = excluded.tenant_id, role = 'admin';
  perform public.seed_tenant_defaults(v_slug);
  insert into public.tenant_integrations (tenant_id) values (v_slug)
  on conflict (tenant_id) do nothing;
  return v_slug;
end;
$$;

-- Tabela de eventos Stripe (auditoria + idempotência via event_id).
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  tenant_id text null references public.tenants(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists billing_events_tenant_idx on public.billing_events(tenant_id);

alter table public.billing_events enable row level security;
-- Só service_role lê/escreve (webhook). Não há UI pra usuários ainda.
drop policy if exists "billing_events service only" on public.billing_events;
create policy "billing_events service only"
  on public.billing_events for all
  to service_role
  using (true) with check (true);
grant all on public.billing_events to service_role;

-- Helper pro frontend: status de billing do tenant atual.
create or replace function public.current_tenant_billing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plan', t.plan,
    'status', t.status,
    'trial_ends_at', t.trial_ends_at,
    'current_period_ends_at', t.current_period_ends_at,
    'has_stripe', t.stripe_customer_id is not null
  )
  from public.tenants t
  where t.id = public.current_tenant_id()
  limit 1
$$;

grant execute on function public.current_tenant_billing() to authenticated;
