-- Resultados que fecham o ciclo: do lead até a sala.
--
-- Duas perguntas que o sistema não respondia, apesar de ter todo o dado:
--
--   1. "Quantos leads entraram e quantos viraram VENDA?" — a /resultados contava
--      lead, resposta e SLA, e parava aí. Origem que traz 400 leads e vende zero
--      aparecia como a melhor origem da tabela. Conversão em REAIS é o que decide
--      onde colocar verba ([[feedback_ads_conversao_nao_e_venda]]).
--
--   2. "Quanto tempo a cirurgia ocupa a sala, e quanto essa hora rende?" — o
--      espelho do centro cirúrgico (srg_*) tem 2.756 etapas cronometradas desde
--      nov/2025 e nenhuma tela lia isso. Tempo de sala, tempo por etapa, folículo
--      por hora e R$/hora de sala saem todos daqui.
--
-- DECISÕES DE CONTAGEM (é o que faz o número ser confiável):
--
--   • Conversão é de SAFRA: dos leads criados no período, quantos compraram
--     alguma vez. Não é "vendas do mês / leads do mês", que mistura safras e sobe
--     sozinha quando o mês tem pouca entrada. As vendas ocorridas na janela vêm
--     separadas, em `vendas_no_periodo`.
--   • Venda vale para os dois polos: clinic_sales (clínica) e rede/pagbank pagos
--     (Tricopill). Sem isso a conversão da loja daria zero.
--   • Tempo de sala = da primeira à última marcação da cirurgia. `hora_inicio` /
--     `dt_fim` do cabeçalho mandam quando existem; senão vale a primeira e a
--     última etapa cronometrada.
--   • Duração fora de 1h..20h é DESCARTADA da média, não corrigida. O banco tem
--     registro de 36 segundos (alguém abriu e fechou) e de 72 horas (ninguém
--     encerrou). Somar isso move a média em horas. As descartadas aparecem em
--     `qualidade.duracao_suspeita` — buraco de dado é para consertar, não esconder.
--   • R$/hora de sala só conta cirurgia que tem AS DUAS coisas: valor de venda
--     vinculado e duração plausível. Hoje são 60 de 194 no ano. Dividir a receita
--     parcial pelas horas TOTAIS daria um R$/hora 2,6x menor e mentiroso — por
--     isso a base da conta vem junto do número, na mesma resposta.

-- ---------------------------------------------------------------------------
-- 1) Produção do centro cirúrgico
-- ---------------------------------------------------------------------------

create or replace function public.crm_cirurgia_analytics(p_de date, p_ate date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_resposta jsonb;
begin
  -- Guarda antes da conta, não dentro dela: SECURITY DEFINER passa por cima da
  -- RLS das srg_*, e filtro silencioso devolveria tela montada e vazia — que é
  -- pior que tela trancada, porque parece que a clínica não operou.
  if coalesce((select t.polo_type from public.tenants t where t.id = public.current_tenant_id()), '') <> 'clinic' then
    raise exception 'A produção do centro cirúrgico é da clínica. Troque de polo para ver esta tela.'
      using errcode = '42501';
  end if;
  if not (public.can_route_leads() or public.current_user_can_finance()) then
    raise exception 'Sem permissão para ver a produção do centro cirúrgico.'
      using errcode = '42501';
  end if;

with base as (
  select s.id,
         s.dia,
         -- O sistema da sala grava "1" e "01" para a MESMA sala (e "2"/"02"). Sem
         -- normalizar, o relatório mostra 4 salas onde existem 2, e cada uma com
         -- metade das horas.
         coalesce(nullif(case when btrim(s.sala) ~ '^\d+$' then ltrim(btrim(s.sala), '0')
                              else btrim(s.sala) end, ''), 'Sem sala') as sala,
         s.status,
         nullif(s.meta, 0)                         as meta,
         s.total_extraidos,
         s.total_implantados,
         coalesce(nullif(m.nome, ''), 'Sem médico') as medico,
         coalesce(s.hora_inicio, et.ini)           as entrada,
         coalesce(s.dt_fim, et.fim)                as saida,
         v.valor_cents
  from public.srg_surgeries s
  left join public.srg_staff m on m.id = s.medico_id
  -- lateral, não join direto: duas vendas apontando para a mesma cirurgia
  -- duplicariam a linha e as horas dela entrariam duas vezes na soma.
  left join lateral (
    select sum(cs.value_cents) as valor_cents
    from public.clinic_sales cs
    where cs.srg_surgery_id = s.id and cs.value_cents > 0
  ) v on true
  left join lateral (
    select min(g.horario) as ini, max(g.horario) as fim
    from public.srg_stages g
    where g.surgery_id = s.id and g.deleted_at is null and g.horario is not null
  ) et on true
  where s.deleted_at is null
    and s.dia between p_de and p_ate
    and s.tenant_id = public.current_tenant_id()
),
c as (
  select b.*,
         h.bruta,
         case when h.bruta between 1 and 20 then h.bruta end as horas
  from base b
  left join lateral (
    select case when b.entrada is not null and b.saida is not null
                then extract(epoch from (b.saida - b.entrada)) / 3600.0 end as bruta
  ) h on true
),
resumo as (
  select jsonb_build_object(
    'cirurgias',            count(*),
    'finalizadas',          count(*) filter (where status = 'FINALIZADA'),
    'em_processo',          count(*) filter (where status = 'EM_PROCESSO'),
    'horas_sala',           round(coalesce(sum(horas), 0)::numeric, 1),
    'mediana_horas',        round(percentile_cont(0.5) within group (order by horas)::numeric, 2),
    'p90_horas',            round(percentile_cont(0.9) within group (order by horas)::numeric, 2),
    'foliculos_extraidos',  coalesce(sum(total_extraidos), 0),
    'foliculos_implantados',coalesce(sum(total_implantados), 0),
    'meta_total',           coalesce(sum(meta), 0),
    'aproveitamento_meta_pct', round(100.0 * coalesce(sum(total_implantados) filter (where meta is not null), 0)
                                     / nullif(sum(meta), 0), 1),
    'foliculos_por_hora',   round((coalesce(sum(total_implantados) filter (where horas is not null), 0)
                                   / nullif(sum(horas), 0))::numeric, 0),
    'receita_cents',        coalesce(sum(valor_cents), 0),
    'ticket_medio_cents',   round(avg(valor_cents) filter (where valor_cents > 0))::bigint,
    -- R$/hora só sobre quem tem valor E duração. `base_valor_hora` é a honestidade
    -- do número: sem ela o card vira média de coisa nenhuma.
    'valor_hora_sala_cents', round(coalesce(sum(valor_cents) filter (where horas is not null and valor_cents > 0), 0)
                                   / nullif(sum(horas) filter (where valor_cents > 0), 0))::bigint,
    'base_valor_hora',      count(*) filter (where horas is not null and valor_cents > 0),
    'horas_valor_hora',     round(coalesce(sum(horas) filter (where valor_cents > 0), 0)::numeric, 1)
  ) as j
  from c
),
por_mes as (
  select coalesce(jsonb_agg(x order by x->>'mes'), '[]'::jsonb) as j from (
    select jsonb_build_object(
      'mes',            to_char(date_trunc('month', dia), 'YYYY-MM'),
      'cirurgias',      count(*),
      'horas',          round(coalesce(sum(horas), 0)::numeric, 1),
      'mediana_horas',  round(percentile_cont(0.5) within group (order by horas)::numeric, 2),
      'foliculos',      coalesce(sum(total_implantados), 0),
      'receita_cents',  coalesce(sum(valor_cents), 0),
      'valor_hora_cents', round(coalesce(sum(valor_cents) filter (where horas is not null and valor_cents > 0), 0)
                                / nullif(sum(horas) filter (where valor_cents > 0), 0))::bigint
    ) as x
    from c group by date_trunc('month', dia)
  ) m
),
por_etapa as (
  select coalesce(jsonb_agg(x order by (x->>'mediana_min')::numeric desc), '[]'::jsonb) as j from (
    select jsonb_build_object(
      'etapa',       e.etapa,
      'cirurgias',   count(*),
      'mediana_min', round(percentile_cont(0.5) within group (order by e.min)::numeric, 0),
      'p90_min',     round(percentile_cont(0.9) within group (order by e.min)::numeric, 0)
    ) as x
    from (
      select g.surgery_id, g.etapa,
             extract(epoch from (max(g.horario) filter (where g.tipo = 'CONCLUIDO')
                               - min(g.horario) filter (where g.tipo = 'INICIO'))) / 60.0 as min
      from public.srg_stages g
      join c on c.id = g.surgery_id
      where g.deleted_at is null and g.horario is not null
      group by g.surgery_id, g.etapa
    ) e
    -- etapa negativa é marcação fora de ordem; zero é etapa que só foi carimbada.
    where e.min is not null and e.min > 0
    group by e.etapa
  ) t
),
por_medico as (
  select coalesce(jsonb_agg(x order by (x->>'cirurgias')::int desc), '[]'::jsonb) as j from (
    select jsonb_build_object(
      'medico',           medico,
      'cirurgias',        count(*),
      'horas',            round(coalesce(sum(horas), 0)::numeric, 1),
      'mediana_horas',    round(percentile_cont(0.5) within group (order by horas)::numeric, 2),
      'foliculos',        coalesce(sum(total_implantados), 0),
      'foliculos_por_hora', round((coalesce(sum(total_implantados) filter (where horas is not null), 0)
                                   / nullif(sum(horas), 0))::numeric, 0),
      'receita_cents',    coalesce(sum(valor_cents), 0)
    ) as x
    from c group by medico
  ) d
),
por_sala as (
  select coalesce(jsonb_agg(x order by (x->>'cirurgias')::int desc), '[]'::jsonb) as j from (
    select jsonb_build_object(
      'sala',       sala,
      'cirurgias',  count(*),
      'horas',      round(coalesce(sum(horas), 0)::numeric, 1),
      'mediana_horas', round(percentile_cont(0.5) within group (order by horas)::numeric, 2)
    ) as x
    from c group by sala
  ) s
),
qualidade as (
  select jsonb_build_object(
    'sem_duracao',        count(*) filter (where bruta is null),
    'duracao_suspeita',   count(*) filter (where bruta is not null and horas is null),
    'sem_venda_vinculada',count(*) filter (where valor_cents is null or valor_cents = 0),
    'ultimo_sync',        (select max(synced_at) from public.srg_surgeries)
  ) as j
  from c
)
select jsonb_build_object(
  'range',      jsonb_build_object('de', p_de, 'ate', p_ate),
  'resumo',     (select j from resumo),
  'por_mes',    (select j from por_mes),
  'por_etapa',  (select j from por_etapa),
  'por_medico', (select j from por_medico),
  'por_sala',   (select j from por_sala),
  'qualidade',  (select j from qualidade)
)
into v_resposta;

  return v_resposta;
end;
$fn$;

-- PUBLIC executa função por padrão, e anon entra em PUBLIC.
revoke all on function public.crm_cirurgia_analytics(date, date) from public, anon;
grant execute on function public.crm_cirurgia_analytics(date, date) to authenticated, service_role;

comment on function public.crm_cirurgia_analytics(date, date) is
  'Produção do centro cirúrgico no período: tempo de sala, tempo por etapa, folículos/hora e R$/hora de sala. Duração fora de 1h..20h é descartada e reportada em qualidade.duracao_suspeita.';

-- ---------------------------------------------------------------------------
-- 2) Conversão comercial: do lead ao dinheiro
-- ---------------------------------------------------------------------------
-- Função separada, e não mais um bloco dentro de `crm_funil_comercial`, por dois
-- motivos: a de lá tem 230 linhas e mexer nela para acrescentar coluna arrisca o
-- que já funciona; e conversão é pergunta que outras telas (analytics, metas)
-- vão querer sozinha, sem carregar SLA e faixas de resposta junto.
--
-- O que conta como VENDA, nos dois polos:
--   • clínica  → clinic_sales com lead vinculado (cancelada não conta);
--   • Tricopill→ rede_payments / pagbank_checkouts com status pago.
-- Venda registrada na mão que nunca virou pagamento no gateway não entra — é o
-- mesmo buraco de [[crm_venda_manual_nao_conta_como_paga]], e por isso
-- `qualidade.vendas_sem_lead` sai junto: sem ele a conversão da loja parece
-- pior do que é e ninguém sabe se é venda ruim ou cadastro solto.

create or replace function public.crm_conversao_comercial(
  p_start timestamptz,
  p_end   timestamptz,
  p_tenant text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_prev_start timestamptz := p_start - (p_end - p_start);
  v_resposta jsonb;
begin
  drop table if exists _cv_leads;
  drop table if exists _cv_vendas;
  drop table if exists _cv_safra;

  -- Coorte: leads criados na janela. Mesmo critério do funil comercial, para as
  -- duas telas não se contradizerem no total de leads.
  create temp table _cv_leads on commit drop as
    select l.id, l.created_at, l.owner_id, l.source, l.lost_reason,
           l.attribution_channel, l.attribution_campaign
    from public.leads l
    where l.deleted_at is null
      and coalesce(l.excluded_from_metrics, false) = false
      and l.created_at >= p_start and l.created_at <= p_end
      and (p_tenant is null or l.tenant_id = p_tenant);

  -- Todas as vendas do polo, de qualquer data: a safra do mês passado pode ter
  -- comprado hoje, e cortar por data aqui zeraria a conversão dos leads recentes.
  create temp table _cv_vendas on commit drop as
    select cs.lead_id, cs.value_cents::bigint as cents,
           (cs.sold_at + time '12:00') at time zone v_tz as quando
    from public.clinic_sales cs
    where cs.lead_id is not null and cs.sold_at is not null
      and coalesce(cs.status, '') <> 'cancelada'
      and coalesce(cs.value_cents, 0) > 0
      and (p_tenant is null or cs.tenant_id = p_tenant)
    union all
    select r.lead_id, r.amount_cents::bigint, coalesce(r.paid_at, r.created_at)
    from public.rede_payments r
    where r.lead_id is not null and r.status = 'paid'
      and (p_tenant is null or r.tenant_id = p_tenant)
    union all
    select pb.lead_id, pb.amount_cents::bigint, coalesce(pb.paid_at, pb.created_at)
    from public.pagbank_checkouts pb
    where pb.lead_id is not null and pb.status = 'paid'
      and (p_tenant is null or pb.tenant_id = p_tenant);

  create temp table _cv_safra on commit drop as
    select b.id, b.created_at, b.owner_id, b.source, b.lost_reason,
           b.attribution_channel, b.attribution_campaign,
           coalesce(sum(v.cents), 0)::bigint as receita_cents,
           count(v.lead_id) as compras,
           min(v.quando) as primeira_compra,
           extract(epoch from (min(v.quando) - b.created_at)) / 86400.0 as dias_ate_venda
    from _cv_leads b
    left join _cv_vendas v on v.lead_id = b.id
    group by b.id, b.created_at, b.owner_id, b.source, b.lost_reason,
             b.attribution_channel, b.attribution_campaign;

  select jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end, 'anterior_start', v_prev_start),
    'resumo', jsonb_build_object(
      'leads',              (select count(*) from _cv_safra),
      'convertidos',        (select count(*) from _cv_safra where compras > 0),
      'taxa_conversao_pct', (select round(100.0 * count(*) filter (where compras > 0) / nullif(count(*), 0), 1) from _cv_safra),
      'receita_cents',      (select coalesce(sum(receita_cents), 0) from _cv_safra),
      'ticket_medio_cents', (select round(avg(receita_cents) filter (where compras > 0))::bigint from _cv_safra),
      'dias_ate_venda_mediana', (select round(percentile_cont(0.5) within group (order by dias_ate_venda)::numeric, 1)
                                 from _cv_safra where compras > 0),
      -- Conversão no MESMO DIA quase nunca é lead que a equipe trabalhou: é o
      -- cadastro que a própria venda criou (importação de planilha, PDV, venda
      -- lançada na mão). Em julho/2026 eram 45 das 75 "conversões", todas na
      -- origem `planilha_venda`, com 100% de conversão — sem este número a taxa
      -- da tela sobe sozinha e ninguém sabe por quê.
      'convertidos_mesmo_dia', (select count(*) from _cv_safra where compras > 0 and dias_ate_venda < 1),
      -- Safra anterior do mesmo tamanho, para a variação. Comparar com "as vendas
      -- do mês passado" seria comparar coisa diferente.
      'convertidos_anterior', (
        select count(distinct l.id)
        from public.leads l
        join _cv_vendas v on v.lead_id = l.id
        where l.deleted_at is null and coalesce(l.excluded_from_metrics, false) = false
          and l.created_at >= v_prev_start and l.created_at < p_start
          and (p_tenant is null or l.tenant_id = p_tenant)),
      'leads_anterior', (
        select count(*)
        from public.leads l
        where l.deleted_at is null and coalesce(l.excluded_from_metrics, false) = false
          and l.created_at >= v_prev_start and l.created_at < p_start
          and (p_tenant is null or l.tenant_id = p_tenant)),
      -- Caixa da janela: vendas que ACONTECERAM no período, de qualquer safra.
      -- É o número que casa com o financeiro; a conversão acima é o número que
      -- avalia a entrada de lead. São perguntas diferentes e ficam separadas.
      'vendas_no_periodo',        (select count(*) from _cv_vendas where quando >= p_start and quando <= p_end),
      'receita_no_periodo_cents', (select coalesce(sum(cents), 0) from _cv_vendas where quando >= p_start and quando <= p_end)
    ),
    'por_origem', (
      select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'origem',        coalesce(nullif(attribution_channel, ''), nullif(source, ''), 'Não identificada'),
          'leads',         count(*),
          'convertidos',   count(*) filter (where compras > 0),
          'conversao_pct', round(100.0 * count(*) filter (where compras > 0) / nullif(count(*), 0), 1),
          'receita_cents', coalesce(sum(receita_cents), 0)
        ) as x
        from _cv_safra
        group by coalesce(nullif(attribution_channel, ''), nullif(source, ''), 'Não identificada')
      ) o),
    'por_campanha', (
      select coalesce(jsonb_agg(x order by (x->>'receita_cents')::bigint desc, (x->>'leads')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'campanha',      attribution_campaign,
          'leads',         count(*),
          'convertidos',   count(*) filter (where compras > 0),
          'conversao_pct', round(100.0 * count(*) filter (where compras > 0) / nullif(count(*), 0), 1),
          'receita_cents', coalesce(sum(receita_cents), 0)
        ) as x
        from _cv_safra
        where attribution_campaign is not null and attribution_campaign <> ''
        group by attribution_campaign
        order by coalesce(sum(receita_cents), 0) desc, count(*) desc
        limit 12
      ) c),
    'por_atendente', (
      select coalesce(jsonb_agg(x order by (x->>'convertidos')::int desc, (x->>'leads')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'atendente',     coalesce(u.name, 'Sem responsável'),
          'leads',         count(*),
          'convertidos',   count(*) filter (where s.compras > 0),
          'conversao_pct', round(100.0 * count(*) filter (where s.compras > 0) / nullif(count(*), 0), 1),
          'receita_cents', coalesce(sum(s.receita_cents), 0)
        ) as x
        from _cv_safra s
        left join public.app_users u on u.id = s.owner_id
        group by coalesce(u.name, 'Sem responsável')
      ) a),
    'por_mes', (
      select coalesce(jsonb_agg(x order by x->>'mes'), '[]'::jsonb) from (
        select jsonb_build_object(
          'mes',           to_char(date_trunc('month', created_at at time zone v_tz), 'YYYY-MM'),
          'leads',         count(*),
          'convertidos',   count(*) filter (where compras > 0),
          'conversao_pct', round(100.0 * count(*) filter (where compras > 0) / nullif(count(*), 0), 1),
          'receita_cents', coalesce(sum(receita_cents), 0)
        ) as x
        from _cv_safra
        group by date_trunc('month', created_at at time zone v_tz)
      ) m),
    'qualidade', jsonb_build_object(
      -- Venda sem lead é conversão que existiu e não pode ser creditada a origem
      -- nenhuma. Enquanto esse número for alto, toda taxa aqui é PISO, não verdade.
      'vendas_sem_lead', (
        select count(*) from public.clinic_sales cs
        where cs.lead_id is null and cs.sold_at is not null
          and (cs.sold_at + time '12:00') at time zone v_tz between p_start and p_end
          and coalesce(cs.status, '') <> 'cancelada'
          and (p_tenant is null or cs.tenant_id = p_tenant)),
      'pagamentos_sem_lead', (
        select count(*) from public.rede_payments r
        where r.lead_id is null and r.status = 'paid'
          and coalesce(r.paid_at, r.created_at) between p_start and p_end
          and (p_tenant is null or r.tenant_id = p_tenant))
    )
  ) into v_resposta;

  return v_resposta;
end;
$fn$;

revoke all on function public.crm_conversao_comercial(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.crm_conversao_comercial(timestamptz, timestamptz, text) to authenticated, service_role;

comment on function public.crm_conversao_comercial(timestamptz, timestamptz, text) is
  'Conversão de SAFRA (leads criados na janela que compraram alguma vez) + caixa da janela, por origem, campanha, atendente e mês. Vale para os dois polos: clinic_sales, rede_payments e pagbank_checkouts.';
