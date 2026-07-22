-- Open Finance (Pluggy) — vínculo da conta bancária do CRM com a conta no provedor.
-- Cada fin_account pode estar ligada a uma conta do Pluggy (of_account_id) dentro de uma
-- conexão/item (of_item_id). O sync puxa as transações dessa conta pro razão de caixa
-- (fin_transactions, source 'openfinance', dedup por external_id = id da transação Pluggy).
-- Credenciais Pluggy ficam em secrets da edge function, nunca no banco.

alter table public.fin_accounts add column if not exists of_provider     text;   -- 'pluggy'
alter table public.fin_accounts add column if not exists of_item_id      text;   -- conexão (banco) no Pluggy
alter table public.fin_accounts add column if not exists of_account_id   text;   -- conta específica no Pluggy
alter table public.fin_accounts add column if not exists of_last_sync_at timestamptz;

create index if not exists fin_accounts_of_idx
  on public.fin_accounts (tenant_id, of_account_id)
  where of_account_id is not null;
