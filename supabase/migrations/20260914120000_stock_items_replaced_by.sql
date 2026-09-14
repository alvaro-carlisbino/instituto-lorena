-- Item consolidado: o mesmo produto físico que entrou por várias notas com nomes de fornecedor
-- ("LUVA CIRURGICA ESTERIL 7,0 (BE CARE)", "LUVA CIRURGICA 7,0 ESTERIL C/200 PARES") passa a
-- apontar para o item que a enfermagem conta ("LUVA 7,0 (ESTERIL)"). O item antigo fica
-- inativo, com saldo zero e o histórico de compra intacto.
--
-- Sem o ponteiro, a próxima nota do mesmo fornecedor casa pelo nome/EAN com o item antigo
-- (a importação lê também os inativos) e o saldo volta a se dividir em dois — a contagem
-- deixaria de valer na primeira entrada da SEFAZ.
alter table public.stock_items
  add column if not exists replaced_by uuid references public.stock_items (id);

comment on column public.stock_items.replaced_by is
  'Item que substituiu este (consolidação por inventário). A entrada de NF-e segue o ponteiro.';

create index if not exists stock_items_replaced_by_idx
  on public.stock_items (replaced_by) where replaced_by is not null;
