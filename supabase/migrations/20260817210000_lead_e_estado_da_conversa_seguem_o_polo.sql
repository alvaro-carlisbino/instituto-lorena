-- O lead e o estado da conversa também param de atravessar o polo para o dono.
--
-- 17/ago/2026, continuação do `20260817200000`. Lá caiu a exceção de super admin na
-- LEITURA de `interactions` e `crm_media_items`. Só que a mesma exceção estava em
-- `leads` e `crm_conversation_states`, então as duas contas de dono continuavam vendo, no
-- CRM de um polo, o lead e o estado de atendimento do outro — em /leads, no Kanban e em
-- tudo que nasce dessas listas.
--
-- POR QUE UMA POLICY NOVA, SÓ DE SELECT, EM VEZ DE EDITAR A QUE JÁ EXISTE:
-- a `tenant_isolation` dessas tabelas é `for all`, e mexer nela mexeria também no INSERT
-- e no WITH CHECK — foi assim que a de `interactions` quase quebrou a atendente que
-- responde num lead fixado na linha do outro polo (14/ago). Policies RESTRICTIVE se somam
-- com AND, então esta entra só na leitura e a outra fica intacta.
--
-- MAS ATENÇÃO, MEDIDO NA MÃO E NÃO É O QUE PARECE: policy de SELECT também alcança o
-- UPDATE. Todo update real tem WHERE, o WHERE lê coluna, e ler coluna passa pelas policies
-- de leitura. Testado com o JWT do dono, polo ativo = tricopill:
--   * lead do Tricopill  -> update grava normal;
--   * lead da clínica    -> update NÃO pega, 0 linhas, sem erro na cara.
-- Ou seja: a partir daqui o dono só escreve no lead que ele ENXERGA naquele CRM, igual à
-- equipe. Isso é o desejado (um CRM por negócio), mas é bom saber por dois motivos: um
-- update silencioso de 0 linhas parece bug, e cirurgia cross-polo (trocar o polo de um
-- lead, por exemplo) agora só pelo SQL/service_role, que não passa por RLS.
--
-- O QUE **NÃO** MUDA — a conversa segue a LINHA (regra de 10/ago):
-- quem é dono da linha continua enxergando o lead que fala nela, mesmo que a pessoa seja
-- do outro polo. É o caso do paciente da clínica que compra Tricopill: o card continua
-- aparecendo dos dois lados, cada um com a metade da conversa que é dele. Por isso o
-- `whatsapp_instance_id in current_tenant_instance_ids()` e o `lead_id in
-- current_tenant_visible_lead_ids()` seguem aqui dentro.
--
-- EFEITO COLATERAL CONHECIDO (já existia para a equipe, agora vale para o dono também):
-- 17 leads da clínica SEM linha registrada têm 263 mensagens carimbadas `tricopill` —
-- gente que falou na linha de vendas antes de o lead guardar a linha. A equipe do
-- Tricopill nunca viu esses cards (só as mensagens soltas); a partir daqui o dono também
-- não vê. Consertar isso é carimbar a linha nesses leads, o que muda o que a EQUIPE
-- enxerga — decisão do Álvaro, não conserto de bandeja.

drop policy if exists tenant_isolation_read on public.leads;
create policy tenant_isolation_read on public.leads
  as restrictive
  for select
  using (
    tenant_id = (select public.current_tenant_id())
    or whatsapp_instance_id in (select public.current_tenant_instance_ids())
  );

drop policy if exists tenant_isolation_read on public.crm_conversation_states;
create policy tenant_isolation_read on public.crm_conversation_states
  as restrictive
  for select
  using (
    tenant_id = (select public.current_tenant_id())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  );
