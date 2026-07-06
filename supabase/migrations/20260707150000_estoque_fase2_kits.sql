-- Estoque FASE 2 (desenho validado com a enfermagem em 16/jun, simplificado):
--   • Lotes com validade (FEFO — vence primeiro, sai primeiro) via stock_batches;
--     o saldo por lote é derivado de stock_movements.batch_id (livro-razão único).
--   • Kits cirúrgicos: modelo (kit_templates) → kit montado p/ paciente/procedimento
--     (stock_kits). A BAIXA continua por conferência ativa (consumir o kit), nunca
--     automática pela Shosp — decisão de 16/jun (agenda não casa com o físico).
--   • Substâncias controladas: flag no item + livro de registro próprio
--     (controlled_substance_log). SNGPC/transmissão fica FORA por ora (pendência
--     regulatória em aberto); o livro guarda o rastro completo p/ auditoria.

-- 1) Flag de controlado no item
alter table public.stock_items add column if not exists controlled boolean not null default false;

-- 2) Lotes
create table if not exists public.stock_batches (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  item_id    uuid not null references public.stock_items (id) on delete cascade,
  lot_code   text not null,
  expires_on date,
  note       text,
  created_at timestamptz not null default now(),
  unique (tenant_id, item_id, lot_code)
);
create index if not exists stock_batches_item_idx on public.stock_batches (tenant_id, item_id, expires_on);

alter table public.stock_movements add column if not exists batch_id uuid references public.stock_batches (id);

-- Saldo por lote (FEFO ordena por expires_on no app)
create or replace view public.stock_batch_balances
  with (security_invoker = on) as
select
  b.tenant_id,
  b.id as batch_id,
  b.item_id,
  b.lot_code,
  b.expires_on,
  coalesce(sum(m.qty_delta), 0) as qty
from public.stock_batches b
left join public.stock_movements m on m.batch_id = b.id
group by b.tenant_id, b.id;

-- 3) Modelos de kit
create table if not exists public.kit_templates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  name       text not null,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kit_templates_tenant_idx on public.kit_templates (tenant_id, active, name);

create table if not exists public.kit_template_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default public.current_tenant_id() references public.tenants (id),
  template_id uuid not null references public.kit_templates (id) on delete cascade,
  item_id     uuid not null references public.stock_items (id) on delete cascade,
  qty         numeric not null,
  created_at  timestamptz not null default now()
);
create index if not exists kit_template_items_tpl_idx on public.kit_template_items (tenant_id, template_id);

-- 4) Kits montados (paciente/procedimento em texto; vínculo a lead/agenda fica p/ fase 3)
create table if not exists public.stock_kits (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null default public.current_tenant_id() references public.tenants (id),
  template_id     uuid references public.kit_templates (id),
  name            text not null,
  patient_name    text,
  procedure_label text,
  scheduled_for   date,
  status          text not null default 'montado', -- 'montado' | 'consumido' | 'cancelado'
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  consumed_at     timestamptz
);
create index if not exists stock_kits_tenant_idx on public.stock_kits (tenant_id, status, created_at desc);

create table if not exists public.stock_kit_items (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default public.current_tenant_id() references public.tenants (id),
  kit_id     uuid not null references public.stock_kits (id) on delete cascade,
  item_id    uuid not null references public.stock_items (id),
  qty        numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists stock_kit_items_kit_idx on public.stock_kit_items (tenant_id, kit_id);

-- 5) Livro de substâncias controladas (toda entrada/saída de item controlled gera linha)
create table if not exists public.controlled_substance_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default public.current_tenant_id() references public.tenants (id),
  item_id      uuid not null references public.stock_items (id),
  batch_id     uuid references public.stock_batches (id),
  movement_id  uuid references public.stock_movements (id),
  action       text not null,               -- 'entrada' | 'saida' | 'ajuste'
  qty          numeric not null,
  patient_name text,
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists controlled_log_tenant_idx on public.controlled_substance_log (tenant_id, created_at desc);

-- 6) RLS — mesmo padrão das tabelas da fase 1
do $$
declare t text;
begin
  foreach t in array array[
    'stock_batches', 'kit_templates', 'kit_template_items',
    'stock_kits', 'stock_kit_items', 'controlled_substance_log'
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

grant select on public.stock_batch_balances to authenticated;
grant select on public.stock_batch_balances to service_role;
