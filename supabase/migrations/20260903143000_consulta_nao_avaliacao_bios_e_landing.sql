-- Segunda mão do "o nome é CONSULTA": as bios dos médicos e a porta da landing.
--
-- A primeira migration (20260903120000) tirou "avaliação" de onde ela ocupava o lugar
-- do atendimento na resposta de preço. Sobraram as duas bios que a Sofia manda no Passo 3
-- (o paciente lê essas frases inteiras, elas vão entre aspas no prompt) e a resposta de
-- consulta online. A Aline pediu o texto padronizado, então elas caem também.
--
-- Junto vai a porta da landing: o botão do /consulta passou a mandar "quero falar sobre a
-- CONSULTA capilar" em vez de "avaliação capilar". Essa frase é a etiqueta que o
-- crm_ctwa_carimbar usa para dizer que o lead veio da landing, então a frase nova precisa
-- estar cadastrada ANTES do deploy do site. A antiga fica ativa: quem abriu o WhatsApp com
-- o link velho e só responder depois ainda tem de ser carimbado como landing, e o carimbo
-- casa por substring escolhendo a frase mais longa, então as duas convivem sem brigar.

do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Dr. Matheus (bio na seção OS MÉDICOS e no texto do Passo 3)
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'com foco em avaliação clínica capilar individualizada',
       E'com foco em cuidado clínico capilar individualizado'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- Dra. Jaqueline (bio na seção OS MÉDICOS)
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'cuidado individualizado, com avaliação atenciosa e personalizada para cada paciente.',
       E'cuidado individualizado, com escuta atenciosa e personalizada para cada paciente.'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- Dra. Jaqueline (texto do Passo 3)
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'oferecendo uma avaliação atenciosa e personalizada para cada paciente.',
       E'oferecendo uma escuta atenciosa e personalizada para cada paciente.'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- "Tem consulta online?" — quem analisa é o médico, na consulta.
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'realizam consulta online de forma individualizada: avaliação do seu caso, histórico, queixas e objetivos para um plano de tratamento personalizado',
       E'realizam consulta online de forma individualizada: seu caso, histórico, queixas e objetivos são analisados para um plano de tratamento personalizado'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';
end $$;

-- A porta nova da landing. `trecho` é sem acento e em minúsculo, como as outras.
insert into ctwa_aberturas (tenant_id, trecho, canal, criativo_id, campanha_id, rotulo, ativo)
values
  ('instituto-lorena', 'vim pelo site e quero falar sobre a consulta capilar', 'landing', null, null,
   'Landing /consulta: botão direto para o WhatsApp', true)
on conflict do nothing;

update ctwa_aberturas
   set rotulo = 'Landing /consulta: botão direto para o WhatsApp (frase antiga, até 03/set/2026)'
 where tenant_id = 'instituto-lorena'
   and trecho = 'vim pelo site e quero falar sobre a avaliacao capilar';
