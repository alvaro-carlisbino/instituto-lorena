-- Rastreio do estoque: de qual nota veio, por onde passou, em que setor está e onde fica.
--
-- Pedido do Álvaro (17/09): "quero saber qual foi a nota que comprou tal item e movimentou
-- estoque". O livro (stock_movements) já guardava ref_type/ref_id de quase tudo, mas nenhuma
-- tela juntava: o histórico do item mostrava os últimos 50 movimentos sem origem, sem saldo
-- corrido e sem os itens de nota consolidados no item contado (replaced_by, 14/09).
--
-- O que muda aqui:
--  1) Todo movimento tem setor explícito. Os setores existiam desde 24/07 e nenhum movimento
--     usava (3.260 linhas com warehouse_id nulo = "padrão"). Nulo significava "o padrão de
--     HOJE": trocar o padrão mudaria o passado de lugar. Backfill + gatilho de inserção.
--  2) Número de lançamento (seq). Tudo que uma função grava numa transação sai com o mesmo
--     created_at; sem desempate o saldo corrido do kardex ficava em ordem aleatória.
--  3) Livro que não se edita: o navegador podia UPDATE/DELETE em movimento e no livro de
--     controlados, e apagar um produto apagava o histórico dele em cascata. Correção agora
--     é estorno (novo lançamento que aponta para o original).
--  4) FEFO por setor numa função só (_stock_fefo), usada por kit, transferência e baixa.
--  5) Transferência numa transação, lote a lote, com cancelamento. A antiga gravava pelo
--     navegador, sem lote: o lote ficava no setor de origem e o saldo por lote se perdia.
--  6) Endereços (onde o item fica dentro do setor) e setor de saída no modelo de kit.
--  7) stock_kardex(item): o histórico completo com nota de origem, lote e a nota que
--     trouxe o lote, paciente do kit, inventário, transferência, autor e saldo corrido.

-- ---------------------------------------------------------------- 1) setor em todo movimento

update public.stock_movements m
   set warehouse_id = w.id
  from public.stock_warehouses w
 where m.warehouse_id is null
   and w.tenant_id = m.tenant_id
   and w.is_default
   and w.active;

create or replace function public._stock_movimento_setor()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.warehouse_id is null then
    select w.id into new.warehouse_id
      from public.stock_warehouses w
     where w.tenant_id = new.tenant_id and w.is_default and w.active
     order by w.created_at
     limit 1;
  elsif not exists (
    select 1 from public.stock_warehouses w where w.id = new.warehouse_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Setor de estoque não pertence a este polo.';
  end if;
  return new;
end;
$$;

revoke all on function public._stock_movimento_setor() from public, anon, authenticated;

drop trigger if exists stock_movements_setor on public.stock_movements;
create trigger stock_movements_setor
  before insert on public.stock_movements
  for each row execute function public._stock_movimento_setor();

-- ---------------------------------------------------------------- 2) número de lançamento

alter table public.stock_movements
  add column if not exists seq bigint generated always as identity;

create index if not exists stock_movements_batch_idx
  on public.stock_movements (batch_id) where batch_id is not null;

-- ---------------------------------------------------------------- 3) livro que não se edita

drop policy if exists "stock_movements tenant update" on public.stock_movements;
drop policy if exists "stock_movements tenant delete" on public.stock_movements;
revoke update, delete, truncate on public.stock_movements from authenticated;
revoke all on public.stock_movements from anon;

drop policy if exists "controlled_substance_log tenant update" on public.controlled_substance_log;
drop policy if exists "controlled_substance_log tenant delete" on public.controlled_substance_log;
revoke update, delete, truncate on public.controlled_substance_log from authenticated;
revoke all on public.controlled_substance_log from anon;

-- Produto com histórico não se apaga: desativa (active=false). O cascade levava o livro junto.
alter table public.stock_movements drop constraint if exists stock_movements_item_id_fkey;
alter table public.stock_movements
  add constraint stock_movements_item_id_fkey
  foreign key (item_id) references public.stock_items (id) on delete restrict;

-- Transferência não se apaga, se cancela (o cancelamento estorna os movimentos).
alter table public.stock_transfers
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid,
  add column if not exists cancel_reason text;
drop policy if exists "stock_transfers tenant delete" on public.stock_transfers;
drop policy if exists "stock_transfer_items tenant delete" on public.stock_transfer_items;
revoke delete, truncate on public.stock_transfers, public.stock_transfer_items from authenticated;

-- RLS com a função fora da linha: `tenant_id = current_tenant_id()` roda por linha e impede
-- índice (mesma causa do sino de 15/09). Só reescreve a regra padrão, idêntica no efeito.
do $$
declare
  r record;
  regra constant text := '(tenant_id = current_tenant_id())';
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in (
         'stock_movements', 'stock_items', 'stock_batches', 'stock_warehouses', 'stock_suppliers',
         'purchase_invoices', 'purchase_orders', 'stock_kits', 'stock_counts', 'stock_count_items',
         'stock_transfers', 'stock_transfer_items', 'controlled_substance_log', 'kit_templates'
       )
  loop
    if r.cmd in ('SELECT', 'DELETE') and r.qual = regra then
      execute format('alter policy %I on public.%I using (tenant_id = (select public.current_tenant_id()))',
        r.policyname, r.tablename);
    elsif r.cmd = 'INSERT' and r.with_check = regra then
      execute format('alter policy %I on public.%I with check (tenant_id = (select public.current_tenant_id()))',
        r.policyname, r.tablename);
    elsif r.cmd = 'UPDATE' and r.qual = regra and r.with_check = regra then
      execute format(
        'alter policy %I on public.%I using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))',
        r.policyname, r.tablename);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 4) FEFO por setor

-- Fatias de lote para tirar p_qty do item no setor: vence antes sai antes; o que faltar sai
-- sem lote (estoque que entrou sem lote). Não grava nada.
create or replace function public._stock_fefo(p_tenant text, p_item_id uuid, p_setor uuid, p_qty numeric)
returns table (lote_id uuid, parte numeric, custo_cents integer)
language sql
stable
security invoker
set search_path = public
as $$
  with saldos as (
    select m.batch_id as lote, sum(m.qty_delta) as saldo, b.expires_on as vence, b.created_at as criado
      from public.stock_movements m
      join public.stock_batches b on b.id = m.batch_id
     where m.tenant_id = p_tenant
       and b.item_id = p_item_id
       and m.warehouse_id = p_setor
     group by m.batch_id, b.expires_on, b.created_at
    having sum(m.qty_delta) > 0
  ),
  fila as (
    select s.lote, s.saldo, s.vence, s.criado,
           coalesce(sum(s.saldo) over (
             order by s.vence asc nulls last, s.criado, s.lote
             rows between unbounded preceding and 1 preceding
           ), 0) as antes
      from saldos s
  ),
  fatias as (
    select f.lote, least(f.saldo, p_qty - f.antes) as qtd, f.vence, f.criado
      from fila f
     where p_qty > 0 and f.antes < p_qty
  )
  select x.lote, x.qtd, c.unit_cost_cents
    from fatias x
    left join public.stock_batch_costs c on c.batch_id = x.lote and c.tenant_id = p_tenant
  union all
  select null::uuid, p_qty - coalesce((select sum(y.qtd) from fatias y), 0), null::integer
   where p_qty - coalesce((select sum(y.qtd) from fatias y), 0) > 0
$$;

-- Chamada por funções security invoker: quem clica precisa do EXECUTE (lição de 17/09).
revoke all on function public._stock_fefo(text, uuid, uuid, numeric) from public, anon;
grant execute on function public._stock_fefo(text, uuid, uuid, numeric) to authenticated, service_role;

create or replace function public.stock_setor_padrao()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select w.id from public.stock_warehouses w
   where w.tenant_id = (select public.current_tenant_id()) and w.is_default and w.active
   order by w.created_at
   limit 1
$$;
revoke all on function public.stock_setor_padrao() from public, anon;
grant execute on function public.stock_setor_padrao() to authenticated, service_role;

-- ---------------------------------------------------------------- 6a) kit sai de um setor

alter table public.kit_templates
  add column if not exists warehouse_id uuid references public.stock_warehouses (id);
alter table public.stock_kits
  add column if not exists warehouse_id uuid references public.stock_warehouses (id);
alter table public.stock_counts
  add column if not exists warehouse_id uuid references public.stock_warehouses (id);

create or replace function public._stock_kit_saida(p_kit public.stock_kits, p_item_id uuid, p_qty numeric, p_motivo text)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.stock_items%rowtype;
  v_setor uuid;
  v_custo_item integer;
  v_fatia record;
  v_mov uuid;
  v_n int := 0;
begin
  if p_qty <= 0 then return 0; end if;
  select * into v_item from public.stock_items where id = p_item_id;
  if not found then raise exception 'Item de estoque não encontrado.'; end if;
  v_setor := coalesce(p_kit.warehouse_id, (
    select w.id from public.stock_warehouses w
     where w.tenant_id = p_kit.tenant_id and w.is_default and w.active
     order by w.created_at limit 1
  ));
  select c.unit_cost_cents into v_custo_item from public.stock_item_last_costs c
   where c.tenant_id = p_kit.tenant_id and c.item_id = p_item_id;

  for v_fatia in select f.lote_id, f.parte, f.custo_cents from public._stock_fefo(p_kit.tenant_id, p_item_id, v_setor, p_qty) f
  loop
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
    values
      (p_kit.tenant_id, p_item_id, 'saida', -v_fatia.parte, p_motivo,
       p_kit.name || coalesce(' · ' || p_kit.patient_name, ''), 'stock_kit', p_kit.id::text,
       v_fatia.lote_id, v_setor, coalesce(v_fatia.custo_cents, v_custo_item))
    returning id into v_mov;
    if v_item.controlled then
      insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
      values (p_kit.tenant_id, p_item_id, v_fatia.lote_id, v_mov, 'saida', v_fatia.parte, p_kit.patient_name, p_motivo);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function public._stock_kit_saida(public.stock_kits, uuid, numeric, text) to authenticated;

-- p_kit ganha "warehouse_id" (opcional): sem ele vale o setor do modelo, e sem esse o padrão.
create or replace function public.stock_kit_montar(p_kit jsonb, p_itens jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_linhas int;
  v_item record;
  v_movimentos int := 0;
  v_controlados int := 0;
begin
  insert into public.stock_kits
    (template_id, name, lead_id, clinic_sale_id, patient_name, procedure_label, scheduled_for, warehouse_id)
  values (
    nullif(p_kit->>'template_id', '')::uuid,
    coalesce(nullif(btrim(p_kit->>'name'), ''), 'Kit'),
    nullif(p_kit->>'lead_id', ''),
    nullif(p_kit->>'clinic_sale_id', '')::uuid,
    nullif(btrim(p_kit->>'patient_name'), ''),
    nullif(btrim(p_kit->>'procedure_label'), ''),
    nullif(p_kit->>'scheduled_for', '')::date,
    coalesce(
      nullif(p_kit->>'warehouse_id', '')::uuid,
      (select t.warehouse_id from public.kit_templates t where t.id = nullif(p_kit->>'template_id', '')::uuid)
    )
  )
  returning * into v_kit;

  insert into public.stock_kit_items (tenant_id, kit_id, item_id, qty, is_extra, charge_cents, label)
  select v_kit.tenant_id, v_kit.id, (e->>'item_id')::uuid, (e->>'qty')::numeric,
         coalesce((e->>'is_extra')::boolean, false),
         greatest(0, coalesce(round((e->>'charge_cents')::numeric), 0))::int,
         nullif(btrim(e->>'label'), '')
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as x(e, ordem)
   where nullif(e->>'item_id', '') is not null
     and coalesce((e->>'qty')::numeric, 0) > 0
   order by ordem;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then raise exception 'O kit precisa de ao menos um item.'; end if;

  -- Uma baixa por produto: o mesmo item no modelo e como avulso sai junto, pelos mesmos lotes.
  for v_item in
    select ki.item_id, sum(ki.qty) as qty
      from public.stock_kit_items ki
     where ki.kit_id = v_kit.id
     group by ki.item_id
  loop
    v_movimentos := v_movimentos + public._stock_kit_saida(v_kit, v_item.item_id, v_item.qty, 'kit montado');
  end loop;

  select count(*) into v_controlados
    from public.controlled_substance_log l
    join public.stock_movements m on m.id = l.movement_id
   where m.ref_type = 'stock_kit' and m.ref_id = v_kit.id::text;

  return jsonb_build_object('kit_id', v_kit.id, 'linhas', v_linhas, 'movimentos', v_movimentos, 'controlados', v_controlados);
end;
$$;
revoke all on function public.stock_kit_montar(jsonb, jsonb) from public, anon;
grant execute on function public.stock_kit_montar(jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- 4b) baixa avulsa por setor

-- Saída manual e bipagem: FEFO no setor, custo do lote (ou último custo), livro de
-- controlados. p_itens = [{"item_id", "qty"}]. Controlado sem paciente não sai.
create or replace function public.stock_baixar(
  p_setor uuid,
  p_itens jsonb,
  p_motivo text default null,
  p_paciente text default null,
  p_origem text default 'manual'
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant text := (select public.current_tenant_id());
  v_setor uuid;
  v_linha record;
  v_item public.stock_items%rowtype;
  v_custo_item integer;
  v_fatia record;
  v_mov uuid;
  v_movimentos int := 0;
  v_controlados int := 0;
  v_paciente text := nullif(btrim(p_paciente), '');
  v_motivo text := coalesce(nullif(btrim(p_motivo), ''), 'saída');
begin
  if v_tenant is null then raise exception 'Sem polo ativo.'; end if;
  if coalesce(p_origem, '') not in ('manual', 'bipagem') then raise exception 'Origem de baixa inválida.'; end if;
  v_setor := coalesce(p_setor, (select public.stock_setor_padrao()));
  if not exists (select 1 from public.stock_warehouses w where w.id = v_setor and w.tenant_id = v_tenant and w.active) then
    raise exception 'Setor de estoque não encontrado.';
  end if;

  for v_linha in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     where nullif(e->>'item_id', '') is not null and coalesce((e->>'qty')::numeric, 0) > 0
     group by 1
  loop
    select * into v_item from public.stock_items i where i.id = v_linha.item_id and i.tenant_id = v_tenant;
    if not found then raise exception 'Item de estoque não encontrado.'; end if;
    if v_item.controlled and v_paciente is null then
      raise exception 'Saída de "%" (controlado) precisa do nome do paciente.', v_item.name;
    end if;
    select c.unit_cost_cents into v_custo_item from public.stock_item_last_costs c
     where c.tenant_id = v_tenant and c.item_id = v_linha.item_id;

    for v_fatia in select f.lote_id, f.parte, f.custo_cents from public._stock_fefo(v_tenant, v_linha.item_id, v_setor, v_linha.qty) f
    loop
      insert into public.stock_movements
        (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, batch_id, warehouse_id, unit_cost_cents)
      values
        (v_tenant, v_linha.item_id, 'saida', -v_fatia.parte, v_motivo,
         case when v_paciente is not null then 'Paciente: ' || v_paciente end,
         case when p_origem = 'bipagem' then 'bipagem' end,
         v_fatia.lote_id, v_setor, coalesce(v_fatia.custo_cents, v_custo_item))
      returning id into v_mov;
      v_movimentos := v_movimentos + 1;
      if v_item.controlled then
        insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
        values (v_tenant, v_linha.item_id, v_fatia.lote_id, v_mov, 'saida', v_fatia.parte, v_paciente, v_motivo);
        v_controlados := v_controlados + 1;
      end if;
    end loop;
  end loop;

  if v_movimentos = 0 then raise exception 'Inclua ao menos um item com quantidade.'; end if;
  return jsonb_build_object('movimentos', v_movimentos, 'controlados', v_controlados);
end;
$$;
revoke all on function public.stock_baixar(uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.stock_baixar(uuid, jsonb, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 5) transferência

-- p_itens = [{"item_id", "qty"}]. Sai do setor de origem por FEFO e entra no destino no
-- MESMO lote e custo: o lote atravessa junto, a validade não se perde no caminho.
create or replace function public.stock_transferir(p_de uuid, p_para uuid, p_itens jsonb, p_obs text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_de public.stock_warehouses%rowtype;
  v_para public.stock_warehouses%rowtype;
  v_tr public.stock_transfers%rowtype;
  v_linha record;
  v_fatia record;
  v_custo_item integer;
  v_movimentos int := 0;
  v_itens int := 0;
begin
  if p_de is null or p_para is null then raise exception 'Escolha o setor de origem e o de destino.'; end if;
  if p_de = p_para then raise exception 'Origem e destino precisam ser setores diferentes.'; end if;
  select * into v_de from public.stock_warehouses w where w.id = p_de and w.active;
  if not found then raise exception 'Setor de origem não encontrado.'; end if;
  select * into v_para from public.stock_warehouses w where w.id = p_para and w.active;
  if not found then raise exception 'Setor de destino não encontrado.'; end if;
  if v_de.tenant_id <> v_para.tenant_id then raise exception 'Setores de polos diferentes.'; end if;

  insert into public.stock_transfers (tenant_id, from_warehouse_id, to_warehouse_id, note)
  values (v_de.tenant_id, p_de, p_para, nullif(btrim(p_obs), ''))
  returning * into v_tr;

  for v_linha in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     where nullif(e->>'item_id', '') is not null and coalesce((e->>'qty')::numeric, 0) > 0
     group by 1
  loop
    if not exists (select 1 from public.stock_items i where i.id = v_linha.item_id and i.tenant_id = v_tr.tenant_id) then
      raise exception 'Item de estoque não encontrado.';
    end if;
    insert into public.stock_transfer_items (tenant_id, transfer_id, item_id, qty)
    values (v_tr.tenant_id, v_tr.id, v_linha.item_id, v_linha.qty);
    v_itens := v_itens + 1;
    select c.unit_cost_cents into v_custo_item from public.stock_item_last_costs c
     where c.tenant_id = v_tr.tenant_id and c.item_id = v_linha.item_id;

    for v_fatia in select f.lote_id, f.parte, f.custo_cents from public._stock_fefo(v_tr.tenant_id, v_linha.item_id, p_de, v_linha.qty) f
    loop
      insert into public.stock_movements
        (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
      values
        (v_tr.tenant_id, v_linha.item_id, 'saida', -v_fatia.parte, 'transferência', 'Para ' || v_para.name,
         'stock_transfer', v_tr.id::text, v_fatia.lote_id, p_de, coalesce(v_fatia.custo_cents, v_custo_item)),
        (v_tr.tenant_id, v_linha.item_id, 'entrada', v_fatia.parte, 'transferência', 'De ' || v_de.name,
         'stock_transfer', v_tr.id::text, v_fatia.lote_id, p_para, coalesce(v_fatia.custo_cents, v_custo_item));
      v_movimentos := v_movimentos + 2;
    end loop;
  end loop;

  if v_itens = 0 then raise exception 'Inclua ao menos um item com quantidade.'; end if;
  return jsonb_build_object('transfer_id', v_tr.id, 'itens', v_itens, 'movimentos', v_movimentos);
end;
$$;
revoke all on function public.stock_transferir(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.stock_transferir(uuid, uuid, jsonb, text) to authenticated, service_role;

-- Desfaz: devolve cada lote ao setor de onde saiu, pelo líquido que a transferência moveu.
create or replace function public.stock_transferencia_cancelar(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tr public.stock_transfers%rowtype;
  v_movimentos int := 0;
begin
  select * into v_tr from public.stock_transfers t where t.id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if v_tr.cancelled_at is not null then raise exception 'Esta transferência já foi cancelada.'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Diga o motivo do cancelamento.'; end if;

  insert into public.stock_movements
    (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
  select v_tr.tenant_id, m.item_id,
         case when sum(m.qty_delta) > 0 then 'saida' else 'entrada' end,
         -sum(m.qty_delta), 'transferência cancelada', btrim(p_motivo),
         'stock_transfer', v_tr.id::text, m.batch_id, m.warehouse_id, max(m.unit_cost_cents)
    from public.stock_movements m
   where m.ref_type = 'stock_transfer' and m.ref_id = v_tr.id::text
   group by m.item_id, m.batch_id, m.warehouse_id
  having sum(m.qty_delta) <> 0;
  get diagnostics v_movimentos = row_count;

  update public.stock_transfers
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_motivo)
   where id = v_tr.id;
  return jsonb_build_object('movimentos', v_movimentos);
end;
$$;
revoke all on function public.stock_transferencia_cancelar(uuid, text) from public, anon;
grant execute on function public.stock_transferencia_cancelar(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 3b) estorno

-- Só para lançamento avulso (manual ou bipagem). Nota, kit, transferência e inventário têm
-- o próprio caminho de correção, que mantém o documento de origem coerente.
create or replace function public.stock_movimento_estornar(p_movimento uuid, p_motivo text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_m public.stock_movements%rowtype;
  v_item public.stock_items%rowtype;
  v_novo uuid;
begin
  select * into v_m from public.stock_movements m where m.id = p_movimento;
  if not found then raise exception 'Movimento não encontrado.'; end if;
  if v_m.ref_type is not null and v_m.ref_type <> 'bipagem' then
    raise exception 'Este movimento veio de %: corrija por lá.',
      case v_m.ref_type
        when 'purchase_invoice' then 'uma nota fiscal'
        when 'stock_kit' then 'um kit (use Corrigir uso e devolução)'
        when 'stock_transfer' then 'uma transferência (cancele a transferência)'
        when 'stock_count' then 'um inventário'
        when 'estorno' then 'um estorno'
        else v_m.ref_type
      end;
  end if;
  if exists (select 1 from public.stock_movements e where e.ref_type = 'estorno' and e.ref_id = p_movimento::text) then
    raise exception 'Este movimento já foi estornado.';
  end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Diga o motivo do estorno.'; end if;

  insert into public.stock_movements
    (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
  values
    (v_m.tenant_id, v_m.item_id,
     case when v_m.kind = 'ajuste' then 'ajuste' when v_m.qty_delta > 0 then 'saida' else 'entrada' end,
     -v_m.qty_delta, 'estorno', btrim(p_motivo), 'estorno', p_movimento::text,
     v_m.batch_id, v_m.warehouse_id, v_m.unit_cost_cents)
  returning id into v_novo;

  select * into v_item from public.stock_items i where i.id = v_m.item_id;
  if v_item.controlled then
    insert into public.controlled_substance_log (tenant_id, item_id, batch_id, movement_id, action, qty, patient_name, note)
    values (v_m.tenant_id, v_m.item_id, v_m.batch_id, v_novo,
            case when v_m.qty_delta > 0 then 'saida' else 'entrada' end,
            abs(v_m.qty_delta), null, 'Estorno: ' || btrim(p_motivo));
  end if;
  return v_novo;
end;
$$;
revoke all on function public.stock_movimento_estornar(uuid, text) from public, anon;
grant execute on function public.stock_movimento_estornar(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 6b) endereços

create table if not exists public.stock_locations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default public.current_tenant_id() references public.tenants (id),
  warehouse_id uuid not null references public.stock_warehouses (id),
  code         text not null check (length(btrim(code)) > 0),
  description  text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists stock_locations_code_uniq
  on public.stock_locations (tenant_id, warehouse_id, upper(btrim(code)));

create table if not exists public.stock_item_locations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default public.current_tenant_id() references public.tenants (id),
  item_id     uuid not null references public.stock_items (id) on delete cascade,
  location_id uuid not null references public.stock_locations (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (item_id, location_id)
);
create index if not exists stock_item_locations_location_idx
  on public.stock_item_locations (tenant_id, location_id);

do $$
declare t text;
begin
  foreach t in array array['stock_locations', 'stock_item_locations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s tenant read" on public.%I', t, t);
    execute format('create policy "%s tenant read" on public.%I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t, t);
    execute format('drop policy if exists "%s tenant insert" on public.%I', t, t);
    execute format('create policy "%s tenant insert" on public.%I for insert to authenticated with check (tenant_id = (select public.current_tenant_id()))', t, t);
    execute format('drop policy if exists "%s tenant update" on public.%I', t, t);
    execute format('create policy "%s tenant update" on public.%I for update to authenticated using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t, t);
    execute format('drop policy if exists "%s tenant delete" on public.%I', t, t);
    execute format('create policy "%s tenant delete" on public.%I for delete to authenticated using (tenant_id = (select public.current_tenant_id()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 7) kardex

-- Histórico completo do item, do mais novo para o mais antigo, com saldo corrido (total e
-- no setor). Inclui os itens consolidados nele (replaced_by, em cadeia): a nota que comprou
-- "LUVA PROC LATEX M CX100" aparece no histórico de LUVA PROCEDIMENTO M.
create or replace function public.stock_kardex(p_item_id uuid)
returns table (
  id uuid,
  seq bigint,
  created_at timestamptz,
  item_id uuid,
  item_nome text,
  kind text,
  qty_delta numeric,
  saldo numeric,
  saldo_setor numeric,
  setor_id uuid,
  setor_nome text,
  lote_id uuid,
  lote text,
  validade date,
  custo_unit_cents integer,
  motivo text,
  observacao text,
  ref_type text,
  ref_id text,
  autor text,
  origem jsonb,
  lote_origem jsonb,
  estornado_por uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive familia(fid) as (
    select p_item_id
    union
    select i.id from public.stock_items i join familia f on i.replaced_by = f.fid
  ),
  movs as (
    select m.*,
           sum(m.qty_delta) over (order by m.created_at, m.seq) as saldo_total,
           sum(m.qty_delta) over (partition by m.warehouse_id order by m.created_at, m.seq) as saldo_no_setor
      from public.stock_movements m
     where m.item_id in (select fid from familia)
  )
  select
    mv.id, mv.seq, mv.created_at, mv.item_id, it.name, mv.kind, mv.qty_delta,
    mv.saldo_total, mv.saldo_no_setor,
    mv.warehouse_id, w.name,
    mv.batch_id, b.lot_code, b.expires_on,
    mv.unit_cost_cents, mv.reason, mv.note, mv.ref_type, mv.ref_id,
    (select au.name from public.app_users au where au.auth_user_id = mv.created_by order by au.active desc limit 1),
    case
      when mv.ref_type = 'purchase_invoice' then (
        select jsonb_build_object(
          'tipo', 'nota', 'id', pi.id, 'numero', pi.number, 'emissao', pi.issue_date,
          'chave', pi.nfe_key, 'fornecedor', s.name, 'total_cents', pi.total_cents)
          from public.purchase_invoices pi
          left join public.stock_suppliers s on s.id = pi.supplier_id
         where pi.id = mv.ref_id::uuid)
      when mv.ref_type = 'nfe_omie' then coalesce((
        select jsonb_build_object(
          'tipo', 'nota', 'id', pi.id, 'numero', pi.number, 'emissao', pi.issue_date,
          'chave', pi.nfe_key, 'fornecedor', s.name, 'total_cents', pi.total_cents)
          from public.purchase_invoices pi
          left join public.stock_suppliers s on s.id = pi.supplier_id
         where pi.nfe_key = mv.ref_id
         limit 1),
        jsonb_build_object('tipo', 'nota', 'chave', mv.ref_id,
          'numero', nullif(ltrim(substr(mv.ref_id, 26, 9), '0'), '')))
      when mv.ref_type = 'purchase_order' then (
        select jsonb_build_object('tipo', 'ordem', 'id', po.id, 'responsavel', po.responsible_name)
          from public.purchase_orders po where po.id = mv.ref_id::uuid)
      when mv.ref_type = 'stock_kit' then (
        select jsonb_build_object(
          'tipo', 'kit', 'id', k.id, 'nome', k.name, 'paciente', k.patient_name,
          'lead_id', k.lead_id, 'status', k.status, 'data', k.scheduled_for)
          from public.stock_kits k where k.id = mv.ref_id::uuid)
      when mv.ref_type = 'stock_count' then (
        select jsonb_build_object('tipo', 'inventario', 'id', c.id, 'nome', c.label)
          from public.stock_counts c where c.id = mv.ref_id::uuid)
      when mv.ref_type = 'stock_transfer' then (
        select jsonb_build_object(
          'tipo', 'transferencia', 'id', t.id, 'de', wd.name, 'para', wp.name,
          'cancelada', t.cancelled_at is not null)
          from public.stock_transfers t
          join public.stock_warehouses wd on wd.id = t.from_warehouse_id
          join public.stock_warehouses wp on wp.id = t.to_warehouse_id
         where t.id = mv.ref_id::uuid)
      when mv.ref_type = 'estorno' then jsonb_build_object('tipo', 'estorno', 'id', mv.ref_id)
      when mv.ref_type = 'bipagem' then jsonb_build_object('tipo', 'bipagem')
      when mv.ref_type in ('inventario_fisico', 'pedido_bling') then jsonb_build_object('tipo', mv.ref_type)
      else null
    end,
    case when mv.batch_id is not null then (
      select jsonb_build_object(
        'nota_id', pi.id, 'numero', pi.number, 'emissao', pi.issue_date, 'fornecedor', s.name)
        from public.stock_movements e
        join public.purchase_invoices pi on pi.id::text = e.ref_id
        left join public.stock_suppliers s on s.id = pi.supplier_id
       where e.batch_id = mv.batch_id and e.ref_type = 'purchase_invoice'
       order by e.created_at, e.seq
       limit 1)
    end,
    (select e.id from public.stock_movements e
      where e.ref_type = 'estorno' and e.ref_id = mv.id::text
      limit 1)
  from movs mv
  join public.stock_items it on it.id = mv.item_id
  left join public.stock_warehouses w on w.id = mv.warehouse_id
  left join public.stock_batches b on b.id = mv.batch_id
  order by mv.created_at desc, mv.seq desc
$$;
revoke all on function public.stock_kardex(uuid) from public, anon;
grant execute on function public.stock_kardex(uuid) to authenticated, service_role;
