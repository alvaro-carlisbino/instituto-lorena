-- can_manage_users() cannot SELECT permission_profiles under RLS: the table's
-- FOR ALL policy calls can_manage_users() again → infinite recursion → 500.
-- Read the flag via SECURITY DEFINER (bypasses RLS for this lookup only).

create or replace function public.permission_profile_can_manage_users_for_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select pp.can_manage_users
      from public.permission_profiles pp
      where lower(pp.role) = lower(trim(p_role))
      limit 1
    ),
    false
  );
$$;

revoke all on function public.permission_profile_can_manage_users_for_role(text) from public;
grant execute on function public.permission_profile_can_manage_users_for_role(text) to authenticated;
grant execute on function public.permission_profile_can_manage_users_for_role(text) to service_role;

create or replace function public.can_manage_users()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() = 'admin'
    or public.permission_profile_can_manage_users_for_role(public.current_profile_role());
$$;
