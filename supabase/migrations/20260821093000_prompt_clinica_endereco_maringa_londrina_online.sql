-- Sofia respondia "Estamos em Maringá, na Av. Nóbrega, 814" e parava aí.
-- Em 21/08/2026 um paciente de DDD 41 perguntou o endereço, ouviu só Maringá e a
-- atendente teve que corrigir: dava pra atender ele em Londrina, ou online.
--
-- Londrina e consulta online JÁ estavam no prompt, mas escondidas atrás de uma
-- pergunta: só saíam se o paciente perguntasse "é em Londrina?" ou "tem online?".
-- Ninguém pergunta pelo que não sabe que existe. Quem pergunta endereço está
-- medindo distância, e é exatamente aí que a opção mais perto tem que aparecer.
--
-- O que muda:
--   1. O INSTITUTO ganha o bloco de consulta online (ao lado de Maringá e Londrina).
--   2. Nasce a FAQ de endereço: sempre devolve as três formas e pergunta a cidade.
--   3. A FAQ de Londrina passa a oferecer online como terceira saída.
--   4. O fluxo resumido ganha a linha do endereço.
--
-- O endereço da rua em Londrina fica de fora de propósito: ninguém passou (não está
-- no site, nem na Shosp, nem em clinic_booking_units). Sofia diz que a unidade
-- existe e a Aline manda o endereço. Inventar rua é pior que não dar.
--
-- Este prompt é lido do banco a cada mensagem: vale já na resposta seguinte, sem
-- redeploy. Ver crm_agenda_lorena_regra_no_prompt.

do $$
declare
  p text;

  a1 constant text := 'Atende uma vez por mês. Realizamos Transplante Capilar e Transplante de Sobrancelha e também **consultas clínicas** com a Dra. Lorena Visentainer, o Dr. Matheus Amaral e a Dra. Jaqueline Augusto.';
  a2 constant text := '### "Tem consulta online?"';
  a3 constant text := '> Prefere aguardar a agenda de Londrina ou quer agendar aqui em Maringá?';
  a4 constant text := '  ├─ Online → resposta padrão → seguir fluxo';

  r1 constant text := a1 || E'\n\n**Consulta online:**\nPara quem mora longe ou prefere não se deslocar: a Dra. Lorena Visentainer, o Dr. Matheus Amaral e a Dra. Jaqueline Augusto atendem por vídeo, com a mesma avaliação individualizada.';

  r2 constant text :=
    E'### "Qual o endereço?" / "Onde vocês ficam?" / "Onde fica a clínica?" / "Vocês são de onde?" / "É em Maringá?"\n' ||
    E'\n' ||
    E'**NUNCA responda só Maringá.** Quem pergunta endereço está medindo distância: se ouvir só a sede, o paciente de outra cidade desiste sem saber que existe Londrina e consulta online. Apresente sempre as três formas e pergunte de qual cidade ele fala, para indicar a mais perto.\n' ||
    E'\n' ||
    E'> A gente atende de três formas 😊\n' ||
    E'>\n' ||
    E'> 📍 *Maringá/PR*: nossa sede, na Av. Nóbrega, 814, Zona 04, com estacionamento próprio\n' ||
    E'> 📍 *Londrina/PR*: também temos unidade lá, com atendimento uma vez por mês\n' ||
    E'> 💻 *Consulta online*: por vídeo, de onde você estiver, com a mesma avaliação individualizada\n' ||
    E'>\n' ||
    E'> Você é de qual cidade? Assim já te indico a melhor opção!\n' ||
    E'\n' ||
    E'Se o paciente ficar com Londrina, o endereço exato e a data do próximo atendimento quem passa é a Aline Fenato. Você não informa data nem rua de Londrina.\n' ||
    E'\n' ||
    a2;

  r3 constant text := '> Prefere aguardar a agenda de Londrina, agendar aqui em Maringá ou fazer sua consulta online?';

  r4 constant text :=
    E'  ├─ Endereço / "onde fica" / "vocês são de onde" → SEMPRE as 3 opções (Maringá, Londrina, online) + perguntar a cidade\n' || a4;

begin
  -- Trigger enforce_role_write exige papel de serviço para DML (ver mcp_sql_write_bypass).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'prompt da clínica não encontrado (crm_ai_configs / instituto-lorena)';
  end if;

  -- Cada âncora tem que existir exatamente uma vez. O prompt é editável pela tela:
  -- se alguém mexeu no trecho, o replace passaria batido (ou pegaria duas vezes) e
  -- a Sofia ficaria se contradizendo na mesma conversa.
  if (length(p) - length(replace(p, a1, ''))) / length(a1) <> 1 then
    raise exception 'âncora 1 (bloco Londrina em O INSTITUTO) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a2, ''))) / length(a2) <> 1 then
    raise exception 'âncora 2 (FAQ consulta online) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a3, ''))) / length(a3) <> 1 then
    raise exception 'âncora 3 (fecho da FAQ de Londrina) não bate: revise à mão';
  end if;
  if (length(p) - length(replace(p, a4, ''))) / length(a4) <> 1 then
    raise exception 'âncora 4 (fluxo resumido) não bate: revise à mão';
  end if;

  -- Idempotência: se a FAQ de endereço já está lá, não faz nada.
  if position('### "Qual o endereço?"' in p) > 0 then
    raise notice 'FAQ de endereço já aplicada, nada a fazer';
    return;
  end if;

  p := replace(p, a1, r1);
  p := replace(p, a2, r2);
  p := replace(p, a3, r3);
  p := replace(p, a4, r4);

  update crm_ai_configs
     set system_prompt = p,
         updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';
end $$;
