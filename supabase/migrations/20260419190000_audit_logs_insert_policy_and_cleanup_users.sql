-- 1) audit_logs: política de INSERT para o trigger log_audit (sessões autenticadas).
drop policy if exists "audit logs insert by session user" on public.audit_logs;
create policy "audit logs insert by session user"
  on public.audit_logs
  for insert
  with check (actor_id is not null and actor_id = auth.uid());

-- 2) Limpeza one-off (sem JWT na migração): desliga todos os triggers de utilizador em app_users/leads.
alter table public.app_users disable trigger user;
alter table public.leads disable trigger user;

do $$
declare
  keeper_email constant text := 'alvaromathe123@gmail.com';
  keeper_id text;
  v_auth uuid;
  v_display text;
  v_email text;
  v_role text;
begin
  select au.id
    into keeper_id
  from public.app_users au
  where lower(au.email) = lower(keeper_email)
  limit 1;

  if keeper_id is null then
    select ap.auth_user_id, ap.display_name, ap.email, ap.role::text
      into v_auth, v_display, v_email, v_role
    from public.app_profiles ap
    where lower(ap.email) = lower(keeper_email)
    limit 1;

    if v_auth is null then
      raise notice 'cleanup: sem app_users nem app_profiles para % — nada feito.', keeper_email;
    else
      keeper_id := 'user-' || left(replace(v_auth::text, '-', ''), 16);

      insert into public.app_users (id, name, email, role, active, auth_user_id)
      values (
        keeper_id,
        coalesce(nullif(trim(v_display), ''), split_part(v_email, '@', 1)),
        v_email,
        case lower(trim(v_role))
          when 'admin' then 'admin'
          when 'gestor' then 'gestor'
          else 'sdr'
        end,
        true,
        v_auth
      )
      on conflict (id) do update set
        email = excluded.email,
        name = excluded.name,
        role = excluded.role,
        active = excluded.active,
        auth_user_id = excluded.auth_user_id;
    end if;
  end if;

  if keeper_id is not null then
    update public.leads
    set owner_id = keeper_id
    where owner_id is distinct from keeper_id;

    delete from public.app_users
    where id is distinct from keeper_id;

    delete from public.app_profiles
    where lower(email) is distinct from lower(keeper_email);
  end if;
end $$;

alter table public.leads enable trigger user;
alter table public.app_users enable trigger user;
