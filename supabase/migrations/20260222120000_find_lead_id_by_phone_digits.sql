-- Deduplication for crm-ingest-webhook: match lead by digits-only phone.
create or replace function public.find_lead_id_by_phone_digits(p_digits text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.leads l
  where length(p_digits) >= 10
    and regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = p_digits
  limit 1
$$;

revoke all on function public.find_lead_id_by_phone_digits(text) from public;
grant execute on function public.find_lead_id_by_phone_digits(text) to service_role;
