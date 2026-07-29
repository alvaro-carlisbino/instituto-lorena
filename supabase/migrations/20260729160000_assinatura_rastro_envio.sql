-- Rastro do envio de cada ciclo de assinatura.
--
-- Motivo (29/jul/2026): o Tricopill perguntou se o pedido da Chayenne (assinatura) tinha caído
-- no Melhor Envio e NÃO havia como responder pelo sistema. O ciclo de assinatura:
--   • não cria linha em asaas_payments (some do /pedidos e do financeiro);
--   • chamava autoShipToCart DESCARTANDO o resultado, com `catch {}` mudo — se falhasse,
--     ninguém ficava sabendo;
--   • gravava last_shipped_cycle mesmo quando o envio NÃO saiu, então a falha nunca era retentada;
--   • escrevia a timeline num lead_id que nem existe (assinatura órfã), e o insert falhava calado.
-- Resultado: "está no ar, verde e morto" — só deu pra responder consultando a API do Melhor
-- Envio na mão. Estas colunas guardam o desfecho de cada tentativa no próprio registro da
-- assinatura, que é o único lugar que sempre existe.
alter table public.asaas_subscriptions
  add column if not exists last_ship_cycle       integer,
  add column if not exists last_ship_status      text,
  add column if not exists last_ship_reason      text,
  add column if not exists last_ship_me_order_id text,
  add column if not exists last_ship_at          timestamptz;

comment on column public.asaas_subscriptions.last_ship_status is
  'Desfecho da última tentativa de envio do ciclo: shipped | skipped (ciclo sem envio, ex. trimestral 2/3) | failed.';
comment on column public.asaas_subscriptions.last_ship_reason is
  'Motivo do skipped/failed vindo do autoShipToCart (sem_numero, sem_cep, me_nao_configurado, shipment_failed...).';
comment on column public.asaas_subscriptions.last_ship_me_order_id is
  'Id do carrinho/pedido no Melhor Envio quando o envio saiu.';

-- Backfill do que já dá pra afirmar: ciclo 1 da Chayenne foi enviado e entregue
-- (Melhor Envio ORD-202606138049149, rastreio AP145862516BR, 29/jun/2026).
update public.asaas_subscriptions
   set last_ship_cycle = last_shipped_cycle,
       last_ship_status = 'shipped',
       last_ship_at = '2026-06-29T17:00:24Z'
 where id = '2cf27019ec304cf1'
   and last_shipped_cycle = 1
   and last_ship_status is null;
