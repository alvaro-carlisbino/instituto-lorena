-- NFS-e da clínica: guardar PIS e COFINS da nota para mostrar as "Exclusões e Reduções da
-- Base de Cálculo".
--
-- O financeiro leu a nossa nota 320 ao lado da que o contador emite no portal nacional e
-- cobrou esse campo, que no PDF da Focus sai em branco. O contador (Alex, 21/ago/2026) fechou
-- o que ele é: **a soma de ISS + PIS + COFINS**, o que sai da base do IBS/CBS para o cálculo
-- efetivo. Base fixa: o valor bruto da nota; alíquotas fixas: ISS 2%, PIS 0,65%, COFINS 3%.
--
-- E ele confirmou o que a comparação de XML já tinha provado: **é automático, não é campo de
-- emissão**. O portal CALCULA na hora de imprimir. O número não existe no XML — nem no da
-- nota 272 (portal) nem no da 320 (nossa), conferidos campo a campo: nenhum dos dois tem
-- bloco IBS/CBS. Ou seja, não falta dado na nota; falta o dado na TELA.
--
-- Estas duas colunas guardam o que a SEFIN registrou (tags `vPis` / `vCofins` do XML) para o
-- CRM somar com o ISS e mostrar o valor na lista e no CSV da planilha de controle, sem
-- ninguém abrir XML. Em 2026 o IBS/CBS apurado é zero (ano de teste); em 2027 passa a valer,
-- e o número já estará conferido aqui.

alter table public.nfse_notes
  add column if not exists valor_pis_cents integer,
  add column if not exists valor_cofins_cents integer;

comment on column public.nfse_notes.valor_pis_cents is
  'PIS da nota, lido da tag vPis do XML. Com o COFINS e o ISS forma as "Exclusões e Reduções '
  'da Base de Cálculo" do IBS/CBS — que o PDF da Focus não desenha e o do portal nacional calcula.';
comment on column public.nfse_notes.valor_cofins_cents is
  'COFINS da nota, lido da tag vCofins do XML.';

-- Backfill do que já existe: o valor transmitido está no payload (`valor_pis`/`valor_cofins`,
-- em reais), e ele bate com o XML porque o cálculo usa o mesmo arredondamento ABNT da SEFIN
-- (conferido na 320: vPis 4,22 e vCofins 19,50 no XML, idênticos ao payload). Só o que virou
-- nota: payload de DPS recusada nunca foi transmitido.
update public.nfse_notes
   set valor_pis_cents = round((payload->>'valor_pis')::numeric * 100),
       valor_cofins_cents = round((payload->>'valor_cofins')::numeric * 100)
 where valor_pis_cents is null
   and status in ('autorizado', 'cancelado')
   and payload->>'valor_pis' is not null
   and payload->>'valor_cofins' is not null;
