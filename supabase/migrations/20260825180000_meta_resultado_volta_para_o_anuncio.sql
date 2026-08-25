-- ─────────────────────────────────────────────────────────────────────────────
-- O resultado volta para o anúncio
--
-- Até hoje a Meta só sabia o que é "preencheu formulário" e "abriu conversa".
-- Foi exatamente isso que ela entregou: 860 leads de formulário em jul+ago e
-- 1 venda. Ela cumpriu o pedido. O pedido é que estava errado.
--
-- Aqui a clínica passa a devolver o que interessa: quem RESPONDEU, quem
-- AGENDOU e quem COMPROU. A Meta usa o `lead_id` dela mesma como chave, então
-- nenhum dado pessoal sai do CRM: nem telefone, nem nome, nem CPF.
--
-- PEGADINHA QUE DEFINE O DESENHO: o pixel recusa evento com mais de 7 DIAS
-- ("Event Timestamp Too Old", subcode 2804003). Não existe backfill. Ou o
-- evento sai perto de acontecer, ou não sai nunca. Por isso o cron é de 30 em
-- 30 minutos e a janela de busca é de 6 dias, com folga de um dia.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Livro de o que já foi enviado ────────────────────────────────────────
--
-- Chave por (lead, evento): a mesma pessoa pode gerar Contact, Schedule e
-- Purchase, e cada um vai uma vez só. Reenviar infla a conta da Meta e ensina
-- errado.
create table if not exists public.meta_capi_events (
  lead_id      text        not null,
  event_name   text        not null,
  leadgen_id   text        not null,
  event_time   timestamptz not null,
  sent_at      timestamptz not null default now(),
  ok           boolean     not null default false,
  response     text,
  primary key (lead_id, event_name)
);

comment on table public.meta_capi_events is
  'O que já foi devolvido para a Meta por lead e por evento. Guarda contra reenvio.';

create index if not exists meta_capi_events_sent_idx on public.meta_capi_events (sent_at desc);

alter table public.meta_capi_events enable row level security;
-- Ninguém lê pelo PostgREST: é livro de máquina, não tela.
revoke all on table public.meta_capi_events from anon, authenticated;
grant all on table public.meta_capi_events to service_role;

-- ── 2. Quem está esperando para ser devolvido ───────────────────────────────
--
-- Três eventos, do mais raro ao mais comum:
--   Purchase  = fechou venda (leva valor em reais)
--   Schedule  = agendou no Shosp
--   Contact   = respondeu no WhatsApp, e ainda não agendou nem comprou
--
-- Só entra lead que veio de formulário Meta e tem `leadgen_id`, porque é essa
-- a chave que a Meta reconhece. Lead de conversa (CTWA) não tem, e por isso
-- continua invisível até o gatilho do ManyChat ser destravado.
create or replace function public.crm_meta_capi_pendentes(dias int default 6)
returns table (
  lead_id     text,
  leadgen_id  text,
  event_name  text,
  event_time  timestamptz,
  value_reais numeric
)
language sql
security definer
set search_path = public
as $$
  with corte as (select now() - make_interval(days => greatest(dias, 1)) as desde),
  base as (
    select l.id,
           l.attribution->>'leadgen_id' as lg,
           exists (
             select 1 from interactions i
             where i.lead_id = l.id and i.direction = 'in' and i.channel = 'whatsapp'
           ) as respondeu,
           (select min(a.data) from shosp_appointments a where a.lead_id = l.id) as agendou,
           (select min(cs.sold_at)     from clinic_sales cs where cs.lead_id = l.id) as vendeu_em,
           (select max(cs.value_cents) from clinic_sales cs where cs.lead_id = l.id) as venda_cents,
           l.last_interaction_at
    from leads l
    where l.tenant_id = 'instituto-lorena'
      and l.deleted_at is null
      and l.attribution_channel = 'lead_ads'
      and l.attribution->>'leadgen_id' is not null
  ),
  candidatos as (
    select id, lg, 'Purchase'::text as ev, vendeu_em::timestamptz as t, venda_cents / 100.0 as v
      from base where vendeu_em is not null
    union all
    select id, lg, 'Schedule', agendou::timestamptz, null
      from base where agendou is not null
    union all
    select id, lg, 'Contact', coalesce(last_interaction_at, now()), null
      from base where respondeu and agendou is null and vendeu_em is null
  )
  select c.id, c.lg, c.ev, c.t, c.v
  from candidatos c, corte
  where c.t >= corte.desde
    and c.t <= now()
    and not exists (
      select 1 from meta_capi_events e
      where e.lead_id = c.id and e.event_name = c.ev and e.ok
    )
  order by c.t;
$$;

revoke all on function public.crm_meta_capi_pendentes(int) from public, anon, authenticated;
grant execute on function public.crm_meta_capi_pendentes(int) to service_role;

-- ── 3. A semente do público de clientes ─────────────────────────────────────
--
-- Devolve SÓ o hash. O telefone é normalizado (55 + DDD + número) e passa por
-- SHA-256 aqui dentro, então número em claro não sai do banco em momento
-- nenhum, nem para a função, nem para a Meta.
--
-- Duas camadas, e a chamada escolhe:
--   'paciente' = quem agendou, tem prontuário ou comprou. Melhor sinal.
--   'conversa' = quem respondeu de verdade no WhatsApp. Sinal mais fraco,
--                porém grande o bastante para a Meta aceitar como semente de
--                público semelhante, que exige mais de mil pessoas.
create or replace function public.crm_meta_audience_seed(camada text default 'paciente')
returns table (hash text)
language sql
security definer
set search_path = public, extensions
as $$
  with tel as (
    select case
             when length(d) between 12 and 13 and left(d, 2) = '55' then d
             when length(d) in (10, 11) then '55' || d
           end as t
    from (
      select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d
      from (
        select cs.phone as p from clinic_sales cs
          where camada in ('paciente','conversa') and cs.tenant_id = 'instituto-lorena'
        union all
        select l.phone from shosp_appointments a join leads l on l.id = a.lead_id
          where camada in ('paciente','conversa')
        union all
        select l.phone from leads l
          where camada in ('paciente','conversa')
            and l.tenant_id = 'instituto-lorena' and l.shosp_prontuario is not null
        union all
        select l.phone from leads l
          where camada = 'conversa'
            and l.tenant_id = 'instituto-lorena' and l.deleted_at is null
            and exists (
              select 1 from interactions i
              where i.lead_id = l.id and i.direction = 'in' and i.channel = 'whatsapp'
            )
      ) fontes
    ) limpos
  )
  select distinct encode(digest(t, 'sha256'), 'hex')
  from tel where t is not null;
$$;

revoke all on function public.crm_meta_audience_seed(text) from public, anon, authenticated;
grant execute on function public.crm_meta_audience_seed(text) to service_role;

-- ── 4. Segredo do cron ──────────────────────────────────────────────────────
insert into public.app_cron_secrets (key, secret)
select 'meta_ads', encode(gen_random_bytes(24), 'hex')
where not exists (select 1 from public.app_cron_secrets where key = 'meta_ads');

-- ── 5. De 30 em 30 minutos ──────────────────────────────────────────────────
--
-- Não é frequência de capricho: com janela de 7 dias e cirurgia que fecha em
-- horário comercial, meia hora garante que nada chegue perto do limite.
select cron.unschedule('crm-meta-ads-sync-job') where exists (
  select 1 from cron.job where jobname = 'crm-meta-ads-sync-job'
);

select cron.schedule(
  'crm-meta-ads-sync-job',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-meta-ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'meta_ads'), '')
    ),
    body := '{"action":"capi"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

-- O público de clientes se refaz uma vez por dia, de madrugada. Base de
-- paciente muda devagar; o que não pode é envelhecer por meses, que foi o que
-- aconteceu com as listas antigas da conta (mil pessoas, semente pequena
-- demais para gerar semelhante).
select cron.unschedule('crm-meta-ads-audience-job') where exists (
  select 1 from cron.job where jobname = 'crm-meta-ads-audience-job'
);

select cron.schedule(
  'crm-meta-ads-audience-job',
  '40 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-meta-ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'meta_ads'), '')
    ),
    body := '{"action":"audience"}'::jsonb,
    timeout_milliseconds := 180000
  );
  $cron$
);
