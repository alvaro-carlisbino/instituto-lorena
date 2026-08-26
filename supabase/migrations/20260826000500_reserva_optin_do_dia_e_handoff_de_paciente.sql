-- 25/ago/2026. Dois buracos que apareceram no mesmo lead de formulário.
--
-- 1) O teto de primeiros contatos do dia (20, linha em aquecimento) foi consumido inteiro
--    até às 11h27 da manhã por leads represados da varredura. O formulário das 19h04 bateu
--    em `cap_optin_dia` quatro segundos depois de entrar e, na segunda tentativa, a janela
--    de 08h-20h já tinha fechado. Ficou para as 08h do dia seguinte, atrás de dois leads
--    presos há 10 e 11 voltas. O teto está certo e não sobe: o que faltava era ORDEM.
--    `optin_reserva_pct` guarda uma fatia do teto para quem preencheu HOJE.
--
-- 2) O handoff da equipe (owner_mode='human' COM ai_enabled=true, que é o que fica quando a
--    atendente responde na mão) expira em 7 dias e a IA reassume. Isso é certo para lead
--    esquecido no topo do funil e errado para quem já é paciente: a Roberta, etapa Encerrado,
--    último humano em 09/jul, levou uma resposta da IA às 18h02 de 25/ago sobre documentos que
--    tinha acabado de mandar. Eram 288 conversas em `human` com IA ligada, 195 já passadas do
--    prazo, 19 delas de paciente pagante ou agendado.

-- ── 1. Reserva do teto de primeiro contato para o lead do dia ────────────────────────────
alter table public.whatsapp_line_policy
  add column if not exists optin_reserva_pct integer not null default 30;

alter table public.whatsapp_line_policy
  drop constraint if exists whatsapp_line_policy_optin_reserva_pct_check;
alter table public.whatsapp_line_policy
  add constraint whatsapp_line_policy_optin_reserva_pct_check
  check (optin_reserva_pct >= 0 and optin_reserva_pct <= 90);

comment on column public.whatsapp_line_policy.optin_reserva_pct is
  'Percentagem do teto diário de primeiros contatos guardada para leads criados HOJE. '
  '0 desliga a reserva e a fila volta a ser só por ordem de agendamento.';

-- ── 2. Onde o handoff da equipe nunca expira ─────────────────────────────────────────────
alter table public.crm_ai_configs
  add column if not exists ai_handoff_keep_pipelines jsonb not null default '[]'::jsonb;
alter table public.crm_ai_configs
  add column if not exists ai_handoff_keep_stages jsonb not null default '[]'::jsonb;

comment on column public.crm_ai_configs.ai_handoff_keep_pipelines is
  'Esteiras inteiras em que o handoff da equipe NÃO expira: quem está aqui já é paciente, '
  'e a conversa continua de quem assumiu na mão até alguém religar a IA no painel.';
comment on column public.crm_ai_configs.ai_handoff_keep_stages is
  'Etapas soltas com a mesma regra, para funil que mistura aquisição e paciente.';

-- Clínica: as duas esteiras de pós-consulta inteiras, e no funil da clínica da consulta
-- agendada em diante. Fora da lista fica exatamente onde a IA trabalha hoje (Novo lead,
-- Ligar — Formulário, Triagem, Contato, Follow UP 1/2/3, tc-novo e tc-triagem), para não
-- recriar o buraco de jul/26 em que 682 conversas ficaram mudas para sempre.
update public.crm_ai_configs
   set ai_handoff_keep_pipelines = '["pipeline-processo-cirurgico","pipeline-protocolos"]'::jsonb,
       ai_handoff_keep_stages = '[
         "consulta",
         "stage-1777902160674",
         "fechado",
         "cancelou-cirurgia",
         "cancelou-protocolo",
         "tc-avaliacao",
         "tc-plano",
         "tc-sessoes",
         "tc-concluido"
       ]'::jsonb,
       updated_at = now()
 where tenant_id = 'instituto-lorena' and id = 'default';

-- O Tricopill fica de fora de propósito: lá o bot de vendas nunca se desliga sozinho e não
-- há etapa de paciente. Ver crm_ia_quando_responde.
