-- Correção do texto aplicado horas antes (20260821093000): a clínica FICA em
-- Maringá. Londrina é atendimento uma vez por mês, não uma segunda unidade, e
-- por isso não existe endereço de rua de Londrina em lugar nenhum do sistema.
-- Dizer "também temos unidade lá" prometia porta aberta que não existe.
--
-- A resposta passa a ser: a clínica fica em Maringá (endereço completo), e além
-- dela existem mais duas formas de ser atendido, Londrina uma vez por mês e
-- consulta online. Pergunta a cidade no fim para indicar a mais perto.
--
-- Prompt lido do banco a cada mensagem: vale na resposta seguinte, sem redeploy.

do $$
declare
  p text;

  a1 constant text := '**Maringá (sede principal):**';
  a2 constant text := E'**Londrina:**\nAtende uma vez por mês.';
  a3 constant text := '**NUNCA responda só Maringá.** Quem pergunta endereço está medindo distância: se ouvir só a sede, o paciente de outra cidade desiste sem saber que existe Londrina e consulta online. Apresente sempre as três formas e pergunte de qual cidade ele fala, para indicar a mais perto.';
  a4 constant text :=
    E'> A gente atende de três formas 😊\n' ||
    E'>\n' ||
    E'> 📍 *Maringá/PR*: nossa sede, na Av. Nóbrega, 814, Zona 04, com estacionamento próprio\n' ||
    E'> 📍 *Londrina/PR*: também temos unidade lá, com atendimento uma vez por mês\n' ||
    E'> 💻 *Consulta online*: por vídeo, de onde você estiver, com a mesma avaliação individualizada';
  a5 constant text := 'Se o paciente ficar com Londrina, o endereço exato e a data do próximo atendimento quem passa é a Aline Fenato. Você não informa data nem rua de Londrina.';

  r1 constant text := '**Maringá (a clínica fica aqui):**';
  r2 constant text := E'**Londrina (atendimento mensal, não é uma segunda clínica):**\nA equipe atende em Londrina uma vez por mês.';
  r3 constant text := '**A clínica fica em Maringá, mas nunca pare por aí.** Quem pergunta endereço está medindo distância: se ouvir só Maringá, o paciente de outra cidade desiste sem saber que a equipe atende em Londrina uma vez por mês e que existe consulta online. Diga onde fica a clínica, apresente as outras duas formas e pergunte de qual cidade ele fala.';
  r4 constant text :=
    E'> A nossa clínica fica em Maringá/PR, na Av. Nóbrega, 814, Zona 04, com estacionamento próprio 😊\n' ||
    E'>\n' ||
    E'> E tem mais duas formas de ser atendido:\n' ||
    E'> 📍 *Londrina/PR*: a equipe atende lá uma vez por mês\n' ||
    E'> 💻 *Consulta online*: por vídeo, de onde você estiver, com a mesma avaliação individualizada';
  r5 constant text := 'Se o paciente ficar com Londrina, quem passa o local e a data do próximo atendimento é a Aline Fenato. Você não informa data nem endereço de Londrina, e nunca fala em "unidade" ou "filial" de Londrina: a clínica é a de Maringá.';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'prompt da clínica não encontrado (crm_ai_configs / instituto-lorena)';
  end if;

  if position(r4 in p) > 0 then
    raise notice 'correção de Londrina já aplicada, nada a fazer';
    return;
  end if;

  if (length(p) - length(replace(p, a1, ''))) / length(a1) <> 1 then
    raise exception 'âncora 1 (cabeçalho Maringá) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a2, ''))) / length(a2) <> 1 then
    raise exception 'âncora 2 (cabeçalho Londrina) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a3, ''))) / length(a3) <> 1 then
    raise exception 'âncora 3 (instrução da FAQ de endereço) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a4, ''))) / length(a4) <> 1 then
    raise exception 'âncora 4 (resposta da FAQ de endereço) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a5, ''))) / length(a5) <> 1 then
    raise exception 'âncora 5 (nota sobre Londrina) não bate: revise à mão';
  end if;

  p := replace(p, a1, r1);
  p := replace(p, a2, r2);
  p := replace(p, a3, r3);
  p := replace(p, a4, r4);
  p := replace(p, a5, r5);

  update crm_ai_configs
     set system_prompt = p,
         updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';
end $$;
