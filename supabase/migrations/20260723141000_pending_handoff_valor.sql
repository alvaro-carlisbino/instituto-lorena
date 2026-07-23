-- Pergunta de valor da consulta ficava invisível para a equipa.
--
-- O script manda a Sofia acolher ("Um instante que a nossa equipe te envia o valor da consulta") e
-- deixar a Dandara mandar o preço — mas nada avisava a Dandara. Caso Aline (22/jul): perguntou o
-- valor às 19:01, repetiu às 20:31, e só foi respondida às 08:30 do dia seguinte, quando a Dandara
-- abriu a conversa por conta própria. O card "Atendimento Pendente" não pegava porque o texto da
-- promessa não bate com nenhum dos padrões de handoff do RPC.
--
-- Agora a promessa de valor sem resposta humana também acende o card, com o motivo separado para a
-- Dandara priorizar (quem está esperando um PREÇO é diferente de quem está esperando agendamento).
-- Mesma mecânica de sempre: a última SAÍDA é da IA; se um humano responder, ele vira a saída mais
-- recente e o lead some da lista.
--
-- Sai também o padrão "equipe médica especializada pronta": esse é o Passo 2 do script (a Sofia
-- apresenta os 3 profissionais e pergunta com qual o paciente quer ser atendido), ou seja, quem está
-- sendo esperado é o PACIENTE, não a Dandara. Enquanto o texto era gerado pelo GLM ele aparecia de
-- vez em quando; desde que o eco do Passo 2 virou determinístico, ele passaria a acender o card para
-- TODO lead triado e só apagaria quando um humano respondesse — 3 falsos positivos nas últimas 48h,
-- e seria 100% deles daqui pra frente. O handoff de verdade é o Passo 3 ("vou encaminhar seu
-- atendimento para a nossa consultora Dandara"), que os outros padrões já pegam.

drop function if exists public.crm_pending_human_handoff(int);

create function public.crm_pending_human_handoff(p_window_hours int default 48)
returns table (
  lead_id text,
  patient_name text,
  waiting_since timestamptz,
  last_message text,
  channel text,
  reason text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with tenant as (select public.current_tenant_id() as tid),
  last_out as (
    select distinct on (i.lead_id)
      i.lead_id, i.created_at, i.content, i.channel, i.author
    from public.interactions i, tenant
    where i.tenant_id = tenant.tid
      and i.direction = 'out'
      and i.created_at > now() - make_interval(hours => greatest(p_window_hours, 1))
    order by i.lead_id, i.created_at desc
  )
  select
    lo.lead_id,
    l.patient_name,
    lo.created_at as waiting_since,
    left(lo.content, 200) as last_message,
    lo.channel,
    case
      when lo.content ~* '(um instante que a nossa equip|te env(ia|io) o valor|passar essas informa[çc][õo]es)'
        then 'valor'
      else 'handoff'
    end as reason
  from last_out lo
  join public.leads l on l.id = lo.lead_id
  where l.deleted_at is null
    and coalesce(l.conversation_status, '') not in ('archived','closed','lost','won','human_active')
    and coalesce(lo.author, '') not like '%@%'  -- IA (Sofia), não consultor humano
    and lo.content ~* '(excelente escolha|dandara|vou (chamar|encaminhar|transferir)|encaminhar (o |seu )?(contato|atendimento)|passar as op[çc]|verificar a disponibilidade|entra em contato|te (retornar|contatar)|um instante que a nossa equip|te env(ia|io) o valor|passar essas informa[çc][õo]es)'
  order by lo.created_at asc;
$$;

grant execute on function public.crm_pending_human_handoff(int) to authenticated;
comment on function public.crm_pending_human_handoff(int) is
  'Leads aguardando consultor humano, derivado das interactions (handoff da Sofia sem resposta humana). reason = valor (prometeu o preço) ou handoff. waiting_since = hora do handoff.';
