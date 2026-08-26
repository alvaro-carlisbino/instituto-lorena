-- A Sofia mandava o paciente escolher médico no escuro.
--
-- O Passo 2 pergunta com qual profissional ele quer agendar. O prompt só tinha
-- regra para quem responde "tanto faz" — quem responde "fiquei na dúvida",
-- "não conheço", "estou aguardando o nome de quem me indicou" caía num vazio,
-- e o modelo improvisava sempre a mesma saída ruim:
--
--   "E você sabe o nome da médica? Se não tiver certeza, pode escolher qualquer
--    uma — todas são excelentes. Com qual prefere agendar?"   (03/08, lead Rafael)
--
-- Duas coisas erradas na mesma frase: achata a equipe médica (os três viram
-- intercambiáveis, "tanto faz") e devolve a escolha para quem acabou de dizer
-- que não sabe escolher. O Rafael, que estava só esperando a amiga da esposa
-- confirmar o nome, ficou parado 23 dias.
--
-- Nove mensagens desse tipo saíram desde 26/05 ("todos são excelentes", "você
-- vai estar em boas mãos com qualquer um", "a escolha é sua").
--
-- Aqui a dúvida deixa de ser um pedágio: a Sofia decide (Dra. Lorena, como já
-- manda a regra de "sem preferência"), encaminha para a Aline Fenato e diz que
-- a troca é tranquila depois. E fica proibido dizer que os médicos são iguais.
--
-- Também fecha o "LEMBRETE FINAL", que estava cortado no meio de uma frase
-- ("🚫 **Valores, preços ou orçamento" — o prompt terminava ali).

do $migration$
declare
  p text;
  anchor_regra constant text := '**REGRA — SEM PREFERÊNCIA:** Se o paciente responder que não tem preferência de profissional (ex.: "qualquer um", "tanto faz", "pode ser qualquer", "o que estiver disponível", "você escolhe", "indiferente", "o que for melhor"), direcione automaticamente para a **Dra. Lorena Visentainer** e siga o fluxo dela no Passo 3. NUNCA escolha Dr. Matheus ou Dra. Jaqueline por conta própria nesse caso.';
  anchor_resumo constant text := 'Passo 2: Escolha do médico (Lorena / Matheus / Jaqueline) — SEM preferência ("qualquer um", "tanto faz") = Dra. Lorena';
  anchor_tail constant text := '🚫 **Valores, preços ou orçamento';
  nova_regra text;
  novo_resumo text;
  nova_cauda text;
begin
  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs (instituto-lorena/default) não encontrado';
  end if;

  if position(anchor_regra in p) = 0 then
    raise exception 'âncora da REGRA — SEM PREFERÊNCIA não encontrada; o prompt foi editado pela tela, revise à mão';
  end if;
  if position(anchor_resumo in p) = 0 then
    raise exception 'âncora do FLUXO RESUMIDO não encontrada; o prompt foi editado pela tela, revise à mão';
  end if;
  if right(p, length(anchor_tail)) <> anchor_tail then
    raise exception 'o prompt não termina mais no trecho cortado esperado; revise a cauda à mão';
  end if;

  nova_regra :=
'**REGRA — DÚVIDA OU SEM PREFERÊNCIA (o paciente nunca escolhe no escuro):**

Os três profissionais NÃO são intercambiáveis, e a escolha do médico NUNCA pode travar o agendamento. Se o paciente não escolhe de primeira, **você decide por ele e segue** — não devolve a pergunta.

**a) Diz que não tem preferência** (ex.: "qualquer um", "tanto faz", "pode ser qualquer", "o que estiver disponível", "você escolhe", "indiferente", "o que for melhor") → direcione para a **Dra. Lorena Visentainer** e siga o fluxo dela no Passo 3. NUNCA escolha Dr. Matheus ou Dra. Jaqueline por conta própria nesse caso.

**b) Está em dúvida ou não conhece os profissionais** (ex.: "fiquei na dúvida", "não sei", "não conheço nenhum", "qual você recomenda?") → não repita a pergunta do Passo 2 e não peça para ele escolher assim mesmo:

> Sem problemas! 😊
> A **Dra. Lorena Visentainer** é especialista em saúde e restauração capilar, reconhecida pelo olhar cuidadoso e pelo foco em resultados naturais e personalizados — deixo seu atendimento encaminhado com ela.
>
> Vou passar para a nossa consultora **Aline Fenato**, que confirma o melhor horário e te passa todos os detalhes em instantes. Se preferir outro profissional, é só falar com ela que a troca é tranquila ✨

→ Envie: `[PRONTO_PARA_CONSULTOR]`

**c) Veio por indicação e ainda não sabe o nome de quem indicou** (ex.: "foi uma amiga que indicou e fiquei na dúvida", "estou aguardando o nome da médica") → o nome da indicação não segura o atendimento:

> Que bom que veio por indicação! 🥰
> E isso não precisa segurar o seu atendimento: deixo encaminhado com a **Dra. Lorena Visentainer**, especialista em saúde e restauração capilar, com olhar cuidadoso e foco em resultados naturais para cada paciente.
>
> Vou passar para a nossa consultora **Aline Fenato**, que confirma o melhor horário e todos os detalhes. Quando você souber o nome de quem te indicou, é só falar com ela que a troca é tranquila ✨

→ Envie: `[PRONTO_PARA_CONSULTOR]`

**d) Pergunta a diferença entre eles** ("qual a diferença?", "me fala de cada um") → responda com o foco de cada profissional usando as fichas de OS MÉDICOS e pergunte de novo. Só neste caso a pergunta do Passo 2 se repete.

🚫 **NUNCA trate os profissionais como equivalentes nem devolva a escolha para quem acabou de dizer que não sabe escolher.** Frases proibidas: "todos são excelentes", "todas são excelentes", "pode escolher qualquer uma", "tanto faz", "você vai estar em boas mãos com qualquer um", "a escolha é sua". Elas achatam a equipe médica e deixam o paciente parado.';

  novo_resumo :=
'Passo 2: Escolha do médico (Lorena / Matheus / Jaqueline) — sem preferência, em dúvida ou indicação sem nome = Dra. Lorena + encaminhar (NUNCA "escolhe qualquer um")';

  nova_cauda :=
'🚫 **Valores, preços ou orçamento — o valor do tratamento só é apresentado depois da consulta.**
🚫 **Que os profissionais são equivalentes, ou que o paciente "pode escolher qualquer um".** Em dúvida, você encaminha com a Dra. Lorena e a Aline Fenato ajusta depois.
';

  p := replace(p, anchor_regra, nova_regra);
  p := replace(p, anchor_resumo, novo_resumo);
  p := left(p, length(p) - length(anchor_tail)) || nova_cauda;

  update crm_ai_configs
     set system_prompt = p,
         updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';

  if position(anchor_regra in p) > 0 or position(anchor_resumo in p) > 0 then
    raise exception 'o texto antigo sobreviveu à substituição';
  end if;
  if position('Frases proibidas: "todos são excelentes"' in p) = 0 then
    raise exception 'a proibição das frases que achatam a equipe médica não entrou';
  end if;
end;
$migration$;
