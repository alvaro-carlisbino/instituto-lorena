-- Remove apenas os 3 leads de demonstração inseridos por seedDemoData (ids fixos do mock).
create or replace function public.maintenance_delete_seed_demo_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  set local session_replication_role = 'replica';

  delete from public.leads
  where id in ('lead-001', 'lead-002', 'lead-003');

  get diagnostics n = row_count;

  set local session_replication_role = 'origin';
  return coalesce(n, 0);
end;
$$;

comment on function public.maintenance_delete_seed_demo_leads() is
  'Apaga os 3 leads de demonstração (Mariana, Paulo, Renata). Interações e mídias em cascade.';

revoke all on function public.maintenance_delete_seed_demo_leads() from public;
grant execute on function public.maintenance_delete_seed_demo_leads() to postgres;
grant execute on function public.maintenance_delete_seed_demo_leads() to service_role;
