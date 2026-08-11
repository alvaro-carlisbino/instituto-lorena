-- A ficha precisa abrir para a pessoa que a busca achou.
--
-- Com a busca passando a achar nos dois polos, clicar num cliente do Tricopill a partir
-- do workspace da clínica abria uma ficha VAZIA: todas as seções filtravam por
-- `current_tenant_id()`, que é o polo ativo, não o polo da pessoa. Verificado antes do
-- patch: a busca devolvia o cliente e a ficha dele mostrava 0 pedidos.
--
-- Troca o filtro pelo mesmo conjunto que a busca usa — os polos de que o usuário é
-- membro. Quem é membro de um polo só continua enxergando um polo só.
--
-- Feito por substituição de texto sobre a definição publicada, de propósito: a função
-- tem ~290 linhas e reescrevê-la à mão para mexer em nove filtros é como se perde uma
-- seção sem perceber. A contagem esperada é conferida antes de trocar qualquer coisa,
-- para a migração falhar alto se alguém tiver mexido na função no meio do caminho.
do $$
declare
  d text;
  qtd integer;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'crm_paciente_360_ref';

  -- cirurgias, vendas, pedidos(rede), pedidos(pagbank), pagamentos, assinatura,
  -- protocolos, notas_clinicas, followups
  select count(*) into qtd from regexp_matches(d, 'tenant_id = public\.current_tenant_id\(\)', 'g');
  if qtd <> 9 then
    raise exception 'Esperava 9 filtros de tenant no 360, achei %. Alguém mexeu na função — revisar à mão.', qtd;
  end if;

  d := replace(d, 'tenant_id = public.current_tenant_id()',
                  'tenant_id in (select public.crm_meus_tenants())');
  execute d;
end $$;

do $$
declare
  d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'crm_identidade';
  d := replace(d, 'tenant_id = public.current_tenant_id()',
                  'tenant_id in (select public.crm_meus_tenants())');
  execute d;
end $$;

-- CREATE OR REPLACE preserva o ACL, mas deixar explícito custa nada e documenta.
revoke execute on function public.crm_paciente_360_ref(text, text) from anon, public;
revoke execute on function public.crm_identidade(text, text) from anon, public;
grant execute on function public.crm_paciente_360_ref(text, text) to authenticated, service_role;
grant execute on function public.crm_identidade(text, text) to authenticated, service_role;
