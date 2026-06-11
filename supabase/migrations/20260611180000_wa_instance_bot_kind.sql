-- Persona por linha de WhatsApp: 'clinic' (Sofia / Instituto Lorena, agenda Shosp)
-- ou 'sales' (atendente de vendas — ex.: Tricopill, suplemento capilar).
-- Default 'clinic' preserva 100% do comportamento das linhas existentes.
alter table whatsapp_channel_instances
  add column if not exists bot_kind text not null default 'clinic';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_channel_instances_bot_kind_check'
  ) then
    alter table whatsapp_channel_instances
      add constraint whatsapp_channel_instances_bot_kind_check
      check (bot_kind in ('clinic', 'sales'));
  end if;
end $$;
