-- Chat do CRM com as mesmas mãos do WhatsApp: responder citando, reagir, encaminhar,
-- editar e apagar (para todos, não só na nossa tela).
--
-- Até aqui, "apagar" no CRM só escondia a linha do nosso lado e a paciente continuava
-- vendo a mensagem — o botão dizia uma coisa e fazia outra. E responder uma mensagem
-- específica não existia: toda resposta chegava solta no fim da conversa.
--
-- Três coisas novas em `interactions`:
--   • `reply_to_external_id`  — o id W-API da mensagem CITADA (a que a bolha responde).
--   • `edited_at` / `deleted_at` / `deleted_scope` — o histórico para de sumir. Mensagem
--     apagada vira lápide ("Esta mensagem foi apagada"), como no WhatsApp: quem auditar a
--     conversa depois vê que existiu algo ali. `deleted_scope='everyone'` é o apagar de
--     verdade (saiu do telemóvel da paciente); `'crm'` é só limpeza da nossa tela.
--   • `forwarded_from_id` — encaminhada de onde. A W-API não tem rota de encaminhar: o
--     CRM reenvia o conteúdo, então sem este carimbo ninguém saberia depois que aquilo
--     não foi escrito ali.
--
-- E uma tabela para as reações (emoji na bolha). Não cabe em `interactions`: reação não é
-- mensagem, não entra no histórico, troca de valor e some. Uma linha por (mensagem, autor).

alter table public.interactions
  add column if not exists reply_to_external_id text,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_scope text,
  add column if not exists forwarded_from_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'interactions_deleted_scope_check'
  ) then
    alter table public.interactions
      add constraint interactions_deleted_scope_check
      check (deleted_scope is null or deleted_scope in ('crm', 'everyone'));
  end if;
end $$;

-- Buscar a mensagem citada é lookup por id externo dentro do lead.
create index if not exists interactions_lead_external_idx
  on public.interactions (lead_id, external_message_id);

create table if not exists public.crm_message_reactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  lead_id text not null references public.leads (id) on delete cascade,
  interaction_id uuid references public.interactions (id) on delete cascade,
  -- Guardado além do interaction_id porque a reação da PACIENTE chega pelo webhook citando
  -- o id da W-API, e a interaction correspondente pode ainda não ter sido gravada.
  external_message_id text not null,
  emoji text not null,
  direction text not null check (direction in ('in', 'out')),
  author text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma reação por pessoa por mensagem: reagir de novo TROCA o emoji, não empilha.
create unique index if not exists crm_message_reactions_unica
  on public.crm_message_reactions (external_message_id, direction, author);

create index if not exists crm_message_reactions_interaction_idx
  on public.crm_message_reactions (interaction_id);

create index if not exists crm_message_reactions_lead_idx
  on public.crm_message_reactions (lead_id, created_at desc);

alter table public.crm_message_reactions enable row level security;

-- Mesma expressão de isolamento das outras tabelas que penduram no lead (ver
-- 20260810192225_rls_tenant_em_conjunto_nao_por_linha.sql): a reação segue a CONVERSA.
drop policy if exists tenant_isolation on public.crm_message_reactions;
create policy tenant_isolation on public.crm_message_reactions
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  );

drop policy if exists crm_message_reactions_read on public.crm_message_reactions;
create policy crm_message_reactions_read on public.crm_message_reactions
  for select to authenticated using ((select public.is_staff_user()));

grant select on public.crm_message_reactions to authenticated;
