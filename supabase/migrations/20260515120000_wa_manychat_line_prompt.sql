-- Linhas ManyChat no mesmo catálogo que instâncias Evolution + prompt IA por linha.

alter table public.whatsapp_channel_instances
  alter column evolution_instance_name drop not null;

alter table public.whatsapp_channel_instances
  add column if not exists channel_provider text;

update public.whatsapp_channel_instances
set channel_provider = 'evolution'
where channel_provider is null;

alter table public.whatsapp_channel_instances
  alter column channel_provider set default 'evolution';

alter table public.whatsapp_channel_instances
  alter column channel_provider set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_channel_instances_channel_provider_check'
  ) then
    alter table public.whatsapp_channel_instances
      add constraint whatsapp_channel_instances_channel_provider_check
      check (channel_provider in ('evolution', 'manychat'));
  end if;
end $$;

alter table public.whatsapp_channel_instances
  add column if not exists manychat_instance_key text;

alter table public.whatsapp_channel_instances
  add column if not exists ai_system_prompt text not null default '';

comment on column public.whatsapp_channel_instances.channel_provider is
  'evolution = WhatsApp via Evolution API; manychat = Meta via ManyChat (sem QR Evolution).';

comment on column public.whatsapp_channel_instances.manychat_instance_key is
  'Chave opcional no POST ManyChat (crm_instance_key) para escolher esta linha e o respectivo prompt.';

comment on column public.whatsapp_channel_instances.ai_system_prompt is
  'Se não vazio, substitui o system_prompt global (crm_ai_configs default) na chamada interna ao crm-ai-assistant.';

drop index if exists whatsapp_channel_instances_manychat_key_uidx;

create unique index whatsapp_channel_instances_manychat_key_uidx
  on public.whatsapp_channel_instances (manychat_instance_key)
  where manychat_instance_key is not null and length(trim(manychat_instance_key)) > 0;
