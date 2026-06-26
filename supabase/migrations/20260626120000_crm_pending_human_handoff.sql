-- Card "Atendimento Pendente" nunca acendia: conversation_status='waiting_human' nunca
-- é gravado para a clínica (a Sofia roda no ManyChat e o handoff p/ a Dandara não
-- marcava o status). Em vez de depender dessa escrita frágil, este RPC DERIVA a lista
-- de leads aguardando consultor direto das interactions.
--
-- Regra: a ÚLTIMA mensagem de SAÍDA do lead é da IA (autor sem '@') e tem semântica de
-- handoff p/ humano, dentro de uma janela de tempo. Se um humano (autor = e-mail) tivesse
-- respondido, ele seria a saída mais recente -> some da lista (vira "em atendimento").
-- waiting_since = hora do handoff (tempo de espera real, não reseta com novas msgs do lead).
create or replace function public.crm_pending_human_handoff(p_window_hours int default 48)
returns table (
  lead_id text,
  patient_name text,
  waiting_since timestamptz,
  last_message text,
  channel text
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
    lo.channel
  from last_out lo
  join public.leads l on l.id = lo.lead_id
  where l.deleted_at is null
    and coalesce(l.conversation_status, '') not in ('archived','closed','lost','won','human_active')
    and coalesce(lo.author, '') not like '%@%'  -- IA (Sofia), não consultor humano
    and lo.content ~* '(equipe m[ée]dica especializada pronta|excelente escolha|dandara|vou (chamar|encaminhar|transferir)|encaminhar (o |seu )?(contato|atendimento)|passar as op[çc]|verificar a disponibilidade|entra em contato|te (retornar|contatar))'
  order by lo.created_at asc;
$$;

grant execute on function public.crm_pending_human_handoff(int) to authenticated;
comment on function public.crm_pending_human_handoff(int) is
  'Leads aguardando consultor humano, derivado das interactions (handoff da Sofia sem resposta humana). waiting_since = hora do handoff.';
