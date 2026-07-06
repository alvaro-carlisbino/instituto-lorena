-- Estoque FASE 3:
--   • Vínculo do kit ao lead/paciente do CRM (antes era só texto livre).
--   • Inventário (contagem física): stock_counts + stock_count_items. Ao finalizar,
--     as divergências viram movimentos de 'ajuste' (o app faz isso, transacional
--     por item, no mesmo padrão do consumo de kit).

-- 1) Kit aponta pro lead (texto, sem FK rígida: leads.id é text e não queremos que
--    apagar um lead derrube o histórico do kit)
alter table public.stock_kits add column if not exists lead_id text;

-- 2) Contagem de inventário (cabeçalho)
create table if not exists public.stock_counts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default public.current_tenant_id() references public.tenants (id),
  label        text not null,
  status       text not null default 'aberta',   -- 'aberta' | 'finalizada' | 'cancelada'
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  finalized_at timestamptz
);
create index if not exists stock_counts_tenant_idx on public.stock_counts (tenant_id, status, created_at desc);

-- 3) Itens contados (saldo do sistema no momento da contagem + o que foi contado)
create table if not exists public.stock_count_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default public.current_tenant_id() references public.tenants (id),
  count_id    uuid not null references public.stock_counts (id) on delete cascade,
  item_id     uuid not null references public.stock_items (id) on delete cascade,
  system_qty  numeric not null default 0,   -- saldo do sistema quando a contagem abriu
  counted_qty numeric,                       -- null = ainda não contado
  created_at  timestamptz not null default now(),
  unique (tenant_id, count_id, item_id)
);
create index if not exists stock_count_items_count_idx on public.stock_count_items (tenant_id, count_id);

-- 4) RLS — mesmo padrão das fases 1/2
do $$
declare t text;
begin
  foreach t in array array['stock_counts', 'stock_count_items'] loop
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
