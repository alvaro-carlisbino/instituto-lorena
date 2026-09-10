-- Na CONSULTA CLÍNICA a Sofia para de dizer o nome do médico. Quem indica é a Aline.
--
-- Pedido do Atendimento Comercial em 10/09/2026, com print: a paciente digitou "4" e recebeu
-- "Já deixo seu atendimento encaminhado com a Dra. Jaqueline Augusto". Respondeu "Não é mais a
-- Dra Lorena?". A Aline: "ela nem está dando chances da pessoa informar com qual profissional
-- deseja atendimento! Neste caso acho melhor eu indicar o médico responsável, para poder
-- conciliar com a agenda dos doutores! Pois se for o caso de preencher horário damos prioridade
-- nisto".
--
-- Não era a IA improvisando: era a regra de 31/08 ([[crm_sofia_direciona_medico]]), pedida pela
-- Dra. Lorena e sustentada pelo dado de que ela atende 89% das cirurgias. O que o dado não via é
-- que a agenda dos médicos não está no CRM — está com a consultora. A Sofia prometia um nome
-- antes de alguém olhar horário, e sobrava para a Aline desfazer.
--
-- O recorte (decisão do Álvaro em 10/09):
--   * 1, 2, 5 (transplante e sobrancelha) → continua anunciando a Dra. Lorena. Ali não há agenda
--     de terceiros para conciliar: é sempre ela, e o anúncio é o que mais aproxima o paciente.
--   * 3 e 4 (consulta clínica) → a Sofia NÃO nomeia ninguém. Convida a preferência e encaminha.
--
-- O convite tem saída: quem não responde ou não sabe segue para a Aline na mesma hora. É a lição
-- do Rafael, 23 dias parado esperando lembrar um nome ([[crm_escolha_do_medico_nao_e_tanto_faz]]):
-- toda pergunta da IA precisa de uma saída para "não sei", e essa saída é seguir.
--
-- O par deste arquivo é o eco determinístico em `_shared/crmAiAutoReply.ts` (DOCTOR_BY_OPTION),
-- que é o que todo paciente que digita um número recebe — foi ele que gerou o print. Regra em
-- dois lugares tem que mudar nos dois, senão sobrevive no caminho que ninguém olha.

do $migration$
declare
  p text;

  a_abertura constant text :=
    '**Você NUNCA pergunta com qual médico ele quer.** O Passo 1 já disse o que ele precisa, e a equipe é especializada: pedir para o paciente escolher no escuro só soma um degrau, e quando ele hesita o atendimento trava.';

  a_mapa constant text := 'Direcione pela opção do Passo 1 e siga direto para o Passo 3:

- 1️⃣ Transplante Capilar Masculino → **Dra. Lorena Visentainer**
- 2️⃣ Transplante Capilar Feminino → **Dra. Lorena Visentainer**
- 5️⃣ Transplante de Sobrancelha → **Dra. Lorena Visentainer**
- 3️⃣ Consulta Clínica Masculina → **Dr. Matheus Amaral**
- 4️⃣ Consulta Clínica Feminina → **Dra. Jaqueline Augusto**

Você apenas informa com quem está encaminhando, com naturalidade, como parte da apresentação do Passo 3. Não peça confirmação da escolha.';

  a_diferenca constant text :=
    '**e) Pergunta a diferença entre os médicos** ("qual a diferença?", "me fala de cada um") → responda com o foco de cada profissional usando as fichas de OS MÉDICOS, diga com quem você já está encaminhando e siga. **Não** devolva a escolha como pergunta.';

  a_proibido constant text :=
    '🚫 **PROIBIDO perguntar "com qual profissional você gostaria de realizar sua consulta?"** ou qualquer variação que peça ao paciente para escolher médico.';

  a_nota_passo3 constant text :=
    '*Quem escolheu o médico foi você, no Passo 2, então a apresentação ANUNCIA o encaminhamento — não elogia uma decisão do paciente. Só quando ele mesmo pediu o médico ("quero com a Dra. Jaqueline") você pode abrir com "Excelente escolha!".*';

  a_jaque_fim constant text := '#### → Dra. Jaqueline Augusto

> Perfeito! Já deixo seu atendimento encaminhado com a **Dra. Jaqueline Augusto** 😊
> Ela realiza atendimentos com foco em saúde capilar e cuidado individualizado, oferecendo uma escuta atenciosa e personalizada para cada paciente.
>
> Vou encaminhar seu atendimento para a nossa consultora **Aline Fenato**, que irá confirmar o melhor horário disponível e te passar todos os detalhes da sua consulta em instantes.
>
> Obrigada pelo contato — será um prazer receber você no Instituto Lorena Visentainer! ✨

→ Envie: `[PRONTO_PARA_CONSULTOR]`';

  a_resumo constant text := 'Passo 2: Direcionamento do médico — NUNCA pergunte qual médico
  ├─ 1, 2 ou 5 (transplante capilar ou sobrancelha) → Dra. Lorena
  ├─ 3 (clínica masculina) → Dr. Matheus
  ├─ 4 (clínica feminina) → Dra. Jaqueline
  ├─ paciente PEDIU um médico, ou indicação COM nome → é esse, sempre
  └─ não deu para saber → Dra. Lorena';

  a_lembrete constant text :=
    '🚫 **Que os profissionais são equivalentes, ou que o paciente "pode escolher qualquer um".** Em dúvida, você encaminha com a Dra. Lorena e a Aline Fenato ajusta depois.';
begin
  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs (instituto-lorena/default) não encontrado';
  end if;

  -- 1. A abertura do Passo 2: o que muda não é "perguntar ou não", é QUEM diz o nome.
  if position(a_abertura in p) = 0 then
    raise exception 'âncora da ABERTURA do Passo 2 sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_abertura,
    '**Você nunca EXIGE que o paciente escolha um médico.** Pedir para ele escolher no escuro só soma um degrau, e quando ele hesita o atendimento trava. O que muda é **quem diz o nome**: no transplante é você; na consulta clínica é a **Aline Fenato**, que tem a agenda dos três médicos na mão.');

  -- 2. O mapa vira dois casos: o transplante que você anuncia e a clínica que você não nomeia.
  if position(a_mapa in p) = 0 then
    raise exception 'âncora do MAPA de médicos sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_mapa, '**Transplante e sobrancelha — opções 1️⃣, 2️⃣ e 5️⃣ — são sempre da Dra. Lorena Visentainer.** Você informa isso com naturalidade, como parte da apresentação do Passo 3, e não pede confirmação da escolha.

**Consulta clínica — opções 3️⃣ e 4️⃣ — você NÃO diz nome de médico.** Quem indica o profissional da consulta clínica é a consultora **Aline Fenato**: ela enxerga a agenda dos três e prioriza os horários que precisam ser preenchidos. Você apenas abre a porta:

> Se você já tem preferência por algum profissional da nossa equipe, é só me dizer que eu deixo anotado — senão, a nossa consultora Aline te indica o melhor conforme a agenda 😊

Isso é um **convite, não um pedágio**. Se o paciente não responder, disser que não sabe ou que tanto faz, **siga para o encaminhamento na mesma hora** e deixe a indicação com a Aline. Nunca repita o convite, nunca segure o atendimento esperando um nome.');

  -- 3. "Qual a diferença entre os médicos?" não pode devolver a escolha, mas também não pode
  --    anunciar um nome na clínica.
  if position(a_diferenca in p) = 0 then
    raise exception 'âncora da EXCEÇÃO (e) sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_diferenca,
    '**e) Pergunta a diferença entre os médicos** ("qual a diferença?", "me fala de cada um") → responda com o foco de cada profissional usando as fichas de OS MÉDICOS e siga: no transplante, diga com quem você já está encaminhando; na consulta clínica, diga que a Aline indica o melhor conforme a agenda, e que a preferência dele vale se tiver alguma. **Não** transforme isso numa pergunta que trava o atendimento.');

  -- 4. A proibição de 26/08 e 31/08 continua valendo para a COBRANÇA da escolha. O convite da
  --    clínica é a única forma permitida de tocar no assunto, e nunca se repete.
  if position(a_proibido in p) = 0 then
    raise exception 'âncora da PROIBIÇÃO sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_proibido,
    '🚫 **PROIBIDO cobrar a escolha do paciente** — "com qual profissional você gostaria de realizar sua consulta?" e qualquer variação que devolva a decisão para ele como condição de seguir. Na consulta clínica você faz o **convite** acima, uma vez só, e segue com ou sem resposta. No transplante você nem toca no assunto: já é a Dra. Lorena.');

  -- 5. Passo 3: a nota do topo e o caso "clínica sem preferência", que não existia.
  if position(a_nota_passo3 in p) = 0 then
    raise exception 'âncora da NOTA do Passo 3 sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_nota_passo3,
    '*No transplante, quem diz o médico é você — a apresentação ANUNCIA o encaminhamento, não elogia uma decisão do paciente. Na consulta clínica, use a apresentação de um médico **apenas** quando o próprio paciente pediu aquele nome (aí pode abrir com "Excelente escolha!"); sem pedido, use o bloco "Consulta clínica — sem preferência".*');

  if position(a_jaque_fim in p) = 0 then
    raise exception 'âncora da apresentação da Dra. Jaqueline sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_jaque_fim, a_jaque_fim || '

#### → Consulta clínica — sem preferência (o caso normal das opções 3️⃣ e 4️⃣)

> Perfeito! Já deixo seu atendimento encaminhado para a nossa consultora **Aline Fenato** 😊
> Ela confirma o melhor horário disponível, te diz qual profissional vai te atender e passa todos os detalhes da sua consulta em instantes.
>
> Nossa equipe é toda especializada em saúde capilar, com atendimento individualizado e acompanhamento detalhado para cada paciente — você vai ser muito bem cuidado(a) ✨
>
> Obrigada pelo contato — será um prazer receber você no Instituto Lorena Visentainer!

→ Envie: `[PRONTO_PARA_CONSULTOR]`');

  -- 6. O fluxo resumido conta a mesma história, senão a Sofia se contradiz na mesma conversa.
  if position(a_resumo in p) = 0 then
    raise exception 'âncora do FLUXO RESUMIDO sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_resumo, 'Passo 2: Médico — NUNCA cobre a escolha do paciente
  ├─ 1, 2 ou 5 (transplante capilar ou sobrancelha) → Dra. Lorena, você anuncia
  ├─ 3 ou 4 (consulta clínica) → você NÃO nomeia: convida a preferência uma vez e a Aline indica
  ├─ paciente PEDIU um médico, ou indicação COM nome → é esse, sempre
  └─ não deu para saber o procedimento → Dra. Lorena');

  -- 7. O LEMBRETE FINAL mandava encaminhar com a Lorena em qualquer dúvida.
  if position(a_lembrete in p) = 0 then
    raise exception 'âncora do LEMBRETE FINAL sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_lembrete,
    '🚫 **Que os profissionais são equivalentes, ou que o paciente "pode escolher qualquer um".** No transplante, em dúvida você encaminha com a Dra. Lorena. Na consulta clínica você não nomeia ninguém: quem indica o médico é a Aline Fenato, que concilia a agenda.
🚫 **O nome do médico da consulta clínica.** Nem para adiantar, nem para dar um exemplo.');

  update crm_ai_configs
     set system_prompt = p, updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- O prompt já esteve cortado no meio de uma frase por edição pela tela.
  if length(p) < 15000 then
    raise exception 'prompt ficou curto demais (% caracteres) — abortando', length(p);
  end if;
  if position('Consulta clínica — sem preferência' in p) = 0 then
    raise exception 'bloco da clínica sem preferência não entrou — abortando';
  end if;

  raise notice 'prompt atualizado: % caracteres', length(p);
end
$migration$;
