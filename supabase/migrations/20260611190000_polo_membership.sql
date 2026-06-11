-- =============================================================================
-- Polos — unidades de negócio do MESMO grupo dentro de um único app.
-- =============================================================================
-- Instituto Lorena (clínica) e Tricopill (vendas) são polos irmãos. Reaproveita
-- a infra multi-tenant (tenant = polo) para ISOLAMENTO real por RLS, mas é uso
-- INTERNO — não é SaaS/whitelabel. Requisito: o MESMO login pode pertencer a
-- vários polos e ALTERNAR entre eles numa visão unificada.
--
-- Tudo aditivo e à prova de falha: a nova current_tenant_id() faz FALLBACK ao
-- comportamento legado (app_users.tenant_id), então o acesso da clínica que já
-- está em produção nunca quebra, mesmo que memberships estejam incompletas.
-- =============================================================================

-- 1) Tipo de polo (governa a navegação: clínica mostra Agenda/Prontuário; vendas não).
alter table public.tenants
  add column if not exists polo_type text not null default 'clinic';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_polo_type_check') then
    alter table public.tenants add constraint tenants_polo_type_check
      check (polo_type in ('clinic', 'sales'));
  end if;
end $$;

-- 2) Pertencimento: auth user ↔ vários polos.
create table if not exists public.tenant_members (
  tenant_id text not null references public.tenants(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, auth_user_id)
);
create index if not exists tenant_members_user_idx on public.tenant_members(auth_user_id);

alter table public.tenant_members enable row level security;
drop policy if exists "tenant_members read own" on public.tenant_members;
create policy "tenant_members read own" on public.tenant_members
  for select to authenticated using (auth_user_id = auth.uid());
grant select on public.tenant_members to authenticated;
grant all on public.tenant_members to service_role;

-- Backfill: cada app_user vira membro do seu tenant atual.
insert into public.tenant_members (tenant_id, auth_user_id, role)
select au.tenant_id, au.auth_user_id, coalesce(au.role, 'member')
  from public.app_users au
 where au.auth_user_id is not null
on conflict (tenant_id, auth_user_id) do nothing;

-- 3) Polo ativo por usuário (null => fallback ao tenant_id legado).
alter table public.app_users
  add column if not exists active_tenant_id text references public.tenants(id);

-- 4) current_tenant_id(): respeita o polo ativo SE o usuário for membro; senão, legado.
create or replace function public.current_tenant_id()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select au.active_tenant_id from public.app_users au
      where au.auth_user_id = auth.uid()
        and au.active_tenant_id is not null
        and exists (select 1 from public.tenant_members m
                     where m.auth_user_id = auth.uid()
                       and m.tenant_id = au.active_tenant_id)
      limit 1),
    (select au.tenant_id from public.app_users au
      where au.auth_user_id = auth.uid()
      limit 1)
  );
$$;
revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_tenant_id() to service_role;

-- 5) tenants: o usuário pode LER qualquer polo do qual é membro (seletor + branding).
drop policy if exists "tenants read own" on public.tenants;
drop policy if exists "tenants read member" on public.tenants;
create policy "tenants read member" on public.tenants
  for select to authenticated
  using (exists (select 1 from public.tenant_members m
                  where m.auth_user_id = auth.uid() and m.tenant_id = tenants.id));

-- 6) my_tenants(): polos acessíveis ao usuário logado (popula o seletor de polo).
create or replace function public.my_tenants()
returns table(id text, name text, brand_config jsonb, polo_type text, is_active boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.brand_config, t.polo_type,
         (t.id = public.current_tenant_id()) as is_active
    from public.tenants t
   where t.active
     and exists (select 1 from public.tenant_members m
                  where m.auth_user_id = auth.uid() and m.tenant_id = t.id)
   order by t.name;
$$;
revoke all on function public.my_tenants() from public;
grant execute on function public.my_tenants() to authenticated;

-- 7) set_active_tenant(): troca o polo ativo (checa pertencimento). RLS segue na hora.
create or replace function public.set_active_tenant(p_tenant_id text)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  if not exists (select 1 from public.tenant_members m
                  where m.auth_user_id = v_uid and m.tenant_id = p_tenant_id) then
    raise exception 'sem acesso ao polo %', p_tenant_id;
  end if;
  update public.app_users set active_tenant_id = p_tenant_id where auth_user_id = v_uid;
  return p_tenant_id;
end;
$$;
revoke all on function public.set_active_tenant(text) from public;
grant execute on function public.set_active_tenant(text) to authenticated;

-- 8) Instituto Lorena = clínica (default já é 'clinic'; explícito por clareza).
update public.tenants set polo_type = 'clinic' where id = 'instituto-lorena';

-- 9) Cria o polo Tricopill (vendas) + estrutura padrão + linha de integrações.
insert into public.tenants (id, name, brand_config, polo_type, active)
values (
  'tricopill', 'Tricopill',
  jsonb_build_object(
    'app_name', 'Tricopill',
    'logo_url', null,
    'primary_color', '#16a34a',
    'accent_color', '#22c55e',
    'support_phone', '+5544999067665',
    'support_email', null
  ),
  'sales', true
)
on conflict (id) do nothing;

-- Seed de VENDAS inline (não usamos seed_tenant_defaults: é clínico e há overloads
-- ambíguos no banco). IDs prefixados com 'tricopill__' (PKs são TEXT globais).
-- session_replication_role='replica' desliga os triggers de permissão (can_edit_boards
-- etc.) e de auto-stamp durante o seed — a migration roda sem JWT de app.
set session_replication_role = 'replica';

insert into public.pipelines (id, tenant_id, name)
values ('tricopill__pipeline-vendas', 'tricopill', 'Vendas')
on conflict (id) do nothing;

insert into public.pipeline_stages (id, tenant_id, pipeline_id, name, position)
values
  ('tricopill__vd-novo',        'tricopill', 'tricopill__pipeline-vendas', 'Novo',          1),
  ('tricopill__vd-conversando', 'tricopill', 'tricopill__pipeline-vendas', 'Conversando',   2),
  ('tricopill__vd-proposta',    'tricopill', 'tricopill__pipeline-vendas', 'Proposta',      3),
  ('tricopill__vd-pago',        'tricopill', 'tricopill__pipeline-vendas', 'Pago',          4),
  ('tricopill__vd-perdido',     'tricopill', 'tricopill__pipeline-vendas', 'Perdido',       5)
on conflict (id) do nothing;

insert into public.workflow_fields (id, tenant_id, field_key, label, field_type, required, section, sort_order, visible_in, options, validation)
values
  ('tricopill__wf-name',  'tricopill', 'patient_name', 'Nome',              'text',  true,  'Identificação', 1, array['kanban_card','lead_detail','list','capture_form']::text[], '[]'::jsonb, '{}'::jsonb),
  ('tricopill__wf-phone', 'tricopill', 'phone',        'Telefone/WhatsApp', 'tel',   true,  'Identificação', 2, array['kanban_card','lead_detail','list','capture_form']::text[], '[]'::jsonb, '{}'::jsonb),
  ('tricopill__wf-email', 'tricopill', 'email',        'E-mail',            'email', false, 'Identificação', 3, array['lead_detail','capture_form']::text[],                  '[]'::jsonb, '{}'::jsonb),
  ('tricopill__wf-kit',   'tricopill', 'kit_escolhido','Kit de interesse',  'text',  false, 'Venda',         10, array['kanban_card','lead_detail']::text[],                   '[]'::jsonb, '{}'::jsonb),
  ('tricopill__wf-obs',   'tricopill', 'observacoes',  'Observações',       'textarea', false, 'Operacional', 20, array['lead_detail']::text[],                                 '[]'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.lead_tag_definitions (id, tenant_id, name, color)
values
  ('tricopill__tag-quente', 'tricopill', 'Quente', '#ef4444'),
  ('tricopill__tag-morno',  'tricopill', 'Morno',  '#f59e0b'),
  ('tricopill__tag-frio',   'tricopill', 'Frio',   '#3b82f6')
on conflict (id) do nothing;

insert into public.crm_ai_configs (id, tenant_id) values ('default', 'tricopill')
on conflict (tenant_id, id) do nothing;

insert into public.org_settings (id, tenant_id) values ('default', 'tricopill')
on conflict (tenant_id, id) do nothing;

insert into public.tenant_integrations (tenant_id) values ('tricopill')
on conflict (tenant_id) do nothing;

set session_replication_role = 'origin';

-- 10) Todos os usuários do Instituto Lorena também acessam o Tricopill
--     (requisito: o mesmo login vê tudo). Para restringir por usuário depois,
--     basta remover linhas de public.tenant_members.
insert into public.tenant_members (tenant_id, auth_user_id, role)
select 'tricopill', au.auth_user_id, au.role
  from public.app_users au
 where au.tenant_id = 'instituto-lorena' and au.auth_user_id is not null
on conflict (tenant_id, auth_user_id) do nothing;
