-- Follow-up de agendamento cobrava quem a equipe já ENCERROU.
--
-- 14/set/2026, caso Stone Ferrari (554488604658): respondeu "Não obrigado" à cobrança de 48h e
-- a Aline foi encerrar o atendimento. Encerrar move o card para «Encerrado» (`fechado`), mas a
-- RPC que escolhe quem recebe os degraus 24h/48h/7d só barrava `nao-se-aplica`. Com a última
-- fala da casa ("Por nada Stone!") mais nova que a do paciente, ele seguia elegível e levaria
-- o degrau de 7 dias depois de ter recusado.
--
-- Na medição, 7 leads em «Encerrado» estavam na lista da RPC e 1 já tinha recebido degrau
-- depois de entrar na coluna. `crm-followup-scheduler` e `crm-reengage-scheduler` já pulam
-- `fechado`; esta rotina era a única porta aberta.
--
-- Mudança única: `l.stage_id is distinct from 'nao-se-aplica'` passa a barrar `fechado` também.
-- O resto do corpo é o que está em produção (migration 20260908213000).

create or replace function public.crm_sem_agendamento_para_nutrir(
  p_tenant text default 'instituto-lorena'::text,
  p_min_horas integer default 24,
  p_desde timestamp with time zone default null::timestamp with time zone,
  p_max_dias integer default 30
)
returns table(
  lead_id text,
  patient_name text,
  phone text,
  tenant_id text,
  conversa_tenant_id text,
  whatsapp_instance_id text,
  medico text,
  ultima_saida timestamp with time zone,
  ultima_entrada timestamp with time zone,
  horas_parado integer
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with conversa as (
    select
      i.lead_id,
      -- A ÚLTIMA RESPOSTA DE VERDADE, não a última mensagem que saiu. Cobrança de robô
      -- (follow-up, reengajamento, carrinho, e esta própria rotina) não pode reiniciar o
      -- relógio: se contasse, o degrau de 24h nunca chegaria aos 48h — cada mensagem
      -- nossa empurraria a régua para a frente e a pessoa levaria a mesma primeira
      -- mensagem para sempre. Também é o que tira daqui quem o
      -- `crm-followup-scheduler` está cobrando: para esses a última fala real é ANTIGA,
      -- a entrada é mais nova, e a linha cai fora sozinha no filtro lá embaixo.
      max(i.happened_at) filter (
        where i.direction = 'out'
          and coalesce(i.author, '') not in (
            'Assistente IA (follow-up)',
            'Assistente IA (agendamento)',
            'Assistente IA (reengajamento)',
            'Assistente IA (recompra)',
            'Assistente IA (carrinho)',
            'Sistema (Follow-up)',
            -- Pesquisa de satisfação não é resposta sobre a consulta.
            'NPS (Sofia)',
            'NPS (IA)'
          )
      ) as ultima_saida,
      max(i.happened_at) filter (where i.direction = 'in') as ultima_entrada,
      max(i.tenant_id) filter (where i.direction = 'out') as tenant_da_conversa
    from public.interactions i
    -- 'system' fora dos dois lados: nota de automação não é conversa de gente
    -- ([[crm_nota_de_sistema_virou_mensagem_do_paciente]]).
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
    nullif(l.custom_fields->>'medico', '') as medico,
    c.ultima_saida,
    c.ultima_entrada,
    (extract(epoch from (now() - c.ultima_saida)) / 3600)::integer as horas_parado
  from public.leads l
  join conversa c on c.lead_id = l.id
  where l.tenant_id = p_tenant
    and l.deleted_at is null
    and l.opted_out_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and not public.crm_is_internal_contact(l.patient_name)
    and coalesce(l.conversation_status, '') not in ('archived', 'closed', 'lost', 'won')
    and length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) >= 12
    -- Lead da landing tem dono: `crm-landing-retomada`. Ver o cabeçalho.
    and not (l.custom_fields ? 'origem_landing')
    -- A PESSOA FALOU e a casa respondeu. Quem nunca escreveu é primeiro contato, e disso
    -- cuida a fila do `crm-outreach-worker` — os textos daqui ("ficou alguma dúvida em
    -- relação à consulta") seriam mentira para quem nunca conversou.
    and c.ultima_entrada is not null
    and c.ultima_saida is not null
    and c.ultima_saida > c.ultima_entrada
    and c.ultima_saida < now() - make_interval(hours => greatest(p_min_horas, 1))
    and (p_desde is null or c.ultima_saida >= p_desde)
    -- Quem já andou no funil sai: cobrar agendamento de quem já agendou é o jeito mais
    -- rápido de queimar a relação ([[crm_followup_quadro_come_paciente]]).
    -- «Encerrado» (`fechado`) também: a equipe fechou o atendimento, a régua não reabre.
    and coalesce(l.stage_id, '') not in ('nao-se-aplica', 'fechado')
    and not exists (select 1 from public.appointments a where a.lead_id = l.id)
    and not exists (select 1 from public.shosp_appointments sa where sa.lead_id = l.id)
    and not exists (select 1 from public.clinic_prebookings pb where pb.lead_id = l.id)
    and not exists (select 1 from public.clinic_sales cs where cs.lead_id = l.id)
  order by c.ultima_saida asc
  limit 200;
$function$;

-- SECURITY DEFINER devolvendo nome e telefone: só service_role ([[supabase_rpc_aberta_anon]]).
revoke all on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) from public;
revoke all on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) from anon;
revoke all on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) from authenticated;
grant execute on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) to service_role;
