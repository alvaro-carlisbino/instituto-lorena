-- Align can_manage_users() with permission_profiles (same idea as the app UI).
-- Fixes 400 on app_users when a gestor (or other role) has can_manage_users in permission_profiles.

create or replace function public.can_manage_users()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() = 'admin'
    or coalesce(
      (
        select pp.can_manage_users
        from public.permission_profiles pp
        where lower(pp.role) = lower(public.current_profile_role())
        limit 1
      ),
      false
    );
$$;
