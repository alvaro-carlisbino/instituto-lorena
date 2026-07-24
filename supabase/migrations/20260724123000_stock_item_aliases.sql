-- Aliases de nome p/ casar item do estoque/kit com a descrição da NF-e.
-- Ex.: kit "TRANSAMIN EV" ↔ NF "ÁCIDO TRANEXÂMICO ..."
alter table public.stock_items
  add column if not exists aliases text[] not null default '{}';

comment on column public.stock_items.aliases is
  'Nomes alternativos (nome da NF, princípio ativo, marca) usados no match da entrada de NF-e.';

create index if not exists stock_items_aliases_gin
  on public.stock_items using gin (aliases);
