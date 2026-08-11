-- `polo` passa a ser o ID do polo, não o nome.
--
-- Achar a pessoa em outro polo não bastava: clicar no resultado levava a /leads/<id>,
-- e essa tela lê `crm.leads`, que só tem o polo ativo (a RLS de `leads` também). O
-- resultado era a ficha presa em "Carregando lead…" para sempre.
--
-- A solução é o ⌘K trocar de polo antes de navegar, usando o seletor que já existe —
-- e para isso a busca precisa devolver o ID, que é o que `switchTenant` recebe. O nome
-- para exibir o app já tem em `availableTenants`.
do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crm_buscar_pacientes';

  if position('(select tn.name from public.tenants tn where tn.id = l.tenant_id) as polo' in d) = 0 then
    raise exception 'Expressão de polo não encontrada como esperado — revisar à mão.';
  end if;

  d := replace(d,
    '(select tn.name from public.tenants tn where tn.id = l.tenant_id) as polo',
    'l.tenant_id as polo');
  execute d;
end $$;

revoke execute on function public.crm_buscar_pacientes(text, integer) from anon, public;
grant execute on function public.crm_buscar_pacientes(text, integer) to authenticated, service_role;
