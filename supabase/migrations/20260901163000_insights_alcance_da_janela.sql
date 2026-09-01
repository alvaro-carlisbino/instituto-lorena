-- Alcance de anúncio, para dar FREQUÊNCIA (impressões ÷ pessoas), que é o número padrão
-- de fadiga de criativo.
--
-- `reach` sempre ficou fora da série diária de anúncio de propósito: com `time_increment=1`
-- ele é o primeiro campo que a Meta derruba sob cota. O efeito colateral é que a conta
-- ficou cega para "o criativo cansou?", e em 01/set essa pergunta teve que ser respondida
-- na mão, por CTR e CPC, com quatro criativos caindo ao mesmo tempo.
--
-- Agora a `crm-meta-ads-sync` faz uma chamada extra SEM `time_increment` e grava o agregado
-- da janela como `nivel = 'anuncio_janela'`, com `dia` = último dia da janela. É uma linha
-- por anúncio em vez de uma por anúncio por dia, então não repete o problema de cota, e é
-- exatamente o recorte que a frequência quer: pessoas alcançadas NO PERÍODO, não no dia.
--
-- A check constraint só conhecia 'campanha' e 'anuncio', então o upsert inteiro caía com
-- "violates check constraint" e nem a série diária era gravada. Falhou alto, que é o certo.

alter table public.meta_ads_insights
  drop constraint if exists meta_ads_insights_nivel_check;

alter table public.meta_ads_insights
  add constraint meta_ads_insights_nivel_check
  check (nivel = any (array['campanha'::text, 'anuncio'::text, 'anuncio_janela'::text]));

comment on column public.meta_ads_insights.nivel is
  'campanha e anuncio são a série DIÁRIA. anuncio_janela é o agregado do período (uma linha por anúncio, dia = fim da janela) e é a única linha com reach de anúncio: some as diárias, nunca as três juntas.';
