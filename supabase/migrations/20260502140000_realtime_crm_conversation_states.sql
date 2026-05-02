-- Eventos Realtime para modo IA/humano na UI (ChatWorkspace / modal).

do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crm_conversation_states'
  ) then
    execute 'alter publication supabase_realtime add table public.crm_conversation_states';
  end if;
end $migration$;
