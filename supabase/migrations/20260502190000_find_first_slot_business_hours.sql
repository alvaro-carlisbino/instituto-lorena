-- Antes: o primeiro slot do dia era 00:00 no fuso da clínica → confirmações "00:00" no WhatsApp.
-- Agora: janela diária usa business_hours_* de crm_ai_configs (fallback 08:00–18:00).
-- Opcional: p_local_hour_min / p_local_hour_max filtram hora de início (ex.: tarde 13–17).

drop function if exists public.find_first_appointment_slot(date, date, int);

create or replace function public.find_first_appointment_slot(
  p_starts_on date,
  p_ends_on date,
  p_duration_minutes int,
  p_local_hour_min int default null,
  p_local_hour_max int default null
)
returns table (room_id text, slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
as $$
declare
  d date;
  step interval := (greatest(5, p_duration_minutes) || ' minutes')::interval;
  day_start timestamptz;
  day_end timestamptz;
  r record;
  cand_start timestamptz;
  cand_end timestamptz;
  tz text;
  overlap_exists boolean;
  bh_start time;
  bh_end time;
  slot_hour int;
begin
  select coalesce((select timezone from public.org_settings where id = 'default' limit 1), 'America/Sao_Paulo')
  into tz;

  select
    coalesce((select business_hours_start from public.crm_ai_configs where id = 'default' limit 1), time '08:00'),
    coalesce((select business_hours_end from public.crm_ai_configs where id = 'default' limit 1), time '18:00')
  into bh_start, bh_end;

  d := p_starts_on;
  while d <= p_ends_on loop
    day_start := ((d::text || ' ' || bh_start::text)::timestamp) at time zone tz;
    day_end := ((d::text || ' ' || bh_end::text)::timestamp) at time zone tz;

    for r in
      select rm.id as rid, rm.slot_minutes
      from public.rooms rm
      where rm.active = true
      order by rm.sort_order, rm.name
    loop
      cand_start := day_start;
      while cand_start + (greatest(r.slot_minutes, p_duration_minutes) || ' minutes')::interval
            <= day_end + interval '1 second'
      loop
        cand_end := cand_start + (p_duration_minutes || ' minutes')::interval;

        if cand_end > day_end then
          cand_start := cand_start + step;
          continue;
        end if;

        select exists(
          select 1 from public.appointments a
          where a.room_id = r.rid
            and a.status <> 'cancelled'
            and a.starts_at < cand_end
            and a.ends_at > cand_start
        ) into overlap_exists;

        if not overlap_exists then
          slot_hour := extract(hour from (cand_start at time zone tz))::int;
          if p_local_hour_min is not null and slot_hour < p_local_hour_min then
            cand_start := cand_start + step;
            continue;
          end if;
          if p_local_hour_max is not null and slot_hour > p_local_hour_max then
            cand_start := cand_start + step;
            continue;
          end if;

          room_id := r.rid;
          slot_start := cand_start;
          slot_end := cand_end;
          return next;
          return;
        end if;

        cand_start := cand_start + step;
      end loop;
    end loop;

    d := d + 1;
  end loop;

  return;
end;
$$;

revoke all on function public.find_first_appointment_slot(date, date, int, int, int) from public;
grant execute on function public.find_first_appointment_slot(date, date, int, int, int) to authenticated;
grant execute on function public.find_first_appointment_slot(date, date, int, int, int) to service_role;
