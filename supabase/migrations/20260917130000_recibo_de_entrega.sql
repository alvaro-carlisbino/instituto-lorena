-- Recibo da mensagem: enviada, entregue, lida, ouvida, falhou (17/set/2026).
--
-- A W-API manda `webhookStatus` para cada mensagem ("READ", "DELIVERY_ACK", ...) e o CRM só usava
-- isso para contar falha da linha. A atendente não sabia se a paciente tinha visto a mensagem, que
-- é o que ela olha no celular antes de decidir cobrar de novo ou esperar. Guardado na própria
-- interação, pelo `external_message_id` (já indexado). Só sobe: um "entregue" atrasado não desfaz
-- um "lido" (ordem em `_shared/whatsapp/wapi.ts`, ORDEM_DO_STATUS).

alter table public.interactions
  add column if not exists delivery_status text,
  add column if not exists delivery_status_at timestamptz;

comment on column public.interactions.delivery_status is
  'Recibo do WhatsApp para mensagem que SAIU: sent | delivered | read | played | failed. Ver 20260917130000.';

notify pgrst, 'reload schema';
