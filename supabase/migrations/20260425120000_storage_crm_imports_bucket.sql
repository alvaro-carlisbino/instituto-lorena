-- Bucket para cópias de ficheiros importados (CSV/JSON) via app
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-imports', 'crm-imports', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "crm_imports insert authenticated" on storage.objects;
drop policy if exists "crm_imports select authenticated" on storage.objects;

create policy "crm_imports insert authenticated"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-imports');

create policy "crm_imports select authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'crm-imports');
