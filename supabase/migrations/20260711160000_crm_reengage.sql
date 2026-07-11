-- ─────────────────────────────────────────────────────────────────────────────
-- Reengajamento "sem fim" do Tricopill — as engrenagens que faltavam.
--
-- O crm-followup-scheduler só cutuca quem MANDOU mensagem e está esperando a
-- gente (inbound > outbound). Ele NÃO toca em:
--   • quem A GENTE respondeu por último e sumiu (67% da base) → Trilha A
--   • quem JÁ COMPROU e vai acabar o frasco → Trilha B (recompra)
--
-- Esta migration cria o estado que controla essas duas cadências (medidas em
-- DIAS, com frequência decrescente e sem fim) + views de métricas pra enxergar
-- o funil de reengajamento. A cadência/mensagens moram na edge function
-- crm-reengage-scheduler; aqui só guardamos o estado e medimos.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Estado de reengajamento, uma linha por (lead, trilha).
create table if not exists public.crm_reengage_state (
  lead_id     text not null references public.leads(id) on delete cascade,
  track       text not null,                    -- 'reactivation' | 'recompra'
  step        int  not null default 0,          -- índice 0-based do próximo toque
  anchor_at   timestamptz not null,             -- silêncio começou (A) / paid_at (B)
  last_sent_at timestamptz,
  status      text not null default 'active',   -- 'active' | 'stopped' | 'converted' | 'paused'
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (lead_id, track)
);

create index if not exists idx_reengage_track_status on public.crm_reengage_state(track, status);
create index if not exists idx_reengage_anchor on public.crm_reengage_state(anchor_at);

alter table public.crm_reengage_state enable row level security;
do $$
begin
  create policy "reengage read" on public.crm_reengage_state for select to authenticated using (true);
exception when duplicate_object then null;
end$$;
-- Escrita é só service_role (a edge function). authenticated não escreve.

-- 2. View: leads Tricopill que já pagaram (Rede + Asaas unificados).
--    first/last_paid_at + último kit → base da Trilha B (recompra) e do funil.
create or replace view public.tricopill_paid_leads as
with pays as (
  select lead_id, paid_at, kit, amount_cents
    from public.rede_payments
   where tenant_id = 'tricopill' and status = 'paid' and lead_id is not null and paid_at is not null
  union all
  select lead_id, paid_at, kit, amount_cents
    from public.asaas_payments
   where tenant_id = 'tricopill'
     and status in ('CONFIRMED','RECEIVED','RECEIVED_IN_CASH')
     and lead_id is not null and paid_at is not null
)
select
  lead_id,
  count(*)                       as orders,
  min(paid_at)                   as first_paid_at,
  max(paid_at)                   as last_paid_at,
  (array_agg(kit order by paid_at desc))[1] as last_kit,
  sum(amount_cents)              as total_cents
from pays
group by lead_id;

-- 3. View de detalhe por lead — alimenta o painel de reengajamento.
--    Classifica cada lead Tricopill numa "situação" e traz os sinais de tempo.
create or replace view public.tricopill_reengage_leads as
select
  l.id                                   as lead_id,
  l.patient_name,
  l.phone,
  l.created_at,
  l.opted_out_at,
  l.conversation_status,
  cs.last_inbound_at,
  greatest(coalesce(cs.last_ai_reply_at,'epoch'::timestamptz),
           coalesce(cs.last_human_reply_at,'epoch'::timestamptz)) as last_outbound_at,
  p.orders,
  p.first_paid_at,
  p.last_paid_at,
  p.last_kit,
  -- dias em silêncio (a gente falou por último e ninguém respondeu)
  case when greatest(coalesce(cs.last_ai_reply_at,'epoch'::timestamptz),
                     coalesce(cs.last_human_reply_at,'epoch'::timestamptz))
            > coalesce(cs.last_inbound_at,'epoch'::timestamptz)
       then round(extract(epoch from (now() - greatest(coalesce(cs.last_ai_reply_at,'epoch'::timestamptz),
                     coalesce(cs.last_human_reply_at,'epoch'::timestamptz)))) / 86400.0, 1)
  end                                     as dias_silencio,
  rs_a.step   as reactivation_step,
  rs_a.status as reactivation_status,
  rs_b.step   as recompra_step,
  rs_b.status as recompra_status,
  -- situação de negócio
  case
    when l.opted_out_at is not null then 'opt_out'
    when p.lead_id is not null then 'comprou'
    when cs.last_inbound_at is null then 'nunca_conversou'
    when greatest(coalesce(cs.last_ai_reply_at,'epoch'::timestamptz),
                  coalesce(cs.last_human_reply_at,'epoch'::timestamptz))
         > coalesce(cs.last_inbound_at,'epoch'::timestamptz)
      then 'silencioso'          -- a gente falou por último, sumiu
    else 'aguardando_resposta'   -- ele falou por último (o outro scheduler cuida)
  end                                     as situacao
from public.leads l
left join public.crm_conversation_states cs on cs.lead_id = l.id
left join public.tricopill_paid_leads p on p.lead_id = l.id
left join public.crm_reengage_state rs_a on rs_a.lead_id = l.id and rs_a.track = 'reactivation'
left join public.crm_reengage_state rs_b on rs_b.lead_id = l.id and rs_b.track = 'recompra'
where l.tenant_id = 'tricopill' and l.deleted_at is null;

-- 4. View de KPIs — uma linha, o retrato do funil de reengajamento.
create or replace view public.tricopill_reengage_metrics as
select
  count(*)                                                          as total_leads,
  count(*) filter (where last_inbound_at is not null)              as conversaram,
  count(*) filter (where situacao = 'silencioso')                 as silenciosos,
  count(*) filter (where situacao = 'silencioso' and dias_silencio >= 7)  as silenciosos_7d,
  count(*) filter (where situacao = 'silencioso' and dias_silencio >= 30) as silenciosos_30d,
  count(*) filter (where situacao = 'comprou')                    as compradores,
  count(*) filter (where situacao = 'opt_out')                    as opt_out,
  count(*) filter (where reactivation_status = 'active')          as em_reativacao,
  count(*) filter (where recompra_status = 'active')             as em_recompra,
  count(*) filter (where reactivation_status = 'converted')       as reativados_convertidos
from public.tricopill_reengage_leads;
