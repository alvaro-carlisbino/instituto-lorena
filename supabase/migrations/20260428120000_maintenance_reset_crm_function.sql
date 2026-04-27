-- Função de manutenção: o SQL Editor corre sem JWT de app, por isso os triggers
-- enforce_role_write() bloqueiam DELETE em leads. session_replication_role = replica
-- desativa esses triggers durante a operação (padrão PostgreSQL).

create or replace function public.maintenance_reset_crm_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  set local session_replication_role = 'replica';

  truncate public.crm_assistant_threads cascade;

  truncate public.webhook_jobs restart identity;

  delete from public.leads;

  truncate public.audit_logs restart identity;

  set local session_replication_role = 'origin';
end;
$$;

comment on function public.maintenance_reset_crm_data() is
  'Apaga leads, interações (cascade), mídias, fila webhooks, threads assistente e audit_logs. Apenas manutenção.';

revoke all on function public.maintenance_reset_crm_data() from public;
grant execute on function public.maintenance_reset_crm_data() to postgres;
grant execute on function public.maintenance_reset_crm_data() to service_role;
