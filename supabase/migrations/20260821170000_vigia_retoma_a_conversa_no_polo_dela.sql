-- O vigia de atendimento retomava a conversa PARADA pelo polo do CADASTRO da pessoa, não
-- pelo polo da CONVERSA. Para quem é paciente da clínica e cliente do Tricopill (13 leads
-- hoje) isso significava: a pessoa escreve na linha de vendas sobre um pedido da loja, o
-- vigia acha a conversa parada, descarta a linha de vendas por ser "de outro polo" e
-- responde pelo número da CLÍNICA, com o prompt da CLÍNICA.
--
-- Caso real: Hugo Bongiorno, 21/ago/2026. Pagou R$ 361,60 no Pix (Tricopill) 01:56, mandou
-- o comprovante na linha de vendas, e às 08:51 recebeu "Recebi o arquivo, Hugo! É o
-- comprovante do pagamento do Shampoo Grandha..." pelo WhatsApp da clínica
-- (whatsapp_outbound_log: instance_id = wa-wapi-mpyi00su, source = 'wapi').
--
-- A informação que faltava estava no banco o tempo todo: desde 14/ago o trigger carimba a
-- interação com o tenant da LINHA (20260814120000_conversa_carimba_a_linha.sql), então o
-- `tenant_id` da última mensagem RECEBIDA é o polo da conversa. A RPC só não devolvia.
--
-- DROP + CREATE porque `create or replace` não muda a lista de colunas de um RETURNS TABLE.
-- O runner de migração já roda em transação, então a janela sem função dura o commit, e o
-- vigia roda de 5 em 5 min.

drop function if exists public.crm_pendencias_sem_resposta(integer, integer);

create function public.crm_pendencias_sem_resposta(p_horas integer default 12, p_min_minutos integer default 6)
returns table(
  lead_id text,
  patient_name text,
  phone text,
  tenant_id text,
  -- Polo da CONVERSA: o carimbo da última mensagem recebida, que segue a linha por onde ela
  -- entrou. Pode ser diferente de `tenant_id` (o cadastro da pessoa) e é ele que manda em
  -- qual linha responder e qual prompt usar.
  conversa_tenant_id text,
  whatsapp_instance_id text,
  content text,
  happened_at timestamp with time zone,
  minutos integer,
  owner_mode text,
  ai_enabled boolean
)
language sql
security definer
set search_path to 'public'
as $function$
  with ultima_entrada as (
    select distinct on (i.lead_id)
      i.lead_id, i.content, i.happened_at, i.tenant_id
    from public.interactions i
    where i.direction = 'in'
      and i.channel = 'whatsapp'
      and i.happened_at > now() - make_interval(hours => p_horas)
    order by i.lead_id, i.happened_at desc
  )
  select
    l.id as lead_id,
    coalesce(l.patient_name, 'Lead') as patient_name,
    coalesce(l.phone, '') as phone,
    l.tenant_id,
    coalesce(nullif(e.tenant_id, ''), l.tenant_id) as conversa_tenant_id,
    l.whatsapp_instance_id,
    e.content,
    e.happened_at,
    (extract(epoch from (now() - e.happened_at)) / 60)::integer as minutos,
    coalesce(s.owner_mode, 'auto') as owner_mode,
    coalesce(s.ai_enabled, true) as ai_enabled
  from ultima_entrada e
  join public.leads l on l.id = e.lead_id
  left join public.crm_conversation_states s on s.lead_id = l.id
  where l.opted_out_at is null
    and e.happened_at < now() - make_interval(mins => p_min_minutos)
    -- Nada saiu depois que a pessoa falou. Inclui resposta da IA, envio manual e
    -- eco do aparelho: se QUALQUER coisa saiu, a conversa não está parada.
    and not exists (
      select 1 from public.interactions o
      where o.lead_id = l.id
        and o.direction = 'out'
        and o.happened_at > e.happened_at
    )
  order by e.happened_at asc
  limit 200;
$function$;

-- ATENÇÃO ao recriar esta função: ela é SECURITY DEFINER e devolve nome e telefone de lead.
-- O DROP leva junto os grants explícitos (hoje: só postgres e service_role) e o CREATE
-- devolve o default do Postgres, que é EXECUTE para PUBLIC — ou seja, `anon` passaria a
-- poder chamar. É o mesmo buraco de [[supabase_rpc_aberta_anon]] / [[crm_rpc_anon_vazava_paciente_cpf]].
revoke all on function public.crm_pendencias_sem_resposta(integer, integer) from public;
revoke all on function public.crm_pendencias_sem_resposta(integer, integer) from anon, authenticated;
grant execute on function public.crm_pendencias_sem_resposta(integer, integer) to service_role;
