-- O carimbo de CTWA existia, o cron rodava de 15 em 15 min, e carimbava ZERO leads.
--
-- Motivo: `ctwa_aberturas` só tinha as duas frases próprias dos criativos que
-- subiram em 25/08 às 20h. Todo o resto do tráfego de Clique-para-WhatsApp
-- (os anúncios que rodaram de 18 a 25/08, e o que ainda entra por post
-- impulsionado) abre com o texto que a Meta preenche sozinha quando ninguém
-- define o `text` do link:
--
--     "Olá! Vi um anúncio e gostaria de saber mais..."
--
-- 24 leads da clínica chegaram com essa frase EXATA, caractere por caractere,
-- incluindo as reticências — é texto pré-preenchido, não é gente escrevendo.
-- Nenhum deles casava com nada, então nenhum foi carimbado, e o custo por
-- conversa continuou impossível de fechar.
--
-- A frase genérica não diz DE QUAL anúncio a pessoa veio, e é honesto que o
-- rótulo diga isso. Mas ela diz que veio de anúncio, e isso é a diferença
-- entre "canal desconhecido" e "veio do pago".
--
-- `criativo_id` e `campanha_id` ficam nulos de propósito: a função usa
-- coalesce, então o lead recebe canal sem receber criativo inventado.

insert into ctwa_aberturas (tenant_id, trecho, criativo_id, campanha_id, rotulo, ativo)
values
  ('instituto-lorena', 'vi um anuncio e gostaria de saber mais', null, null,
   'Anúncio Meta · criativo não identificado', true),
  -- O padrão em inglês foi o que o Álvaro pegou no print de 25/08. Some da base
  -- nova, mas segue valendo para lead antigo e para anúncio que alguém suba de
  -- novo sem frase própria.
  ('instituto-lorena', 'can i get more info on this', null, null,
   'Anúncio Meta · criativo não identificado (padrão em inglês)', true)
on conflict do nothing;
