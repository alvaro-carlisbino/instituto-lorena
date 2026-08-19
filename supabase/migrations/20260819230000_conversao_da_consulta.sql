-- Conversão da consulta em venda, nos dois cenários que o Álvaro pediu.
--
-- A Central de Vendas mostrava faturamento, ticket, lucro e "fechou em follow-up",
-- e não mostrava a conta que a Aline faz de cabeça: de quem sentou na cadeira,
-- quantos compraram.
--
-- OS DOIS CENÁRIOS, e por que os dois existem:
--   1. NO MÊS      — das consultas do mês, quantas fecharam venda ainda dentro do
--                    mês. É o número que casa com o fechamento e com a meta.
--   2. COM FOLLOW-UP — das MESMAS consultas, quantas fecharam venda em qualquer
--                    momento, inclusive meses depois. É o que mede o trabalho de
--                    recuperação: em junho/2026 o protocolo saiu de 35,6% para
--                    47,5% só por causa do follow-up, ou seja, um terço das vendas
--                    daquela safra não existiria sem alguém ligar de volta.
-- O segundo é sempre maior ou igual ao primeiro, e a diferença ENTRE eles é o
-- tamanho do follow-up. Por isso não dá para escolher um só.
--
-- DENOMINADOR = PACIENTE, não agendamento. Quem passa duas vezes no mês (consulta
-- online e depois presencial) é uma pessoa decidindo uma vez; contar duas afunda a
-- taxa por motivo administrativo. Em agosto/2026 são 137 agendamentos para 101
-- pacientes.
--
-- O QUE É "CONSULTA" é a MESMA regra da fila de pós-consulta (migration
-- 20260818160000): hora passada, não desmarcada nem falta, fora do spa, e serviço
-- começando com "consulta" — ou, quando a Shosp não devolve serviço, a observação
-- da recepção sem retorno/lavagem/curativo/protocolo/sessão. A regra foi extraída
-- para `crm_consultas_realizadas` para as duas telas não darem contagens
-- diferentes da mesma coisa. A fila de pós-consulta ainda tem a regra embutida:
-- quando alguém mexer nela, é para passar a chamar esta função.
--
-- SEM security definer de propósito: `shosp_appointments` e `clinic_sales` já têm
-- RLS que limita à clínica. Deixar a RLS trabalhar é menos código e uma guarda a
-- menos para errar.

create or replace function public.crm_consultas_realizadas(p_de date, p_ate date)
returns table (prontuario text, data date, codigo text)
language sql
stable
as $fn$
  select ap.prontuario, ap.data, ap.codigo_agendamento
  from public.shosp_appointments ap
  where ap.prontuario is not null
    and ap.data between p_de and p_ate
    -- Consulta que ainda não aconteceu não converteu nem deixou de converter.
    and (
      ap.data < current_date
      or substring(coalesce(ap.horario, '') from '^[0-9]{1,2}:[0-9]{2}')::time
         <= (now() at time zone 'America/Sao_Paulo')::time
    )
    and coalesce(ap.status, '') !~* 'desmarc|cancel|falt'
    and coalesce(ap.prestador, '') !~* '^[[:space:]]*spa capilar'
    and case
          when nullif(btrim(coalesce(ap.servico, '')), '') is not null
            then ap.servico ~* '^[[:space:]]*consulta'
          else coalesce(ap.payload ->> 'observacao', '')
               !~* 'finaliza|retorno|lavagem|curativo|protocolo|terapia|sess[aã]o|[0-9][[:space:]]*[ºo°]?[[:space:]]*(m[eê]s|meses)'
        end;
$fn$;

revoke all on function public.crm_consultas_realizadas(date, date) from public, anon;
grant execute on function public.crm_consultas_realizadas(date, date) to authenticated, service_role;

create or replace function public.crm_conversao_consulta(p_mes text, p_kind text default 'cirurgia')
returns jsonb
language sql
stable
as $fn$
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
vendas as (
  select cs.id, cs.sold_at, cs.consultation_at, cs.value_cents
  from public.clinic_sales cs, lim
  where cs.kind = p_kind
    and cs.status <> 'cancelada'
    and cs.consultation_at between lim.ini and lim.fim
),
num as (
  select
    count(*) filter (where to_char(sold_at, 'YYYY-MM') = p_mes)::int as vendas_mes,
    coalesce(sum(value_cents) filter (where to_char(sold_at, 'YYYY-MM') = p_mes), 0)::bigint as receita_mes,
    count(*)::int as vendas_follow,
    coalesce(sum(value_cents), 0)::bigint as receita_follow
  from vendas
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
  'ultima_venda_registrada', (select ultima from registro),
  'dias_sem_registro', (select case when ultima is null then null
                                    else (least((select fim from lim), current_date) - ultima) end
                        from registro)
);
$fn$;

revoke all on function public.crm_conversao_consulta(text, text) from public, anon;
grant execute on function public.crm_conversao_consulta(text, text) to authenticated, service_role;

comment on function public.crm_conversao_consulta(text, text) is
  'Conversão de consulta em venda no mês, em dois cenários: fechada dentro do mês, e incluindo o que o follow-up fechou depois. Denominador é PACIENTE em consulta, pela mesma regra da fila de pós-consulta.';
