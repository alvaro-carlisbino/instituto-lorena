-- ─────────────────────────────────────────────────────────────────────────────
-- Vigia do atendimento: ninguém fica no vácuo.
--
-- O webhook grava o job como `processing` e só depois chama o modelo. Se a função morre
-- no meio (timeout do modelo, 504 do gateway), o job fica `processing` para sempre e a
-- mensagem do cliente some do fluxo — não há retry, não há alarme, não há nada. Em
-- 20/08/2026 havia 4 jobs assim na linha do Tricopill; um deles era de um cliente que
-- tinha acabado de dizer "1 frasco" e estava havia quase duas horas sem resposta.
--
-- Esta função responde a única pergunta que importa, e responde olhando a CONVERSA, não o
-- job: existe mensagem de entrada sem nenhuma saída depois dela? Assim o vigia cobre
-- qualquer causa de silêncio, inclusive as que ainda não conhecemos.
--
-- SECURITY DEFINER + revoke de PUBLIC: quem chama é a edge function (service_role). Sem o
-- revoke, `anon` executaria e leria nome + telefone + texto de paciente — foi exatamente
-- assim que uma RPC vazou nome e CPF em julho (ver crm_rpc_anon_vazava_paciente_cpf).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.crm_pendencias_sem_resposta(
  p_horas integer default 12,
  p_min_minutos integer default 6
)
returns table (
  lead_id text,
  patient_name text,
  phone text,
  tenant_id text,
  whatsapp_instance_id text,
  content text,
  happened_at timestamptz,
  minutos integer,
  owner_mode text,
  ai_enabled boolean
)
language sql
security definer
set search_path = public
as $$
  with ultima_entrada as (
    select distinct on (i.lead_id)
      i.lead_id, i.content, i.happened_at
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
$$;

comment on function public.crm_pendencias_sem_resposta(integer, integer) is
  'Quem escreveu no WhatsApp e não recebeu nada depois. Fonte do crm-atendimento-vigia: '
  'olha a conversa, não o job, então cobre qualquer causa de silêncio.';

revoke all on function public.crm_pendencias_sem_resposta(integer, integer) from public;
revoke all on function public.crm_pendencias_sem_resposta(integer, integer) from anon;
revoke all on function public.crm_pendencias_sem_resposta(integer, integer) from authenticated;
grant execute on function public.crm_pendencias_sem_resposta(integer, integer) to service_role;

-- Índice que faz a pergunta ser barata: a subconsulta "saiu alguma coisa depois?" roda
-- uma vez por lead pendente, e sem isto vira seq scan em interactions a cada 5 minutos.
create index if not exists interactions_lead_direction_happened_idx
  on public.interactions (lead_id, direction, happened_at desc);

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cron de 5 em 5 minutos (criado fora do arquivo, via cron.schedule):
--
-- select cron.schedule('crm-atendimento-vigia-job', '*/5 * * * *', $cron$
--   select net.http_post(
--     url := 'https://<project>.supabase.co/functions/v1/crm-atendimento-vigia',
--     headers := '{"Content-Type": "application/json"}'::jsonb,
--     body := '{"max": 5}'::jsonb,
--     timeout_milliseconds := 55000);
-- $cron$);
-- ─────────────────────────────────────────────────────────────────────────────
