-- Cliente que JÁ COMPROU e está esperando resposta ficava invisível.
--
-- Caso Márcio (04/ago): pagou R$ 1.890,50 em 23/07 (retirada na clínica), escreveu em 31/07
-- "a minha esposa perguntou e não entregaram pra ela" e ninguém respondeu por 4 dias. Ele deu
-- opt-out em 24/07, então a IA fica muda E o conversation_status virou 'archived' — some de
-- todos os painéis, inclusive do card de Atendimento Pendente, que exclui 'archived' e depende
-- de a última SAÍDA ser uma promessa de handoff da Sofia.
--
-- Opt-out é pra parar MARKETING, não pra parar suporte de quem pagou. Esta função olha o outro
-- lado da conversa: a última mensagem é do CLIENTE e ninguém respondeu depois. Por isso NÃO
-- filtra opt-out nem 'archived' — é justamente onde os casos se escondem.
--
-- last_out é de TODO o histórico, não da janela: se a última resposta foi há 3 meses e o cliente
-- escreveu ontem, ele tem que acender. Só a mensagem DELE respeita a janela.

create or replace function public.crm_paying_customers_waiting(
  p_window_hours int default 720,
  p_min_wait_minutes int default 120
)
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
  compradores as (
    select distinct r.lead_id
    from public.rede_payments r, tenant
    where r.tenant_id = tenant.tid and r.status = 'paid' and r.lead_id is not null
    union
    select distinct a.lead_id
    from public.asaas_payments a, tenant
    where a.tenant_id = tenant.tid and a.status = 'paid' and a.lead_id is not null
  ),
  last_in as (
    select distinct on (i.lead_id)
      i.lead_id, i.created_at, i.content, i.channel
    from public.interactions i, tenant
    where i.tenant_id = tenant.tid
      and i.direction = 'in'
      and i.created_at > now() - make_interval(hours => greatest(p_window_hours, 1))
    order by i.lead_id, i.created_at desc
  ),
  last_out as (
    select i.lead_id, max(i.created_at) as created_at
    from public.interactions i, tenant
    where i.tenant_id = tenant.tid and i.direction = 'out'
    group by i.lead_id
  )
  select
    li.lead_id,
    l.patient_name,
    li.created_at as waiting_since,
    left(li.content, 200) as last_message,
    li.channel,
    'cliente'::text as reason
  from last_in li
  join compradores c on c.lead_id = li.lead_id
  join public.leads l on l.id = li.lead_id
  left join last_out lo on lo.lead_id = li.lead_id
  where l.deleted_at is null
    and li.created_at > coalesce(lo.created_at, '2000-01-01'::timestamptz)
    -- Piso de espera: sem ele todo "ok, obrigado" recém-chegado acende o alerta.
    and li.created_at <= now() - make_interval(mins => greatest(p_min_wait_minutes, 0))
    -- Fechamento de conversa CURTO ("Ok obrigado", "Igualmente", "👍") não é gente esperando:
    -- é o cliente encerrando. Sem este filtro eram 2 de 6 na primeira medição, e os dois
    -- apareciam NO TOPO por serem os mais antigos — o card perde a credibilidade e o caso
    -- real (Márcio) some no meio. O corte de tamanho protege: "ok, mas e o meu pedido?" fica.
    and not (
      length(btrim(li.content)) <= 28
      and btrim(li.content) ~* '^(ok|okay|obg|obrigad[oa]|valeu|vlw|blz|beleza|show|perfeito|certo|entendi|igualmente|de nada|tudo bem|ta bom|tá bom|isso|sim|👍|🙏|❤️|💚|😊)\M'
    )
  order by li.created_at asc;
$$;

revoke execute on function public.crm_paying_customers_waiting(int, int) from public, anon;
grant execute on function public.crm_paying_customers_waiting(int, int) to authenticated;

comment on function public.crm_paying_customers_waiting(int, int) is
  'Clientes que JÁ PAGARAM e cuja última mensagem não teve resposta. Ignora opt-out e conversa arquivada de propósito: opt-out cala o marketing, não o suporte. reason = cliente.';
