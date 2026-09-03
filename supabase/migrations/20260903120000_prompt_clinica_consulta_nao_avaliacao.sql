-- A palavra é CONSULTA, não "avaliação".
--
-- Pedido da Aline (03/09/2026), a partir de uma conversa real: a Sofia disse ao paciente
-- que "as expectativas e as condições são definidas com base na avaliação médica detalhada".
-- No balcão da clínica isso soa como uma etapa gratuita anterior à consulta, e o paciente
-- chega na Aline achando que ainda vai ter uma "avaliação" antes de pagar qualquer coisa.
-- O atendimento tem UM nome: consulta.
--
-- O system_prompt completo NÃO é versionado no repositório; ele mora em
-- crm_ai_configs (tenant_id='instituto-lorena', id='default'). Esta migration registra o DELTA.
-- As 3 linhas de WhatsApp estão com whatsapp_channel_instances.ai_system_prompt vazio,
-- então é o prompt do tenant que chega ao paciente (ver crm_prompt_ia_linha_sobrepoe_tenant).
--
-- replace() é idempotente: se o texto antigo já não existir, o UPDATE é no-op.

do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- (1) Resposta de "quanto custa o transplante/tratamento": o preço sai DA CONSULTA.
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'- **Valor do TRANSPLANTE ou TRATAMENTO:** explique que é personalizado, definido após a avaliação.',
       E'- **Valor do TRANSPLANTE ou TRATAMENTO:** explique que é personalizado, definido após a consulta.'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'> Como cada caso é único, o transplante capilar e os tratamentos são totalmente personalizados, definidos após uma avaliação médica detalhada (região doadora, grau da queda, objetivos e necessidades individuais). Por esse motivo, os valores do tratamento são apresentados após a consulta 😊',
       E'> Como cada caso é único, o transplante capilar e os tratamentos são totalmente personalizados, definidos na consulta médica, em que a médica analisa a região doadora, o grau da queda, seus objetivos e necessidades individuais. Por esse motivo, os valores do tratamento são apresentados depois da consulta 😊'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- (2) Consulta online: o que se repete lá é o CUIDADO, não uma "avaliação" à parte.
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'atendem por vídeo, com a mesma avaliação individualizada.',
       E'atendem por vídeo, com o mesmo cuidado individualizado.'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'> 💻 *Consulta online*: por vídeo, de onde você estiver, com a mesma avaliação individualizada',
       E'> 💻 *Consulta online*: por vídeo, de onde você estiver, com o mesmo cuidado individualizado'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';

  -- (3) A trava que não depende de eu ter caçado cada frase: a Sofia parafraseia, e a
  --     paráfrase é que trouxe "avaliação" de volta na conversa da Araci.
  update crm_ai_configs
     set system_prompt = replace(
       system_prompt,
       E'- ❌ Repetir o que já disse antes na mesma conversa.',
       E'- ❌ Repetir o que já disse antes na mesma conversa.\n- ❌ Chamar o atendimento de "avaliação". O nome é **consulta**, sempre. A médica avalia o caso *na consulta*; não existe uma avaliação antes dela nem separada dela.'
     )
   where tenant_id = 'instituto-lorena' and id = 'default';
end $$;
