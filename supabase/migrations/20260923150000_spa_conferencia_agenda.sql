-- Conferência do SPA: agenda do Shosp × kits (pedido da clínica, 23/09/2026: "estoque do SPA não
-- está conciliando com a agenda do Shosp de atendimento, apenas agenda cirúrgica").
--
-- Toda conferência existente olhava a sala cirúrgica (srg_*) ou a Central de Vendas. O SPA atende
-- ~45 pessoas por dia, muitas só no Shosp, e o kit não guardava nem prontuário nem agendamento:
-- não havia como dizer quem foi atendido sem baixa de material. Em 23/09 existiam 4 kits do SPA.

alter table public.stock_kits
  add column if not exists shosp_prontuario text,
  add column if not exists shosp_agendamento text;

create index if not exists stock_kits_shosp_agendamento_idx on public.stock_kits (shosp_agendamento) where shosp_agendamento is not null;
create index if not exists stock_kits_shosp_prontuario_idx on public.stock_kits (shosp_prontuario) where shosp_prontuario is not null;

-- Atendimento que não usa material (só avaliação, retorno sem procedimento): marcado uma vez,
-- sai da lista de pendentes.
create table if not exists public.stock_spa_sem_material (
  tenant_id text not null default public.current_tenant_id(),
  codigo_agendamento text not null,
  motivo text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (tenant_id, codigo_agendamento)
);
alter table public.stock_spa_sem_material enable row level security;
create policy "stock_spa_sem_material tenant read" on public.stock_spa_sem_material
  for select using (tenant_id = (select public.current_tenant_id()));
create policy "stock_spa_sem_material tenant insert" on public.stock_spa_sem_material
  for insert with check (tenant_id = (select public.current_tenant_id()));
create policy "stock_spa_sem_material tenant delete" on public.stock_spa_sem_material
  for delete using (tenant_id = (select public.current_tenant_id()));
grant select, insert, delete on public.stock_spa_sem_material to authenticated;

create or replace function public.stock_kit_montar(p_kit jsonb, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_kit public.stock_kits%rowtype;
  v_linhas int;
  v_item record;
  v_movimentos int := 0;
  v_controlados int := 0;
begin
  insert into public.stock_kits
    (template_id, name, lead_id, clinic_sale_id, patient_name, procedure_label, scheduled_for, warehouse_id,
     shosp_prontuario, shosp_agendamento)
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
    ),
    nullif(btrim(p_kit->>'shosp_prontuario'), ''),
    nullif(btrim(p_kit->>'shosp_agendamento'), '')
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
$function$;

-- Uma linha por atendimento do Spa Capilar no período (sem desmarcado/falta), com o kit que casa,
-- e uma linha por kit do SPA que não casou com ninguém da agenda.
-- Casamento, do mais seguro ao menos: agendamento gravado no kit; prontuário no mesmo dia;
-- lead no mesmo dia; nome igual no mesmo dia (paciente digitado à mão).
create or replace function public.stock_spa_conferencia(p_de date, p_ate date)
returns table(
  tipo text, codigo_agendamento text, data date, horario text, prestador text, paciente text,
  prontuario text, lead_id text, status text, sem_material boolean,
  kit_id uuid, kit_nome text, kit_status text, casou_por text
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with kits as (
    select k.id, k.name, k.status, k.lead_id, k.shosp_prontuario, k.shosp_agendamento,
           coalesce(k.scheduled_for, (k.created_at at time zone 'America/Sao_Paulo')::date) as dia,
           lower(btrim(regexp_replace(coalesce(k.patient_name, ''), '\s+', ' ', 'g'))) as nome
      from public.stock_kits k
      left join public.kit_templates t on t.id = k.template_id
      left join public.stock_warehouses w on w.id = k.warehouse_id
     where k.tenant_id = (select public.current_tenant_id())
       and k.status <> 'cancelado'
       and (t.setor = 'spa' or w.code = 'SPA')
       and coalesce(k.scheduled_for, (k.created_at at time zone 'America/Sao_Paulo')::date) between p_de - 1 and p_ate + 1
  ),
  agenda as (
    select a.codigo_agendamento, a.data, a.horario, a.prestador, a.prontuario, a.lead_id, a.status,
           btrim(coalesce(a.payload->>'paciente', '')) as paciente,
           lower(btrim(regexp_replace(coalesce(a.payload->>'paciente', ''), '\s+', ' ', 'g'))) as nome
      from public.shosp_appointments a
     where a.data between p_de and p_ate
       and a.prestador ~* '^\s*spa'
       and coalesce(a.status, '') !~* 'desmarc|cancel|falt'
  ),
  casados as (
    select ag.*, m.id as kit_id, m.name as kit_nome, m.status as kit_status, m.por
      from agenda ag
      left join lateral (
        select k.id, k.name, k.status,
               case when k.shosp_agendamento = ag.codigo_agendamento then 'agendamento'
                    when k.shosp_prontuario = ag.prontuario then 'prontuario'
                    when k.lead_id = ag.lead_id then 'cadastro'
                    else 'nome' end as por
          from kits k
         where k.shosp_agendamento = ag.codigo_agendamento
            or (k.dia = ag.data and (
                  (ag.prontuario is not null and k.shosp_prontuario = ag.prontuario)
               or (ag.lead_id is not null and k.lead_id = ag.lead_id)
               or (ag.nome <> '' and (k.nome = ag.nome or k.nome like ag.nome || ' %'))))
         order by (k.shosp_agendamento = ag.codigo_agendamento) desc nulls last,
                  (k.shosp_prontuario = ag.prontuario) desc nulls last
         limit 1
      ) m on true
  )
  select 'atendimento', c.codigo_agendamento, c.data, c.horario, c.prestador, c.paciente, c.prontuario,
         c.lead_id, c.status,
         exists (select 1 from public.stock_spa_sem_material s
                  where s.tenant_id = (select public.current_tenant_id()) and s.codigo_agendamento = c.codigo_agendamento),
         c.kit_id, c.kit_nome, c.kit_status, c.por
    from casados c
  union all
  select 'kit_sem_agenda', null, k.dia, null, null, k.nome, k.shosp_prontuario, k.lead_id, null, false,
         k.id, k.name, k.status, null
    from kits k
   where k.dia between p_de and p_ate
     and not exists (select 1 from casados c where c.kit_id = k.id)
$$;

grant execute on function public.stock_spa_conferencia(date, date) to authenticated;
