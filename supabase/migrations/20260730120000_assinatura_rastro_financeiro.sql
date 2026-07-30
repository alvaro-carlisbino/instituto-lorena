-- Rastro do FINANCEIRO de cada ciclo de assinatura.
--
-- Motivo (30/jul/2026, Kauan): o ciclo 2 da Chayenne cobrou R$160,59 em 29/jul e não deixou nada
-- no Bling — nem pedido, nem conta a receber. O trimestral cobra todo mês e envia a cada 3, e o
-- Bling só era tocado no ciclo de ENVIO. Agora todo ciclo pago lança a mensalidade como conta a
-- receber; estas colunas guardam o desfecho, do mesmo jeito que last_ship_* guarda o do envio
-- (migration 20260729160000). Sem elas, uma conta que não entra volta a ser invisível.
alter table public.asaas_subscriptions
  add column if not exists last_fin_cycle          integer,
  add column if not exists last_fin_status         text,     -- ok | em_aberto | falhou
  add column if not exists last_fin_reason         text,
  add column if not exists last_fin_receivable_id  text,     -- id da conta a receber no Bling
  add column if not exists last_fin_at             timestamptz;

comment on column public.asaas_subscriptions.last_fin_status is
  'Financeiro do último ciclo: ok = conta baixada no Bling; em_aberto = conta criada mas sem taxa p/ baixar; falhou = nada lançado (conferir e lançar na mão).';
