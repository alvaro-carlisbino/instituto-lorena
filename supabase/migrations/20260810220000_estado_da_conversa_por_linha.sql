-- ESTADO DA CONVERSA POR LINHA
--
-- Complemento de 20260810180848_conversa_segue_a_linha. Aquela migration resolveu a
-- VISIBILIDADE (quem enxerga a conversa). Mas `crm_conversation_states` continuou com uma
-- linha por LEAD, e é lá que moram `owner_mode` e `ai_enabled`. Resultado: um "assumir na
-- mão" feito na clínica em julho deixava o bot de vendas MUDO na linha do Tricopill em
-- agosto, porque a mesma pessoa reaproveita o mesmo card.
--
-- Caso real de 10/ago: a Carla (card da clínica, owner_mode='human' desde 27/jul) perguntou
-- "Qual valor do Tricopill?" na linha de vendas às 13:24 e não teve resposta nenhuma. O
-- Ismael mandou 4 mensagens entre 13:27 e 13:28 ("Preciso de um retorno", "Vou fazer o
-- implante na quinta"), idem. Foram 66 mensagens entrando pela linha do Tricopill em cards
-- da clínica em 20 dias, 11 só naquele dia, todas mudas. O Spa teve que mandar o telefone da
-- Carla na mão pedindo pra alguém ligar nela.
--
-- A partir daqui quem decide se o bot responde é o par (lead, LINHA).
--
-- A tabela antiga NÃO morre: ela continua sendo a verdade do que o painel mostra (o estado
-- da linha atual do lead), de tudo que é transitório (buffer de burst, trava anti-duplicata,
-- timestamps, contador de follow-up) e de todo canal que não é WhatsApp (ManyChat/Instagram
-- não têm linha). Repartir a tabela antiga na marra quebraria os ~36 pontos que fazem
-- `.eq('lead_id', x).maybeSingle()`, incluindo a trava de resposta da IA e o realtime do
-- painel — troca cara demais pra um conserto que cabe numa tabela companheira.

create table if not exists public.crm_conversation_line_states (
  lead_id text not null references public.leads(id) on delete cascade,
  whatsapp_instance_id text not null,
  owner_mode text not null default 'auto',
  ai_enabled boolean not null default true,
  last_human_reply_at timestamptz,
  tenant_id text not null,
  updated_at timestamptz not null default now(),
  primary key (lead_id, whatsapp_instance_id)
);

comment on table public.crm_conversation_line_states is
  'owner_mode/ai_enabled por (lead, linha do WhatsApp). Linha ausente = nenhuma decisão foi tomada nessa linha ainda: vale o default de crm_ai_configs (IA responde). Ver 20260810220000.';

create index if not exists crm_conversation_line_states_lead_idx
  on public.crm_conversation_line_states (lead_id);

alter table public.crm_conversation_line_states enable row level security;

-- Só as edge functions (service_role, que passa por cima do RLS) escrevem e leem aqui.
-- O painel continua lendo `crm_conversation_states`, que espelha a linha atual do lead.
revoke all on public.crm_conversation_line_states from anon, authenticated;

-- BACKFILL
-- Só o que NÃO é default (935 de 1848 linhas): quem está em 'auto'/ativo não precisa de
-- registro, a ausência já significa "IA pode responder".
--
-- A atribuição é pelo POLO DO LEAD, não pela linha atual dele. É de propósito: o card da
-- Carla hoje aponta pra `tricopill-wapi` (o upsert por telefone carimbou a última linha),
-- mas o "human" dela foi decidido pela clínica em julho. Herdar isso pra linha de vendas
-- reproduziria exatamente o bug que esta migration existe pra matar.
insert into public.crm_conversation_line_states
  (lead_id, whatsapp_instance_id, owner_mode, ai_enabled, last_human_reply_at, tenant_id, updated_at)
select
  s.lead_id,
  w.id,
  coalesce(s.owner_mode, 'auto'),
  coalesce(s.ai_enabled, true),
  s.last_human_reply_at,
  w.tenant_id,
  s.updated_at
from public.crm_conversation_states s
join public.leads l on l.id = s.lead_id
join public.whatsapp_channel_instances w on w.tenant_id = l.tenant_id
where coalesce(s.owner_mode, 'auto') <> 'auto' or coalesce(s.ai_enabled, true) = false
on conflict (lead_id, whatsapp_instance_id) do nothing;
