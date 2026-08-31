-- A Sofia para de perguntar qual médico e passa a DIRECIONAR pelo caso.
--
-- Pedido da Dra. Lorena em 31/08/2026: "tb acho que não vale a pena perguntar
-- qual médico, e sim direcionar conforme o lead".
--
-- O dado dá razão a ela. Em 12 meses, das 223 cirurgias vendidas:
--
--   Lorena atende → Lorena opera .... 129   R$ 4,78 mi
--   Lorena atende → Matheus opera .... 67   R$ 2,01 mi
--   Matheus atende → Matheus opera ... 19   R$ 570 mil
--   Jaqueline atende → Matheus ........ 5   R$ 141 mil
--   demais ............................ 3
--
-- A Dra. Lorena já atende 89% das cirurgias, e transplante feminino (27 de 27)
-- e sobrancelha (31 de 32) são praticamente só dela. Do que o Dr. Matheus e a
-- Dra. Jaqueline vendem, 76% e 89% é protocolo clínico. Ou seja: a pergunta do
-- Passo 2 não estava distribuindo nada — só somava um degrau, e quando o
-- paciente hesitava, travava. Foi o caso do Rafael em 03/08, 23 dias parado
-- esperando lembrar o nome de quem indicou.
--
-- O Passo 1 já pergunta exatamente o que basta para direcionar (menu de 1 a 5),
-- então o direcionamento sai de graça, sem nenhuma pergunta nova.
--
-- Decisões desta migração, confirmadas pelo Álvaro em 31/08:
--   * TODO transplante vai para a Dra. Lorena. É o que já acontece; a
--     distribuição da sala continua sendo decisão interna, depois da consulta.
--   * Em Londrina atendem os TRÊS. O prompt se contradizia: a linha 69 dizia
--     os três e a FAQ "É em Londrina?" dizia só Matheus e Jaqueline.
--
-- Consulta clínica masculina → Dr. Matheus e feminina → Dra. Jaqueline é
-- escolha de desenho, não achado do dado: os dois fazem clínico, e a regra
-- precisa ser determinística para o modelo seguir. Trocar é uma linha.
--
-- O pedido do paciente continua vencendo tudo: quem pede um médico, tem.

do $migration$
declare
  p text;

  anchor_funcao constant text :=
    'Sua função é **acolher** o paciente, **identificar** o tipo de atendimento que ele busca e o **profissional de preferência**, **apresentar** o médico escolhido e **encaminhar** tudo para a consultora **Aline Fenato**, que finaliza o agendamento (horário, valor, pagamento, dados cadastrais).';

  anchor_bullets constant text := '- Identificação do médico de preferência
- Apresentação do médico escolhido';

  anchor_passo2_ini constant text := '### Passo 2 — Escolha do médico';
  anchor_passo2_fim constant text := 'Elas achatam a equipe médica e deixam o paciente parado.';

  anchor_londrina constant text :=
    '> Em Londrina nosso atendimento é uma vez por mês. Atendemos transplante capilar e de sobrancelha e também consultas clínicas com o Dr. Matheus e a Dra. Jaqueline 😊';

  anchor_resumo constant text := 'Passo 2: Escolha do médico (Lorena / Matheus / Jaqueline) — sem preferência, em dúvida ou indicação sem nome = Dra. Lorena + encaminhar (NUNCA "escolhe qualquer um")
  ├─ Lorena → apresentação Lorena → [PRONTO_PARA_CONSULTOR]
  ├─ Matheus → apresentação Matheus → [PRONTO_PARA_CONSULTOR]
  └─ Jaqueline → apresentação Jaqueline → [PRONTO_PARA_CONSULTOR]';

  anchor_resumo_lond constant text := '  └─ Londrina → explicar → perguntar preferência';

  ini int;
  fim int;
  passo2_atual text;
  novo_passo2 text;
begin
  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs (instituto-lorena/default) não encontrado';
  end if;

  -- 1. A função da Sofia deixa de citar "profissional de preferência".
  if position(anchor_funcao in p) = 0 then
    raise exception 'âncora da FUNÇÃO sumiu do prompt — revisar antes de aplicar';
  end if;
  p := replace(p, anchor_funcao,
    'Sua função é **acolher** o paciente, **identificar** o tipo de atendimento que ele busca, **direcionar** para o médico certo para o caso dele e **encaminhar** tudo para a consultora **Aline Fenato**, que finaliza o agendamento (horário, valor, pagamento, dados cadastrais).');

  -- 2. Os bullets do resumo de função.
  if position(anchor_bullets in p) = 0 then
    raise exception 'âncora dos BULLETS sumiu do prompt — revisar antes de aplicar';
  end if;
  p := replace(p, anchor_bullets, '- Direcionamento para o médico certo para o caso
- Apresentação do médico direcionado');

  -- 3. O Passo 2 inteiro: de "escolha" para "direcionamento".
  ini := position(anchor_passo2_ini in p);
  if ini = 0 then
    raise exception 'âncora de INÍCIO do Passo 2 sumiu do prompt — revisar antes de aplicar';
  end if;
  fim := position(anchor_passo2_fim in p);
  if fim = 0 or fim < ini then
    raise exception 'âncora de FIM do Passo 2 sumiu ou está fora de ordem — revisar antes de aplicar';
  end if;
  fim := fim + length(anchor_passo2_fim);
  passo2_atual := substr(p, ini, fim - ini);

  novo_passo2 := $novo$### Passo 2 — Direcionamento do médico

**Você NUNCA pergunta com qual médico ele quer.** O Passo 1 já disse o que ele precisa, e a equipe é especializada: pedir para o paciente escolher no escuro só soma um degrau, e quando ele hesita o atendimento trava.

Direcione pela opção do Passo 1 e siga direto para o Passo 3:

- 1️⃣ Transplante Capilar Masculino → **Dra. Lorena Visentainer**
- 2️⃣ Transplante Capilar Feminino → **Dra. Lorena Visentainer**
- 5️⃣ Transplante de Sobrancelha → **Dra. Lorena Visentainer**
- 3️⃣ Consulta Clínica Masculina → **Dr. Matheus Amaral**
- 4️⃣ Consulta Clínica Feminina → **Dra. Jaqueline Augusto**

Você apenas informa com quem está encaminhando, com naturalidade, como parte da apresentação do Passo 3. Não peça confirmação da escolha.

**EXCEÇÕES, nesta ordem de prioridade:**

**a) O paciente PEDE um médico** (ex.: "quero com a Dra. Jaqueline", "pode ser com o Dr. Matheus", "queria com a Dra. Lorena") → **é esse médico, sempre**. Pedido do paciente vence qualquer regra acima.

**b) Veio por indicação e sabe o nome** (ex.: "me indicaram a Dra. Jaqueline") → é o nome indicado.

**c) Veio por indicação e ainda NÃO sabe o nome** (ex.: "foi uma amiga que indicou e fiquei na dúvida", "estou aguardando o nome da médica") → o nome não segura o atendimento:

> Que bom que veio por indicação! 🥰
> E isso não precisa segurar o seu atendimento: já deixo encaminhado com a **Dra. Lorena Visentainer**, especialista em saúde e restauração capilar, com olhar cuidadoso e foco em resultados naturais para cada paciente.
>
> Vou passar para a nossa consultora **Aline Fenato**, que confirma o melhor horário e todos os detalhes. Quando você souber o nome de quem te indicou, é só falar com ela que a troca é tranquila ✨

→ Envie: `[PRONTO_PARA_CONSULTOR]`

**d) Não deu para saber o que ele quer** (não escolheu no menu, conversa solta) → **Dra. Lorena Visentainer**.

**e) Pergunta a diferença entre os médicos** ("qual a diferença?", "me fala de cada um") → responda com o foco de cada profissional usando as fichas de OS MÉDICOS, diga com quem você já está encaminhando e siga. **Não** devolva a escolha como pergunta.

🚫 **PROIBIDO perguntar "com qual profissional você gostaria de realizar sua consulta?"** ou qualquer variação que peça ao paciente para escolher médico.

🚫 **NUNCA trate os profissionais como equivalentes.** Frases proibidas: "todos são excelentes", "todas são excelentes", "pode escolher qualquer uma", "tanto faz", "você vai estar em boas mãos com qualquer um", "a escolha é sua". Elas achatam a equipe médica e deixam o paciente parado.$novo$;

  p := overlay(p placing novo_passo2 from ini for (fim - ini));

  -- 4. Londrina: os TRÊS atendem lá (a linha 69 já dizia isso; a FAQ contradizia).
  if position(anchor_londrina in p) = 0 then
    raise exception 'âncora de LONDRINA sumiu do prompt — revisar antes de aplicar';
  end if;
  p := replace(p, anchor_londrina,
    '> Em Londrina nosso atendimento é uma vez por mês. Atendemos transplante capilar e de sobrancelha e também consultas clínicas com a Dra. Lorena Visentainer, o Dr. Matheus Amaral e a Dra. Jaqueline Augusto 😊');

  -- 5. O fluxo resumido tem que contar a mesma história, senão a Sofia se contradiz
  --    dentro da mesma conversa (foi o que aconteceu com a agenda da Lorena em 17/08).
  if position(anchor_resumo in p) = 0 then
    raise exception 'âncora do FLUXO RESUMIDO sumiu do prompt — revisar antes de aplicar';
  end if;
  p := replace(p, anchor_resumo, 'Passo 2: Direcionamento do médico — NUNCA pergunte qual médico
  ├─ 1, 2 ou 5 (transplante capilar ou sobrancelha) → Dra. Lorena
  ├─ 3 (clínica masculina) → Dr. Matheus
  ├─ 4 (clínica feminina) → Dra. Jaqueline
  ├─ paciente PEDIU um médico, ou indicação COM nome → é esse, sempre
  └─ não deu para saber → Dra. Lorena
       ↓
     apresentação do médico → [PRONTO_PARA_CONSULTOR]');

  if position(anchor_resumo_lond in p) = 0 then
    raise exception 'âncora de LONDRINA no resumo sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, anchor_resumo_lond, '  └─ Londrina → explicar (os três atendem lá) → perguntar Londrina, Maringá ou online');

  update crm_ai_configs
     set system_prompt = p, updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- O prompt já esteve cortado no meio de uma frase por edição pela tela.
  if right(p, 1) is null or length(p) < 5000 then
    raise exception 'prompt ficou curto demais (% caracteres) — abortando', length(p);
  end if;

  raise notice 'prompt atualizado: % caracteres', length(p);
end
$migration$;
