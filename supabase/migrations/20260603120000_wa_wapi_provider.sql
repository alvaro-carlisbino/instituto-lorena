-- Adiciona a W-API (api.w-api.app) como provider alternativo ao Evolution/ManyChat
-- no catálogo `whatsapp_channel_instances`. Cada linha guarda token e instanceId
-- próprios (W-API entrega 1 token por instância no painel deles).
--
-- Não toca em Evolution/ManyChat: apenas amplia o CHECK constraint e adiciona
-- colunas opcionais para credenciais da W-API. Linhas existentes ficam intactas.

alter table public.whatsapp_channel_instances
  drop constraint if exists whatsapp_channel_instances_channel_provider_check;

alter table public.whatsapp_channel_instances
  add constraint whatsapp_channel_instances_channel_provider_check
  check (channel_provider in ('evolution', 'manychat', 'wapi'));

alter table public.whatsapp_channel_instances
  add column if not exists wapi_instance_id text;

alter table public.whatsapp_channel_instances
  add column if not exists wapi_token text;

alter table public.whatsapp_channel_instances
  add column if not exists wapi_base_url text;

alter table public.whatsapp_channel_instances
  add column if not exists wapi_webhook_secret text;

comment on column public.whatsapp_channel_instances.wapi_instance_id is
  'ID da instância no painel da W-API (api.w-api.app). Único por linha, usado para rotear webhook de entrada para o tenant/agente correto.';

comment on column public.whatsapp_channel_instances.wapi_token is
  'Token Bearer da W-API para essa instância. Vai no header Authorization do POST /message/send-text. Sensível — RLS por tenant já protege.';

comment on column public.whatsapp_channel_instances.wapi_base_url is
  'Base URL da W-API. Default aplicado em runtime (https://api.w-api.app/v1) — coluna existe pro caso de a W-API expor regiões/hosts diferentes.';

comment on column public.whatsapp_channel_instances.wapi_webhook_secret is
  'Segredo opcional comparado contra header x-webhook-secret do POST entrante. Vazio = validação desligada (recomenda-se ativar em produção).';

drop index if exists whatsapp_channel_instances_wapi_instance_uidx;

create unique index whatsapp_channel_instances_wapi_instance_uidx
  on public.whatsapp_channel_instances (wapi_instance_id)
  where wapi_instance_id is not null and length(trim(wapi_instance_id)) > 0;
