-- Consulta de cortesia na safra, e fora de toda conta de conversão.
--
-- Pedido da Aline em 24/set, com print da faixa de setembro: "preciso adicionar uma opção
-- para consulta cortesia, só que ela não pode contar nas métricas de consulta, porque no
-- caso dele foi uma parceria, ou seja, ele fechou a permuta, mas não entra como venda".
--
-- Cortesia não é consulta nem retorno: ninguém saiu dali para ser convencido a comprar. Se
-- ficasse no denominador, cada parceria baixaria a taxa da semana por construção, e o jeito
-- de "consertar" seria lançar a permuta como venda, que é pior. Então ela vira um terceiro
-- tipo e sai das duas contas que falam de consulta:
--
--   1. a safra da Central de Vendas (a conta é feita no front, `atendimentos.ts`);
--   2. o card "Conversão da consulta", que lê a agenda da Shosp e não a safra. O Maikel,
--      que abriu o pedido, está na Shosp como "CONSULTA ONLINE - TRANSPLANTE CAPILAR", ou
--      seja, entraria no denominador de TC mesmo marcado como cortesia na safra.
--
-- Na mesma mensagem, o outro caso: o Gabriel foi encaminhado da fila de pós-consulta como
-- transplante e é paciente de protocolo desde 2025 (a Shosp tem o protocolo capilar dele).
-- Ela tentou tirá-lo dispensando o card do quadro, 14 segundos depois de encaminhar, mas
-- dispensar o follow-up não tira ninguém da safra: o atendimento aconteceu. O que estava
-- errado era a FILA, e isso a tela agora troca. Aqui só o dado dos dois.

-- ---------------------------------------------------------------------------
-- 1. O tipo
-- ---------------------------------------------------------------------------
alter table public.clinic_atendimentos drop constraint if exists clinic_atendimentos_tipo_check;
alter table public.clinic_atendimentos
  add constraint clinic_atendimentos_tipo_check check (tipo in ('consulta', 'retorno', 'cortesia'));

-- ---------------------------------------------------------------------------
-- 2. A conversão da consulta não conta a cortesia
-- ---------------------------------------------------------------------------
-- A marca mora na safra (`clinic_atendimentos`) e a conta lê a agenda (`shosp_appointments`).
-- O elo é paciente + dia: o prontuário vem da agenda daquele lead naquele dia ou, quando o
-- atendimento foi digitado à mão sem agenda casada, do prontuário gravado no lead.
--
-- O filtro fica aqui, e não em `crm_consultas_realizadas`: aquela é a definição de "houve uma
-- consulta" e a cortesia houve. Quem não pode contar é a CONVERSÃO, e esta é a função que só a
-- conversão usa.
create or replace function public.crm_consultas_realizadas_tipadas(p_de date, p_ate date)
 returns table(prontuario text, data date, codigo text, servico text, tipo text)
 language sql
 stable
as $function$
  with cortesias as (
    select ap.prontuario, a.atendido_em as data
      from public.clinic_atendimentos a
      join public.shosp_appointments ap on ap.lead_id = a.lead_id and ap.data = a.atendido_em
     where a.tipo = 'cortesia'
       and a.atendido_em between p_de and p_ate
       and ap.prontuario is not null
    union
    select btrim(l.shosp_prontuario), a.atendido_em
      from public.clinic_atendimentos a
      join public.leads l on l.id = a.lead_id
     where a.tipo = 'cortesia'
       and a.atendido_em between p_de and p_ate
       and nullif(btrim(l.shosp_prontuario), '') is not null
  )
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
  left join public.shosp_appointments ap on ap.codigo_agendamento = c.codigo
  where not exists (
          select 1 from cortesias x where x.prontuario = c.prontuario and x.data = c.data
        );
$function$;

-- A casca devolve quantas cortesias saíram da conta, para o card dizer em vez de sumir com
-- elas caladas (regra da casa desde 26/08: o que fica fora aparece na tela). Igual à versão de
-- 26/08 (migration 20260826170000) mais a chave `cortesias`.
create or replace function public.crm_conversao_consulta(p_mes text, p_kind text default 'cirurgia'::text, p_tipo_consulta text default 'auto'::text)
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
),
cortesia as (
  select count(distinct coalesce(a.lead_id, a.id::text))::int as pacientes
  from public.clinic_atendimentos a, lim
  where a.tipo = 'cortesia' and a.atendido_em between lim.ini and lim.fim
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
                        from registro),
  -- Pacientes com consulta de cortesia no mês: já estão fora do denominador (ver a tipada).
  'cortesias', coalesce((select pacientes from cortesia), 0)
);
$function$;

-- ---------------------------------------------------------------------------
-- 3. O dado dos dois pacientes do pedido
-- ---------------------------------------------------------------------------
-- `leads` tem `enforce_role_write`: sem a claim de service_role o gatilho recusa.
do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Maikel Ramthun, 22/09: consulta de parceria (permuta).
  update public.clinic_atendimentos
     set tipo = 'cortesia'
   where id = '34f3afc3-6654-486f-a7e1-d4b3135434f6'
     and tipo = 'consulta';

  -- Gabriel Sanches Andreotti, 22/09: protocolo, não transplante. Vai para a safra de
  -- protocolos, e o card sai do funil cirúrgico para onde o encaminhamento de protocolo o teria
  -- posto. Só se ele ainda estiver onde o encaminhamento errado o deixou: se alguém já o moveu,
  -- vale a mão.
  update public.clinic_atendimentos
     set indicacao = 'protocolo'
   where id = 'e343e986-4e27-4ab6-916a-dae2ee89813a'
     and indicacao = 'cirurgia';

  update public.leads
     set pipeline_id = 'pipeline-protocolos',
         stage_id = 'pro-consulta-realizada',
         stage_entered_at = now()
   where id = 'lead-be83d858-cf1'
     and tenant_id = 'instituto-lorena'
     and stage_id = 'cir-consulta-realizada';
end
$$;
