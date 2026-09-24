-- Transferência com uso e data (pedido do Álvaro, 24/09/2026).
--
-- "Usei 3 L de álcool, preciso registrar": a Édina lançou como transferência do Principal para o
-- Centro Cirúrgico, mas parte do que vai para o setor é GASTO lá. E "às vezes usamos ontem":
-- o lançamento precisa da data do uso. E a transferência tem que poder ser corrigida depois.
--
-- Cada item da transferência passa a ter duas quantidades: levou (qty, o que saiu da origem e
-- entrou no setor) e usou (usado, o que o setor gastou). O uso é uma saída no setor de destino,
-- ref_type 'stock_uso', no dia informado; a Lista de compra conta como gasto. Usou menos do que
-- tinha lançado vira 'estorno' com ref_id = a transferência (a Lista de compra já desconta
-- estorno, e as views de custo já ignoram). Levou menos devolve do setor para a origem.
--
-- Tudo passa por _stock_transferencia_aplicar, que compara o que foi pedido com o que os
-- movimentos dizem e grava só a diferença: criar (tudo zero antes) e editar são a mesma conta.

alter table public.stock_transfers add column if not exists feito_em date;
comment on column public.stock_transfers.feito_em is
  'Dia em que a transferência aconteceu (pode ser antes do dia em que foi registrada).';

alter table public.stock_transfer_items add column if not exists usado numeric not null default 0;
comment on column public.stock_transfer_items.qty is 'Quanto levou: saiu da origem e entrou no setor.';
comment on column public.stock_transfer_items.usado is 'Quanto o setor de destino gastou do que levou (baixa no estoque).';
-- Editar pode zerar uma linha (lançou o item errado); a linha fica, com zero.
alter table public.stock_transfer_items drop constraint if exists stock_transfer_items_qty_check;
alter table public.stock_transfer_items add constraint stock_transfer_items_qty_check check (qty >= 0);
alter table public.stock_transfer_items drop constraint if exists stock_transfer_items_usado_check;
alter table public.stock_transfer_items add constraint stock_transfer_items_usado_check check (usado >= 0 and usado <= qty);

-- Dia informado na tela → instante dos movimentos. Hoje (ou vazio) é agora; dia passado entra ao
-- meio-dia de Brasília, para cair no dia certo em qualquer relatório por período.
create or replace function public._stock_instante_do_dia(p_dia date)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_dia is null or p_dia = v_hoje then return now(); end if;
  if p_dia > v_hoje then raise exception 'A data não pode ser depois de hoje.'; end if;
  if p_dia < v_hoje - 30 then raise exception 'A data é de mais de 30 dias atrás: confira o dia.'; end if;
  return (p_dia + time '12:00') at time zone 'America/Sao_Paulo';
end;
$$;
-- Chamada por funções security invoker: o papel final (authenticated) precisa do execute.
revoke all on function public._stock_instante_do_dia(date) from public, anon;
grant execute on function public._stock_instante_do_dia(date) to authenticated, service_role;

-- Número para mensagem: 2,5 e não 2.500000.
create or replace function public._stock_qtd_texto(p numeric)
returns text
language sql
immutable
set search_path = public
as $$ select replace(trim_scale(round(p, 3))::text, '.', ','); $$;
revoke all on function public._stock_qtd_texto(numeric) from public, anon;
grant execute on function public._stock_qtd_texto(numeric) to authenticated, service_role;

-- ------------------------------------------------------------------ o coração
create or replace function public._stock_transferencia_aplicar(p_transfer uuid, p_itens jsonb, p_quando timestamptz)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_tr public.stock_transfers%rowtype;
  v_de text;
  v_para text;
  v_linha record;
  v_item public.stock_items%rowtype;
  v_levou numeric;
  v_usou numeric;
  v_falta numeric;
  v_parte numeric;
  v_f record;
  v_custo_item integer;
  v_mov int := 0;
  -- Lançamento com data passada guarda quando foi digitado: o movimento leva o dia do uso, e o
  -- histórico precisa dizer também quando alguém registrou.
  v_lancado text := case when abs(extract(epoch from now() - p_quando)) > 60
                         then ' · lançado ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
                         else '' end;
begin
  select * into v_tr from public.stock_transfers t where t.id = p_transfer;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  select w.name into v_de from public.stock_warehouses w where w.id = v_tr.from_warehouse_id;
  select w.name into v_para from public.stock_warehouses w where w.id = v_tr.to_warehouse_id;

  for v_linha in
    select (e->>'item_id')::uuid as item_id,
           sum(greatest(coalesce((e->>'qty')::numeric, 0), 0)) as levou,
           sum(greatest(coalesce((e->>'usado')::numeric, 0), 0)) as usou
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     where nullif(e->>'item_id', '') is not null
     group by 1
  loop
    select * into v_item from public.stock_items i where i.id = v_linha.item_id and i.tenant_id = v_tr.tenant_id;
    if not found then raise exception 'Item de estoque não encontrado.'; end if;
    if v_linha.usou > v_linha.levou + 1e-9 then
      raise exception '"%": usou % mas levou %. Usado não passa do que levou.',
        v_item.name, public._stock_qtd_texto(v_linha.usou), public._stock_qtd_texto(v_linha.levou);
    end if;

    -- Como está hoje, pelos movimentos (não pela linha gravada): levou = o que entrou no setor
    -- por esta transferência; usou = saídas de uso menos as correções.
    select coalesce(sum(m.qty_delta) filter (where m.ref_type = 'stock_transfer' and m.warehouse_id = v_tr.to_warehouse_id), 0),
           coalesce(-sum(m.qty_delta) filter (where m.ref_type in ('stock_uso', 'estorno')), 0)
      into v_levou, v_usou
      from public.stock_movements m
     where m.tenant_id = v_tr.tenant_id and m.item_id = v_linha.item_id and m.ref_id = v_tr.id::text
       and m.ref_type in ('stock_transfer', 'stock_uso', 'estorno');

    if v_linha.usou > v_usou + 1e-9 and v_item.controlled then
      raise exception '"%" é controlado: sai pelo kit ou pela baixa com o nome do paciente, não como uso do setor.', v_item.name;
    end if;

    -- 1) Usou menos do que estava lançado: volta ao setor, do uso mais recente para trás.
    v_falta := v_usou - v_linha.usou;
    if v_falta > 1e-9 then
      for v_f in
        select m.batch_id, -sum(m.qty_delta) as usado_lote, max(m.unit_cost_cents) as custo
          from public.stock_movements m
         where m.tenant_id = v_tr.tenant_id and m.item_id = v_linha.item_id and m.ref_id = v_tr.id::text
           and m.ref_type in ('stock_uso', 'estorno')
         group by m.batch_id
        having -sum(m.qty_delta) > 1e-9
         order by max(m.created_at) desc
      loop
        exit when v_falta <= 1e-9;
        v_parte := least(v_falta, v_f.usado_lote);
        insert into public.stock_movements
          (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents, created_at)
        values
          (v_tr.tenant_id, v_linha.item_id, 'entrada', v_parte, 'uso corrigido', 'Uso · ' || v_para || v_lancado,
           'estorno', v_tr.id::text, v_f.batch_id, v_tr.to_warehouse_id, v_f.custo, p_quando);
        v_falta := v_falta - v_parte;
        v_mov := v_mov + 1;
      end loop;
    end if;

    -- 2) Levou mais: sai da origem por FEFO e entra no setor, no mesmo lote e custo.
    v_falta := v_linha.levou - v_levou;
    if v_falta > 1e-9 then
      select c.unit_cost_cents into v_custo_item from public.stock_item_last_costs c
       where c.tenant_id = v_tr.tenant_id and c.item_id = v_linha.item_id;
      for v_f in select f.lote_id, f.parte, f.custo_cents
                   from public._stock_fefo(v_tr.tenant_id, v_linha.item_id, v_tr.from_warehouse_id, v_falta) f
      loop
        insert into public.stock_movements
          (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents, created_at)
        values
          (v_tr.tenant_id, v_linha.item_id, 'saida', -v_f.parte, 'transferência', 'Para ' || v_para || v_lancado,
           'stock_transfer', v_tr.id::text, v_f.lote_id, v_tr.from_warehouse_id, coalesce(v_f.custo_cents, v_custo_item), p_quando),
          (v_tr.tenant_id, v_linha.item_id, 'entrada', v_f.parte, 'transferência', 'De ' || v_de || v_lancado,
           'stock_transfer', v_tr.id::text, v_f.lote_id, v_tr.to_warehouse_id, coalesce(v_f.custo_cents, v_custo_item), p_quando);
        v_mov := v_mov + 2;
      end loop;
    end if;

    -- 3) Usou mais: sai do setor, dos lotes que esta transferência levou para lá (vence antes, sai antes).
    v_falta := v_linha.usou - v_usou;
    if v_falta > 1e-9 then
      for v_f in
        select m.batch_id,
               coalesce(sum(m.qty_delta) filter (where m.ref_type = 'stock_transfer'), 0)
                 + coalesce(sum(m.qty_delta) filter (where m.ref_type in ('stock_uso', 'estorno')), 0) as livre,
               max(m.unit_cost_cents) as custo
          from public.stock_movements m
          left join public.stock_batches b on b.id = m.batch_id
         where m.tenant_id = v_tr.tenant_id and m.item_id = v_linha.item_id and m.ref_id = v_tr.id::text
           and m.warehouse_id = v_tr.to_warehouse_id
           and m.ref_type in ('stock_transfer', 'stock_uso', 'estorno')
         group by m.batch_id
         order by max(b.expires_on) asc nulls last
      loop
        exit when v_falta <= 1e-9;
        continue when v_f.livre <= 1e-9;
        v_parte := least(v_falta, v_f.livre);
        insert into public.stock_movements
          (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents, created_at)
        values
          (v_tr.tenant_id, v_linha.item_id, 'saida', -v_parte, 'uso do setor', 'Uso · ' || v_para || v_lancado,
           'stock_uso', v_tr.id::text, v_f.batch_id, v_tr.to_warehouse_id, v_f.custo, p_quando);
        v_falta := v_falta - v_parte;
        v_mov := v_mov + 1;
      end loop;
      if v_falta > 1e-9 then raise exception '"%": não achei o que foi levado para dar baixa.', v_item.name; end if;
    end if;

    -- 4) Levou menos: o que sobrou desta transferência no setor volta para a origem.
    v_falta := v_levou - v_linha.levou;
    if v_falta > 1e-9 then
      for v_f in
        select m.batch_id,
               coalesce(sum(m.qty_delta) filter (where m.ref_type = 'stock_transfer'), 0)
                 + coalesce(sum(m.qty_delta) filter (where m.ref_type in ('stock_uso', 'estorno')), 0) as livre,
               max(m.unit_cost_cents) as custo
          from public.stock_movements m
          left join public.stock_batches b on b.id = m.batch_id
         where m.tenant_id = v_tr.tenant_id and m.item_id = v_linha.item_id and m.ref_id = v_tr.id::text
           and m.warehouse_id = v_tr.to_warehouse_id
           and m.ref_type in ('stock_transfer', 'stock_uso', 'estorno')
         group by m.batch_id
         order by max(b.expires_on) desc nulls first
      loop
        exit when v_falta <= 1e-9;
        continue when v_f.livre <= 1e-9;
        v_parte := least(v_falta, v_f.livre);
        insert into public.stock_movements
          (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents, created_at)
        values
          (v_tr.tenant_id, v_linha.item_id, 'saida', -v_parte, 'transferência corrigida', 'Voltou para ' || v_de || v_lancado,
           'stock_transfer', v_tr.id::text, v_f.batch_id, v_tr.to_warehouse_id, v_f.custo, p_quando),
          (v_tr.tenant_id, v_linha.item_id, 'entrada', v_parte, 'transferência corrigida', 'Voltou de ' || v_para || v_lancado,
           'stock_transfer', v_tr.id::text, v_f.batch_id, v_tr.from_warehouse_id, v_f.custo, p_quando);
        v_falta := v_falta - v_parte;
        v_mov := v_mov + 2;
      end loop;
      if v_falta > 1e-9 then raise exception '"%": não achei o que foi levado para devolver.', v_item.name; end if;
    end if;

    update public.stock_transfer_items
       set qty = v_linha.levou, usado = v_linha.usou
     where transfer_id = v_tr.id and item_id = v_linha.item_id;
    if not found and v_linha.levou > 0 then
      insert into public.stock_transfer_items (tenant_id, transfer_id, item_id, qty, usado)
      values (v_tr.tenant_id, v_tr.id, v_linha.item_id, v_linha.levou, v_linha.usou);
    end if;
  end loop;
  return v_mov;
end;
$$;
revoke all on function public._stock_transferencia_aplicar(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public._stock_transferencia_aplicar(uuid, jsonb, timestamptz) to authenticated, service_role;

-- ------------------------------------------------------------------ transferir (com uso e data)
drop function if exists public.stock_transferir(uuid, uuid, jsonb, text);
create or replace function public.stock_transferir(
  p_de uuid,
  p_para uuid,
  p_itens jsonb,
  p_obs text default null,
  p_dia date default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_de public.stock_warehouses%rowtype;
  v_para public.stock_warehouses%rowtype;
  v_tr public.stock_transfers%rowtype;
  v_quando timestamptz := public._stock_instante_do_dia(p_dia);
  v_movimentos int;
begin
  if p_de is null or p_para is null then raise exception 'Escolha o setor de origem e o de destino.'; end if;
  if p_de = p_para then raise exception 'Origem e destino precisam ser setores diferentes.'; end if;
  select * into v_de from public.stock_warehouses w where w.id = p_de and w.active;
  if not found then raise exception 'Setor de origem não encontrado.'; end if;
  select * into v_para from public.stock_warehouses w where w.id = p_para and w.active;
  if not found then raise exception 'Setor de destino não encontrado.'; end if;
  if v_de.tenant_id <> v_para.tenant_id then raise exception 'Setores de polos diferentes.'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     where nullif(e->>'item_id', '') is not null and coalesce((e->>'qty')::numeric, 0) > 0
  ) then
    raise exception 'Inclua ao menos um item com quantidade.';
  end if;

  insert into public.stock_transfers (tenant_id, from_warehouse_id, to_warehouse_id, note, feito_em)
  values (v_de.tenant_id, p_de, p_para, nullif(btrim(p_obs), ''), (v_quando at time zone 'America/Sao_Paulo')::date)
  returning * into v_tr;

  v_movimentos := public._stock_transferencia_aplicar(v_tr.id, p_itens, v_quando);
  return jsonb_build_object('transfer_id', v_tr.id, 'movimentos', v_movimentos);
end;
$$;
revoke all on function public.stock_transferir(uuid, uuid, jsonb, text, date) from public, anon;
grant execute on function public.stock_transferir(uuid, uuid, jsonb, text, date) to authenticated, service_role;

-- ------------------------------------------------------------------ editar (e dar baixa)
-- p_itens diz como cada item tem que ficar ({item_id, qty, usado}); item fora da lista não muda.
-- p_dia é o dia desta alteração (o uso de ontem registrado hoje).
create or replace function public.stock_transferencia_editar(
  p_id uuid,
  p_itens jsonb,
  p_dia date default null,
  p_obs text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tr public.stock_transfers%rowtype;
  v_movimentos int;
begin
  select * into v_tr from public.stock_transfers t where t.id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if v_tr.cancelled_at is not null then raise exception 'Transferência cancelada não se edita.'; end if;
  v_movimentos := public._stock_transferencia_aplicar(v_tr.id, p_itens, public._stock_instante_do_dia(p_dia));
  if p_obs is not null then
    update public.stock_transfers set note = nullif(btrim(p_obs), '') where id = v_tr.id;
  end if;
  return jsonb_build_object('movimentos', v_movimentos);
end;
$$;
revoke all on function public.stock_transferencia_editar(uuid, jsonb, date, text) from public, anon;
grant execute on function public.stock_transferencia_editar(uuid, jsonb, date, text) to authenticated, service_role;

-- ------------------------------------------------------------------ cancelar
-- Desfaz a transferência (cada lote volta ao setor de onde saiu) e o uso (estorno do que o setor
-- gastou, que a Lista de compra desconta do gasto).
create or replace function public.stock_transferencia_cancelar(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tr public.stock_transfers%rowtype;
  v_uso int := 0;
  v_movimentos int := 0;
begin
  select * into v_tr from public.stock_transfers t where t.id = p_id for update;
  if not found then raise exception 'Transferência não encontrada.'; end if;
  if v_tr.cancelled_at is not null then raise exception 'Esta transferência já foi cancelada.'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Diga o motivo do cancelamento.'; end if;

  insert into public.stock_movements
    (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
  select v_tr.tenant_id, m.item_id, 'entrada', -sum(m.qty_delta), 'uso cancelado', btrim(p_motivo),
         'estorno', v_tr.id::text, m.batch_id, m.warehouse_id, max(m.unit_cost_cents)
    from public.stock_movements m
   where m.tenant_id = v_tr.tenant_id and m.ref_id = v_tr.id::text and m.ref_type in ('stock_uso', 'estorno')
   group by m.item_id, m.batch_id, m.warehouse_id
  having sum(m.qty_delta) < 0;
  get diagnostics v_uso = row_count;

  insert into public.stock_movements
    (tenant_id, item_id, kind, qty_delta, reason, note, ref_type, ref_id, batch_id, warehouse_id, unit_cost_cents)
  select v_tr.tenant_id, m.item_id,
         case when sum(m.qty_delta) > 0 then 'saida' else 'entrada' end,
         -sum(m.qty_delta), 'transferência cancelada', btrim(p_motivo),
         'stock_transfer', v_tr.id::text, m.batch_id, m.warehouse_id, max(m.unit_cost_cents)
    from public.stock_movements m
   where m.tenant_id = v_tr.tenant_id and m.ref_type = 'stock_transfer' and m.ref_id = v_tr.id::text
   group by m.item_id, m.batch_id, m.warehouse_id
  having sum(m.qty_delta) <> 0;
  get diagnostics v_movimentos = row_count;

  update public.stock_transfers
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_motivo)
   where id = v_tr.id;
  return jsonb_build_object('movimentos', v_movimentos + v_uso);
end;
$$;
revoke all on function public.stock_transferencia_cancelar(uuid, text) from public, anon;
grant execute on function public.stock_transferencia_cancelar(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ estorno avulso e kardex
-- Saída de uso se corrige na transferência, não pelo estorno avulso do kardex.
CREATE OR REPLACE FUNCTION public.stock_movimento_estornar(p_movimento uuid, p_motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
        when 'stock_uso' then 'uma baixa de uso (corrija na transferência)'
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
$function$;

-- Kardex: saída de uso e a correção dela aparecem como "Uso do setor", com o setor que gastou.
CREATE OR REPLACE FUNCTION public.stock_kardex(p_item_id uuid)
 RETURNS TABLE(id uuid, seq bigint, created_at timestamp with time zone, item_id uuid, item_nome text, kind text, qty_delta numeric, saldo numeric, saldo_setor numeric, setor_id uuid, setor_nome text, lote_id uuid, lote text, validade date, custo_unit_cents integer, motivo text, observacao text, ref_type text, ref_id text, autor text, origem jsonb, lote_origem jsonb, estornado_por uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      when mv.ref_type = 'stock_uso'
        or (mv.ref_type = 'estorno' and exists (select 1 from public.stock_transfers t where t.id::text = mv.ref_id)) then (
        select jsonb_build_object(
          'tipo', 'uso', 'id', t.id, 'de', wd.name, 'setor', wp.name,
          'dia', (mv.created_at at time zone 'America/Sao_Paulo')::date,
          'cancelada', t.cancelled_at is not null)
          from public.stock_transfers t
          join public.stock_warehouses wd on wd.id = t.from_warehouse_id
          join public.stock_warehouses wp on wp.id = t.to_warehouse_id
         where t.id::text = mv.ref_id)
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
$function$;
