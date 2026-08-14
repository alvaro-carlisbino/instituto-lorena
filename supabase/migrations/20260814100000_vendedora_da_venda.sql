-- Quem VENDEU, separado de quem é MÉDICO.
--
-- A Central de Vendas nasceu das planilhas da Aline (transplante) e da Ingrid
-- (protocolos/spa), mas a venda só guardava médico: seller_doctor, attending_doctor
-- e performing_doctor. Nas 418 vendas importadas, seller_doctor traz Lorena, Matheus
-- e Jaqueline — os médicos. "Ingrid" aparece 1 vez em 418 e "Aline", nenhuma.
--
-- Sem esta coluna não existe "o CRM da Aline" nem "o CRM da Ingrid": não dá para
-- dizer de quem é a venda, medir produtividade nem calcular comissão. E não dá para
-- resolver por created_by, porque a recepção da clínica opera em login compartilhado
-- — a conta que registra é a mesma para as duas.

alter table public.clinic_sales
  add column if not exists seller_name text;

comment on column public.clinic_sales.seller_name is
  'Consultora que fechou a venda (Aline, Ingrid…). Não confundir com seller_doctor/attending_doctor, que são o médico da consulta.';

-- Busca por vendedora no período é a consulta do dia a dia ("o que a Ingrid fechou
-- em agosto"), e a tabela é varrida inteira em toda abertura da Central de Vendas.
create index if not exists clinic_sales_seller_name_sold_at_idx
  on public.clinic_sales (tenant_id, seller_name, sold_at desc)
  where seller_name is not null;
