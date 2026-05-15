-- Executar no SQL Editor (Supabase) se existirem leads com owner_id apontando para app_users apagado
-- (ex.: remoção manual ou migração antiga). Ajuste o subselect se quiser um responsável fixo.

update public.leads l
set owner_id = coalesce(
  (
    select u.id
    from public.app_users u
    where u.active = true
    order by (u.role = 'admin') desc, u.name asc
    limit 1
  ),
  l.owner_id
)
where not exists (select 1 from public.app_users u where u.id = l.owner_id);
