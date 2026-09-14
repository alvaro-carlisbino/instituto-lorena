-- Cancelamentos do mês na Central de Vendas: consultas, protocolos e cirurgias.
--
-- Pedido do Fabricio em 14/09/2026. A Central já sabia cancelar venda (motivo e
-- estorno), mas o cancelamento só aparecia escolhendo "Só canceladas" no filtro,
-- sem número nenhum na tela. E consulta desmarcada não aparecia em lugar nenhum:
-- ela mora na agenda da Shosp, não em `clinic_sales`.
--
-- DUAS DATAS DIFERENTES, de propósito:
--   • venda (protocolo/cirurgia) entra pelo `canceled_at`, o dia em que cancelou.
--     A lista de vendas continua pelo mês em que fechou. Cirurgia vendida em junho
--     e cancelada em setembro é cancelamento de setembro.
--   • consulta entra pela data da CONSULTA. A Shosp não guarda quando o horário foi
--     desmarcado, só que foi.
--
-- "DESMARCADO" NA SHOSP NÃO É SÓ CANCELAMENTO. A recepção troca o horário
-- desmarcando e agendando de novo ("AJUSTAR PARA AS 11:20HRS"). Em 14/09 dois dos
-- 16 desmarcados de setembro tinham consulta ativa no mesmo dia. Esses saem da
-- lista e vão contados em `trocas_de_horario`, senão o card repete o erro das
-- "66 consultas agendadas" que eram spa. Quem desmarcou e marcou OUTRO dia continua
-- na lista, com `remarcada_para`: desmarcou, mas não foi embora.
--
-- "Consulta" é `crm_e_consulta`, a mesma regra da conversão e do painel.
--
-- Sem security definer: `shosp_appointments`, `clinic_sales` e `leads` já têm RLS
-- de clínica.

create or replace function public.crm_cancelamentos_do_mes(p_mes text)
returns jsonb
language sql
stable
as $function$
with lim as (
  select to_date(p_mes || '-01', 'YYYY-MM-DD') as ini,
         (to_date(p_mes || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date as fim
),
consulta as (
  select ap.codigo_agendamento, ap.prontuario, ap.lead_id, ap.data, ap.horario,
         ap.prestador, ap.servico, ap.status, ap.payload
  from public.shosp_appointments ap
  where public.crm_e_consulta(ap.servico, ap.prestador, ap.payload ->> 'observacao')
),
ativa as (
  select prontuario, data
  from consulta
  where prontuario is not null
    and coalesce(status, '') !~* 'desmarc|cancel|falt'
),
desmarcada as (
  -- Um paciente desmarcado duas vezes no mesmo dia é um cancelamento só.
  select distinct on (coalesce(c.prontuario, c.codigo_agendamento), c.data)
    c.codigo_agendamento,
    c.prontuario,
    c.data,
    c.horario,
    c.prestador,
    c.servico,
    nullif(btrim(coalesce(c.payload ->> 'observacao', '')), '') as observacao,
    nullif(btrim(coalesce(c.payload ->> 'paciente', '')), '') as paciente,
    coalesce(
      c.lead_id,
      -- Só quando o prontuário aponta para UM lead: casar por aproximação em saúde
      -- é abrir a ficha de outro paciente.
      (select min(l.id) from public.leads l
        where c.prontuario is not null and l.shosp_prontuario = c.prontuario
       having count(*) = 1)
    ) as lead_id,
    exists (
      select 1 from ativa a where a.prontuario = c.prontuario and a.data = c.data
    ) as troca_de_horario,
    (select min(a.data) from ativa a
      where a.prontuario = c.prontuario
        and a.data > c.data
        and a.data <= c.data + 90) as remarcada_para
  from consulta c, lim
  where c.data between lim.ini and lim.fim
    and coalesce(c.status, '') ~* 'desmarc|cancel'
  order by coalesce(c.prontuario, c.codigo_agendamento), c.data, c.horario
)
select jsonb_build_object(
  'mes', p_mes,
  'consultas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'codigo', d.codigo_agendamento,
             'prontuario', d.prontuario,
             'lead_id', d.lead_id,
             'paciente', d.paciente,
             'data', d.data,
             'horario', d.horario,
             'prestador', d.prestador,
             'servico', d.servico,
             'observacao', d.observacao,
             'remarcada_para', d.remarcada_para
           ) order by d.data desc, d.horario desc)
    from desmarcada d
    where not d.troca_de_horario
  ), '[]'::jsonb),
  'trocas_de_horario', (select count(*) from desmarcada where troca_de_horario)::int,
  'vendas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id,
             'kind', s.kind,
             'lead_id', s.lead_id,
             'paciente', s.patient_name,
             'procedimento', s.procedure_label,
             'valor_cents', s.value_cents,
             'vendida_em', s.sold_at,
             'cancelada_em', s.canceled_at,
             'motivo', s.cancel_reason,
             'estorno', s.refund_status,
             'observacao', s.cancel_note,
             'vendedora', s.seller_name
           ) order by s.canceled_at desc, s.patient_name)
    from public.clinic_sales s, lim
    where s.status = 'cancelada'
      and s.canceled_at between lim.ini and lim.fim
  ), '[]'::jsonb),
  -- Cancelada sem data não cai em mês nenhum. Hoje é zero; se aparecer, a tela diz.
  'vendas_sem_data_de_cancelamento', (
    select count(*) from public.clinic_sales where status = 'cancelada' and canceled_at is null
  )::int
);
$function$;

comment on function public.crm_cancelamentos_do_mes(text) is
  'Central de Vendas: consultas desmarcadas (Shosp, pela data da consulta, sem troca de horário) '
  'e vendas de protocolo/cirurgia canceladas (pelo canceled_at) no mês YYYY-MM.';

revoke execute on function public.crm_cancelamentos_do_mes(text) from public, anon;
grant execute on function public.crm_cancelamentos_do_mes(text) to authenticated, service_role;
