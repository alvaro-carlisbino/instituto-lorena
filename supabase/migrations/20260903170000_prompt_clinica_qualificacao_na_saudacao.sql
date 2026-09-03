-- Cidade e prazo saem do Passo 2b e entram na SAUDAÇÃO.
--
-- Desde 31/08 a Sofia perguntava as duas coisas depois do menu (Passo 2b). Em
-- 4 dias isso alcançou 19 de 137 leads. Não é o prompt: dentro do turno a Sofia
-- cala assim que um humano fala, e a equipe responde em minutos, então a
-- saudação é a única mensagem da Sofia que a maioria recebe. Pergunta que não
-- está na saudação não é feita. Medido em 03/09/2026: 10% das conversas da
-- semana tinham a cidade perguntada nas primeiras 48h, e o feedback da equipe
-- era "muita gente de longe" e "só querem preço".
--
-- A saudação (que o código monta, `buildInitialTriageMessage`) e o eco da opção
-- (`buildTriageOptionAckMessage`) passam a fazer as perguntas. Aqui o prompt
-- acompanha: o Passo 1 mostra a saudação como ela sai, o Passo 2b vira "não
-- repita se ele já respondeu; se ignorou, pergunte uma vez com o
-- direcionamento", a FAQ de valor faz as perguntas na mesma mensagem em que
-- encaminha para a Aline, e o fluxo resumido reflete tudo isso.
--
-- Prompt lido do banco a cada mensagem: vale na resposta seguinte, sem redeploy.

do $$
declare
  p text;

  a1 constant text :=
    E'> 5️⃣ Transplante de Sobrancelha\n\n*Se não souber o nome do paciente, omita "(Nome do paciente)" e siga normalmente.*';
  r1 constant text :=
    E'> 5️⃣ Transplante de Sobrancelha\n' ||
    E'>\n' ||
    E'> E pra eu já te direcionar certinho: você é de Maringá, de Londrina ou de outra cidade? E tá pensando em fazer nos próximos meses, ou ainda tá pesquisando? 😊\n\n' ||
    E'*Se não souber o nome do paciente, omita "(Nome do paciente)" e siga normalmente.*\n\n' ||
    E'**As duas perguntas do fim são a cidade e o prazo, que a Aline precisa.** Elas ficam na saudação porque é a única mensagem sua que a maioria dos pacientes recebe antes de a equipe assumir.';

  a2 constant text :=
    E'### Passo 2b — As duas perguntas que a Aline precisa\n\nAntes de encaminhar, você pergunta **a cidade** e **o prazo**, numa mensagem só e com naturalidade:';
  r2 constant text :=
    E'### Passo 2b — As duas perguntas que a Aline precisa\n\n' ||
    E'A saudação do Passo 1 **já termina com as duas perguntas** (cidade e prazo). Se o paciente respondeu, mesmo que só uma delas, **não pergunte de novo**: registre e siga. Se ele ignorou as duas, pergunte **uma vez**, junto com o direcionamento do médico, numa mensagem só e com naturalidade:';

  a3 constant text :=
    E'**Pergunte UMA vez.** Se ele responder só uma das duas, siga com o que veio e não insista:';
  r3 constant text :=
    E'**Nunca uma terceira vez.** Se ele responder só uma das duas, siga com o que veio e não insista:';

  a4 constant text :=
    E'- **Valor da CONSULTA:** acolha e diga que vai passar essa informação. Encaminhe para a Aline Fenato, que envia o valor da consulta.\n' ||
    E'> Claro! Já vou passar essas informações pra você 😊 Um instante que a nossa equipe te envia o valor da consulta.';
  r4 constant text :=
    E'- **Valor da CONSULTA:** acolha e diga que vai passar essa informação. Encaminhe para a Aline Fenato, que envia o valor da consulta. **Se ainda não souber a cidade e o prazo, pergunte na MESMA mensagem**, antes de encaminhar: é o que a Aline precisa para responder certo (e é a última vez que você pergunta).\n' ||
    E'> Claro! Já vou passar essas informações pra você 😊 Só me confirma: você é de Maringá, de Londrina ou de outra cidade? E tá pensando em fazer nos próximos meses, ou ainda tá pesquisando?\n\n' ||
    E'*Se ele já tinha respondido cidade e prazo, mantenha só a primeira frase e encaminhe.*';

  a5 constant text :=
    E'Passo 2b: perguntar CIDADE e PRAZO (uma vez só, nunca segura o encaminhamento)';
  r5 constant text :=
    E'Passo 2b: CIDADE e PRAZO já vêm perguntados na saudação; respondeu → registra, ignorou → pergunta uma vez com o direcionamento (nunca segura o encaminhamento)';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'prompt da clínica não encontrado (crm_ai_configs / instituto-lorena)';
  end if;

  if position(r1 in p) > 0 then
    raise notice 'qualificação na saudação já aplicada, nada a fazer';
    return;
  end if;

  if (length(p) - length(replace(p, a1, ''))) / length(a1) <> 1 then
    raise exception 'âncora 1 (fim do menu do Passo 1) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a2, ''))) / length(a2) <> 1 then
    raise exception 'âncora 2 (cabeçalho do Passo 2b) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a3, ''))) / length(a3) <> 1 then
    raise exception 'âncora 3 ("Pergunte UMA vez") não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a4, ''))) / length(a4) <> 1 then
    raise exception 'âncora 4 (FAQ valor da consulta) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a5, ''))) / length(a5) <> 1 then
    raise exception 'âncora 5 (fluxo resumido) não bate: revise à mão';
  end if;

  p := replace(p, a1, r1);
  p := replace(p, a2, r2);
  p := replace(p, a3, r3);
  p := replace(p, a4, r4);
  p := replace(p, a5, r5);

  update crm_ai_configs set system_prompt = p, updated_at = now()
  where tenant_id = 'instituto-lorena' and id = 'default';

  raise notice 'prompt da clínica: cidade e prazo agora na saudação (% caracteres)', length(p);
end $$;
