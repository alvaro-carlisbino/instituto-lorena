alter table public.whatsapp_channel_instances
  add column if not exists meta_phone_number_id text;

comment on column public.whatsapp_channel_instances.meta_phone_number_id is
  'Meta WhatsApp Cloud API: phone_number_id do número (webhook metadata). Usado quando WHATSAPP_PROVIDER=official.';

create unique index if not exists whatsapp_channel_instances_meta_phone_number_id_key
  on public.whatsapp_channel_instances (meta_phone_number_id)
  where meta_phone_number_id is not null and trim(meta_phone_number_id) <> '';
