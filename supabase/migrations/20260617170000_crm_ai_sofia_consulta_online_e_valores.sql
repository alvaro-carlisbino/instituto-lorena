-- Atualiza o system_prompt da Sofia (assistente clinica do Instituto Lorena) no banco.
--
-- IMPORTANTE: o system_prompt completo NAO e versionado no repositorio. Ele e mantido
-- diretamente em crm_ai_configs (tenant_id='instituto-lorena', id='default'). Esta migration
-- registra apenas o DELTA aplicado em 2026-06-17:
--   1) Dra. Lorena e Dr. Matheus passam a oferecer CONSULTA ONLINE (antes so a Jaqueline
--      estava marcada como online, e por isso a IA encaminhava todos os casos a distancia
--      somente para ela).
--   2) Pergunta sobre "valor da consulta" deixa de ser tratada como valor de tratamento:
--      a Sofia acolhe, diz que vai passar a informacao e encaminha para a Dandara (o handoff
--      [PRONTO_PARA_CONSULTOR] ja e disparado pela regra de "perguntar valores"). O valor de
--      TRANSPLANTE/TRATAMENTO continua sendo "personalizado, definido apos a avaliacao".
--
-- replace() e idempotente: se o texto antigo ja nao existir (ex.: ja aplicado manualmente),
-- o UPDATE e no-op. set_config(...true) garante o bypass do trigger enforce_role_write.

do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (1) Consulta online para o Dr. Matheus Amaral
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'todos os tipos de atendimento.\n\n**Dra. Jaqueline Augusto**',
       E'todos os tipos de atendimento. Realiza também consulta online.\n\n**Dra. Jaqueline Augusto**'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- (1) Consulta online para a Dra. Lorena Visentainer
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'Para transplante capilar ou sobrancelha com a Dra. Lorena, a Dandara verifica a disponibilidade.',
       E'Para transplante capilar ou sobrancelha com a Dra. Lorena, a Dandara verifica a disponibilidade.\nA Dra. Lorena também realiza consulta online.'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- (2) Separa valor da CONSULTA (handoff p/ Dandara) do valor de TRATAMENTO (personalizado)
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'**Nunca informe valores.** Conduza para a consulta:\n\n> Entendemos sua dúvida! Como cada caso é único, tanto o transplante capilar quanto os tratamentos são totalmente personalizados, definidos após uma avaliação médica detalhada da região doadora, grau da queda, objetivos e necessidades individuais.\n>\n> Por esse motivo, os valores são apresentados somente após a consulta — permitindo que a médica indique a melhor estratégia para o seu caso com segurança e precisão 😊\n>\n> Posso seguir com seu atendimento?',
       E'**Você não informa valores diretamente — mas acolhe e encaminha conforme o caso:**\n\n- **Valor da CONSULTA:** acolha e diga que vai passar essa informação. Encaminhe para a Dandara, que envia o valor da consulta.\n> Claro! Já vou passar essas informações pra você 😊 Um instante que a nossa equipe te envia o valor da consulta.\n\n- **Valor do TRANSPLANTE ou TRATAMENTO:** explique que é personalizado, definido após a avaliação.\n> Como cada caso é único, o transplante capilar e os tratamentos são totalmente personalizados, definidos após uma avaliação médica detalhada (região doadora, grau da queda, objetivos e necessidades individuais). Por esse motivo, os valores do tratamento são apresentados após a consulta 😊\n>\n> Posso seguir com seu atendimento?'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';
end $$;
