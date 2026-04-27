-- Permite atualização em tempo real da lista de conversas e do histórico no painel (idempotente).
do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'interactions'
  ) then
    execute 'alter publication supabase_realtime add table public.interactions';
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leads'
  ) then
    execute 'alter publication supabase_realtime add table public.leads';
  end if;
end $migration$;
