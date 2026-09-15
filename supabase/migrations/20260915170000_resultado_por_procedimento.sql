-- Quanto a clínica ganhou em cada cirurgia/protocolo: receita, custo e lucro.
--
-- As peças já existiam soltas. A venda (`clinic_sales.value_cents`) tem o preço e quatro
-- colunas de custo digitadas à mão, que nunca foram preenchidas (0 de 441 vendas). O kit tem
-- o custo real do material que saiu e voltou, lote a lote, e o que se cobrou a mais do
-- paciente. Faltava o elo entre os dois e uma conta que junte.
--
-- Elo kit → venda: `stock_kits.clinic_sale_id` quando alguém escolheu; sem isso, a venda do
-- mesmo lead mais próxima em até 7 dias da data do kit, marcada como vínculo automático para a
-- tela avisar que é dedução.

alter table public.stock_kits
  add column if not exists clinic_sale_id uuid references public.clinic_sales(id) on delete set null;

create index if not exists stock_kits_clinic_sale_idx on public.stock_kits (clinic_sale_id) where clinic_sale_id is not null;
create index if not exists stock_movements_ref_idx on public.stock_movements (ref_type, ref_id);

drop function if exists public.crm_resultado_procedimentos(date, date);
create or replace function public.crm_resultado_procedimentos(p_de date, p_ate date)
returns table (
  sale_id uuid,
  kind text,
  status text,
  dia date,
  patient_name text,
  lead_id text,
  procedure_label text,
  receita_cents bigint,
  cobrado_kits_cents bigint,
  materiais_kits_cents bigint,
  materiais_manual_cents bigint,
  custo_medico_cents bigint,
  imposto_cents bigint,
  outros_cents bigint,
  kits integer,
  kit_ids uuid[],
  vinculo text,
  srg_surgery_id integer,
  shosp_prontuario text
)
language sql
stable
security invoker
set search_path = public
as $$
  with pode as (
    -- Lucro de cirurgia é dado de gestão: mesma régua da tela "Cirurgia foi paga?".
    select (public.current_user_can_finance() or public.can_route_leads()) as ok
  ),
  vendas as (
    select s.id, s.kind, s.status, s.patient_name, s.lead_id, s.procedure_label, s.srg_surgery_id, s.shosp_prontuario,
           coalesce(s.value_cents, 0) as receita,
           coalesce(s.cost_materials_cents, 0) as mat_manual,
           coalesce(s.cost_doctor_cents, 0) as medico,
           coalesce(s.tax_cents, 0) as imposto,
           coalesce(s.cost_other_cents, 0) as outros,
           coalesce((s.scheduled_at at time zone 'America/Sao_Paulo')::date, s.sold_at) as dia
      from public.clinic_sales s, pode
     where pode.ok
       and s.status <> 'cancelada'
       and s.kind in ('cirurgia', 'protocolo')
       and coalesce((s.scheduled_at at time zone 'America/Sao_Paulo')::date, s.sold_at) between p_de and p_ate
  ),
  kits as (
    select k.id, k.lead_id, k.clinic_sale_id, k.patient_name, k.name, k.procedure_label,
           coalesce(k.scheduled_for, (k.created_at at time zone 'America/Sao_Paulo')::date) as dia,
           coalesce((select sum(-m.qty_delta * coalesce(m.unit_cost_cents, 0))
                       from public.stock_movements m
                      where m.ref_type = 'stock_kit' and m.ref_id = k.id::text), 0)::bigint as custo,
           coalesce((select sum(i.charge_cents) from public.stock_kit_items i where i.kit_id = k.id), 0)::bigint as cobrado
      from public.stock_kits k, pode
     where pode.ok and k.status <> 'cancelado'
  ),
  elo as (
    select k.id as kit_id,
           coalesce(
             k.clinic_sale_id,
             (select v.id from vendas v
               where k.lead_id is not null and v.lead_id = k.lead_id and abs(v.dia - k.dia) <= 7
               order by abs(v.dia - k.dia), (v.kind = 'cirurgia') desc
               limit 1)
           ) as sale_id,
           case when k.clinic_sale_id is not null then 'manual' else 'automatico' end as vinculo
      from kits k
  )
  select v.id, v.kind, v.status, v.dia, v.patient_name, v.lead_id, v.procedure_label,
         v.receita,
         coalesce(sum(k.cobrado), 0)::bigint,
         coalesce(sum(k.custo), 0)::bigint,
         v.mat_manual, v.medico, v.imposto, v.outros,
         count(k.id)::int,
         coalesce(array_agg(k.id) filter (where k.id is not null), '{}'),
         case when count(k.id) = 0 then 'sem_kit'
              when bool_or(e.vinculo = 'automatico') then 'automatico'
              else 'manual' end,
         v.srg_surgery_id, v.shosp_prontuario
    from vendas v
    left join elo e on e.sale_id = v.id
    left join kits k on k.id = e.kit_id
   group by v.id, v.kind, v.status, v.dia, v.patient_name, v.lead_id, v.procedure_label,
            v.receita, v.mat_manual, v.medico, v.imposto, v.outros, v.srg_surgery_id, v.shosp_prontuario
  union all
  -- Kit no período sem venda achada: custo que ninguém está cobrando. Precisa aparecer.
  select null, 'sem_venda', null, k.dia, k.patient_name, k.lead_id, coalesce(k.procedure_label, k.name),
         0, k.cobrado, k.custo, 0, 0, 0, 0, 1, array[k.id], 'sem_venda', null, null
    from kits k
    join elo e on e.kit_id = k.id
   where e.sale_id is null and k.dia between p_de and p_ate
  order by 4 desc
$$;

revoke all on function public.crm_resultado_procedimentos(date, date) from public, anon;
grant execute on function public.crm_resultado_procedimentos(date, date) to authenticated, service_role;
