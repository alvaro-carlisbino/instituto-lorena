-- Conversão da consulta: parar de dividir populações diferentes.
--
-- Como estava: o numerador eram VENDAS do kind com `consultation_at` dentro do mês, e o
-- denominador, PACIENTES que passaram em consulta (Shosp). Nada garantia que a venda contada
-- pertencesse a alguém do denominador. Em agosto/2026, das 11 cirurgias contadas só 4 tinham
-- prontuário batendo com uma consulta do mês — as outras entravam no numerador sem existir no
-- denominador. A taxa somava laranja com maçã.
--
-- Como fica: numerador é PACIENTE do denominador que fechou. O vínculo tenta o prontuário da
-- venda e, se estiver vazio (é campo digitado à mão), o do LEAD — que em agosto casa 10 das 11.
-- A venda que não casa com consulta nenhuma não entra na conta e sai como `sem_vinculo`, para a
-- tela dizer o que ficou de fora em vez de inflar a taxa em silêncio.
--
-- E o denominador é COMPARTILHADO entre cirurgia e protocolo: a mesma consulta pode virar uma
-- coisa ou outra. Por isso vai junto `outro_kind`, para a tela mostrar que a fatia que não fechou
-- cirurgia não é toda "perdida" — parte virou protocolo.
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
-- Toda venda do mês do tipo pedido, com o prontuário que der para achar: o da venda ou,
-- na falta dele, o do lead. `consultation_at` continua limitando a SAFRA (a consulta que
-- originou), mas quem decide se entra na conta é o vínculo com o paciente.
vendas as (
  select cs.id, cs.sold_at, cs.value_cents,
         coalesce(nullif(btrim(cs.shosp_prontuario), ''), nullif(btrim(l.shosp_prontuario), '')) as prontuario
  from public.clinic_sales cs
  left join public.leads l on l.id = cs.lead_id, lim
  where cs.kind = p_kind
    and cs.status <> 'cancelada'
    and cs.consultation_at between lim.ini and lim.fim
),
ligadas as (
  select v.* from vendas v where v.prontuario in (select prontuario from pacientes)
),
soltas as (
  select v.* from vendas v where v.prontuario is null or v.prontuario not in (select prontuario from pacientes)
),
-- Conta PACIENTE convertido, não linha de venda: quem fechou duas vezes decidiu uma vez,
-- do mesmo jeito que o denominador conta paciente e não agendamento.
num as (
  select
    count(distinct prontuario) filter (where to_char(sold_at, 'YYYY-MM') = p_mes)::int as vendas_mes,
    coalesce(sum(value_cents) filter (where to_char(sold_at, 'YYYY-MM') = p_mes), 0)::bigint as receita_mes,
    count(distinct prontuario)::int as vendas_follow,
    coalesce(sum(value_cents), 0)::bigint as receita_follow
  from ligadas
),
fora as (
  select count(*)::int as vendas, coalesce(sum(value_cents), 0)::bigint as receita from soltas
),
-- O que as MESMAS consultas fecharam do outro lado do balcão.
outro as (
  select count(distinct coalesce(nullif(btrim(cs.shosp_prontuario), ''), nullif(btrim(l.shosp_prontuario), '')))::int as pacientes
  from public.clinic_sales cs
  left join public.leads l on l.id = cs.lead_id, lim
  where cs.kind <> p_kind
    and cs.status <> 'cancelada'
    and cs.consultation_at between lim.ini and lim.fim
    and coalesce(nullif(btrim(cs.shosp_prontuario), ''), nullif(btrim(l.shosp_prontuario), '')) in (select prontuario from pacientes)
),
-- O atraso de digitação é o que decide se este card pode ser lido. Em 19/08/2026
-- a última venda lançada era de 11/08 enquanto a agenda ia até hoje: dividir
-- consulta de 19 dias por venda de 11 dava 5,9% onde a realidade era outra.
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
    'vendas',        (select vendas_mes from num),
    'receita_cents', (select receita_mes from num),
    'pct', round(100.0 * (select vendas_mes from num) / nullif((select pacientes from den), 0), 1)
  ),
  'cenario_followup', jsonb_build_object(
    'vendas',        (select vendas_follow from num),
    'receita_cents', (select receita_follow from num),
    'pct', round(100.0 * (select vendas_follow from num) / nullif((select pacientes from den), 0), 1)
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
