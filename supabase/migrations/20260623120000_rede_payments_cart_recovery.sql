-- Carrinho abandonado: rastreio de nudges de recuperação de links de pagamento pendentes.
-- recovery_step: 0=nenhum, 1=nudge gentil enviado, 2=nudge final enviado. (worker crm-cart-recovery)
alter table rede_payments
  add column if not exists recovery_step int not null default 0,
  add column if not exists recovery_sent_at timestamptz;

comment on column rede_payments.recovery_step is 'Carrinho abandonado: 0=nenhum nudge, 1=nudge gentil, 2=nudge final. Worker crm-cart-recovery.';
comment on column rede_payments.recovery_sent_at is 'Quando o último nudge de recuperação foi enviado.';
