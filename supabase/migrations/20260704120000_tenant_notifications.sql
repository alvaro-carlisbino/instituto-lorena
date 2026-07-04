-- Config de notificações internas por tenant (ex.: grupo de WhatsApp que recebe o
-- comprovante de cada venda confirmada, p/ lançamento e conferência do financeiro):
--   { "sales_receipt_group_jid": "1203...@g.us", "sales_receipt_enabled": true }
-- O grupo se auto-registra mandando "#comprovantes" no grupo (crm-wapi-webhook).
alter table tenant_integrations add column if not exists notifications jsonb;
