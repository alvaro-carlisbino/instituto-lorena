-- /resultados: três correções na apuração do funil comercial.
--
-- 1. QUEM É BOT. O critério era `author <> 'Assistente IA'` (mais `not ilike 'NPS%'`), mas
--    existem outros remetentes automáticos em `interactions`: `Sofia (IA)` (112 mensagens,
--    o template de primeiro contato do Lead Ads), `Assistente IA (follow-up)` (41) e
--    `Sistema` (2). Todos entravam como resposta HUMANA, inflando "leads respondidos pela
--    equipe" e puxando a mediana para baixo, porque template dispara em segundos.
--
-- 2. "POR ATENDENTE" MEDIA O TEMPO DE OUTRA PESSOA. A tabela agrupa por `owner_id` (que é
--    rodízio automático), mas a mediana vinha de quem de fato respondeu. Dos 129 leads
--    creditados a uma atendente, 105 tinham sido respondidos pela gerência e nenhum por
--    ela: a coluna mostrava o desempenho da gerência na linha dela. Agora a mediana
--    considera SÓ os leads que aquela pessoa respondeu, e a coluna `respondidos_por_ela`
--    diz quantos foram, para a linha ser interpretável.
--
-- 3. MOTIVOS DE PERDA COM `limit 10` SEM `order by`. O recorte pegava 10 motivos
--    arbitrários; em 90 dias sumiam o 2º, o 3º e o 4º maiores e sobravam motivos de um
--    lead só. Também agrupa sem diferenciar caixa, porque "Distância/localização" e
--    "distância/localização" viravam duas linhas.

drop function if exists public.crm_funil_comercial(timestamptz, timestamptz, text);

create function public.crm_funil_comercial(
  p_start timestamptz,
  p_end timestamptz,
  p_tenant text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_ia constant text := 'Assistente IA';
  v_dur interval := p_end - p_start;
  v_prev_start timestamptz := p_start - (p_end - p_start);
  v_result jsonb; v_resumo jsonb; v_por_dia jsonb; v_por_origem jsonb; v_por_campanha jsonb;
  v_por_atendente jsonb; v_por_quem_respondeu jsonb; v_sla jsonb; v_perdas jsonb; v_etapas jsonb; v_qualidade jsonb;
  v_prev_leads int;
begin
  -- As tabelas temporárias são `on commit drop`, então duas chamadas na MESMA transação
  -- explodiam com "relation _fc_leads already exists". Não acontecia pela tela (uma chamada
  -- por requisição), mas quebrava qualquer consulta que quisesse comparar dois períodos.
  drop table if exists _fc_leads;
  drop table if exists _fc_resp;
  drop table if exists _fc_tempo;

  create temp table _fc_leads on commit drop as
    select l.id, l.created_at, l.owner_id, l.source, l.stage_id, l.pipeline_id, l.lost_reason,
           l.stage_entered_at, l.shosp_prontuario, l.attribution_channel, l.attribution_campaign
    from public.leads l
    where l.deleted_at is null
      and coalesce(l.excluded_from_metrics, false) = false
      and l.created_at >= p_start and l.created_at <= p_end
      and (p_tenant is null or l.tenant_id = p_tenant);

  -- `humano_autor` guarda QUEM deu a primeira resposta humana, para o bloco "por atendente"
  -- poder separar o desempenho de cada pessoa do desempenho de quem recebeu o lead.
  create temp table _fc_resp on commit drop as
    select b.id,
           -- IA = a assistente conversando com o lead. Disparo de NPS e mensagem de
           -- sistema NÃO entram aqui nem em humano: não são atendimento, são automação de
           -- processo, e contá-las como resposta da IA inflava o número em ~130.
           min(i.happened_at) filter (
             where i.author = v_ia or i.author ilike 'Assistente IA%' or i.author ilike 'Sofia%'
           ) as ia_at,
           min(i.happened_at) filter (
             where not (i.author = v_ia or i.author ilike 'Assistente IA%'
                    or i.author ilike 'Sofia%' or i.author ilike 'NPS%' or i.author = 'Sistema')
           ) as humano_at,
           (array_agg(i.author order by i.happened_at) filter (
             where not (i.author = v_ia or i.author ilike 'Assistente IA%'
                    or i.author ilike 'Sofia%' or i.author ilike 'NPS%' or i.author = 'Sistema')
           ))[1] as humano_autor
    from _fc_leads b
    left join public.interactions i
      on i.lead_id = b.id and i.direction = 'out' and i.happened_at >= b.created_at
    group by b.id;

  create temp table _fc_tempo on commit drop as
    select r.id, r.ia_at, r.humano_at, r.humano_autor,
           extract(epoch from (r.ia_at - b.created_at)) / 60.0 as ia_min,
           extract(epoch from (r.humano_at - b.created_at)) / 60.0 as humano_min,
           (r.ia_at is not null or r.humano_at is not null) as respondido
    from _fc_resp r join _fc_leads b on b.id = r.id;

  select count(*) into v_prev_leads
  from public.leads l
  where l.deleted_at is null and coalesce(l.excluded_from_metrics, false) = false
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

  select coalesce(jsonb_agg(x order by x->>'dia'), '[]'::jsonb) into v_por_dia
  from (select jsonb_build_object('dia', to_char((created_at at time zone v_tz)::date, 'YYYY-MM-DD'), 'leads', count(*)) as x
        from _fc_leads group by (created_at at time zone v_tz)::date) d;

  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_por_origem
  from (select jsonb_build_object(
          'origem', coalesce(nullif(attribution_channel, ''), nullif(source, ''), 'Não identificada'),
          'leads', count(*), 'perdidos', count(*) filter (where lost_reason is not null)) as x
        from _fc_leads
        group by coalesce(nullif(attribution_channel, ''), nullif(source, ''), 'Não identificada')) o;

  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_por_campanha
  from (select jsonb_build_object('campanha', attribution_campaign, 'leads', count(*)) as x
        from _fc_leads where attribution_campaign is not null and attribution_campaign <> ''
        group by attribution_campaign order by count(*) desc limit 12) c;

  -- A mediana passa a olhar SÓ os leads que a própria pessoa respondeu (casando o autor da
  -- interação com o e-mail ou o nome do usuário). `respondidos_por_ela` mostra a base.
  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_por_atendente
  from (
    select jsonb_build_object(
      'atendente', coalesce(u.name, 'Sem responsável'),
      'leads', count(*),
      'respondidos', count(*) filter (where t.respondido),
      'sem_resposta', count(*) filter (where not t.respondido),
      'atendidos_por_humano', count(*) filter (where t.humano_at is not null),
      'respondidos_por_ela', count(*) filter (where t.humano_autor is not null and u.id is not null
                                                and (t.humano_autor = u.email or t.humano_autor = u.name)),
      'mediana_humano_min', round(percentile_cont(0.5) within group (
        order by case when u.id is not null and (t.humano_autor = u.email or t.humano_autor = u.name)
                      then t.humano_min end)::numeric, 1),
      'perdidos', count(*) filter (where b.lost_reason is not null)
    ) as x
    from _fc_leads b
    join _fc_tempo t on t.id = b.id
    left join public.app_users u on u.id = b.owner_id
    group by coalesce(u.name, 'Sem responsável')
  ) a;

  -- Quem de fato respondeu, que é diferente de quem recebeu o lead. Sem este bloco a tela
  -- some com o trabalho de quem atende os leads dos outros: a gerência escreve a maior
  -- parte das primeiras respostas e é dona de pouquíssimos leads.
  select coalesce(jsonb_agg(x order by (x->>'respondeu')::int desc), '[]'::jsonb) into v_por_quem_respondeu
  from (
    select jsonb_build_object(
      'pessoa', coalesce(u.name, t.humano_autor),
      'respondeu', count(*),
      'mediana_min', round(percentile_cont(0.5) within group (order by t.humano_min)::numeric, 1)
    ) as x
    from _fc_tempo t
    left join public.app_users u on u.email = t.humano_autor or u.name = t.humano_autor
    where t.humano_autor is not null
    group by coalesce(u.name, t.humano_autor)
  ) q;

  select jsonb_build_object(
    'ia', jsonb_build_object(
      'respondidos', (select count(*) from _fc_tempo where ia_at is not null),
      'mediana_min', (select round(percentile_cont(0.5) within group (order by ia_min)::numeric, 1) from _fc_tempo where ia_at is not null),
      'p90_min', (select round(percentile_cont(0.9) within group (order by ia_min)::numeric, 1) from _fc_tempo where ia_at is not null)),
    'humano', jsonb_build_object(
      'respondidos', (select count(*) from _fc_tempo where humano_at is not null),
      'mediana_min', (select round(percentile_cont(0.5) within group (order by humano_min)::numeric, 1) from _fc_tempo where humano_at is not null),
      'p90_min', (select round(percentile_cont(0.9) within group (order by humano_min)::numeric, 1) from _fc_tempo where humano_at is not null)),
    'faixas_humano', (
      select coalesce(jsonb_agg(jsonb_build_object('faixa', f.faixa, 'leads', f.n) order by f.ord), '[]'::jsonb)
      from (select case when humano_min is null then 'Sem resposta humana'
                        when humano_min <= 5 then 'Até 5 min'
                        when humano_min <= 30 then '5 a 30 min'
                        when humano_min <= 120 then '30 min a 2 h'
                        when humano_min <= 1440 then '2 a 24 h'
                        else 'Mais de 24 h' end as faixa,
                   case when humano_min is null then 6 when humano_min <= 5 then 1
                        when humano_min <= 30 then 2 when humano_min <= 120 then 3
                        when humano_min <= 1440 then 4 else 5 end as ord,
                   count(*) as n
            from _fc_tempo group by 1, 2) f)
  ) into v_sla;

  -- `order by count(*) desc` antes do limite, e agrupamento sem diferenciar caixa.
  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb) into v_perdas
  from (select jsonb_build_object('motivo', min(lost_reason), 'leads', count(*)) as x
        from _fc_leads where lost_reason is not null
        group by lower(btrim(lost_reason))
        order by count(*) desc limit 10) p;

  select coalesce(jsonb_agg(x order by (x->>'position')::int), '[]'::jsonb) into v_etapas
  from (select jsonb_build_object(
          'etapa', coalesce(ps.name, b.stage_id), 'position', coalesce(ps.position, 99),
          'leads', count(*),
          'dias_medios', round(avg(extract(epoch from (now() - coalesce(b.stage_entered_at, b.created_at))) / 86400.0)::numeric, 1)) as x
        from _fc_leads b left join public.pipeline_stages ps on ps.id = b.stage_id
        where b.lost_reason is null
        group by coalesce(ps.name, b.stage_id), ps.position) e;

  select jsonb_build_object(
    'com_campanha_pct', (select round(100.0 * count(attribution_campaign) / nullif(count(*),0), 1) from _fc_leads),
    'com_motivo_perda_pct', (select round(100.0 * count(*) filter (where lost_reason is not null) / nullif(count(*) filter (where lost_reason is not null or stage_id in (select id from public.pipeline_stages where lower(name) like '%encerr%')), 0), 1) from _fc_leads),
    'com_vinculo_shosp_pct', (select round(100.0 * count(shosp_prontuario) / nullif(count(*),0), 1) from _fc_leads),
    'agenda_ultimo_sync', (select max(synced_at) from public.shosp_appointments),
    'agenda_dias_atras', (select case when max(synced_at) is null then null else floor(extract(epoch from (now() - max(synced_at))) / 86400.0)::int end from public.shosp_appointments)
  ) into v_qualidade;

  v_result := jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end, 'anterior_start', v_prev_start),
    'resumo', v_resumo, 'por_dia', v_por_dia, 'por_origem', v_por_origem,
    'por_campanha', v_por_campanha, 'por_atendente', v_por_atendente, 'por_quem_respondeu', v_por_quem_respondeu, 'sla', v_sla,
    'perdas', v_perdas, 'etapas', v_etapas, 'qualidade_dado', v_qualidade
  );
  return v_result;
end;
$function$;

-- Recria as permissões perdidas no drop. `authenticated` é quem a tela usa; PUBLIC fica de
-- fora de propósito, senão a função volta a ficar aberta para anônimo (ver a limpeza de RPCs
-- SECURITY DEFINER feita em 28/jul).
-- ATENÇÃO: recriar a função reaplica o privilégio PADRÃO do Supabase, que inclui `anon`.
-- Um `revoke ... from public` NÃO tira uma concessão explícita a `anon`, então é preciso
-- revogar `anon` pelo nome. Sem isto a RPC volta a ficar aberta para quem não fez login,
-- desfazendo a limpeza de RPCs SECURITY DEFINER de 28/jul.
revoke all on function public.crm_funil_comercial(timestamptz, timestamptz, text) from public;
revoke execute on function public.crm_funil_comercial(timestamptz, timestamptz, text) from anon;
grant execute on function public.crm_funil_comercial(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.crm_funil_comercial(timestamptz, timestamptz, text) to service_role;
