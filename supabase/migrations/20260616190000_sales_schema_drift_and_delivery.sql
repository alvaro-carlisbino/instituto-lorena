-- Versiona colunas que foram adicionadas direto no banco (via MCP) e nunca entraram em
-- migration — sem isto, um ambiente recriado das migrations quebra rede.ts/crm-bling.
-- Tudo idempotente (IF NOT EXISTS). Também garante pagbank_checkouts.customer_name.
--
-- O "modo de entrega" (retirada_clinica | entrega_local_maringa | envio_externo) NÃO é
-- coluna: vive em leads.custom_fields.entrega.delivery_mode (JSON), gravado pela IA.

-- rede_payments: colunas usadas pelo fluxo de cartão + relatório/BI.
ALTER TABLE public.rede_payments ADD COLUMN IF NOT EXISTS kit text;
ALTER TABLE public.rede_payments ADD COLUMN IF NOT EXISTS bling_order_id text;
ALTER TABLE public.rede_payments ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.rede_payments ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.rede_payments ADD COLUMN IF NOT EXISTS items jsonb;

-- pagbank_checkouts: nome do cliente (p/ o retry_bling e o relatório usarem o nome real).
ALTER TABLE public.pagbank_checkouts ADD COLUMN IF NOT EXISTS customer_name text;

-- Índices p/ o relatório de vendas / BI pós-venda (consulta por dia, mais recentes primeiro).
CREATE INDEX IF NOT EXISTS rede_payments_paid_at_idx ON public.rede_payments (paid_at DESC);
CREATE INDEX IF NOT EXISTS rede_payments_status_idx ON public.rede_payments (status);
CREATE INDEX IF NOT EXISTS pagbank_checkouts_paid_at_idx ON public.pagbank_checkouts (paid_at DESC);
CREATE INDEX IF NOT EXISTS pagbank_checkouts_status_idx ON public.pagbank_checkouts (status);
