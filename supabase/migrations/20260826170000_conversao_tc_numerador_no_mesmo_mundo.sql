-- Conversão da consulta: TC como número principal, e o numerador obrigado a morar no mesmo
-- mundo do denominador.
--
-- Pedido da Luana em 26/08/2026: "esta central de vendas é exclusiva para controle de vendas de
-- cirurgias e está puxando conversão de consulta" — o card media a clínica inteira (96 pacientes
-- em agosto) num painel que só fala de cirurgia.
--
-- Ao forçar a régua de TC ontem, apareceu o furo que a régua larga escondia: o 2º cenário conta
-- TUDO o que fechou no mês, sem exigir que a venda venha de alguém do denominador. Com 96
-- pacientes embaixo isso passava (13,5%); com os 20 pacientes de TC embaixo, dava **65%** — 13
-- vendas sobre 20 consultas, duas delas de gente que não consultou (venda sem prontuário nenhum).
-- Numerador e denominador eram populações diferentes de novo, só que agora escancarado.
--
-- Três mudanças:
--
-- 1) **O numerador mora no mundo do denominador.** Venda só entra na taxa se o paciente estiver
--    no universo da régua; o resto vai para `sem_vinculo`, declarado na tela, fora da conta. Isso
--    corrige também a régua larga: as 2 vendas de agosto sem prontuário (R$ 61.100) inflavam o
--    caixa de 11 para 13 e ninguém via.
--
-- 2) **Cirurgia vendida em consulta clínica não some** (decisão do Álvaro, 26/08). Agosto tem uma:
--    R$ 49.500 fechados em 25/08 sobre "CONSULTA CLÍNICA FEMININA". Quem fechou cirurgia entra no
--    denominador mesmo sem consulta de TC identificada — a alternativa era esconder venda de
--    cirurgia num painel de cirurgia. Vem separado em `entraram_por_venda` porque é entrada de
--    convertido: sobe a taxa por construção e a tela precisa dizer.
--
-- 3) **As duas réguas na mesma resposta.** `outra_regua` traz a leitura oposta pronta, para o card
--    mostrar TC como número principal e "todas as consultas" como contexto sem uma segunda ida ao
--    banco. O cálculo virou função de uma régua só (`crm_conversao_consulta_regua`), chamada duas
--    vezes — antes de duplicar 60 linhas de CTE.
--
-- 4) **A régua de TC não espera mais a cobertura chegar a 60%.** Em cirurgia ela é a principal, e
--    a cobertura virou selo de confiança na tela. O gatilho saiu porque no mesmo 26/08 o backfill
--    de tipo bateu no teto: das 56 consultas de agosto sem serviço, 53 foram buscadas paciente por
--    paciente naquela hora e a Shosp devolveu a agenda sem o campo. Não é fila atrasada, é dado que
--    não existe do outro lado, e o prestador não substitui (a Dra. Lorena aparece com 44,7% e 72,7%
--    de TC conforme a grafia do nome). Como o denominador de TC fica incompleto de vez, o card
--    passou a mostrar o PISO ao lado do número medido: agosto é 47,6% medido e ~27,5% se as
--    consultas sem tipo tiverem a mesma proporção de transplante das conhecidas.

create or replace function public.crm_conversao_consulta_regua(
  p_mes text,
  p_kind text,
  p_regua text
)
returns jsonb
language sql
stable
as $function$
with janela as (
  select (p_mes || '-01')::date as ini,
         ((p_mes || '-01')::date + interval '1 month - 1 day')::date as fim
),
lim as (
  select ini, least(fim, current_date) as fim, (fim > current_date) as em_curso from janela
),
-- Uma chamada só, cobrindo 12 meses antes da janela: serve para o denominador (consultas DO mês)
-- e para saber se quem fechou no mês já tinha consulta de TC em safra anterior.
historico as (
  select c.prontuario, c.data, c.tipo
  from lim, public.crm_consultas_realizadas_tipadas((lim.ini - interval '12 months')::date, lim.fim) c
),
consultas as (
  select h.* from historico h, lim where h.data between lim.ini and lim.fim
),
vendas as (
  select cs.id, cs.sold_at, cs.consultation_at, cs.value_cents,
         coalesce(nullif(btrim(cs.shosp_prontuario), ''), nullif(btrim(l.shosp_prontuario), '')) as prontuario
  from public.clinic_sales cs
  left join public.leads l on l.id = cs.lead_id
  where cs.kind = p_kind and cs.status <> 'cancelada'
),
-- Quem consultou no mês E fechou o kind: entra no denominador seja qual for o tipo da consulta.
-- É o que impede o card de esconder a cirurgia vendida numa consulta clínica.
converteram as (
  select distinct v.prontuario
  from vendas v, lim
  where v.prontuario is not null
    and v.prontuario in (select prontuario from consultas)
    and (v.consultation_at between lim.ini and lim.fim or v.sold_at between lim.ini and lim.fim)
),
consideradas as (
  select c.* from consultas c
  where p_regua = 'todas'
     or c.tipo = 'tc'
     or c.prontuario in (select prontuario from converteram)
),
den as (
  select count(*)::int as agendamentos, count(distinct prontuario)::int as pacientes from consideradas
),
pacientes as (
  select distinct prontuario from consideradas
),
-- Quantos entraram no denominador só por terem fechado venda (sem consulta de TC identificada).
por_venda as (
  select count(*)::int as n from (
    select distinct prontuario from consideradas where tipo <> 'tc'
    except
    select distinct prontuario from consideradas where tipo = 'tc'
  ) x
  where p_regua <> 'todas'
),
-- O mundo da régua, incluindo safras anteriores: é o filtro do 2º cenário. Sem ele, venda de quem
-- nunca consultou (ou consultou outra coisa) entra no caixa e a taxa passa de qualquer teto.
mundo as (
  select distinct h.prontuario from historico h
  where p_regua = 'todas' or h.tipo = 'tc'
  union
  select prontuario from pacientes
),
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
fechadas as (
  select v.* from vendas v, lim
  where v.sold_at between lim.ini and lim.fim
    and v.prontuario in (select prontuario from mundo)
),
num_mes as (
  select count(*)::int as vendas,
         coalesce(sum(value_cents), 0)::bigint as receita,
         count(*) filter (where consultation_at is null or consultation_at < (select ini from lim))::int as de_safra_anterior,
         coalesce(sum(value_cents) filter (where consultation_at is null or consultation_at < (select ini from lim)), 0)::bigint as receita_anterior
  from fechadas
),
-- Fora da taxa: consultou no mês ou fechou no mês, mas não dá para ligar a ninguém do denominador
-- (prontuário vazio na venda e no lead, ou paciente que não consultou nesta régua).
soltas as (
  select v.* from vendas v, lim
  where (v.consultation_at between lim.ini and lim.fim or v.sold_at between lim.ini and lim.fim)
    and (v.prontuario is null or v.prontuario not in (select prontuario from mundo))
),
fora as (
  select count(*)::int as vendas, coalesce(sum(value_cents), 0)::bigint as receita from soltas
),
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
)
select jsonb_build_object(
  'regua', p_regua,
  'agendamentos', (select agendamentos from den),
  'pacientes', (select pacientes from den),
  'entraram_por_venda', coalesce((select n from por_venda), 0),
  'pacientes_tc', (select count(distinct prontuario)::int from consideradas where tipo = 'tc'),
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
  'outro_kind_pacientes', coalesce((select pacientes from outro), 0)
);
$function$;

create or replace function public.crm_conversao_consulta(
  p_mes text,
  p_kind text default 'cirurgia',
  p_tipo_consulta text default 'auto'
)
returns jsonb
language sql
stable
as $function$
with janela as (
  select (p_mes || '-01')::date as ini,
         ((p_mes || '-01')::date + interval '1 month - 1 day')::date as fim
),
lim as (
  select ini, least(fim, current_date) as fim, (fim > current_date) as em_curso from janela
),
consultas as (
  select c.tipo from lim, public.crm_consultas_realizadas_tipadas(lim.ini, lim.fim) c
),
cobertura as (
  select count(*)::int as total,
         count(*) filter (where tipo <> 'sem_tipo')::int as com_tipo,
         count(*) filter (where tipo = 'tc')::int as tc,
         round(100.0 * count(*) filter (where tipo <> 'sem_tipo') / nullif(count(*), 0), 1) as pct
  from consultas
),
-- Em cirurgia a régua é TC, ponto: a Central de Vendas só fala de cirurgia, e era esse o pedido.
-- O gatilho de 60% de cobertura saiu de cena como chave (em 26/08 a cobertura estava em 55,8% e
-- subindo devagar — o card ficaria mais um mês medindo a clínica inteira) e virou selo de
-- confiança: a resposta continua dizendo a cobertura, e a tela declara que o denominador de TC
-- está incompleto enquanto ela não fecha. Protocolo segue em 'todas' — é vendido tanto em consulta
-- clínica quanto em consulta de transplante.
regua as (
  select case
           when p_tipo_consulta = 'tc' then 'tc'
           when p_tipo_consulta = 'todas' then 'todas'
           when p_kind = 'cirurgia' then 'tc'
           else 'todas'
         end as tipo_usado
),
blocos as (
  select r.tipo_usado,
         public.crm_conversao_consulta_regua(p_mes, p_kind, r.tipo_usado) as principal,
         public.crm_conversao_consulta_regua(p_mes, p_kind,
           case when r.tipo_usado = 'tc' then 'todas' else 'tc' end) as outra
  from regua r
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
  'agendamentos', (select principal->>'agendamentos' from blocos)::int,
  'pacientes', (select principal->>'pacientes' from blocos)::int,
  'denominador', jsonb_build_object(
    'tipo_usado', (select tipo_usado from blocos),
    'cobertura_pct', coalesce((select pct from cobertura), 0),
    'consultas_com_tipo', coalesce((select com_tipo from cobertura), 0),
    'consultas_no_mes', coalesce((select total from cobertura), 0),
    'consultas_tc', coalesce((select tc from cobertura), 0),
    'pacientes_tc', (select (case when tipo_usado = 'tc' then principal else outra end)->>'pacientes_tc' from blocos)::int,
    'entraram_por_venda', (select principal->>'entraram_por_venda' from blocos)::int
  ),
  'cenario_mes', (select principal->'cenario_mes' from blocos),
  'cenario_followup', (select principal->'cenario_followup' from blocos),
  'de_safra_anterior', (select principal->'de_safra_anterior' from blocos),
  'sem_vinculo', (select principal->'sem_vinculo' from blocos),
  'outro_kind', jsonb_build_object(
    'kind',      case when p_kind = 'cirurgia' then 'protocolo' else 'cirurgia' end,
    'pacientes', (select principal->>'outro_kind_pacientes' from blocos)::int
  ),
  -- A leitura oposta, para o card mostrar as duas sem uma segunda chamada.
  'outra_regua', jsonb_build_object(
    'tipo_usado',       (select outra->>'regua' from blocos),
    'pacientes',        (select outra->>'pacientes' from blocos)::int,
    'cenario_mes',      (select outra->'cenario_mes' from blocos),
    'cenario_followup', (select outra->'cenario_followup' from blocos)
  ),
  'ultima_venda_registrada', (select ultima from registro),
  'dias_sem_registro', (select case when ultima is null then null
                                    else (least((select fim from lim), current_date) - ultima) end
                        from registro)
);
$function$;

revoke execute on function public.crm_conversao_consulta(text, text, text) from public, anon;
revoke execute on function public.crm_conversao_consulta_regua(text, text, text) from public, anon;
