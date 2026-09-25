-- Google Ads da clínica (conta 612-036-9894): devolve ao Google o lead da landing e a CONSULTA
-- MARCADA de quem chegou por anúncio, pelo gclid. Com isso a conta pode otimizar por consulta,
-- não por clique, que é o que o Meta ainda não faz por nós.
--
-- A base é o evento `landing_lead`/`prebooking` da storefront_events, não o lead: `leads.attribution`
-- guarda só a ÚLTIMA origem e perde o gclid se a pessoa voltar por outro caminho. O evento guarda o
-- gclid do clique para sempre, com o lead_id e a hora do clique.

create table if not exists public.gads_conversoes_enviadas (
  tipo text not null,          -- 'lead_landing' | 'consulta_marcada'
  ref text not null,           -- lead_landing: id do evento · consulta_marcada: gclid (a ação é ONE_PER_CLICK)
  tenant_id text not null,
  lead_id text,
  gclid text not null,
  acao_id text not null,
  quando timestamptz not null, -- hora da conversão informada ao Google
  detalhe text,                -- consulta_marcada: código do agendamento na Shosp
  request_id text,             -- protocolo do Data Manager; 200 sem protocolo não prova registro
  enviado_em timestamptz not null default now(),
  primary key (tipo, ref)
);
alter table public.gads_conversoes_enviadas enable row level security;
revoke all on table public.gads_conversoes_enviadas from anon, authenticated;

create or replace function public.crm_gads_clinica_pendentes()
returns table(tipo text, ref text, lead_id text, gclid text, quando timestamptz, detalhe text)
language sql
stable
set search_path = public
as $function$
  with cliques as (
    select e.id::text as evento_id, e.lead_id, e.created_at,
           nullif(btrim(e.attribution -> 'raw' ->> 'gclid'), '') as gclid
    from storefront_events e
    where e.tenant_id = 'instituto-lorena'
      and e.type in ('landing_lead', 'prebooking')
      and e.created_at >= now() - interval '90 days'
  )
  -- Lead da landing: janela de 30 dias da ação "Lead landing (CRM)".
  select 'lead_landing', c.evento_id, c.lead_id, c.gclid, c.created_at, null::text
  from cliques c
  where c.gclid is not null
    and c.created_at >= now() - interval '30 days'
    and not exists (select 1 from gads_conversoes_enviadas g where g.tipo = 'lead_landing' and g.ref = c.evento_id)
  union all
  -- Consulta marcada DEPOIS do clique (first_seen_at = quando a agenda da Shosp mostrou o
  -- horário pela primeira vez), para data a partir do dia do clique, sem desmarcado ou falta.
  -- Uma por gclid: a ação é ONE_PER_CLICK e o Google recusaria a segunda.
  select * from (
    select distinct on (c.gclid)
           'consulta_marcada', c.gclid, c.lead_id, c.gclid, a.first_seen_at, a.codigo_agendamento
    from cliques c
    join leads l on l.id = c.lead_id and l.deleted_at is null
    join shosp_appointments a
      on (a.lead_id = l.id or (l.shosp_prontuario is not null and a.prontuario = l.shosp_prontuario))
    where c.gclid is not null
      and a.first_seen_at >= c.created_at
      and a.data >= (c.created_at at time zone 'America/Sao_Paulo')::date
      and coalesce(a.status, '') !~* 'desmarc|cancel|falt'
      and public.crm_e_consulta(a.servico, a.prestador, a.payload ->> 'observacao')
      and not exists (select 1 from gads_conversoes_enviadas g where g.tipo = 'consulta_marcada' and g.ref = c.gclid)
    order by c.gclid, a.first_seen_at
  ) consultas;
$function$;

comment on function public.crm_gads_clinica_pendentes() is
  'Conversões da clínica ainda não enviadas ao Google Ads (lead da landing e consulta marcada, por gclid). Lida pelo crm-gads-clinica-upload.';

revoke execute on function public.crm_gads_clinica_pendentes() from public, anon, authenticated;

-- Segredo próprio do cron (o mesmo padrão de meta_ads e cirurgia).
insert into public.app_cron_secrets (key, secret)
values ('gads_clinica', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- A cada 30 minutos, fora do minuto dos outros crons de anúncio.
select cron.unschedule(jobid) from cron.job where jobname = 'crm-gads-clinica-upload';
select cron.schedule(
  'crm-gads-clinica-upload',
  '13,43 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-gads-clinica-upload',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'gads_clinica'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
