-- A conversa que ninguém pegou depois das 12h não era de ninguém.
--
-- Três redes olhavam "cliente sem resposta", cada uma com a sua janela, e as três
-- passavam o resto para o "follow-up":
--
--   crm-atendimento-vigia      0–12h   "o que passou de 12h é assunto de follow-up"
--   usePendingHandoff (sino)   0–48/72h "viram lead frio: vão para follow-up"
--   crm-followup-scheduler     ——      só ai_enabled=true E owner_mode<>'human', 24h
--
-- Só que a terceira não podia pegar nenhuma delas. Quando a Sofia termina a triagem e
-- emite [PRONTO_PARA_CONSULTOR], `disableAiOnHandoff` grava ai_enabled=false +
-- owner_mode=human, e isso NÃO expira (a expiração de 7 dias só alcança handoff com a IA
-- ligada). Ou seja: no instante em que o lead vira oportunidade de verdade ele sai da
-- única máquina de follow-up que existe, e passadas 72h some também do sino.
--
-- Medido em 21/ago/2026: 147 conversas de WhatsApp real na clínica com a última mensagem
-- do cliente e nenhuma resposta, 130 delas acima de 72h. Rafael Teló esperava há 7 dias.
--
-- Esta função é a lista dessa zona morta, para o vigia COBRAR A EQUIPE. Ela não dispara
-- resposta automática de propósito: handoff desliga a IA e essa regra continua de pé
-- (ver [[feedback_handoff_desliga_ia]]). Quem escoa o passivo é gente, com teto diário.
--
-- Irmã de `crm_unanswered_inbound` (que serve o sino, é por tenant e para no 72h). Esta
-- roda no cron, então NÃO filtra por current_tenant_id() (service_role não tem tenant) e
-- devolve o tenant em duas colunas: o do cadastro e o da CONVERSA, porque o polo de quem
-- deve cobrar é o da linha por onde a pessoa falou, não o da ficha.

create or replace function public.crm_pendencias_abandonadas(
  p_min_horas integer default 12,
  p_max_dias integer default 90
)
returns table(
  lead_id text,
  patient_name text,
  phone text,
  tenant_id text,
  conversa_tenant_id text,
  whatsapp_instance_id text,
  content text,
  happened_at timestamp with time zone,
  horas integer,
  owner_mode text,
  ai_enabled boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ultima_entrada as (
    select distinct on (i.lead_id)
      i.lead_id, i.content, i.happened_at, i.tenant_id
    from public.interactions i
    where i.direction = 'in'
      and i.channel in ('whatsapp', 'meta')
      and i.happened_at > now() - make_interval(days => greatest(p_max_dias, 1))
    order by i.lead_id, i.happened_at desc
  )
  select
    l.id as lead_id,
    coalesce(l.patient_name, 'Lead') as patient_name,
    coalesce(l.phone, '') as phone,
    l.tenant_id,
    coalesce(nullif(e.tenant_id, ''), l.tenant_id) as conversa_tenant_id,
    l.whatsapp_instance_id,
    left(e.content, 200) as content,
    e.happened_at,
    (extract(epoch from (now() - e.happened_at)) / 3600)::integer as horas,
    coalesce(s.owner_mode, 'auto') as owner_mode,
    coalesce(s.ai_enabled, true) as ai_enabled
  from ultima_entrada e
  join public.leads l on l.id = e.lead_id
  left join public.crm_conversation_states s on s.lead_id = l.id
  where l.deleted_at is null
    and l.opted_out_at is null
    -- Abaixo disto ainda é assunto do vigia quente (IA retoma / avisa em 30 e 90 min).
    and e.happened_at < now() - make_interval(hours => greatest(p_min_horas, 1))
    and coalesce(l.conversation_status, '') not in ('archived', 'closed', 'lost', 'won')
    -- Sem isto a fila nasce cheia de "Spa", "recepção" e do próprio dono, e a equipe
    -- para de confiar no alerta. Mesmo espelho usado pela fila do sino.
    and not public.crm_is_internal_contact(l.patient_name)
    and not exists (
      select 1 from public.interactions o
      where o.lead_id = l.id
        and o.direction = 'out'
        and o.happened_at > e.happened_at
    )
  order by e.happened_at asc
  limit 500;
$function$;

comment on function public.crm_pendencias_abandonadas(integer, integer) is
  'Zona morta entre o vigia (12h) e o sino (72h): cliente falou por último, ninguém respondeu, e nenhuma rotina cobre. Lista para COBRAR A EQUIPE, nunca para resposta automática.';

-- SECURITY DEFINER que devolve dado de paciente precisa de grant explícito: PUBLIC
-- executa por padrão. Só o cron (service_role) usa esta função.
revoke all on function public.crm_pendencias_abandonadas(integer, integer) from public;
revoke all on function public.crm_pendencias_abandonadas(integer, integer) from anon;
revoke all on function public.crm_pendencias_abandonadas(integer, integer) from authenticated;
grant execute on function public.crm_pendencias_abandonadas(integer, integer) to service_role;
