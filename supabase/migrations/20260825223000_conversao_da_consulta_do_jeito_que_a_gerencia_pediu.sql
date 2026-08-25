-- Conversão da consulta, do jeito que a gerência pediu (Luana, 25/08/2026):
--   1) conversão sobre as consultas GERADAS no mês;
--   2) conversão contando as vendas de follow-up FECHADAS DENTRO DESTE MÊS, mesmo quando a
--      consulta que as originou é de meses atrás ("hoje, 25/08, vendeu um TC de uma consulta
--      realizada em 02/03").
--
-- O segundo cenário estava invertido: media a safra do mês contando o que ela fecharia DEPOIS
-- (futuro), quando o que a gerência acompanha é o caixa do mês (passado). Num mês em curso o
-- número antigo era sempre idêntico ao primeiro — os dois cards do painel mostravam 7,0% e 7,0%,
-- e a diferença entre eles, que É a informação, nunca aparecia.
--
-- Também: o numerador passa a exigir vínculo com um paciente do denominador (prontuário da venda
-- ou, na falta dele, do lead). Antes bastava a venda ter `consultation_at` no mês, então entrava
-- gente que não estava no denominador — em agosto/2026, 7 das 11 cirurgias.
create or replace function public.crm_conversao_consulta(p_mes text, p_kind text default 'cirurgia')
returns jsonb
language sql
stable
as $function$
with janela as (
  select (p_mes || '-01')::date as ini,
         ((p_mes || '-01')::date + interval '1 month - 1 day')::date as fim
),
-- Mês corrente para em hoje: somar dia que ainda não veio afunda a conversão
-- exatamente como afundaria a média por dia.
lim as (
  select ini, least(fim, current_date) as fim, (fim > current_date) as em_curso from janela
),
consultas as (
  select c.prontuario, c.data from lim, public.crm_consultas_realizadas(lim.ini, lim.fim) c
),
den as (
  select count(*)::int as agendamentos, count(distinct prontuario)::int as pacientes from consultas
),
pacientes as (
  select distinct prontuario from consultas
),
-- Toda venda do tipo pedido com o prontuário que der para achar: o da venda ou, na falta
-- dele (campo digitado à mão, quase sempre vazio), o do lead.
vendas as (
  select cs.id, cs.sold_at, cs.consultation_at, cs.value_cents,
         coalesce(nullif(btrim(cs.shosp_prontuario), ''), nullif(btrim(l.shosp_prontuario), '')) as prontuario
  from public.clinic_sales cs
  left join public.leads l on l.id = cs.lead_id
  where cs.kind = p_kind and cs.status <> 'cancelada'
),
-- (1) SAFRA: consulta gerada no mês que fechou venda no próprio mês.
safra as (
  select v.* from vendas v, lim
  where v.consultation_at between lim.ini and lim.fim
    and v.prontuario in (select prontuario from pacientes)
),
num_safra as (
  select count(distinct prontuario) filter (where to_char(sold_at, 'YYYY-MM') = p_mes)::int as vendas,
         coalesce(sum(value_cents) filter (where to_char(sold_at, 'YYYY-MM') = p_mes), 0)::bigint as receita
  from safra
),
-- (2) CAIXA DO MÊS: tudo o que fechou dentro do mês, de qualquer safra de consulta.
fechadas as (
  select v.* from vendas v, lim where v.sold_at between lim.ini and lim.fim
),
num_mes as (
  select count(*)::int as vendas,
         coalesce(sum(value_cents), 0)::bigint as receita,
         count(*) filter (where consultation_at is null or consultation_at < (select ini from lim))::int as de_safra_anterior,
         coalesce(sum(value_cents) filter (where consultation_at is null or consultation_at < (select ini from lim)), 0)::bigint as receita_anterior
  from fechadas
),
-- Venda da safra do mês que não casa com paciente nenhum do denominador: fica FORA da conta e
-- aparece na tela. Entrar no numerador sem existir no denominador era o furo antigo.
soltas as (
  select v.* from vendas v, lim
  where v.consultation_at between lim.ini and lim.fim
    and (v.prontuario is null or v.prontuario not in (select prontuario from pacientes))
),
fora as (
  select count(*)::int as vendas, coalesce(sum(value_cents), 0)::bigint as receita from soltas
),
-- O denominador é COMPARTILHADO entre cirurgia e protocolo: a mesma consulta pode virar uma
-- coisa ou outra. Sem isto, as duas taxas dividem o mesmo bolo como se fosse exclusivo.
outro as (
  select count(distinct v.prontuario)::int as pacientes
  from (
    select coalesce(nullif(btrim(cs.shosp_prontuario), ''), nullif(btrim(l.shosp_prontuario), '')) as prontuario,
           cs.consultation_at
    from public.clinic_sales cs
    left join public.leads l on l.id = cs.lead_id
    where cs.kind <> p_kind and cs.status <> 'cancelada'
  ) v, lim
  where v.consultation_at between lim.ini and lim.fim
    and v.prontuario in (select prontuario from pacientes)
),
registro as (
  select max(cs.sold_at) as ultima
  from public.clinic_sales cs, lim
  where cs.kind = p_kind and cs.status <> 'cancelada'
    and cs.sold_at between lim.ini and lim.fim
)
select jsonb_build_object(
  'mes', p_mes,
  'kind', p_kind,
  'em_curso', (select em_curso from lim),
  'ate_dia', (select fim from lim),
  'agendamentos', (select agendamentos from den),
  'pacientes', (select pacientes from den),
  'cenario_mes', jsonb_build_object(
    'vendas',        (select vendas from num_safra),
    'receita_cents', (select receita from num_safra),
    'pct', round(100.0 * (select vendas from num_safra) / nullif((select pacientes from den), 0), 1)
  ),
  'cenario_followup', jsonb_build_object(
    'vendas',        (select vendas from num_mes),
    'receita_cents', (select receita from num_mes),
    'pct', round(100.0 * (select vendas from num_mes) / nullif((select pacientes from den), 0), 1)
  ),
  'de_safra_anterior', jsonb_build_object(
    'vendas',        (select de_safra_anterior from num_mes),
    'receita_cents', (select receita_anterior from num_mes)
  ),
  'sem_vinculo', jsonb_build_object(
    'vendas',        (select vendas from fora),
    'receita_cents', (select receita from fora)
  ),
  'outro_kind', jsonb_build_object(
    'kind',      case when p_kind = 'cirurgia' then 'protocolo' else 'cirurgia' end,
    'pacientes', coalesce((select pacientes from outro), 0)
  ),
  'ultima_venda_registrada', (select ultima from registro),
  'dias_sem_registro', (select case when ultima is null then null
                                    else (least((select fim from lim), current_date) - ultima) end
                        from registro)
);
$function$;
