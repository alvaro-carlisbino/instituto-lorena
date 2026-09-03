-- Os 12 anúncios de Clique-para-WhatsApp da clínica ganharam frase própria de
-- autopreenchimento em 03/09/2026 (action `prefill` do crm-meta-ads-sync).
--
-- Por quê: em 30 dias, 155 conversas abriram com o texto padrão da Meta
-- ("Olá! Posso ter mais informações sobre isso?" / "Olá! Vi um anúncio e
-- gostaria de saber mais...") e 1 virou consulta. Quem escreveu com as próprias
-- palavras converteu 11%. A frase padrão não pede nada de quem clica.
--
-- Criativo em uso é imutável, então cada frase virou um criativo NOVO (mesmo
-- vídeo, mesma copy) trocado nos anúncios. Os ids abaixo são os novos; os
-- trechos antigos continuam válidos porque as frases novas os contêm.
--
-- Já aplicado em produção pelo MCP na mesma hora; este arquivo é o registro e
-- é idempotente.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

update ctwa_aberturas set criativo_id = '1403021538450735' where trecho = 'video do centro cirurgico';
update ctwa_aberturas set criativo_id = '1693186496146289' where trecho = 'naturalidade no transplante';
update ctwa_aberturas set criativo_id = '950437740886735'  where trecho = 'video sobre queda de cabelo';

insert into ctwa_aberturas (canal, trecho, criativo_id, campanha_id, rotulo, ativo)
select 'ctwa', 'sobrancelha fio a fio', '1632559765159829', null, 'Sobrancelha fio a fio', true
where not exists (select 1 from ctwa_aberturas where trecho = 'sobrancelha fio a fio');

insert into ctwa_aberturas (canal, trecho, criativo_id, campanha_id, rotulo, ativo)
select 'ctwa', 'transplante sem raspagem', '1366887788949244', null, 'Sem raspagem', true
where not exists (select 1 from ctwa_aberturas where trecho = 'transplante sem raspagem');

commit;
