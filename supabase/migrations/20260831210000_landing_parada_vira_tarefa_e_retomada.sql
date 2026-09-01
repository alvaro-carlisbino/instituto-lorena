-- O lead da landing que a gente ATENDEU e que parou de responder não é de ninguém.
--
-- Em 31/ago/2026 a landing /consulta tinha 7 leads reais: 6 responderam a Sofia, e
-- ZERO foi agendado. Nenhum dos 7 tinha follow-up marcado. Não é desleixo da equipe,
-- é buraco de desenho: as três redes que existem olham para o outro lado.
--
--   crm-followup-scheduler       só cobra quem está esperando A GENTE (último inbound
--                                mais novo que o último outbound), só nas primeiras 24h,
--                                e só enquanto a IA governa a conversa.
--   crm_pendencias_abandonadas   idem: exige `not exists` de outbound depois do inbound.
--   usePendingHandoff (sino)     idem, e some no 72h.
--
-- Ou seja: no instante em que a Aline responde, o lead sai de todas. Quem falou por
-- último foi a casa, então ninguém o considera pendente. E o caso pior é o do lead que
-- NUNCA respondeu (Miter Monteiro, 30/ago, quente, Norwood 4): `last_inbound_at` é nulo,
-- então o motor de follow-up nem consegue avaliá-lo.
--
-- Esta função é a lista desse buraco, restrita a quem entrou pela landing. Ela alimenta
-- `crm-landing-retomada`, que faz DUAS coisas, nesta ordem: abre a tarefa no CRM para a
-- equipe, e só cobra por mensagem automática se a tarefa vencer sem ninguém tocar.
--
-- Ver `crm_pendencias_abandonadas` (a irmã, que cobre o lado oposto) e `crm_leads_por_porta`.

create or replace function public.crm_landing_sem_retorno(
  p_min_horas integer default 20,
  p_max_dias integer default 30
)
returns table(
  lead_id text,
  patient_name text,
  phone text,
  tenant_id text,
  conversa_tenant_id text,
  whatsapp_instance_id text,
  owner_id text,
  stage_id text,
  score integer,
  temperature text,
  triagem text,
  ultima_saida timestamp with time zone,
  ultima_entrada timestamp with time zone,
  horas_parado integer,
  respondeu boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with conversa as (
    select
      i.lead_id,
      max(i.happened_at) filter (where i.direction = 'out') as ultima_saida,
      max(i.happened_at) filter (where i.direction = 'in') as ultima_entrada,
      max(i.tenant_id) filter (where i.direction = 'out') as tenant_da_conversa
    from public.interactions i
    -- 'system' fora dos dois lados: a nota da landing é `system`, e o formulário do Meta
    -- entra como `direction='in', channel='system'`. Contar qualquer um faria carimbo de
    -- automação parecer conversa de gente, que é o erro de [[crm_nota_de_sistema_virou_mensagem_do_paciente]].
    where i.channel in ('whatsapp', 'meta')
      and i.deleted_at is null
      and i.happened_at > now() - make_interval(days => greatest(p_max_dias, 1))
    group by i.lead_id
  )
  select
    l.id as lead_id,
    coalesce(l.patient_name, 'Lead') as patient_name,
    coalesce(l.phone, '') as phone,
    l.tenant_id,
    coalesce(nullif(c.tenant_da_conversa, ''), l.tenant_id) as conversa_tenant_id,
    l.whatsapp_instance_id,
    l.owner_id,
    l.stage_id,
    l.score,
    l.temperature,
    concat_ws(' · ',
      nullif(l.custom_fields->>'triagem_objetivo', ''),
      nullif(l.custom_fields->>'triagem_grau', ''),
      nullif(l.custom_fields->>'triagem_urgencia', ''),
      nullif(l.custom_fields->>'triagem_unidade', '')
    ) as triagem,
    c.ultima_saida,
    c.ultima_entrada,
    (extract(epoch from (now() - c.ultima_saida)) / 3600)::integer as horas_parado,
    (c.ultima_entrada is not null) as respondeu
  from public.leads l
  join conversa c on c.lead_id = l.id
  where l.custom_fields ? 'origem_landing'
    and l.deleted_at is null
    and l.opted_out_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and not public.crm_is_internal_contact(l.patient_name)
    and coalesce(l.conversation_status, '') not in ('archived', 'closed', 'lost', 'won')
    -- NÓS falamos por último (ou ele nunca respondeu). É exatamente o recorte que as
    -- outras rotinas descartam.
    and c.ultima_saida is not null
    and (c.ultima_entrada is null or c.ultima_saida > c.ultima_entrada)
    and c.ultima_saida < now() - make_interval(hours => greatest(p_min_horas, 1))
    -- Quem já andou no funil sai da lista: cobrar quem tem consulta marcada é o jeito
    -- mais rápido de queimar a relação ([[crm_followup_quadro_come_paciente]]).
    and not exists (select 1 from public.appointments a where a.lead_id = l.id)
    and not exists (select 1 from public.shosp_appointments sa where sa.lead_id = l.id)
    and not exists (select 1 from public.clinic_prebookings pb where pb.lead_id = l.id)
    and not exists (select 1 from public.clinic_sales cs where cs.lead_id = l.id)
  order by c.ultima_saida asc
  limit 200;
$function$;

comment on function public.crm_landing_sem_retorno(integer, integer) is
  'Lead da landing /consulta que a casa atendeu e que parou de responder (ou nunca respondeu): o recorte que o follow-up, o vigia e o sino descartam por olharem só quem espera resposta. Alimenta crm-landing-retomada.';

-- SECURITY DEFINER que devolve dado de paciente precisa de grant explícito: PUBLIC
-- executa por padrão, e PUBLIC no Supabase inclui `anon` — a mesma chave que a landing
-- carrega no navegador de quem vem do anúncio ([[supabase_rpc_aberta_anon]]).
revoke all on function public.crm_landing_sem_retorno(integer, integer) from public;
revoke all on function public.crm_landing_sem_retorno(integer, integer) from anon;
revoke all on function public.crm_landing_sem_retorno(integer, integer) from authenticated;
grant execute on function public.crm_landing_sem_retorno(integer, integer) to service_role;
