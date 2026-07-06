-- Código de barras no estoque (pedido do Álvaro 07/jul): bipar item com leitor
-- USB ou câmera pra dar entrada/saída rápido. O EAN (cEAN) da NF-e importada
-- carimba o barcode do item automaticamente.

alter table public.stock_items add column if not exists barcode text;
create index if not exists stock_items_barcode_idx
  on public.stock_items (tenant_id, barcode)
  where barcode is not null;
