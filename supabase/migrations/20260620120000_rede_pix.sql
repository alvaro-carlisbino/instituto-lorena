-- =============================================================================
-- e.Rede — suporte a PIX (QR Code) na mesma tabela de cobranças do cartão.
-- =============================================================================
-- A e.Rede gera Pix pelo mesmo recurso de transações (OAuth2 + /v2/transactions).
-- Reusamos rede_payments: 'method' separa cartão de pix; 'pix_payload' guarda o
-- copia-e-cola (EMV) p/ reexibir o QR sem recriar a cobrança.
alter table public.rede_payments
  add column if not exists method      text not null default 'card',  -- card | pix
  add column if not exists pix_payload text;                          -- copia-e-cola (EMV)
