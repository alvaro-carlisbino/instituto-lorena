-- ─────────────────────────────────────────────────────────────────────────────
-- Vigia da conta de anúncio
--
-- A conta da clínica tem duas mãos no volante. Em 25/08/2026 a agência pausou
-- dezesseis conjuntos às 16h31 e apagou os públicos de intenção postos às
-- 15h30; o CRM reaplicou às 19h07. Ninguém agiu de má-fé: cada lado viu a conta
-- mudar e reagiu.
--
-- O vigia NÃO desfaz nada. Corrigir sozinho viraria briga de edição no
-- automático, e cada edição zera o aprendizado do algoritmo: o remédio seria
-- pior que a doença. Ele olha de hora em hora e avisa.
--
-- O caso que originou tudo: os criativos "Jaque 07/08" e "LORENA 07 DE AGOSTO"
-- anunciavam consulta em Londrina no dia 7 de agosto e continuaram no ar até
-- 25/08. Deram 38 cliques e ZERO conversa. Anúncio de data performa bem antes e
-- vira armadilha depois, e foi escolhido justamente por ter o melhor custo por
-- resultado no histórico.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.meta_ads_vigia_log (
  id         bigint generated always as identity primary key,
  chave      text        not null,
  texto      text        not null,
  enviado    boolean     not null default false,
  created_at timestamptz not null default now()
);

comment on table public.meta_ads_vigia_log is
  'Avisos do vigia do Ads. A chave sustenta o dedupe de 6h: o vigia roda de hora em hora e o mesmo problema leva um dia para alguém resolver. Sem dedupe ele vira ruído, e ruído treina a pessoa a ignorar o alerta inteiro.';

create index if not exists meta_ads_vigia_log_chave_idx
  on public.meta_ads_vigia_log (chave, created_at desc);

alter table public.meta_ads_vigia_log enable row level security;
revoke all on table public.meta_ads_vigia_log from anon;
grant select on table public.meta_ads_vigia_log to authenticated;
grant all on table public.meta_ads_vigia_log to service_role;

-- De hora em hora, no minuto 47. Longe do minuto 13 (sync do Shosp), do 18
-- (ligação do lead) e dos 0 e 30 (CAPI), para não disputar wall clock.
select cron.unschedule('crm-meta-ads-vigia-job') where exists (
  select 1 from cron.job where jobname = 'crm-meta-ads-vigia-job'
);

select cron.schedule(
  'crm-meta-ads-vigia-job',
  '47 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-meta-ads-vigia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'meta_ads'), '')
    ),
    body := '{"avisar":true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
