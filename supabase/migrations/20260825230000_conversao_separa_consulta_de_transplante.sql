-- Conversão de TC: separar consulta de TRANSPLANTE das demais.
--
-- A gerência mede "conversão sobre as consultas/orçamentos de TC gerados" (Luana, 25/08/2026),
-- mas o denominador contava toda consulta — clínica, acompanhamento, sobrancelha. O tipo estava
-- indisponível porque a grade por prestador da Shosp NÃO devolve o serviço (só o endpoint por
-- paciente). O passo `servicos` do sync passou a preencher isso; enquanto o backfill não cobre o
-- mês inteiro, medir só TC daria um denominador ridículo e uma taxa inflada.
--
-- Daí o modo 'auto': usa TC quando a cobertura de tipo do mês chega a 60%, senão segue com toda
-- consulta e DIZ na resposta qual régua usou e qual é a cobertura. A tela vira sozinha quando o
-- dado chegar, sem ninguém precisar lembrar de trocar.
--
-- Por que 60 e não 80: medido em 25/08, de cada 3 consultas que o backfill tenta, 2 voltam com
-- serviço e 1 a Shosp não tem mesmo (encaixe, agendamento antigo). O teto realista de cobertura
-- fica perto de 2/3, então um gatilho em 80% nunca viraria — e conversão de TC sobre 2/3 das
-- consultas, com o resto declarado na tela, é melhor leitura do que conversão de tudo.
create or replace function public.crm_consultas_realizadas_tipadas(p_de date, p_ate date)
returns table(prontuario text, data date, codigo text, servico text, tipo text)
language sql
stable
as $function$
  select c.prontuario, c.data, c.codigo, ap.servico,
         case
           when nullif(btrim(coalesce(ap.servico, '')), '') is null then 'sem_tipo'
           -- "CONSULTA TRANSPLANTE...", "CONSULTA ONLINE - TRANSPLANTE CAPILAR", "CONSULTA ONLINE
           -- TRANSPLANTE DE SOBRANCELHA". Exige começar em CONSULTA para não pegar
           -- "RETORNO DE TRANSPLANTE ON LINE", que é pós-operatório, não orçamento.
           when ap.servico ~* '^[[:space:]]*consulta' and ap.servico ~* 'transplante' then 'tc'
           when ap.servico ~* '^[[:space:]]*consulta' then 'clinica'
           else 'outra'
         end as tipo
  from public.crm_consultas_realizadas(p_de, p_ate) c
  left join public.shosp_appointments ap on ap.codigo_agendamento = c.codigo;
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
  select c.prontuario, c.data, c.tipo from lim, public.crm_consultas_realizadas_tipadas(lim.ini, lim.fim) c
),
cobertura as (
  select count(*)::int as total,
         count(*) filter (where tipo <> 'sem_tipo')::int as com_tipo,
         round(100.0 * count(*) filter (where tipo <> 'sem_tipo') / nullif(count(*), 0), 1) as pct
  from consultas
),
-- Qual régua vale nesta chamada. 'auto' só vira TC com o dado quase completo (>80%) e para
-- cirurgia — protocolo é vendido tanto em consulta clínica quanto em consulta de transplante.
regua as (
  select case
           when p_tipo_consulta = 'tc' then 'tc'
           when p_tipo_consulta = 'todas' then 'todas'
           when p_kind = 'cirurgia' and coalesce((select pct from cobertura), 0) >= 60 then 'tc'
           else 'todas'
         end as tipo_usado
),
consideradas as (
  select c.* from consultas c, regua r
  where r.tipo_usado = 'todas' or c.tipo = 'tc'
),
den as (
  select count(*)::int as agendamentos, count(distinct prontuario)::int as pacientes from consideradas
),
pacientes as (
  select distinct prontuario from consideradas
),
vendas as (
  select cs.id, cs.sold_at, cs.consultation_at, cs.value_cents,
         coalesce(nullif(btrim(cs.shosp_prontuario), ''), nullif(btrim(l.shosp_prontuario), '')) as prontuario
  from public.clinic_sales cs
  left join public.leads l on l.id = cs.lead_id
  where cs.kind = p_kind and cs.status <> 'cancelada'
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
  select v.* from vendas v, lim where v.sold_at between lim.ini and lim.fim
),
num_mes as (
  select count(*)::int as vendas,
         coalesce(sum(value_cents), 0)::bigint as receita,
         count(*) filter (where consultation_at is null or consultation_at < (select ini from lim))::int as de_safra_anterior,
         coalesce(sum(value_cents) filter (where consultation_at is null or consultation_at < (select ini from lim)), 0)::bigint as receita_anterior
  from fechadas
),
soltas as (
  select v.* from vendas v, lim
  where v.consultation_at between lim.ini and lim.fim
    and (v.prontuario is null or v.prontuario not in (select prontuario from pacientes))
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
  'denominador', jsonb_build_object(
    'tipo_usado', (select tipo_usado from regua),
    'cobertura_pct', coalesce((select pct from cobertura), 0),
    'consultas_com_tipo', coalesce((select com_tipo from cobertura), 0),
    'consultas_no_mes', coalesce((select total from cobertura), 0),
    'pacientes_tc', (select count(distinct prontuario)::int from consultas where tipo = 'tc')
  ),
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

-- A assinatura antiga (p_mes, p_kind) sai de cena: com as duas no schema o PostgREST não escolhe
-- e a chamada do painel morre com "is not unique".
drop function if exists public.crm_conversao_consulta(text, text);

-- `create function` novo herda o EXECUTE do PUBLIC (e do anon). Nenhuma das duas é
-- security definer e as tabelas têm RLS, mas o padrão da casa é não deixar RPC aberta.
revoke execute on function public.crm_conversao_consulta(text, text, text) from public, anon;
revoke execute on function public.crm_consultas_realizadas_tipadas(date, date) from public, anon;
