-- Controle da emissão de NF-e em lote (tela /nfe): guarda o desfecho da nota por venda.
alter table rede_payments
  add column if not exists nfe_id text,
  add column if not exists nfe_numero text,
  add column if not exists nfe_status text,
  add column if not exists nfe_error text,
  add column if not exists nfe_emitted_at timestamptz;

comment on column rede_payments.nfe_status is 'emitida | rascunho | erro — controle da emissão em lote de NF-e via Bling';
