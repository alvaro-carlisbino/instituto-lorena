-- =============================================================================
-- Phase 2 — Tabela `tenant_integrations` (whitelabel multi-tenant)
-- =============================================================================
-- A tabela `tenant_integrations` já existia parcialmente no remoto (criada fora
-- do tracking de migrations, com colunas `manychat` e `evolution`). Esta migration
-- é IDEMPOTENTE: cria a tabela se não existir, adiciona a coluna `llm`, garante
-- PK/FK, popula a linha vazia por tenant, habilita RLS e cria o helper SQL.
--
-- Estratégia: secrets globais (env) continuam sendo fallback. Quando um tenant
-- preenche `tenant_integrations.llm.zai.api_key` ou `manychat.api_key`, as edge
-- functions usam a credencial dele. O Instituto Lorena continua intocado.
-- =============================================================================

-- === Tabela ===
create table if not exists public.tenant_integrations (
  tenant_id text primary key,
  manychat jsonb not null default '{}'::jsonb,
  evolution jsonb not null default '{}'::jsonb,
  llm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Adiciona `llm` se a tabela já existir sem ela.
alter table public.tenant_integrations
  add column if not exists llm jsonb not null default '{}'::jsonb;

-- Garante FK para tenants (caso a tabela tenha sido criada sem ela).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_integrations_tenant_id_fkey'
      and conrelid = 'public.tenant_integrations'::regclass
  ) then
    alter table public.tenant_integrations
      add constraint tenant_integrations_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade;
  end if;
end$$;

comment on table public.tenant_integrations is
  'Credenciais e config de integrações externas por tenant. Quando vazio, edge functions usam os secrets globais como fallback.';
comment on column public.tenant_integrations.manychat is
  'Config ManyChat: {api_key, instagram:{field_id,flow_ns,message_tag}, whatsapp:{...}}';
comment on column public.tenant_integrations.evolution is
  'Config Evolution API (WhatsApp): {base_url, api_key, default_instance}';
comment on column public.tenant_integrations.llm is
  'Config LLMs por provider: {zai:{api_key,model,api_root}, openai:{api_key,model}}';

-- === Trigger de updated_at (reaproveita função criada na Phase 0) ===
drop trigger if exists tenant_integrations_set_updated_at on public.tenant_integrations;
create trigger tenant_integrations_set_updated_at
  before update on public.tenant_integrations
  for each row execute function public._tenants_set_updated_at();

-- === Seed: linha vazia para todo tenant existente ===
insert into public.tenant_integrations (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

-- === RLS ===
alter table public.tenant_integrations enable row level security;

drop policy if exists "tenant_integrations read own" on public.tenant_integrations;
create policy "tenant_integrations read own"
  on public.tenant_integrations for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists "tenant_integrations upsert own" on public.tenant_integrations;
create policy "tenant_integrations upsert own"
  on public.tenant_integrations for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "tenant_integrations update own" on public.tenant_integrations;
create policy "tenant_integrations update own"
  on public.tenant_integrations for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

grant select, insert, update on public.tenant_integrations to authenticated;
grant all on public.tenant_integrations to service_role;

-- === Helper `tenant_llm_config(provider)` ===
create or replace function public.tenant_llm_config(p_tenant_id text, p_provider text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(llm -> p_provider, '{}'::jsonb)
    from public.tenant_integrations
   where tenant_id = p_tenant_id
$$;

revoke all on function public.tenant_llm_config(text, text) from public;
grant execute on function public.tenant_llm_config(text, text) to service_role;
