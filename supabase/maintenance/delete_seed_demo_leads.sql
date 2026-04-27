-- Apaga somente lead-001, lead-002, lead-003 (demonstração do seed).
-- Opção A: select public.maintenance_delete_seed_demo_leads();
-- (Requer migração maintenance_delete_seed_leads aplicada.)

-- Opção B: script bruto
begin;
set local session_replication_role = 'replica';
delete from public.leads where id in ('lead-001', 'lead-002', 'lead-003');
set local session_replication_role = 'origin';
commit;
