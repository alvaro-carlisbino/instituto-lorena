-- Zerar a fila de pós-consulta sem apagar paciente.
--
-- Em 17/08/2026 a fila "Saiu da consulta, falta destino" tinha 43 pacientes, o
-- mais novo de 07/08 e o resto de semanas antes. Encaminhar todos agora seria
-- pior que deixar: cada clique cria follow-up para amanhã, e a Aline começaria
-- com 43 contatos falsos na agenda de um paciente que passou em consulta em maio.
--
-- Dois detalhes que a tela não contava e pesam na decisão:
--   • 7 dos 43 mostram "83 dias" que não existem: é o carimbo de um ALTER TABLE
--     de 26/05 em `stage_entered_at`, o mesmo que já enganou a auditoria de
--     analytics. Para esses, "parado há" nunca foi verdade.
--   • Parte da lista não é paciente: "LRM Empreendimentos Imobiliários",
--     "Kumon", "Recepção". Chegaram na etapa por roteamento, não por consulta.
--
-- Então a fila é DISPENSADA, não limpa: o lead continua onde está, no funil e na
-- etapa, com todo o histórico. O que se registra aqui é a decisão de quem tirou
-- da fila, quando e por quê — e ela é reversível, basta apagar a linha.

create table if not exists public.post_consultation_dismissals (
  lead_id      text primary key references public.leads (id) on delete cascade,
  tenant_id    text not null default 'instituto-lorena' references public.tenants (id),
  -- Por que saiu da fila. Texto livre porque o motivo de hoje ("backlog anterior
  -- ao início da operação da Aline") não é o motivo de amanhã.
  reason       text,
  dismissed_by uuid,
  dismissed_at timestamptz not null default now()
);

create index if not exists post_consultation_dismissals_tenant_idx
  on public.post_consultation_dismissals (tenant_id, dismissed_at desc);

alter table public.post_consultation_dismissals enable row level security;
drop policy if exists "post_consultation_dismissals tenant" on public.post_consultation_dismissals;
create policy "post_consultation_dismissals tenant" on public.post_consultation_dismissals
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on table public.post_consultation_dismissals is
  'Quem saiu da fila de pós-consulta sem ser encaminhado. O lead continua no funil; só não cobra mais ação.';
