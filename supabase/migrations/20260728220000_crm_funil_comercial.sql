-- Centro de Resultados · Funil Comercial da clínica.
--
-- Motivação: a clínica tem 3 telas de métrica que se contradizem e nenhuma
-- responde as perguntas do dia a dia ("de onde vieram os leads?", "quanto
-- tempo a gente demora pra responder?", "quem está atendendo?"). As métricas
-- que dependem da Shosp são cegas (1,2% dos leads têm vínculo com paciente) e
-- não há faturamento registrado. Esta RPC usa SÓ o que é dado confiável hoje:
-- a tabela `leads` e o histórico de `interactions`.
--
-- Decisões de contagem, explicitadas porque é o que faz a métrica ser confiável:
--   * Coorte = leads CRIADOS no período (data local da clínica).
--   * "Respondido" = existe uma interação de saída DEPOIS da criação do lead.
--     Separa resposta da IA (author 'Assistente IA') da resposta HUMANA — são
--     SLAs diferentes e misturar os dois esconde o handoff lento.
--   * Interações de `direction='system'` (sincronização, automação, ordenação de
--     quadro) NUNCA contam como resposta. São ruído de máquina.
--   * NPS/pesquisa de satisfação não conta como primeira resposta.
--   * Comparativo = janela imediatamente anterior do MESMO tamanho.
--   * `qualidade_dado` devolve o preenchimento real dos campos que sustentam as
--     outras métricas. Sem isso a tela vira número bonito sobre base vazia.

create or replace function public.crm_funil_comercial(
  p_start timestamptz default (now() - interval '30 days'),
  p_end timestamptz default now(),
  p_tenant text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_ia constant text := 'Assistente IA';
  v_dur interval := p_end - p_start;
  v_prev_start timestamptz := p_start - (p_end - p_start);
  v_result jsonb;
  v_resumo jsonb;
  v_por_dia jsonb;
  v_por_origem jsonb;
  v_por_campanha jsonb;
  v_por_atendente jsonb;
  v_sla jsonb;
  v_perdas jsonb;
  v_etapas jsonb;
  v_qualidade jsonb;
  v_prev_leads int;
begin
  -- Coorte do período.
  create temp table _fc_leads on commit drop as
  select l.id, l.created_at, l.owner_id, l.source, l.stage_id, l.pipeline_id,
         l.lost_reason, l.stage_entered_at, l.shosp_prontuario,
         l.attribution_channel, l.attribution_campaign
  from public.leads l
  where l.deleted_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and l.created_at >= p_start and l.created_at <= p_end
    and (p_tenant is null or l.tenant_id = p_tenant);

  -- Primeira resposta por lead, separando IA de humano. `system` é ruído de
  -- máquina e a pesquisa de satisfação não é atendimento.
  create temp table _fc_resp on commit drop as
  select b.id,
         min(i.happened_at) filter (where i.author = v_ia) as ia_at,
         min(i.happened_at) filter (where i.author <> v_ia and i.author not ilike 'NPS%') as humano_at
  from _fc_leads b
  left join public.interactions i
    on i.lead_id = b.id
   and i.direction = 'out'
   and i.happened_at >= b.created_at
  group by b.id;

  create temp table _fc_tempo on commit drop as
  select r.id,
         r.ia_at, r.humano_at,
         extract(epoch from (r.ia_at - b.created_at)) / 60.0 as ia_min,
         extract(epoch from (r.humano_at - b.created_at)) / 60.0 as humano_min,
         (r.ia_at is not null or r.humano_at is not null) as respondido
  from _fc_resp r join _fc_leads b on b.id = r.id;

  select count(*) into v_prev_leads
  from public.leads l
  where l.deleted_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and l.created_at >= v_prev_start and l.created_at < p_start
    and (p_tenant is null or l.tenant_id = p_tenant);

  select jsonb_build_object(
    'leads_novos', (select count(*) from _fc_leads),
    'leads_novos_anterior', v_prev_leads,
    'variacao_pct', case when v_prev_leads = 0 then null
                    else round(100.0 * ((select count(*) from _fc_leads) - v_prev_leads) / v_prev_leads, 1) end,
    'ativos', (select count(*) from _fc_leads where lost_reason is null),
    'perdidos', (select count(*) from _fc_leads where lost_reason is not null),
    'respondidos', (select count(*) from _fc_tempo where respondido),
    'sem_resposta', (select count(*) from _fc_tempo where not respondido),
    'taxa_resposta_pct', (select round(100.0 * count(*) filter (where respondido) / nullif(count(*),0), 1) from _fc_tempo),
    'atendidos_por_humano', (select count(*) from _fc_tempo where humano_at is not null),
    'dias_no_periodo', greatest(1, ceil(extract(epoch from v_dur) / 86400.0)::int)
  ) into v_resumo;

  select coalesce(jsonb_agg(x order by x->>'dia'), '[]'::jsonb) into v_por_dia from (
    select jsonb_build_object(
      'dia', to_char((created_at at time zone v_tz)::date, 'YYYY-MM-DD'),
      'leads', count(*)
    ) as x
    from _fc_leads group by (created_at at time zone v_tz)::date
  ) d;

  -- Origem: a atribuição é a fonte boa; quando falta, cai pro canal de entrada.
  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_por_origem from (
    select jsonb_build_object(
      'origem', coalesce(nullif(attribution_channel, ''), nullif(source, ''), 'Não identificada'),
      'leads', count(*),
      'perdidos', count(*) filter (where lost_reason is not null)
    ) as x
    from _fc_leads
    group by coalesce(nullif(attribution_channel, ''), nullif(source, ''), 'Não identificada')
  ) o;

  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_por_campanha from (
    select jsonb_build_object('campanha', attribution_campaign, 'leads', count(*)) as x
    from _fc_leads
    where attribution_campaign is not null and attribution_campaign <> ''
    group by attribution_campaign
    order by count(*) desc
    limit 12
  ) c;

  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_por_atendente from (
    select jsonb_build_object(
      'atendente', coalesce(u.name, 'Sem responsável'),
      'leads', count(*),
      'respondidos', count(*) filter (where t.respondido),
      'sem_resposta', count(*) filter (where not t.respondido),
      'atendidos_por_humano', count(*) filter (where t.humano_at is not null),
      'mediana_humano_min', round(percentile_cont(0.5) within group (order by t.humano_min)::numeric, 1),
      'perdidos', count(*) filter (where b.lost_reason is not null)
    ) as x
    from _fc_leads b
    join _fc_tempo t on t.id = b.id
    left join public.app_users u on u.id = b.owner_id
    group by coalesce(u.name, 'Sem responsável')
  ) a;

  -- SLA de primeira resposta. Faixas em vez de só média: a média esconde o lead
  -- que ficou 3 dias esperando.
  select jsonb_build_object(
    'ia', jsonb_build_object(
      'respondidos', (select count(*) from _fc_tempo where ia_at is not null),
      'mediana_min', (select round(percentile_cont(0.5) within group (order by ia_min)::numeric, 1) from _fc_tempo where ia_at is not null),
      'p90_min', (select round(percentile_cont(0.9) within group (order by ia_min)::numeric, 1) from _fc_tempo where ia_at is not null)
    ),
    'humano', jsonb_build_object(
      'respondidos', (select count(*) from _fc_tempo where humano_at is not null),
      'mediana_min', (select round(percentile_cont(0.5) within group (order by humano_min)::numeric, 1) from _fc_tempo where humano_at is not null),
      'p90_min', (select round(percentile_cont(0.9) within group (order by humano_min)::numeric, 1) from _fc_tempo where humano_at is not null)
    ),
    'faixas_humano', (
      select coalesce(jsonb_agg(jsonb_build_object('faixa', f.faixa, 'leads', f.n) order by f.ord), '[]'::jsonb)
      from (
        select case
                 when humano_min is null then 'Sem resposta humana'
                 when humano_min <= 5 then 'Até 5 min'
                 when humano_min <= 30 then '5 a 30 min'
                 when humano_min <= 120 then '30 min a 2 h'
                 when humano_min <= 1440 then '2 a 24 h'
                 else 'Mais de 24 h'
               end as faixa,
               case
                 when humano_min is null then 6
                 when humano_min <= 5 then 1
                 when humano_min <= 30 then 2
                 when humano_min <= 120 then 3
                 when humano_min <= 1440 then 4
                 else 5
               end as ord,
               count(*) as n
        from _fc_tempo
        group by 1, 2
      ) f
    )
  ) into v_sla;

  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_perdas from (
    select jsonb_build_object('motivo', lost_reason, 'leads', count(*)) as x
    from _fc_leads where lost_reason is not null
    group by lost_reason limit 10
  ) p;

  select coalesce(jsonb_agg(x order by (x->>'position')::int), '[]'::jsonb) into v_etapas from (
    select jsonb_build_object(
      'etapa', coalesce(ps.name, b.stage_id),
      'position', coalesce(ps.position, 99),
      'leads', count(*),
      'dias_medios', round(avg(extract(epoch from (now() - coalesce(b.stage_entered_at, b.created_at))) / 86400.0)::numeric, 1)
    ) as x
    from _fc_leads b left join public.pipeline_stages ps on ps.id = b.stage_id
    where b.lost_reason is null
    group by coalesce(ps.name, b.stage_id), ps.position
  ) e;

  -- Honestidade da base: quanto de cada campo está realmente preenchido.
  select jsonb_build_object(
    'com_campanha_pct', (select round(100.0 * count(attribution_campaign) / nullif(count(*),0), 1) from _fc_leads),
    'com_motivo_perda_pct', (select round(100.0 * count(*) filter (where lost_reason is not null)
                                          / nullif(count(*) filter (where lost_reason is not null
                                                                       or stage_id in (select id from public.pipeline_stages where lower(name) like '%encerr%')), 0), 1)
                             from _fc_leads),
    'com_vinculo_shosp_pct', (select round(100.0 * count(shosp_prontuario) / nullif(count(*),0), 1) from _fc_leads),
    'agenda_ultimo_sync', (select max(synced_at) from public.shosp_appointments),
    'agenda_dias_atras', (select case when max(synced_at) is null then null
                                 else floor(extract(epoch from (now() - max(synced_at))) / 86400.0)::int end
                          from public.shosp_appointments)
  ) into v_qualidade;

  v_result := jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end,
                                'anterior_start', v_prev_start),
    'resumo', v_resumo,
    'por_dia', v_por_dia,
    'por_origem', v_por_origem,
    'por_campanha', v_por_campanha,
    'por_atendente', v_por_atendente,
    'sla', v_sla,
    'perdas', v_perdas,
    'etapas', v_etapas,
    'qualidade_dado', v_qualidade
  );
  return v_result;
end;
$$;

grant execute on function public.crm_funil_comercial(timestamptz, timestamptz, text) to authenticated, service_role;
