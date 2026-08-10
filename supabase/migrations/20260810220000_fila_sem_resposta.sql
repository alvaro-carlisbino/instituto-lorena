-- Faltava a fila mais óbvia: "o cliente escreveu e ninguém respondeu".
--
-- O card "aguardando consultor" tinha duas fontes e nenhuma pegava o caso do Ismael:
--   `crm_pending_human_handoff`  = a IA PROMETEU que um humano retorna (regex na última out)
--   `crm_paying_customers_waiting` = quem JÁ COMPROU e ficou sem resposta
-- Ele não caiu em nenhuma: a IA nunca prometeu nada e ele ainda não tinha comprado.
-- Ficou 3 dias pedindo pra comprar, com a mensagem gravada no banco, fora de todo alerta.
--
-- Esta fila é a rede final: última mensagem da conversa é do cliente e ninguém respondeu.
-- É DELIBERADAMENTE uma fila para humano trabalhar, não gatilho de resposta automática.
-- Automatizar isso hoje dispararia 93 mensagens de uma vez, 89 delas para gente parada há
-- mais de 7 dias (pior caso 77 dias). Ver a regra de 20-30/dia com jitter.

-- Espelho SQL de `matchesInternalTerm` em supabase/functions/_shared/internalContacts.ts.
-- FONTE DA VERDADE é o arquivo TS: mexeu lá, mexe aqui. Sem isto a fila nasce cheia de
-- "Spa", "recepção", "Comercial" e do próprio dono, e a equipe para de confiar no painel.
create or replace function public.crm_is_internal_contact(p_name text)
returns boolean
language sql
immutable
as $function$
  with n as (
    select trim(lower(translate(
      coalesce(p_name, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
    ))) as v
  )
  select
    (select v from n) = 'spa'
    or (select v from n) like any (array[
      '%recepc%', '%marketing%', '%comercial%', '%contato whatsapp%', '%spa capilar%',
      '%instituto lorena%', '%lorena visentainer%', '%alvaro carlisbino%', '%financeiro%',
      '%atendimento%', '%guegrorioda%'
    ]);
$function$;

comment on function public.crm_is_internal_contact(text) is
  'Espelho SQL de matchesInternalTerm (internalContacts.ts). Contato interno, não cliente.';

create or replace function public.crm_unanswered_inbound(p_window_hours integer default 72)
returns table(
  lead_id text,
  patient_name text,
  waiting_since timestamp with time zone,
  last_message text,
  channel text,
  reason text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ultima as (
    select distinct on (i.lead_id)
      i.lead_id, i.direction, i.happened_at, i.content, i.channel
    from public.interactions i
    where i.channel in ('whatsapp', 'meta')
      and i.happened_at > now() - make_interval(hours => greatest(p_window_hours, 1))
      -- Conversa segue a linha: quem é dono da linha vê a espera, mesmo que o lead
      -- esteja no outro polo (paciente da clínica comprando Tricopill).
      and (
        i.tenant_id = public.current_tenant_id()
        or public.current_tenant_can_see_lead(i.lead_id)
      )
    order by i.lead_id, i.happened_at desc
  )
  select
    u.lead_id,
    l.patient_name,
    u.happened_at as waiting_since,
    left(u.content, 200) as last_message,
    u.channel,
    'sem_resposta'::text as reason
  from ultima u
  join public.leads l on l.id = u.lead_id
  where u.direction = 'in'
    -- Respiro: mensagem de agora mesmo ainda está com a IA/atendente, não é "sem resposta".
    and u.happened_at < now() - interval '5 minutes'
    and l.deleted_at is null
    and l.opted_out_at is null
    and coalesce(l.conversation_status, '') not in ('archived', 'closed', 'lost', 'won')
    and not public.crm_is_internal_contact(l.patient_name)
  order by u.happened_at asc;
$function$;

comment on function public.crm_unanswered_inbound(integer) is
  'Conversas em que a última mensagem é do cliente e ninguém respondeu. Fila para humano.';

-- SECURITY DEFINER que devolve DADO precisa de grant explícito: PUBLIC executa por padrão.
revoke all on function public.crm_unanswered_inbound(integer) from public;
revoke all on function public.crm_unanswered_inbound(integer) from anon;
grant execute on function public.crm_unanswered_inbound(integer) to authenticated;
grant execute on function public.crm_unanswered_inbound(integer) to service_role;

-- E o handoff existente passa a enxergar a conversa que acontece numa linha do polo,
-- não só a interaction carimbada com o tenant do polo.
create or replace function public.crm_pending_human_handoff(p_window_hours integer default 48)
returns table(
  lead_id text,
  patient_name text,
  waiting_since timestamp with time zone,
  last_message text,
  channel text,
  reason text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with tenant as (select public.current_tenant_id() as tid),
  last_out as (
    select distinct on (i.lead_id)
      i.lead_id, i.created_at, i.content, i.channel, i.author
    from public.interactions i, tenant
    where (i.tenant_id = tenant.tid or public.current_tenant_can_see_lead(i.lead_id))
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
$function$;
