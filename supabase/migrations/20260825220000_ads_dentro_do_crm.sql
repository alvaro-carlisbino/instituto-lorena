-- ─────────────────────────────────────────────────────────────────────────────
-- O Ads dentro do CRM
--
-- Até agora, saber quanto a clínica gastou em anúncio exigia abrir o
-- Gerenciador da Meta, e cruzar isso com lead e venda exigia alguém com SQL.
-- O resultado prático é que a conversa sempre voltava para "o tráfego está
-- ruim" em vez de "esta campanha aqui não paga".
--
-- Aqui o gasto entra no banco todo dia e encosta no que o CRM já sabe: lead que
-- chegou, quem respondeu, quem agendou e quem comprou. É a mesma linha, do
-- real gasto até o real faturado.
--
-- POR QUE TABELA E NÃO CHAMADA AO VIVO: a Graph API é lenta, tem teto de
-- requisição e some com histórico quando a campanha é apagada. Tela de gestão
-- não pode depender disso a cada F5.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.meta_ads_insights (
  dia            date        not null,
  nivel          text        not null check (nivel in ('campanha', 'anuncio')),
  chave          text        not null,
  campaign_id    text,
  campaign_name  text,
  adset_name     text,
  ad_id          text,
  ad_name        text,
  spend_cents    bigint      not null default 0,
  impressions    bigint      not null default 0,
  clicks         bigint      not null default 0,
  reach          bigint      not null default 0,
  leads          int         not null default 0,
  conversas      int         not null default 0,
  synced_at      timestamptz not null default now(),
  primary key (dia, nivel, chave)
);

comment on table public.meta_ads_insights is
  'Gasto e entrega da conta de anúncio da clínica, por dia. `chave` é ad_id no nível anúncio e campaign_id no nível campanha: é o que sustenta a chave primária sem depender de nulo.';

create index if not exists meta_ads_insights_dia_idx on public.meta_ads_insights (dia desc, nivel);
create index if not exists meta_ads_insights_camp_idx on public.meta_ads_insights (campaign_id, dia desc);

alter table public.meta_ads_insights enable row level security;
revoke all on table public.meta_ads_insights from anon;
grant select on table public.meta_ads_insights to authenticated;
grant all on table public.meta_ads_insights to service_role;

-- ── Do gasto até a venda, na mesma linha ────────────────────────────────────
--
-- O lado esquerdo é o que a Meta cobrou. O lado direito é o que o CRM viu
-- acontecer. Juntar os dois é o motivo de tudo isto existir.
--
-- RESSALVA QUE PRECISA SER LIDA JUNTO COM O NÚMERO: 31,7% dos leads de
-- formulário chegam sem `campaign_id`, e a conversa vinda de anúncio só tem
-- carimbo quando a pessoa não apagou a frase de abertura. Então o lado direito
-- é PISO, não total. Ver ctwa_aberturas e crm_ctwa_carimbar().
create or replace view public.v_ads_campanha_ate_venda as
with gasto as (
  select campaign_id,
         max(campaign_name) as campaign_name,
         min(dia)           as primeiro_dia,
         max(dia)           as ultimo_dia,
         sum(spend_cents)   as spend_cents,
         sum(impressions)   as impressions,
         sum(clicks)        as clicks,
         sum(leads)         as leads_meta,
         sum(conversas)     as conversas_meta
  from meta_ads_insights
  where nivel = 'campanha' and campaign_id is not null
  group by campaign_id
),
crm as (
  select l.attribution_campaign as campaign_id,
         count(*)                                   as leads_crm,
         count(*) filter (where exists (
           select 1 from interactions i
           where i.lead_id = l.id and i.direction = 'in' and i.channel = 'whatsapp'
         ))                                          as responderam,
         count(*) filter (where exists (
           select 1 from shosp_appointments a where a.lead_id = l.id
         ))                                          as agendaram,
         count(distinct cs.id)                       as vendas,
         coalesce(sum(cs.value_cents), 0)            as faturado_cents
  from leads l
  left join clinic_sales cs on cs.lead_id = l.id
  where l.tenant_id = 'instituto-lorena'
    and l.deleted_at is null
    and l.attribution_campaign is not null
  group by l.attribution_campaign
)
select
  g.campaign_id,
  g.campaign_name,
  g.primeiro_dia,
  g.ultimo_dia,
  g.spend_cents,
  g.impressions,
  g.clicks,
  g.leads_meta,
  g.conversas_meta,
  coalesce(c.leads_crm, 0)      as leads_crm,
  coalesce(c.responderam, 0)    as responderam,
  coalesce(c.agendaram, 0)      as agendaram,
  coalesce(c.vendas, 0)         as vendas,
  coalesce(c.faturado_cents, 0) as faturado_cents
from gasto g
left join crm c on c.campaign_id = g.campaign_id;

comment on view public.v_ads_campanha_ate_venda is
  'Do gasto da Meta até a venda do CRM, por campanha. O lado do CRM é PISO: 31,7% dos leads chegam sem campaign_id e conversa só tem carimbo se a pessoa não apagou a frase de abertura.';

alter view public.v_ads_campanha_ate_venda set (security_invoker = on);
revoke all on public.v_ads_campanha_ate_venda from anon;
grant select on public.v_ads_campanha_ate_venda to authenticated, service_role;

-- ── Cron: puxa o gasto todo dia ─────────────────────────────────────────────
--
-- 05h10: depois do fechamento do dia anterior na Meta e antes de qualquer
-- pessoa abrir a tela de manhã. A janela de 7 dias existe porque a Meta ainda
-- reprocessa número de ontem e de anteontem.
select cron.unschedule('crm-meta-ads-insights-job') where exists (
  select 1 from cron.job where jobname = 'crm-meta-ads-insights-job'
);

select cron.schedule(
  'crm-meta-ads-insights-job',
  '10 5 * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-meta-ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'meta_ads'), '')
    ),
    body := '{"action":"insights","dias":7}'::jsonb,
    timeout_milliseconds := 180000
  );
  $cron$
);
