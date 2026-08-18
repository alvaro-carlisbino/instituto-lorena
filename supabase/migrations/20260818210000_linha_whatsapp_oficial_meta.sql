-- Linha de WhatsApp na API OFICIAL da Meta (Cloud API), com credencial POR LINHA.
--
-- O driver `_shared/whatsapp/official.ts` já existia desde jun/26, mas lia phone number id,
-- token e app secret de variáveis de ambiente GLOBAIS. Com um app só e uma linha só isso
-- funcionava; com dois polos não: o token do app da clínica mandaria mensagem pela WABA da
-- clínica mesmo quando a linha resolvida fosse a de vendas. Credencial mora na linha, igual
-- já acontece com a W-API (`wapi_token`, `wapi_webhook_secret`).
--
-- `channel_provider` tinha CHECK fechado em (evolution, manychat, wapi): sem mexer aqui,
-- gravar 'official' no painel devolvia erro de constraint e a linha simplesmente não salvava.

alter table public.whatsapp_channel_instances
  add column if not exists meta_waba_id text,
  add column if not exists meta_access_token text,
  add column if not exists meta_app_secret text;

comment on column public.whatsapp_channel_instances.meta_waba_id is
  'WhatsApp Business Account ID da linha. Usado para listar/enviar templates aprovados.';
comment on column public.whatsapp_channel_instances.meta_access_token is
  'Token permanente do System User com acesso a esta WABA. Vazio = cai no env WHATSAPP_CLOUD_ACCESS_TOKEN.';
comment on column public.whatsapp_channel_instances.meta_app_secret is
  'App secret usado para validar a assinatura x-hub-signature-256 do webhook. Vazio = cai no env WHATSAPP_CLOUD_APP_SECRET.';

alter table public.whatsapp_channel_instances
  drop constraint if exists whatsapp_channel_instances_channel_provider_check;

alter table public.whatsapp_channel_instances
  add constraint whatsapp_channel_instances_channel_provider_check
  check (channel_provider = any (array['evolution'::text, 'manychat'::text, 'wapi'::text, 'official'::text]));

-- O webhook da Meta chega sem nome de instância: o único identificador de linha é
-- `metadata.phone_number_id`. Sem índice, cada mensagem que entra faz seq scan.
create unique index if not exists whatsapp_channel_instances_meta_phone_number_id_key
  on public.whatsapp_channel_instances (meta_phone_number_id)
  where meta_phone_number_id is not null;

notify pgrst, 'reload schema';
