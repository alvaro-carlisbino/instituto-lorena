-- Juntar o item da nota ao item que a equipe usa, pela ficha do item, com desfazer.
--
-- A nota chega com o nome do fornecedor ("CATETER INTRAV PERIF DE SEGURANCA 22G (BD)") e a
-- enfermagem conta pelo nome dela ("ABOCATH Nº22"). A contagem de 14/09 juntou 252 pares por
-- script (replaced_by); o que ficou de fora aparece como item solto, e a ficha do item contado
-- mostra só o inventário, sem a nota que comprou. Agora quem vê o problema resolve na tela.
--
-- Juntar = o saldo que ainda estiver no item da nota passa para o item contado (lote a lote,
-- setor a setor, lançamento de ajuste que aponta para a junção), o lote passa a ser do item
-- contado, o item da nota fica inativo apontando para ele, e o código de barras e o nome da
-- nota viram apelido (a próxima nota casa sozinha). Modelos de kit e endereços são repontados.
-- Tudo fica registrado em stock_item_juncoes para desfazer e para auditoria.

create table if not exists public.stock_item_juncoes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null default public.current_tenant_id() references public.tenants (id),
  origem_id       uuid not null references public.stock_items (id),
  destino_id      uuid not null references public.stock_items (id),
  lotes_repontados uuid[] not null default '{}',
  modelos_repontados uuid[] not null default '{}',
  codigo_levado   text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  desfeita_em     timestamptz,
  desfeita_por    uuid
);
create index if not exists stock_item_juncoes_destino_idx on public.stock_item_juncoes (tenant_id, destino_id, created_at desc);
create index if not exists stock_item_juncoes_origem_idx on public.stock_item_juncoes (tenant_id, origem_id);

alter table public.stock_item_juncoes enable row level security;
drop policy if exists "stock_item_juncoes tenant read" on public.stock_item_juncoes;
create policy "stock_item_juncoes tenant read" on public.stock_item_juncoes
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists "stock_item_juncoes tenant insert" on public.stock_item_juncoes;
create policy "stock_item_juncoes tenant insert" on public.stock_item_juncoes
  for insert to authenticated with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists "stock_item_juncoes tenant update" on public.stock_item_juncoes;
create policy "stock_item_juncoes tenant update" on public.stock_item_juncoes
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
revoke all on public.stock_item_juncoes from anon;
grant select, insert, update on public.stock_item_juncoes to authenticated;
grant all on public.stock_item_juncoes to service_role;

create or replace function public.stock_item_juntar(p_origem uuid, p_destino uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_o public.stock_items%rowtype;
  v_d public.stock_items%rowtype;
  v_juncao uuid;
  v_lotes uuid[] := '{}';
  v_modelos uuid[] := '{}';
  v_movimentos int := 0;
  v_saldo numeric;
  v_codigo text;
begin
  if p_origem is null or p_destino is null or p_origem = p_destino then
    raise exception 'Escolha dois itens diferentes.';
  end if;
  select * into v_o from public.stock_items i where i.id = p_origem for update;
  if not found then raise exception 'Item da nota não encontrado.'; end if;
  select * into v_d from public.stock_items i where i.id = p_destino for update;
  if not found then raise exception 'Item de destino não encontrado.'; end if;
  if v_o.tenant_id <> v_d.tenant_id then raise exception 'Itens de polos diferentes.'; end if;
  if v_d.replaced_by is not null then
    raise exception '"%" já foi juntado em outro item. Abra o item atual e junte nele.', v_d.name;
  end if;
  if v_o.replaced_by is not null then
    raise exception '"%" já está juntado em outro item. Desfaça lá antes.', v_o.name;
  end if;
  -- Sem ciclo: o destino não pode ser, em cadeia, um item juntado na origem.
  if exists (
    with recursive filhos(fid) as (
      select i.id from public.stock_items i where i.replaced_by = p_origem
      union
      select i.id from public.stock_items i join filhos f on i.replaced_by = f.fid
    )
    select 1 from filhos where fid = p_destino
  ) then
    raise exception '"%" já está juntado em "%".', v_d.name, v_o.name;
  end if;

  select coalesce(sum(m.qty_delta), 0) into v_saldo from public.stock_movements m where m.item_id = p_origem;
  if v_saldo <> 0 and lower(btrim(v_o.unit)) <> lower(btrim(v_d.unit)) then
    raise exception 'O item da nota ainda tem saldo de % % e o item contado é em %. Zere pela contagem antes de juntar, senão a quantidade entra na unidade errada.',
      v_saldo, v_o.unit, v_d.unit;
  end if;

  -- Lotes do item da nota passam a ser do item contado, menos quando ele já tem lote com o
  -- mesmo código (aí o saldo vai para o lote dele e o da nota zera).
  with repontados as (
    update public.stock_batches b
       set item_id = p_destino
     where b.item_id = p_origem
       and not exists (
         select 1 from public.stock_batches d
          where d.tenant_id = b.tenant_id and d.item_id = p_destino and d.lot_code = b.lot_code
       )
    returning b.id
  )
  select coalesce(array_agg(id), '{}') into v_lotes from repontados;

  insert into public.stock_item_juncoes (tenant_id, origem_id, destino_id, lotes_repontados)
  values (v_o.tenant_id, p_origem, p_destino, v_lotes)
  returning id into v_juncao;

  -- Saldo restante: sai do item da nota e entra no contado, no mesmo setor e lote.
  with saldos as (
    select m.batch_id, m.warehouse_id, sum(m.qty_delta) as qtd, max(m.unit_cost_cents) as custo
      from public.stock_movements m
     where m.item_id = p_origem
     group by m.batch_id, m.warehouse_id
    having sum(m.qty_delta) <> 0
  ),
  ins as (
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
    select v_o.tenant_id, p_origem, 'ajuste', -s.qtd, 'item juntado', 'Juntado em ' || v_d.name,
           'juncao', v_juncao::text, s.batch_id, s.warehouse_id, s.custo
      from saldos s
    union all
    select v_o.tenant_id, p_destino, 'ajuste', s.qtd, 'item juntado', 'Veio de ' || v_o.name,
           'juncao', v_juncao::text,
           coalesce(
             case when s.batch_id = any (v_lotes) then s.batch_id end,
             (select d.id from public.stock_batches d
                join public.stock_batches o on o.id = s.batch_id
               where d.tenant_id = v_o.tenant_id and d.item_id = p_destino and d.lot_code = o.lot_code)
           ),
           s.warehouse_id, s.custo
      from saldos s
    returning 1
  )
  select count(*) into v_movimentos from ins;

  with modelos as (
    update public.kit_template_items t set item_id = p_destino where t.item_id = p_origem returning t.id
  )
  select coalesce(array_agg(id), '{}') into v_modelos from modelos;

  insert into public.stock_item_locations (tenant_id, item_id, location_id)
  select l.tenant_id, p_destino, l.location_id from public.stock_item_locations l where l.item_id = p_origem
  on conflict (item_id, location_id) do nothing;
  delete from public.stock_item_locations where item_id = p_origem;

  -- Código de barras e nome da nota viram caminho para a próxima nota casar sozinha.
  v_codigo := nullif(btrim(v_o.barcode), '');
  update public.stock_items d
     set barcode = coalesce(nullif(btrim(d.barcode), ''), v_codigo),
         aliases = (
           select coalesce(array_agg(distinct a), '{}')
             from unnest(
               coalesce(d.aliases, '{}') || v_o.name ||
               case when v_codigo is not null and nullif(btrim(d.barcode), '') is not null and d.barcode <> v_codigo
                    then array[v_codigo] else '{}'::text[] end
             ) a
            where nullif(btrim(a), '') is not null
         ),
         pack_factors = case when lower(btrim(v_o.unit)) = lower(btrim(d.unit))
                             then coalesce(v_o.pack_factors, '{}'::jsonb) || coalesce(d.pack_factors, '{}'::jsonb)
                             else d.pack_factors end,
         updated_at = now()
   where d.id = p_destino;

  update public.stock_items set replaced_by = p_destino, active = false, updated_at = now() where id = p_origem;
  update public.stock_item_juncoes
     set modelos_repontados = v_modelos,
         codigo_levado = case when v_codigo is not null and nullif(btrim(v_d.barcode), '') is null then v_codigo end
   where id = v_juncao;

  return jsonb_build_object('juncao_id', v_juncao, 'movimentos', v_movimentos, 'lotes', coalesce(array_length(v_lotes, 1), 0),
                            'modelos', coalesce(array_length(v_modelos, 1), 0));
end;
$$;
revoke all on function public.stock_item_juntar(uuid, uuid) from public, anon;
grant execute on function public.stock_item_juntar(uuid, uuid) to authenticated, service_role;

-- Desfaz a junção: devolve o saldo, os lotes e os modelos de kit, e reativa o item da nota.
-- O apelido acrescentado fica (não atrapalha e pode ter casado nota depois).
create or replace function public.stock_item_desfazer_juncao(p_juncao uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_j public.stock_item_juncoes%rowtype;
  v_movimentos int := 0;
begin
  select * into v_j from public.stock_item_juncoes j where j.id = p_juncao for update;
  if not found then raise exception 'Junção não encontrada.'; end if;
  if v_j.desfeita_em is not null then raise exception 'Esta junção já foi desfeita.'; end if;

  with liquido as (
    select m.item_id, m.batch_id, m.warehouse_id, sum(m.qty_delta) as qtd, max(m.unit_cost_cents) as custo
      from public.stock_movements m
     where m.ref_type = 'juncao' and m.ref_id = p_juncao::text
     group by m.item_id, m.batch_id, m.warehouse_id
    having sum(m.qty_delta) <> 0
  ),
  ins as (
    insert into public.stock_movements
      (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
    select v_j.tenant_id, l.item_id, 'ajuste', -l.qtd, 'junção desfeita', null, 'juncao', p_juncao::text,
           l.batch_id, l.warehouse_id, l.custo
      from liquido l
    returning 1
  )
  select count(*) into v_movimentos from ins;

  update public.stock_batches set item_id = v_j.origem_id where id = any (v_j.lotes_repontados);
  update public.kit_template_items set item_id = v_j.origem_id where id = any (v_j.modelos_repontados);
  update public.stock_items
     set barcode = case when v_j.codigo_levado is not null and barcode = v_j.codigo_levado then null else barcode end,
         updated_at = now()
   where id = v_j.destino_id;
  update public.stock_items set replaced_by = null, active = true, updated_at = now() where id = v_j.origem_id;
  update public.stock_item_juncoes set desfeita_em = now(), desfeita_por = auth.uid() where id = p_juncao;

  return jsonb_build_object('movimentos', v_movimentos);
end;
$$;
revoke all on function public.stock_item_desfazer_juncao(uuid) from public, anon;
grant execute on function public.stock_item_desfazer_juncao(uuid) to authenticated, service_role;

-- Itens que entraram por nota e ainda não estão juntados em nada: a lista onde se procura o
-- "outro nome" de um item. Com quantas notas, a última, fornecedores e o saldo que sobrou.
create or replace function public.stock_itens_de_nota()
returns table (
  item_id uuid,
  nome text,
  unidade text,
  codigo text,
  ativo boolean,
  notas integer,
  ultima_entrada timestamptz,
  fornecedores text,
  saldo numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select i.id, i.name, i.unit, i.barcode, i.active,
         count(distinct m.ref_id)::int,
         max(m.created_at),
         string_agg(distinct s.name, ', '),
         (select coalesce(sum(x.qty_delta), 0) from public.stock_movements x where x.item_id = i.id)
    from public.stock_items i
    join public.stock_movements m on m.item_id = i.id and m.ref_type = 'purchase_invoice'
    left join public.purchase_invoices pi on pi.id::text = m.ref_id
    left join public.stock_suppliers s on s.id = pi.supplier_id
   where i.replaced_by is null
   group by i.id, i.name, i.unit, i.barcode, i.active
$$;
revoke all on function public.stock_itens_de_nota() from public, anon;
grant execute on function public.stock_itens_de_nota() to authenticated, service_role;

-- O kardex passa a dizer o que é "juncao" e a nota de quem entrou por junção.
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
      when mv.ref_type = 'juncao' then (
        select jsonb_build_object(
          'tipo', 'juncao', 'id', j.id, 'origem', io.name, 'destino', idd.name,
          'desfeita', j.desfeita_em is not null)
          from public.stock_item_juncoes j
          join public.stock_items io on io.id = j.origem_id
          join public.stock_items idd on idd.id = j.destino_id
         where j.id = mv.ref_id::uuid)
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

-- Estorno: junção também se corrige pelo próprio caminho (desfazer).
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
        when 'juncao' then 'uma junção de itens (desfaça a junção)'
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
