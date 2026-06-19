-- Atualiza o system_prompt da Sofia (assistente clinica do Instituto Lorena) no banco.
--
-- IMPORTANTE: o system_prompt completo NAO e versionado no repositorio. Ele e mantido
-- diretamente em crm_ai_configs (tenant_id='instituto-lorena', id='default'). Esta migration
-- registra apenas o DELTA aplicado em 2026-06-19:
--   1) A resposta-padrao da FAQ "Tem consulta online?" citava SOMENTE a Dra. Jaqueline.
--      Por isso a Sofia encaminhava casos a distancia mencionando so a Jaqueline (e, pelo
--      perfil, o Dr. Matheus) — deixando a Dra. Lorena de fora, mesmo ela atendendo online.
--      Agora a resposta cita Dra. Lorena Visentainer, Dra. Jaqueline Augusto e Dr. Matheus
--      Amaral.
--   2) Remove a linha "A Dra. Lorena também realiza consulta online." duplicada no perfil
--      da medica (a migration 20260617170000 acabou aplicada duas vezes ao mesmo prompt).
--
-- replace() e idempotente: se o texto antigo ja nao existir (ex.: ja aplicado manualmente),
-- o UPDATE e no-op. set_config(...true) garante o bypass do trigger enforce_role_write.

do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (1) FAQ "Tem consulta online?": citar Lorena + Jaqueline + Matheus (antes so Jaqueline)
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'> Tem sim! A **Dra. Jaqueline Augusto** realiza consulta online de forma individualizada: avaliação do seu caso, histórico, queixas e objetivos para um plano de tratamento personalizado, com acompanhamento detalhado mesmo à distância 😊',
       E'> Tem sim! A **Dra. Lorena Visentainer**, a **Dra. Jaqueline Augusto** e o **Dr. Matheus Amaral** realizam consulta online de forma individualizada: avaliação do seu caso, histórico, queixas e objetivos para um plano de tratamento personalizado, com acompanhamento detalhado mesmo à distância 😊'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- (2) Remove a linha duplicada da Dra. Lorena no perfil da medica
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'A Dra. Lorena também realiza consulta online.\nA Dra. Lorena também realiza consulta online.',
       E'A Dra. Lorena também realiza consulta online.'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';
end $$;
