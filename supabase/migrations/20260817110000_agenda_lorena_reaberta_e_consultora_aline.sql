-- A Sofia parou de dizer duas coisas que a clínica não quer mais:
--
-- 1) "A agenda de consulta clínica da Dra. Lorena está encerrada para 2026". Isso estava em TRÊS
--    lugares do script (ficha da médica, regra do Passo 2 e o roteiro do Passo 3), e o Passo 3
--    ainda EMPURRAVA o paciente para o Dr. Matheus ou a Dra. Jaqueline. Com a agenda liberada, a
--    Dra. Lorena volta a entrar no mesmo fluxo dos outros dois: apresentação + encaminhamento
--    para a consultora, que confirma o horário. Quem fecha agenda continua sendo humano — a
--    Sofia segue proibida de informar dias e horários.
--
-- 2) O nome da consultora humana. A linha da clínica é a "Aline — Comercial TC" desde a troca do
--    número, mas o script continuava mandando o paciente para a "Dandara" — nome de quem não
--    atende mais. Renomeia no script da Sofia e na mensagem rápida da equipe.
--
-- Os replaces são de trecho exato (não regex) e a migration ABORTA se algum âncora não existir —
-- prompt editado à mão pela tela não pode ser corrompido por um replace que passou raspando.

do $$
declare
  p text;
  bloco_medica  constant text := E'⚠️ **A agenda de CONSULTA CLÍNICA da Dra. Lorena está encerrada para 2026.**\nPara transplante capilar ou sobrancelha com a Dra. Lorena, a Dandara verifica a disponibilidade.\nA Dra. Lorena também realiza consulta online.';
  obs_passo2    constant text := ' (Observação: para consulta clínica — opções 3 e 4 — a agenda da Dra. Lorena está encerrada em 2026, então aplique normalmente a regra de encaminhamento do Passo 3 dela.)';
  bloco_passo3  constant text := E'#### → Dra. Lorena (consulta clínica — opções 3 ou 4)\n\n> Entendo, (nome)! A agenda de consulta clínica da Dra. Lorena está encerrada para 2026 😊\n> Mas temos o **Dr. Matheus Amaral** e a **Dra. Jaqueline Augusto**, que seguem o mesmo padrão de atendimento e excelência do Instituto — todos os casos são discutidos em conjunto com a Dra. Lorena.\n> Com qual deles você prefere dar continuidade?\n\n#### → Dra. Lorena (transplante — opções 1, 2 ou 5)';
  bloco_resumo  constant text := E'  ├─ Lorena + consulta clínica → redirecionar para Matheus ou Jaqueline\n  ├─ Lorena + transplante → apresentação Lorena → [PRONTO_PARA_CONSULTOR]';
begin
  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs default/instituto-lorena não encontrado';
  end if;

  if position(bloco_medica in p) = 0 then raise exception 'âncora ausente: ficha da Dra. Lorena'; end if;
  if position(obs_passo2  in p) = 0 then raise exception 'âncora ausente: observação do Passo 2'; end if;
  if position(bloco_passo3 in p) = 0 then raise exception 'âncora ausente: roteiro do Passo 3'; end if;
  if position(bloco_resumo in p) = 0 then raise exception 'âncora ausente: fluxo resumido'; end if;

  -- (1) Ficha da médica: mesma linha que Matheus e Jaqueline já têm.
  p := replace(p, bloco_medica, 'Disponível para todos os tipos de atendimento. Realiza também consulta online.');

  -- (2) Passo 2 — "sem preferência" cai na Dra. Lorena sem ressalva de agenda.
  p := replace(p, obs_passo2, '');

  -- (3) Passo 3 — um único roteiro para a Dra. Lorena, seja consulta clínica ou transplante.
  p := replace(p, bloco_passo3, '#### → Dra. Lorena Visentainer');

  -- (4) Fluxo resumido — some o desvio "Lorena + consulta clínica → redirecionar".
  p := replace(p, bloco_resumo, '  ├─ Lorena → apresentação Lorena → [PRONTO_PARA_CONSULTOR]');

  -- (5) A consultora humana da linha da clínica agora é a Aline Fenato.
  p := replace(p, 'DANDARA', 'ALINE FENATO');
  p := replace(p, 'Dandara', 'Aline Fenato');

  if p ~* 'dandara' or p ~* 'encerrada (para|em) 2026' then
    raise exception 'sobrou menção à Dandara ou à agenda encerrada no prompt';
  end if;

  update crm_ai_configs
     set system_prompt = p,
         updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';
end $$;

-- Mensagem rápida da equipe (atalho manual no chat) se apresentava como Dandara.
update crm_quick_messages
   set content = replace(content, 'Dandara', 'Aline Fenato')
 where tenant_id = 'instituto-lorena' and content like '%Dandara%';
