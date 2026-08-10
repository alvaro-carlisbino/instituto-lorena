-- 20 policies liberavam `using (true)` para QUALQUER authenticated. Como policies
-- permissivas são OR, esse `true` engolia o tenant_isolation que existe ao lado —
-- inclusive em whatsapp_channel_instances, que guarda token/credencial de linha.
--
-- Hoje isso é "só" vazamento entre polos (5 usuários, todos da casa). Vira grave no
-- momento em que o app do paciente existir: paciente é `authenticated` também, e
-- passaria a ler mídia de conversa, anexo, config de IA e token de WhatsApp.
--
-- Correção conservadora: `true` vira "é da equipe" (tem vínculo em tenant_members).
-- Os 5 auth.users atuais têm 9 vínculos — nenhum usuário de hoje perde nada.
-- Deixar tenant-estrito (trocar por tenant_id = current_tenant_id()) é decisão
-- separada, com blast radius no CRM; não é feito aqui de propósito.

create or replace function public.is_staff_user()
returns boolean
language sql
stable
security definer                       -- evita recursão de RLS em tenant_members
set search_path = public
as $fn$
  select exists (
    select 1 from public.tenant_members m where m.auth_user_id = auth.uid()
  )
$fn$;

revoke all on function public.is_staff_user() from public, anon;
grant execute on function public.is_staff_user() to authenticated, service_role;

-- SELECT abertos -> só equipe
do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and 'authenticated' = any(roles)
      and cmd = 'SELECT'
      and btrim(lower(coalesce(qual, ''))) in ('true', '(true)')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_staff_user())',
      r.policyname, r.tablename);
  end loop;
end $$;

-- ALL abertos -> só equipe (duplicados exatos caem fora)
drop policy if exists "Allow all for followup configs"          on public.crm_followup_configs;
drop policy if exists "Allow all for lead followup state"       on public.crm_lead_followup_state;
drop policy if exists "Allow all for quick messages"            on public.crm_quick_messages;

do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and 'authenticated' = any(roles)
      and cmd = 'ALL'
      and btrim(lower(coalesce(qual, ''))) in ('true', '(true)')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user())',
      r.policyname, r.tablename);
  end loop;
end $$;
