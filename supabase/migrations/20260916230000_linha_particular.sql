-- Linha PARTICULAR (16/set/2026).
--
-- O WhatsApp novo é da Aline Muniz (consultora). A linha entrou visível para o polo inteiro e,
-- no mesmo dia, a Aline da SDR (que atende pelo login atendimento@) avisou: "as conversas da
-- Aline Muniz estão vindo aqui no meu CRM". A lista de chat, o sino de alertas e as
-- notificações de "novo lead aguardando" mostravam para toda a equipe o que era da carteira
-- dela.
--
-- `private_owner_id` preenchido = as conversas de leads amarrados nesta linha
-- (`leads.whatsapp_instance_id`) só aparecem para essa pessoa e para admin. É FILTRO DE
-- TELA e de notificação, não trava de RLS: o card continua no quadro do funil, e a ficha
-- aberta pelo quadro mostra a conversa. RLS por pessoa pesaria em toda leitura de
-- `interactions` numa instância que já reiniciou três vezes hoje.
--
-- Onde é lida: `src/hooks/useLinhasParticularesOcultas.ts` (lista do /chat e alertas) e
-- `_shared/notifyAgents.ts` (quem recebe a notificação in-app).
alter table public.whatsapp_channel_instances
  add column if not exists private_owner_id text references public.app_users (id) on delete set null;

comment on column public.whatsapp_channel_instances.private_owner_id is
  'Linha particular: conversas desta linha só aparecem (lista, alertas, notificações) para este usuário e para admin. Ver 20260916230000.';
