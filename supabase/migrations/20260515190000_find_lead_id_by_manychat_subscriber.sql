-- Resolve lead por qualquer ID ManyChat associado (primário, WhatsApp secundário ou lista).
create or replace function public.find_lead_id_by_manychat_subscriber(p_subscriber text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.leads l
  where length(trim(coalesce(p_subscriber, ''))) > 0
    and (
      (l.custom_fields ->> 'manychat_subscriber_id') = trim(p_subscriber)
      or (l.custom_fields ->> 'manychat_whatsapp_subscriber_id') = trim(p_subscriber)
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(l.custom_fields -> 'manychat_subscriber_ids', '[]'::jsonb)) x(el)
        where el = trim(p_subscriber)
      )
    )
  limit 1;
$$;

revoke all on function public.find_lead_id_by_manychat_subscriber(text) from public;
grant execute on function public.find_lead_id_by_manychat_subscriber(text) to service_role;
