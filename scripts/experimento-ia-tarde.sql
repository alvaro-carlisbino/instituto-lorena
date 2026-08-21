-- Experimento "vale a pena a IA no horário comercial?" (pedido do Álvaro, 21/08/2026).
--
-- Compara TARDES (12:00 às 18:00, horário de Maringá) da clínica: com a Sofia ligada
-- contra a tarde de 21/08/2026, em que ela ficou desligada das 12h às 18h.
--
-- Como rodar: troque o intervalo no CTE `janela`. `dow = 5` filtra só sextas; tire a
-- linha para ver todos os dias.
--
-- Regras de contagem (mesmas de crm_funil_comercial, para os números baterem com /resultados):
--   * "conversa" = lead com pelo menos um inbound de PACIENTE na janela. Contato interno
--     (Spa, recepção, equipe) fica de fora por crm_is_internal_contact.
--   * "resposta" = interação direction='out' depois desse inbound. NPS não é atendimento.
--   * A resposta é separada em três autores, porque na tarde sem IA o robô de follow-up
--     continua disparando (ele não olha crm_ai_configs.enabled) e mascararia o tempo humano.
--   * "converteu" = a sincronização da Shosp moveu o lead para "Consulta agendada" nos 7
--     dias seguintes. É o único evento de conversão com data confiável: não existe
--     histórico de etapa no banco.

with janela as (
  select date '2026-06-01' as de, date '2026-08-31' as ate,
         time '12:00' as h_ini, time '18:00' as h_fim
),
inbound as (
  select (i.happened_at at time zone 'America/Sao_Paulo')::date as dia,
         i.lead_id,
         min(i.happened_at) as t_in
  from interactions i
  join leads l on l.id = i.lead_id
  cross join janela j
  where i.tenant_id = 'instituto-lorena'
    and i.direction = 'in'
    and (i.happened_at at time zone 'America/Sao_Paulo')::date between j.de and j.ate
    and (i.happened_at at time zone 'America/Sao_Paulo')::time >= j.h_ini
    and (i.happened_at at time zone 'America/Sao_Paulo')::time <  j.h_fim
    and l.deleted_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and not crm_is_internal_contact(coalesce(l.patient_name, ''))
  group by 1, 2
),
resp as (
  select b.*,
         (select o.happened_at from interactions o
           where o.lead_id = b.lead_id and o.direction = 'out'
             and o.author not in ('NPS (Sofia)', 'NPS')
             and o.happened_at > b.t_in
           order by o.happened_at limit 1) as t_qualquer,
         (select o.author from interactions o
           where o.lead_id = b.lead_id and o.direction = 'out'
             and o.author not in ('NPS (Sofia)', 'NPS')
             and o.happened_at > b.t_in
           order by o.happened_at limit 1) as autor_1a,
         (select o.happened_at from interactions o
           where o.lead_id = b.lead_id and o.direction = 'out'
             and o.author not in ('NPS (Sofia)', 'NPS', 'Assistente IA', 'Sofia (IA)', 'Assistente IA (follow-up)')
             and o.happened_at > b.t_in
           order by o.happened_at limit 1) as t_humano
  from inbound b
),
marc as (
  select r.*,
         extract(epoch from (r.t_qualquer - r.t_in)) / 60 as min_qualquer,
         extract(epoch from (r.t_humano   - r.t_in)) / 60 as min_humano,
         r.autor_1a in ('Assistente IA', 'Sofia (IA)')  as ia,
         r.autor_1a = 'Assistente IA (follow-up)'       as robo_followup,
         exists (select 1 from interactions s
                  where s.lead_id = r.lead_id and s.direction = 'system'
                    and s.content ilike '%Consulta agendada%agenda Shosp%'
                    and s.happened_at >= r.t_in
                    and s.happened_at <  r.t_in + interval '7 days') as agendou_7d
  from resp r
)
select to_char(dia, 'DD/MM') as dia,
       to_char(dia, 'Dy')    as sem,
       count(*)                                                    as conversas,
       count(*) filter (where ia)                                  as resp1_ia,
       count(*) filter (where robo_followup)                       as resp1_robo,
       count(*) filter (where t_qualquer is not null and not ia and not robo_followup) as resp1_humano,
       count(*) filter (where t_qualquer is null)                  as sem_resposta,
       round(percentile_cont(0.5) within group (order by min_qualquer)::numeric, 1) as med_min,
       round(percentile_cont(0.9) within group (order by min_qualquer)::numeric, 1) as p90_min,
       round(percentile_cont(0.5) within group (order by min_humano)::numeric, 1)   as med_humano_min,
       round(100.0 * count(*) filter (where min_qualquer <= 60) / count(*))         as pct_60min,
       count(*) filter (where agendou_7d)                                           as agendou_7d,
       round(100.0 * count(*) filter (where agendou_7d) / count(*), 1)              as pct_conv
from marc
where extract(dow from dia) = 5
group by dia
order by dia;
