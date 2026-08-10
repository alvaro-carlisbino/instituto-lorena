-- APIs dos apps "equipe" (interno) e "tricopill" (cliente/assinante).
-- Mesmo princípio do app do paciente: quem usa app não ganha policy nova em
-- tabela do CRM — fala com RPC security definer que já devolve o recorte certo.

-- ===========================================================================
-- APP DA EQUIPE (login é o mesmo do CRM: e-mail + senha, usuário em app_users)
-- ===========================================================================

create or replace function public.staff_me()
returns table (nome text, email text, role text, employee_id uuid, cargo text, tenant_id text)
language sql stable security definer set search_path = public
as $fn$
  select au.name, au.email, au.role, e.id, e.role_title,
         coalesce(au.active_tenant_id, 'instituto-lorena')
  from public.app_users au
  left join public.hr_employees e on e.user_id = au.auth_user_id and e.active
  where au.auth_user_id = auth.uid()
  limit 1
$fn$;

-- Batida de ponto com a cerca conferida NO SERVIDOR. O cálculo hoje mora no
-- front (src/services/rhPonto.ts); num app instalado no celular do colaborador,
-- deixar a regra só no cliente é deixar a regra em lugar nenhum.
create or replace function public.staff_punch(
  p_lat double precision,
  p_lng double precision,
  p_selfie_path text default null,
  p_note text default null
)
returns table (id uuid, at timestamptz, distance_m int, within_fence boolean)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_emp   record;
  v_cfg   record;
  v_dist  int;
  v_in    boolean;
  v_id    uuid;
  v_at    timestamptz := now();
begin
  if not public.is_staff_user() then
    raise exception 'sem permissao';
  end if;

  select e.* into v_emp
  from public.hr_employees e
  where e.user_id = auth.uid() and e.active
  limit 1;
  if v_emp.id is null then
    raise exception 'usuario sem ficha de colaborador';
  end if;

  select * into v_cfg from public.hr_settings s where s.tenant_id = v_emp.tenant_id;

  if v_cfg.lat is not null and v_cfg.lng is not null and p_lat is not null and p_lng is not null then
    -- haversine, raio da Terra 6371 km
    v_dist := round(
      6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - v_cfg.lat) / 2), 2) +
        cos(radians(v_cfg.lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - v_cfg.lng) / 2), 2)
      ))
    );
    v_in := v_dist <= coalesce(v_cfg.radius_m, 150);
  else
    v_dist := null;
    v_in := null;
  end if;

  if coalesce(v_cfg.enforce_fence, true) and v_in is not null and not v_in then
    raise exception 'fora_da_cerca:%', v_dist;
  end if;
  if coalesce(v_cfg.require_selfie, true) and coalesce(p_selfie_path, '') = '' then
    raise exception 'selfie_obrigatoria';
  end if;

  insert into public.hr_time_entries (tenant_id, employee_id, at, lat, lng, distance_m, within_fence, selfie_path, note)
  values (v_emp.tenant_id, v_emp.id, v_at, p_lat, p_lng, v_dist, v_in, nullif(p_selfie_path, ''), p_note)
  returning hr_time_entries.id into v_id;

  return query select v_id, v_at, v_dist, v_in;
end $fn$;

create or replace function public.staff_punches_today()
returns table (id uuid, at timestamptz, distance_m int, within_fence boolean, selfie_path text, manual boolean)
language sql stable security definer set search_path = public
as $fn$
  select t.id, t.at, t.distance_m, t.within_fence, t.selfie_path, t.manual
  from public.hr_time_entries t
  join public.hr_employees e on e.id = t.employee_id
  where e.user_id = auth.uid()
    and (t.at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
  order by t.at
$fn$;

create or replace function public.staff_agenda_hoje()
returns table (prontuario text, paciente text, horario text, servico text, prestador text, status text)
language sql stable security definer set search_path = public
as $fn$
  select a.prontuario, p.nome, a.horario, a.servico, a.prestador, a.status
  from public.shosp_appointments a
  left join public.shosp_patients p on p.prontuario = a.prontuario
  where public.is_staff_user()
    and a.data = (now() at time zone 'America/Sao_Paulo')::date
  order by a.horario
$fn$;

create or replace function public.staff_cirurgia_hoje()
returns jsonb
language sql stable security definer set search_path = public
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'paciente', s.paciente_nome, 'prontuario', s.shosp_prontuario,
    'status', s.status, 'meta', s.meta, 'sala', s.sala,
    'hora_inicio', s.hora_inicio,
    'total_extraidos', s.total_extraidos, 'total_implantados', s.total_implantados,
    'etapa_atual', (
      select e.etapa from public.srg_stages e
      where e.surgery_id = s.id and e.deleted_at is null and e.horario is not null
      order by e.horario desc limit 1
    )
  ) order by s.hora_inicio), '[]'::jsonb)
  from public.srg_surgeries s
  where public.is_staff_user()
    and s.deleted_at is null
    and s.dia = (now() at time zone 'America/Sao_Paulo')::date
$fn$;

create or replace function public.storage_root_folder(p_path text)
returns text language sql immutable as $fn$
  select split_part(coalesce(p_path, ''), '/', 1)
$fn$;

-- Registro da foto clínica depois do upload no bucket paciente-fotos.
create or replace function public.staff_photo_register(
  p_prontuario text,
  p_storage_path text,
  p_angle text,
  p_milestone text,
  p_surgery_id int default null,
  p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $fn$
declare v_id uuid; v_lead text;
begin
  if not public.is_staff_user() then
    raise exception 'sem permissao';
  end if;
  if p_storage_path is null or (public.storage_root_folder(p_storage_path)) is distinct from p_prontuario then
    raise exception 'caminho deve comecar com o prontuario do paciente';
  end if;
  if not exists (select 1 from public.shosp_patients where prontuario = p_prontuario) then
    raise exception 'prontuario % nao existe', p_prontuario;
  end if;

  select lead_id into v_lead from public.shosp_patients where prontuario = p_prontuario;

  insert into public.patient_photos
    (shosp_prontuario, lead_id, surgery_id, storage_path, angle, milestone, taken_by, source, notes)
  values
    (p_prontuario, v_lead, p_surgery_id, p_storage_path, p_angle, p_milestone, auth.uid(), 'equipe', p_notes)
  on conflict (storage_path) do update
    set angle = excluded.angle, milestone = excluded.milestone, notes = excluded.notes
  returning id into v_id;

  return v_id;
end $fn$;

-- Fotos de um paciente para a equipe (guia de enquadramento: mostra a anterior).
create or replace function public.staff_patient_photos(p_prontuario text)
returns table (id uuid, storage_path text, angle text, milestone text, taken_at timestamptz, visible_to_patient boolean)
language sql stable security definer set search_path = public
as $fn$
  select f.id, f.storage_path, f.angle, f.milestone, f.taken_at, f.visible_to_patient
  from public.patient_photos f
  where public.is_staff_user() and f.shosp_prontuario = p_prontuario
  order by f.taken_at desc
$fn$;

-- ===========================================================================
-- APP DO CLIENTE TRICOPILL
-- ===========================================================================

alter table public.tricopill_customers add column if not exists auth_user_id uuid unique references auth.users (id) on delete set null;
create index if not exists tricopill_customers_phone_idx on public.tricopill_customers (tenant_id, phone);

create or replace function public.current_customer_phone()
returns text
language sql stable security definer set search_path = public
as $fn$
  select c.phone from public.tricopill_customers c
  where c.auth_user_id = auth.uid()
  limit 1
$fn$;

create or replace function public.customer_find_by_phone(p_phone text)
returns table (id text, phone text, name text, email text)
language sql stable security definer set search_path = public
as $fn$
  select c.id, c.phone, c.name, c.email
  from public.tricopill_customers c
  where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    and length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
  limit 1
$fn$;

create or replace function public.customer_me()
returns table (nome text, phone text, email text, address jsonb)
language sql stable security definer set search_path = public
as $fn$
  select c.name, c.phone, c.email, c.address
  from public.tricopill_customers c
  where c.auth_user_id = auth.uid()
$fn$;

-- Pedidos do cliente: cartão/Pix pela Rede e Pix/assinatura pelo Asaas, unidos
-- pelo telefone (é a chave que existe nos dois — ver crm_phone_dedup_variants).
create or replace function public.customer_orders()
returns jsonb
language sql stable security definer set search_path = public
as $fn$
  with tel as (select regexp_replace(coalesce(public.current_customer_phone(), ''), '\D', '', 'g') as p)
  select coalesce(jsonb_agg(o order by o->>'criado_em' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id, 'origem', 'rede', 'criado_em', r.created_at, 'pago_em', r.paid_at,
      'status', r.status, 'metodo', r.method, 'kit', r.kit,
      'valor_centavos', r.amount_cents, 'frete_centavos', r.freight_cents,
      'itens', r.items, 'nfe', r.nfe_numero
    ) as o
    from public.rede_payments r, tel
    where tel.p <> '' and regexp_replace(coalesce(r.phone, ''), '\D', '', 'g') like '%' || right(tel.p, 8)
    union all
    select jsonb_build_object(
      'id', a.id, 'origem', 'asaas', 'criado_em', a.created_at, 'pago_em', a.paid_at,
      'status', a.status, 'metodo', a.method, 'kit', a.kit,
      'valor_centavos', a.amount_cents, 'frete_centavos', a.freight_cents,
      'itens', null, 'nfe', null
    ) as o
    from public.asaas_payments a, tel
    where tel.p <> '' and regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') like '%' || right(tel.p, 8)
  ) t
$fn$;

create or replace function public.customer_subscription()
returns jsonb
language sql stable security definer set search_path = public
as $fn$
  with tel as (select regexp_replace(coalesce(public.current_customer_phone(), ''), '\D', '', 'g') as p)
  select coalesce(to_jsonb(s), 'null'::jsonb) from (
    select a.id, a.cadence, a.status, a.paid_cycles, a.units_per_shipment,
           a.monthly_value_cents, a.last_shipped_cycle, a.last_ship_at,
           a.last_ship_status, a.min_cycles, a.entrega
    from public.asaas_subscriptions a, tel
    where tel.p <> '' and regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') like '%' || right(tel.p, 8)
    order by a.created_at desc
    limit 1
  ) s
$fn$;

-- ===========================================================================
-- Grants
-- ===========================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.staff_me()',
    'public.staff_punch(double precision, double precision, text, text)',
    'public.staff_punches_today()',
    'public.staff_agenda_hoje()',
    'public.staff_cirurgia_hoje()',
    'public.staff_photo_register(text, text, text, text, int, text)',
    'public.staff_patient_photos(text)',
    'public.current_customer_phone()',
    'public.customer_me()',
    'public.customer_orders()',
    'public.customer_subscription()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function public.customer_find_by_phone(text) from public, anon, authenticated;
grant execute on function public.customer_find_by_phone(text) to service_role;
