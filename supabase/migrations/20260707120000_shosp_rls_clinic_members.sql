-- Espelhos da Shosp são dados DA CLÍNICA (agenda + cadastro de pacientes), mas as
-- policies liberavam SELECT para qualquer autenticado — um usuário só do polo
-- Tricopill (caso Ingrid) conseguia ler as ~2 mil consultas e os pacientes.
-- Agora a leitura exige vínculo com um tenant de polo clínica (tenant_members ×
-- tenants.polo_type = 'clinic'). Edge functions/sync usam service_role e não mudam.

do $$
declare t text;
begin
  foreach t in array array[
    'shosp_appointments', 'shosp_patients', 'shosp_reference', 'shosp_sync_state'
  ] loop
    execute format('drop policy if exists "%s read auth" on public.%I', t, t);
    execute format('drop policy if exists "%s read clinic" on public.%I', t, t);
    execute format($p$
      create policy "%s read clinic" on public.%I
        for select to authenticated
        using (exists (
          select 1
          from public.tenant_members m
          join public.tenants tn on tn.id = m.tenant_id
          where m.auth_user_id = auth.uid()
            and tn.polo_type = 'clinic'
        ))
    $p$, t, t);
  end loop;
end $$;
