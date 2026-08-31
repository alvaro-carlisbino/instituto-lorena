-- O Passo 3 respondia "Excelente escolha!" a uma escolha que não existe mais.
--
-- Complemento de 20260831120000, que tirou a pergunta "com qual profissional
-- você gostaria de realizar sua consulta?" e passou a direcionar pelo Passo 1.
-- As três apresentações do Passo 3 continuavam abrindo com "> Excelente
-- escolha!", que agora soa como resposta a uma pergunta que a Sofia não fez:
-- quem escolheu foi ela.
--
-- A abertura nova serve aos dois casos, o direcionado e o pedido pelo paciente,
-- porque anuncia o encaminhamento em vez de elogiar uma decisão.

do $migration$
declare
  p text;
  a_lorena constant text := '> Excelente escolha!
> A **Dra. Lorena Visentainer** é especialista em saúde e restauração capilar, reconhecida pelo olhar cuidadoso, atendimento humanizado e foco em resultados naturais e personalizados para cada paciente.';
  a_matheus constant text := '> Excelente escolha!
> O **Dr. Matheus Amaral** realiza atendimentos com foco em avaliação clínica capilar individualizada, prezando por um acompanhamento detalhado, humanizado e personalizado para cada paciente.';
  a_jaque constant text := '> Excelente escolha!
> A **Dra. Jaqueline Augusto** realiza atendimentos com foco em saúde capilar e cuidado individualizado, oferecendo uma avaliação atenciosa e personalizada para cada paciente.';
  a_titulo constant text := '### Passo 3 — Apresentação do médico e encaminhamento';
begin
  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs (instituto-lorena/default) não encontrado';
  end if;

  if position(a_lorena in p) = 0 then
    raise exception 'âncora da apresentação da Dra. Lorena sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_lorena, '> Perfeito! Já deixo seu atendimento encaminhado com a **Dra. Lorena Visentainer** 😊
> Ela é especialista em saúde e restauração capilar, reconhecida pelo olhar cuidadoso, atendimento humanizado e foco em resultados naturais e personalizados para cada paciente.');

  if position(a_matheus in p) = 0 then
    raise exception 'âncora da apresentação do Dr. Matheus sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_matheus, '> Perfeito! Já deixo seu atendimento encaminhado com o **Dr. Matheus Amaral** 😊
> Ele realiza atendimentos com foco em avaliação clínica capilar individualizada, prezando por um acompanhamento detalhado, humanizado e personalizado para cada paciente.');

  if position(a_jaque in p) = 0 then
    raise exception 'âncora da apresentação da Dra. Jaqueline sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_jaque, '> Perfeito! Já deixo seu atendimento encaminhado com a **Dra. Jaqueline Augusto** 😊
> Ela realiza atendimentos com foco em saúde capilar e cuidado individualizado, oferecendo uma avaliação atenciosa e personalizada para cada paciente.');

  if position(a_titulo in p) = 0 then
    raise exception 'âncora do título do Passo 3 sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, a_titulo, a_titulo || '

*Quem escolheu o médico foi você, no Passo 2, então a apresentação ANUNCIA o encaminhamento — não elogia uma decisão do paciente. Só quando ele mesmo pediu o médico ("quero com a Dra. Jaqueline") você pode abrir com "Excelente escolha!".*');

  update crm_ai_configs
     set system_prompt = p, updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';

  if p like '%> Excelente escolha!
> A **Dra%' or p like '%> Excelente escolha!
> O **Dr%' then
    raise exception 'sobrou "Excelente escolha!" abrindo apresentação — abortando';
  end if;

  raise notice 'Passo 3 alinhado: % caracteres', length(p);
end
$migration$;
