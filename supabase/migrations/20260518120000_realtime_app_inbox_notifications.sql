-- Realtime para a sino de notificações in-app: avisa consultores imediatamente
-- quando a IA termina a triagem e marca o lead como `waiting_human`.

do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_inbox_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.app_inbox_notifications';
  end if;
end $migration$;
