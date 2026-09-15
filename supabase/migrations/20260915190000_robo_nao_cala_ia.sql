-- ROTINA NÃO É GENTE (15/09/2026).
--
-- Até o commit fb897af, todo envio de rotina pelo crm-send-message (follow-up, carrinho,
-- reengajamento, confirmação de pagamento, cadência de agendamento, campanhas do Tricopill que
-- saem como "Operador") gravava owner_mode='human' e last_human_reply_at na conversa, como se
-- alguém da equipe tivesse assumido. A IA calava por até 7 dias (e para sempre nas etapas de
-- paciente da clínica, onde o handoff não expira).
--
-- Esta limpeza devolve para a IA só as conversas em que o "Humano" veio de robô:
--   * o carimbo de last_human_reply_at é de uma mensagem de rotina (±5s);
--   * a IA não foi desligada de propósito (ai_enabled=true; escalonamento real grava false);
--   * nenhuma pessoa da equipe falou ali. No Tricopill vale também "ninguém falou há 7 dias",
--     que é quando o handoff da equipe expiraria de qualquer jeito. Na clínica fica só o
--     "nunca falou";
--   * na clínica, lead em esteira/etapa de paciente (ai_handoff_keep_*) fica como está. A regra
--     de lá é que conversa de paciente é da atendente, e não cabe a uma limpeza decidir isso.
-- O carimbo volta para a última fala de gente de verdade (ou vazio).
-- Fica de fora o lead do caso de 15/09, que a equipe está atendendo na mão agora.

begin;

create temporary table _robo_calou on commit drop as
with ls as (
  select ls.lead_id, ls.whatsapp_instance_id, ls.tenant_id, ls.last_human_reply_at
  from crm_conversation_line_states ls
  where ls.owner_mode = 'human' and ls.ai_enabled
    and ls.lead_id <> 'lead-ad2c766e-0fb'
),
carimbo_de_robo as (
  select ls.*
  from ls
  where exists (
    select 1 from interactions i
    where i.lead_id = ls.lead_id and i.direction = 'out'
      and abs(extract(epoch from (i.happened_at - ls.last_human_reply_at))) < 5
      and (i.author like 'Assistente IA (%'
           or i.author in ('Confirmação de pagamento', 'NPS (Sofia)', 'Operador', 'Follow-up Tricopill'))
  )
),
com_humano as (
  select c.*,
    (select max(i.happened_at) from interactions i
      where i.lead_id = c.lead_id and i.direction = 'out'
        and (i.author like '%@%' or i.author in ('Consultor', 'Equipe (WhatsApp)'))) as ultimo_humano
  from carimbo_de_robo c
)
select h.lead_id, h.whatsapp_instance_id, h.tenant_id, h.last_human_reply_at, h.ultimo_humano
from com_humano h
join leads l on l.id = h.lead_id
left join crm_ai_configs cfg on cfg.tenant_id = h.tenant_id and cfg.id = 'default'
where (h.ultimo_humano is null
       or (h.tenant_id = 'tricopill' and h.ultimo_humano < now() - interval '7 days'))
  and not (
    h.tenant_id = 'instituto-lorena' and (
      coalesce(cfg.ai_handoff_keep_pipelines, '[]'::jsonb) ? coalesce(l.pipeline_id, '')
      or coalesce(cfg.ai_handoff_keep_stages, '[]'::jsonb) ? coalesce(l.stage_id, '')
    )
  );

update crm_conversation_line_states ls
set owner_mode = 'auto', last_human_reply_at = r.ultimo_humano, updated_at = now()
from _robo_calou r
where ls.lead_id = r.lead_id and ls.whatsapp_instance_id = r.whatsapp_instance_id;

-- Estado por lead (é o que o painel mostra): só onde o "Humano" também é o carimbo do robô.
update crm_conversation_states cs
set owner_mode = 'auto', last_human_reply_at = r.ultimo_humano, updated_at = now()
from (select distinct on (lead_id) lead_id, last_human_reply_at, ultimo_humano from _robo_calou) r
where cs.lead_id = r.lead_id
  and cs.owner_mode = 'human' and cs.ai_enabled
  and abs(extract(epoch from (cs.last_human_reply_at - r.last_human_reply_at))) < 5;

commit;
