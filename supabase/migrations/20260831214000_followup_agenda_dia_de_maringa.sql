-- A agenda de follow-up dizia "atrasado 1 dia" às 21h de Maringá.
--
-- `v_followup_agenda` classificava por `CURRENT_DATE`, que no Postgres é o dia do fuso do
-- SERVIDOR (UTC aqui). Das 21h em diante o UTC já virou, então toda tarefa marcada para
-- HOJE aparecia no balde "atrasado", com `dias_atraso = 1`, para uma equipe que ainda
-- estava dentro do próprio dia.
--
-- Achado em 31/ago/2026 abrindo as primeiras tarefas da retomada da landing: a tarefa
-- nasceu 00h41 UTC e a tela já a mostrava um dia atrasada. Fila que mente sobre atraso é
-- fila que a equipe para de olhar, que é exatamente o oposto do que a rotina nova precisa.
-- Mesma classe de erro de [[fuso_dia_local_helper]].
--
-- `scheduled_for` é DATE e é gravada no dia de Maringá; a comparação passa a ser com o dia
-- de Maringá também. Os dois lados no mesmo fuso, que é a única forma de a conta fechar.

create or replace view public.v_followup_agenda as
select
  f.id,
  f.tenant_id,
  f.lead_id,
  f.attempt_no,
  f.scheduled_for,
  f.owner_id,
  f.channel,
  f.note,
  l.patient_name,
  l.phone,
  l.pipeline_id,
  l.stage_id,
  l.source,
  case
    when f.scheduled_for < (now() at time zone 'America/Sao_Paulo')::date then 'atrasado'
    when f.scheduled_for = (now() at time zone 'America/Sao_Paulo')::date then 'hoje'
    when f.scheduled_for <= ((now() at time zone 'America/Sao_Paulo')::date + 7) then 'semana'
    else 'futuro'
  end as bucket,
  (now() at time zone 'America/Sao_Paulo')::date - f.scheduled_for as dias_atraso
from public.lead_followups f
join public.leads l on l.id = f.lead_id and l.deleted_at is null
where f.done_at is null;

-- `create or replace view` DERRUBA o security_invoker: sem esta linha a view volta a ler
-- com os direitos do dono e vaza paciente de outro polo. Ver
-- [[crm_view_replace_derruba_security_invoker]].
alter view public.v_followup_agenda set (security_invoker = true);

comment on view public.v_followup_agenda is
  'Follow-ups em aberto, com o balde (atrasado/hoje/semana/futuro) calculado no dia de Maringá, não no dia UTC do servidor.';
