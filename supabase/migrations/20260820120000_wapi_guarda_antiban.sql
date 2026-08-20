-- ─────────────────────────────────────────────────────────────────────────────
-- Guarda anti-ban das linhas de WhatsApp NÃO-oficiais (W-API e Evolution).
--
-- 20/08/2026: o WhatsApp da SDR da clínica saiu do ManyChat (Meta oficial) e passou
-- a viver numa sessão W-API. Muda a natureza do risco: na API oficial o pior caso é a
-- Meta recusar a mensagem; na não-oficial o pior caso é o NÚMERO morrer, e com ele a
-- porta de entrada do comercial. Número banido não se recupera com deploy.
--
-- O que já existia era pontual e por rotina: `REENGAGE_DAILY_CAP` numa env, um
-- `setTimeout` de jitter dentro do laço do reengajamento, `opted_out_at` conferido em
-- alguns caminhos. Nada disso enxerga o total do dia. No dia 05/08/2026 a clínica mandou
-- 278 mensagens PROATIVAS para 271 pessoas em algumas horas — no ManyChat aquilo passou;
-- na W-API é a assinatura clássica de disparo em massa. O teto vive aqui, uma vez, para
-- todas as rotinas somadas.
--
-- Três tabelas:
--   whatsapp_line_policy  — os limites da linha (editáveis na tela, sem deploy)
--   whatsapp_line_health  — o que a W-API diz da sessão; desconectou, para de enviar
--   whatsapp_outbound_log — livro-caixa: cada envio PERMITIDO e cada BLOQUEIO, com motivo
--
-- O livro-caixa é o que dá o "quanto já saiu hoje": contar por `interactions` misturaria
-- eco do aparelho, ManyChat e Instagram, e não guarda o que foi RECUSADO — e o recusado é
-- justamente o que prova que a guarda está trabalhando.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.whatsapp_line_policy (
  instance_id text primary key references public.whatsapp_channel_instances (id) on delete cascade,
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),

  -- Desligar aqui NÃO libera geral: desligado, a guarda deixa passar só resposta dentro
  -- da conversa e recusa proativo. É freio de mão, não interruptor de "pode tudo".
  enabled boolean not null default true,

  -- Janela de horário LOCAL (America/Sao_Paulo) para mensagem que a pessoa não pediu.
  -- Resposta a quem escreveu não olha o relógio: conversa é conversa a qualquer hora.
  janela_inicio smallint not null default 8,
  janela_fim smallint not null default 20,
  permite_domingo boolean not null default false,

  -- Tetos por linha, por dia local. `frio` = contato que NUNCA escreveu para este número.
  cap_frio_dia integer not null default 20,
  cap_proativo_dia integer not null default 60,
  cap_proativo_hora integer not null default 12,

  -- Espaçamento mínimo entre dois proativos da MESMA linha, com sorteio por cima.
  -- Rajada de mensagens idênticas em segundos é o que a plataforma lê como robô.
  gap_min_segundos integer not null default 45,
  gap_jitter_segundos integer not null default 45,

  -- Quantas vezes a mesma pessoa pode receber proativo na semana, e quantas vezes
  -- insistimos com quem nunca respondeu (a insistência é o que vira denúncia).
  cap_proativo_semana_por_lead integer not null default 2,
  frio_max_tentativas integer not null default 2,
  frio_espera_dias integer not null default 30,

  -- Aquecimento. Número "já aquecido" no aparelho volta a ser um desconhecido quando a
  -- sessão troca de provedor: o padrão de envio passa a sair de outro lugar. Durante
  -- `aquecimento_dias` o teto de frios sobe em rampa a partir de `aquecimento_cap_inicial`.
  aquecimento_inicio timestamptz,
  aquecimento_dias integer not null default 14,
  aquecimento_cap_inicial integer not null default 5,

  -- Link na PRIMEIRA mensagem para quem nunca falou com a gente é sinal de spam.
  bloqueia_link_primeiro_contato boolean not null default true,
  -- Mesmo texto para N pessoas diferentes na mesma hora: idem.
  cap_texto_repetido_hora integer not null default 8,

  -- Freio automático: a linha caiu, ou alguém apertou o botão de pânico na tela.
  pausado_ate timestamptz,
  pausa_motivo text,

  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_line_policy is
  'Limites anti-ban por linha de WhatsApp não-oficial. Uma linha sem registro aqui usa os '
  'mesmos defaults desta tabela (ver _shared/whatsapp/antiBan.ts).';
comment on column public.whatsapp_line_policy.pausado_ate is
  'Enquanto for futuro, NENHUM envio sai por esta linha. Escrito pelo webhook de eventos '
  'quando a sessão cai e pelo botão de pânico da tela /whatsapp.';

create table if not exists public.whatsapp_line_health (
  instance_id text primary key references public.whatsapp_channel_instances (id) on delete cascade,
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),

  -- 'connected' | 'disconnected' | 'banned' | 'unknown'
  status text not null default 'unknown',
  connected boolean,
  phone_e164 text,

  last_event text,
  last_event_at timestamptz,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,

  -- Contadores de entrega das últimas horas, alimentados pelo webhook de status.
  -- Pico de falha em sequência é o primeiro sintoma de linha marcada.
  fails_1h integer not null default 0,

  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_line_health is
  'Estado da sessão como o provedor reporta. É a diferença entre "o CRM está no ar" e "o '
  'número está no ar" — 200 na função não prova que a linha existe.';

create table if not exists public.whatsapp_outbound_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  instance_id text,
  lead_id text,
  phone text not null,

  -- 'reply' (dentro de 24h de quem escreveu) | 'proactive' | 'cold' | 'transactional'
  kind text not null,
  -- 'allowed' | 'blocked'
  decision text not null,
  reason text,
  -- Quem pediu o envio: crm-send-message, ai_auto_reply, reengage_reativacao, ...
  source text,
  -- Hash curto do texto: pega rajada de mensagem idêntica sem guardar o conteúdo de novo.
  text_hash text,

  created_at timestamptz not null default now()
);

comment on table public.whatsapp_outbound_log is
  'Livro-caixa dos envios de WhatsApp: o que saiu e o que a guarda recusou, com motivo. '
  'Fonte dos contadores do dia — interactions não serve (mistura eco do aparelho e canais).';

create index if not exists whatsapp_outbound_log_linha_idx
  on public.whatsapp_outbound_log (instance_id, created_at desc);
create index if not exists whatsapp_outbound_log_lead_idx
  on public.whatsapp_outbound_log (lead_id, created_at desc);
create index if not exists whatsapp_outbound_log_texto_idx
  on public.whatsapp_outbound_log (instance_id, text_hash, created_at desc)
  where decision = 'allowed';

alter table public.whatsapp_line_policy enable row level security;
alter table public.whatsapp_line_health enable row level security;
alter table public.whatsapp_outbound_log enable row level security;

-- Política: a equipe do polo lê e ajusta pela tela (mexer em teto não pode exigir deploy).
drop policy if exists "wa policy tenant read" on public.whatsapp_line_policy;
create policy "wa policy tenant read" on public.whatsapp_line_policy
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user());

drop policy if exists "wa policy tenant write" on public.whatsapp_line_policy;
create policy "wa policy tenant write" on public.whatsapp_line_policy
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user())
  with check (tenant_id = public.current_tenant_id() and public.is_staff_user());

-- Saúde e livro-caixa: leitura pela equipe, escrita só pela edge function (service_role).
-- Ninguém carimba "linha saudável" pela tela; quem diz é o provedor.
drop policy if exists "wa health tenant read" on public.whatsapp_line_health;
create policy "wa health tenant read" on public.whatsapp_line_health
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user());

drop policy if exists "wa outbound log tenant read" on public.whatsapp_outbound_log;
create policy "wa outbound log tenant read" on public.whatsapp_outbound_log
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user());

grant select, insert, update, delete on public.whatsapp_line_policy to authenticated;
grant select on public.whatsapp_line_health to authenticated;
grant select on public.whatsapp_outbound_log to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- O painel da linha: o que já saiu hoje, o que foi recusado e quanto ainda cabe.
-- security_invoker = true de propósito — sem isso a view roda como dono e entrega
-- as linhas do outro polo para quem abrir a tela (ver 18/ago, v_followup_kanban).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.v_whatsapp_line_guard with (security_invoker = true) as
select
  i.id as instance_id,
  i.tenant_id,
  i.label,
  i.channel_provider,
  i.bot_kind,
  i.active,
  coalesce(h.status, 'unknown') as health_status,
  h.connected,
  h.last_event_at,
  h.last_disconnected_at,
  p.pausado_ate,
  p.pausa_motivo,
  coalesce(p.enabled, true) as guard_enabled,
  coalesce(p.cap_frio_dia, 20) as cap_frio_dia,
  coalesce(p.cap_proativo_dia, 60) as cap_proativo_dia,
  coalesce(p.cap_proativo_hora, 12) as cap_proativo_hora,
  p.aquecimento_inicio,
  coalesce(p.aquecimento_dias, 14) as aquecimento_dias,
  coalesce(l.enviados_hoje, 0) as enviados_hoje,
  coalesce(l.proativos_hoje, 0) as proativos_hoje,
  coalesce(l.frios_hoje, 0) as frios_hoje,
  coalesce(l.respostas_hoje, 0) as respostas_hoje,
  coalesce(l.bloqueados_hoje, 0) as bloqueados_hoje,
  coalesce(l.proativos_1h, 0) as proativos_1h,
  l.ultimo_proativo_at
from public.whatsapp_channel_instances i
left join public.whatsapp_line_policy p on p.instance_id = i.id
left join public.whatsapp_line_health h on h.instance_id = i.id
left join lateral (
  select
    count(*) filter (where g.decision = 'allowed') as enviados_hoje,
    count(*) filter (where g.decision = 'allowed' and g.kind in ('proactive', 'cold')) as proativos_hoje,
    count(*) filter (where g.decision = 'allowed' and g.kind = 'cold') as frios_hoje,
    count(*) filter (where g.decision = 'allowed' and g.kind = 'reply') as respostas_hoje,
    count(*) filter (where g.decision = 'blocked') as bloqueados_hoje,
    count(*) filter (
      where g.decision = 'allowed' and g.kind in ('proactive', 'cold')
        and g.created_at >= now() - interval '1 hour'
    ) as proativos_1h,
    max(g.created_at) filter (where g.decision = 'allowed' and g.kind in ('proactive', 'cold')) as ultimo_proativo_at
  from public.whatsapp_outbound_log g
  where g.instance_id = i.id
    and (g.created_at at time zone 'America/Sao_Paulo')::date
        = (now() at time zone 'America/Sao_Paulo')::date
) l on true;

comment on view public.v_whatsapp_line_guard is
  'Uma linha por linha de WhatsApp: saúde da sessão, teto configurado e o que já saiu hoje.';

grant select on public.v_whatsapp_line_guard to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Política inicial das linhas W-API/Evolution que já existem. `on conflict do nothing`
-- para não sobrescrever ajuste feito na tela num redeploy da migração.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.whatsapp_line_policy (instance_id, tenant_id)
select i.id, i.tenant_id
from public.whatsapp_channel_instances i
where i.channel_provider in ('wapi', 'evolution')
on conflict (instance_id) do nothing;

notify pgrst, 'reload schema';
