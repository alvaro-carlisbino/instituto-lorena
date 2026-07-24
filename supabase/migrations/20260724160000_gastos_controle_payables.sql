-- Gastos e controle (planilha Instituto Lorena):
-- Data | Razão Social | Forma Pagto | C. Custo | Subcategoria | Valor
-- Espelha esses campos em payable_installments (já é a fonte de contas a pagar).

alter table public.payable_installments
  add column if not exists cost_center text,
  add column if not exists counterparty text,
  add column if not exists subcategory text,
  add column if not exists import_key text;

create index if not exists payable_installments_cost_center_idx
  on public.payable_installments (tenant_id, cost_center, due_date);

create index if not exists payable_installments_due_cost_idx
  on public.payable_installments (tenant_id, due_date desc);

-- Dedup de importação da planilha (mesmo tenant + mesma chave de linha).
create unique index if not exists payable_installments_import_key_uniq
  on public.payable_installments (tenant_id, import_key)
  where import_key is not null;
