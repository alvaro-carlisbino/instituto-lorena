-- ─────────────────────────────────────────────────────────────────────────────
-- Fila de PRIMEIRO CONTATO — o que o ManyChat fazia, agora pela linha da casa.
--
-- Quem preenche o formulário do Meta Lead Ads não chega conversando: alguém tem de
-- puxar a conversa. Isso era um template aprovado disparado pelo ManyChat; desde que o
-- ManyChat saiu do WhatsApp, `meta_leadgen_events` só acumula `first_touch_failed` —
-- 24 deles, o último hoje às 12:09. O lead entra no CRM e ninguém fala com ele.
--
-- Por que uma FILA e não um envio direto no webhook: numa linha não-oficial o que mata o
-- número é a rajada, e o formulário chega quando chega (inclusive de madrugada, inclusive
-- oito de uma vez quando o anúncio pega). A fila separa as duas perguntas: "temos de falar
-- com esta pessoa?" (sim, sempre, no instante em que ela preenche) e "podemos falar AGORA?"
-- (depende da hora, do intervalo desde o último envio e do teto do dia). Nada se perde:
-- o que não pode sair agora fica agendado e sai na primeira janela boa.
--
-- Volume real da clínica: 3 a 13 formulários por dia nas últimas duas semanas. O teto
-- padrão de 40/dia existe para o dia atípico, não para o normal.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_line_policy
  add column if not exists cap_optin_dia integer not null default 40,
  add column if not exists optin_max_idade_horas integer not null default 48;

comment on column public.whatsapp_line_policy.cap_optin_dia is
  'Teto diário de PRIMEIRO CONTATO com quem pediu contato (formulário, site). Separado do '
  'cap_frio_dia porque o risco é outro: quem preencheu formulário espera a mensagem.';
comment on column public.whatsapp_line_policy.optin_max_idade_horas is
  'Idade máxima do formulário para ainda valer como "pediu contato". Passou disto, a pessoa '
  'já esqueceu que preencheu — e aí é abordagem a desconhecido, com as regras de contato novo.';

create table if not exists public.whatsapp_outreach_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),
  instance_id text references public.whatsapp_channel_instances (id) on delete set null,
  lead_id text references public.leads (id) on delete cascade,
  phone text not null,

  -- Texto já pronto. Guardado aqui, e não gerado na hora do envio, porque o que foi
  -- decidido no momento do formulário é o que deve chegar — mudar o modelo amanhã não
  -- pode reescrever a mensagem de quem está na fila desde ontem.
  message text not null,

  -- 'optin' (formulário/site) | 'cold' | 'proactive'
  kind text not null default 'optin',
  -- Quem produziu: 'leadform', 'site', 'sweep_leadform'…
  source text not null default 'leadform',

  -- 'pending' | 'sent' | 'blocked' | 'canceled'
  status text not null default 'pending',
  scheduled_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_reason text,

  sent_at timestamptz,
  external_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_outreach_queue is
  'Fila de primeiro contato. Entrar na fila é decisão de negócio (falar com todo lead); sair '
  'dela é decisão da guarda anti-ban (poder falar agora). Ver _shared/whatsapp/outreach.ts.';

-- Uma pessoa não recebe o mesmo primeiro contato duas vezes. O índice é a trava real:
-- o webhook ao vivo e a varredura de 30 em 30 minutos veem o mesmo lead, e sem isto a
-- pessoa receberia a mesma mensagem de boas-vindas duas vezes (foi o que aconteceu com o
-- Ezequiel nas avaliações duplicadas — reclamação na hora).
create unique index if not exists whatsapp_outreach_queue_lead_kind_uniq
  on public.whatsapp_outreach_queue (lead_id, kind)
  where lead_id is not null and status in ('pending', 'sent');

create index if not exists whatsapp_outreach_queue_fila_idx
  on public.whatsapp_outreach_queue (status, scheduled_at)
  where status = 'pending';

create index if not exists whatsapp_outreach_queue_linha_idx
  on public.whatsapp_outreach_queue (instance_id, created_at desc);

alter table public.whatsapp_outreach_queue enable row level security;

drop policy if exists "outreach queue tenant read" on public.whatsapp_outreach_queue;
create policy "outreach queue tenant read" on public.whatsapp_outreach_queue
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user());

-- Cancelar um envio que ainda não saiu é decisão da equipe e tem de dar pela tela.
-- Escrever linha nova, não: quem enfileira é o webhook (service_role).
drop policy if exists "outreach queue tenant cancel" on public.whatsapp_outreach_queue;
create policy "outreach queue tenant cancel" on public.whatsapp_outreach_queue
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user())
  with check (tenant_id = public.current_tenant_id() and public.is_staff_user());

grant select, update on public.whatsapp_outreach_queue to authenticated;

-- Contadores da fila para o painel da linha.
create or replace view public.v_whatsapp_outreach_fila with (security_invoker = true) as
select
  q.instance_id,
  q.tenant_id,
  count(*) filter (where q.status = 'pending') as na_fila,
  count(*) filter (where q.status = 'pending' and q.scheduled_at <= now()) as prontos_agora,
  count(*) filter (
    where q.status = 'sent'
      and (q.sent_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
  ) as enviados_hoje,
  count(*) filter (
    where q.status = 'blocked'
      and (q.updated_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
  ) as recusados_hoje,
  min(q.scheduled_at) filter (where q.status = 'pending') as proximo_em
from public.whatsapp_outreach_queue q
group by q.instance_id, q.tenant_id;

comment on view public.v_whatsapp_outreach_fila is
  'Quantos primeiros contatos estão à espera, quantos já saíram hoje e quando sai o próximo.';

grant select on public.v_whatsapp_outreach_fila to authenticated;

-- Config do primeiro contato por polo. Fica em tenant_integrations, junto do resto da
-- configuração não-secreta, e é editável sem deploy.
alter table public.tenant_integrations
  add column if not exists outreach jsonb not null default '{}'::jsonb;

comment on column public.tenant_integrations.outreach is
  'Config do primeiro contato automático: { "leadform": { "enabled": bool, "message": "texto '
  'com {{nome}} e {{primeiro_nome}}", "max_age_hours": 48 } }. Sem enabled=true, ninguém dispara.';

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- O relógio da fila. De minuto em minuto, no máximo 2 por volta — e mesmo essas só
-- saem se a guarda deixar (o intervalo mínimo entre proativos costuma segurar em uma).
-- A cadência tem de parecer alguém atendendo, não um sistema despejando fila.
--
-- Sem cabeçalho de autenticação de propósito: `crm-outreach-worker` roda com
-- verify_jwt=false. Se um dia existir o secret CRON_SECRET no projeto, este comando
-- precisa passar a mandar `x-cron-secret` junto, senão o worker devolve 401 e a fila
-- para em silêncio.
-- ─────────────────────────────────────────────────────────────────────────────
-- select cron.schedule(
--   'crm-outreach-worker-job',
--   '* * * * *',
--   $cron$
--   select net.http_post(
--     url := 'https://<project>.supabase.co/functions/v1/crm-outreach-worker',
--     headers := '{"Content-Type": "application/json"}'::jsonb,
--     body := '{"max": 2}'::jsonb,
--     timeout_milliseconds := 25000
--   );
--   $cron$
-- );
