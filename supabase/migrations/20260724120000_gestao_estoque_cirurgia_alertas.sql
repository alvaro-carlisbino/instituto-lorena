-- Gestão clínica: armazéns + transferência, responsável na OC, itens avulsos/acréscimos
-- no kit, conta do centro cirúrgico, alertas de consulta sem pagamento (Luana).

-- 1) Armazéns / setores
create table if not exists public.stock_warehouses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  name       text not null,
  code       text,
  active     boolean not null default true,
  is_default boolean not null default false,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stock_warehouses_tenant_idx on public.stock_warehouses (tenant_id, active, name);
create unique index if not exists stock_warehouses_one_default_idx
  on public.stock_warehouses (tenant_id) where is_default and active;

-- 2) warehouse_id nos movimentos (null = armazém padrão do tenant)
alter table public.stock_movements
  add column if not exists warehouse_id uuid references public.stock_warehouses (id);

create index if not exists stock_movements_warehouse_idx
  on public.stock_movements (tenant_id, warehouse_id, item_id, created_at desc);

-- Saldo por armazém (security_invoker)
create or replace view public.stock_warehouse_balances
  with (security_invoker = on) as
select
  m.tenant_id,
  coalesce(m.warehouse_id, dw.id) as warehouse_id,
  m.item_id,
  coalesce(sum(m.qty_delta), 0) as qty
from public.stock_movements m
left join lateral (
  select w.id from public.stock_warehouses w
  where w.tenant_id = m.tenant_id and w.is_default and w.active
  order by w.created_at
  limit 1
) dw on true
group by m.tenant_id, coalesce(m.warehouse_id, dw.id), m.item_id;

grant select on public.stock_warehouse_balances to authenticated, service_role;

-- 3) Transferências entre armazéns (auditoria; movimentos reais ficam em stock_movements)
create table if not exists public.stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default public.current_tenant_id() references public.tenants (id),
  from_warehouse_id uuid not null references public.stock_warehouses (id),
  to_warehouse_id   uuid not null references public.stock_warehouses (id),
  note             text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint stock_transfers_distinct check (from_warehouse_id <> to_warehouse_id)
);
create index if not exists stock_transfers_tenant_idx on public.stock_transfers (tenant_id, created_at desc);

create table if not exists public.stock_transfer_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default public.current_tenant_id() references public.tenants (id),
  transfer_id uuid not null references public.stock_transfers (id) on delete cascade,
  item_id     uuid not null references public.stock_items (id),
  qty         numeric not null check (qty > 0),
  created_at  timestamptz not null default now()
);
create index if not exists stock_transfer_items_transfer_idx on public.stock_transfer_items (tenant_id, transfer_id);

-- 4) Responsável pela compra na OC
alter table public.purchase_orders
  add column if not exists responsible_user_id uuid,
  add column if not exists responsible_name text;

-- 5) Itens avulsos / acréscimos no kit (cobrança ao paciente)
alter table public.stock_kit_items
  add column if not exists is_extra boolean not null default false,
  add column if not exists charge_cents integer not null default 0,
  add column if not exists label text;

-- 6) Conta do centro cirúrgico (Mat/Med, hora sala, anestesia, pagamentos, consumo)
create table if not exists public.surgery_accounts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null default public.current_tenant_id() references public.tenants (id),
  lead_id          text references public.leads (id) on delete set null,
  patient_name     text not null,
  procedure_label  text,
  surgery_date     date,
  kit_id           uuid references public.stock_kits (id) on delete set null,
  status           text not null default 'aberta', -- aberta | fechada | cancelada
  note             text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index if not exists surgery_accounts_tenant_idx on public.surgery_accounts (tenant_id, status, surgery_date desc);

create table if not exists public.surgery_account_lines (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null default public.current_tenant_id() references public.tenants (id),
  account_id      uuid not null references public.surgery_accounts (id) on delete cascade,
  kind            text not null, -- mat_med | hora_sala | anestesia | pagamento | consumo | acrescimo | desconto | outro
  description     text not null,
  qty             numeric not null default 1,
  unit_cents      integer not null default 0,  -- positivo = cobrança; pagamento pode ser negativo
  stock_item_id   uuid references public.stock_items (id),
  created_at      timestamptz not null default now()
);
create index if not exists surgery_account_lines_account_idx on public.surgery_account_lines (tenant_id, account_id);

-- 7) RLS
do $$
declare t text;
begin
  foreach t in array array[
    'stock_warehouses', 'stock_transfers', 'stock_transfer_items',
    'surgery_accounts', 'surgery_account_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s tenant read" on public.%I', t, t);
    execute format('create policy "%s tenant read" on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant insert" on public.%I', t, t);
    execute format('create policy "%s tenant insert" on public.%I for insert to authenticated with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant update" on public.%I', t, t);
    execute format('create policy "%s tenant update" on public.%I for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('drop policy if exists "%s tenant delete" on public.%I', t, t);
    execute format('create policy "%s tenant delete" on public.%I for delete to authenticated using (tenant_id = public.current_tenant_id())', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 8) Seed armazém padrão por tenant (idempotente)
insert into public.stock_warehouses (tenant_id, name, code, is_default, note)
select t.id, 'Principal', 'PRINCIPAL', true, 'Armazém padrão'
from public.tenants t
where not exists (
  select 1 from public.stock_warehouses w where w.tenant_id = t.id and w.is_default
);

-- 9) Alerta: consulta agendada sem pagamento (Luana / gestores)
create or replace function public.crm_unpaid_appointment_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int := 0;
begin
  with unpaid as (
    select a.tenant_id, a.id as appointment_id, a.lead_id, a.starts_at,
           coalesce(nullif(l.patient_name, ''), 'Paciente') as patient_name,
           l.phone
    from appointments a
    join leads l on l.id = a.lead_id
    where a.status in ('confirmed', 'draft')
      and a.starts_at >= now() - interval '1 day'
      and a.starts_at < now() + interval '14 days'
      and a.lead_id is not null
      and not exists (
        select 1 from fin_receivables fr
        where fr.lead_id = a.lead_id
          and fr.tenant_id = a.tenant_id
          and fr.status in ('recebido', 'pago', 'received', 'paid', 'parcial')
      )
      and not exists (
        select 1 from rede_payments rp
        where rp.lead_id = a.lead_id
          and rp.tenant_id = a.tenant_id
          and rp.status = 'paid'
      )
      and not exists (
        select 1 from asaas_payments ap
        where ap.lead_id = a.lead_id
          and ap.tenant_id = a.tenant_id
          and ap.status in ('RECEIVED', 'CONFIRMED', 'paid', 'received')
      )
  ),
  recipients as (
    select u.*, m.auth_user_id
    from unpaid u
    join tenant_members m on m.tenant_id = u.tenant_id and m.role in ('admin', 'gestor')
    union
    -- Luana (e aliases) por e-mail, se for membro do tenant
    select u.*, au.auth_user_id
    from unpaid u
    join app_users au on au.auth_user_id is not null and au.active
      and (
        lower(coalesce(au.email, '')) like '%luana%'
        or lower(coalesce(au.name, '')) like '%luana%'
      )
    join tenant_members tm on tm.tenant_id = u.tenant_id and tm.auth_user_id = au.auth_user_id
  ),
  ins as (
    insert into app_inbox_notifications (auth_user_id, tenant_id, kind, title, body, metadata)
    select distinct r.auth_user_id, r.tenant_id, 'urgent',
           'ALERTA: consulta sem pagamento',
           r.patient_name || ' — ' || to_char(r.starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') ||
             coalesce(' · ' || nullif(r.phone, ''), ''),
           jsonb_build_object(
             'dedupeKey', 'unpaid_appt:' || r.appointment_id,
             'route', '/alertas-pagamento',
             'appointmentId', r.appointment_id,
             'leadId', r.lead_id
           )
    from recipients r
    where r.auth_user_id is not null
      and not exists (
        select 1 from app_inbox_notifications n
        where n.auth_user_id = r.auth_user_id
          and n.metadata->>'dedupeKey' = 'unpaid_appt:' || r.appointment_id
          and n.created_at > now() - interval '24 hours'
      )
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;

grant execute on function public.crm_unpaid_appointment_alerts() to service_role;
grant execute on function public.crm_unpaid_appointment_alerts() to authenticated;

select cron.unschedule('crm-unpaid-appointment-alerts') where exists (
  select 1 from cron.job where jobname = 'crm-unpaid-appointment-alerts'
);
select cron.schedule(
  'crm-unpaid-appointment-alerts',
  '0 11,15,19 * * *',
  $$select public.crm_unpaid_appointment_alerts()$$
);
