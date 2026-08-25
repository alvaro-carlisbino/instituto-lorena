-- ─────────────────────────────────────────────────────────────────────────────
-- A primeira mensagem diz de onde a pessoa veio
--
-- Todo anúncio de Clique-para-WhatsApp da clínica abria com o texto padrão da
-- Meta, EM INGLÊS: "Hello! Can I get more info on this?". Ninguém tinha
-- definido o parâmetro `text` do link, então a Meta preenchia sozinha.
--
-- Consertar isso resolve duas coisas de uma vez:
--
--  1. A mensagem passa a soar como alguém de Maringá escrevendo, não como
--     tradução automática.
--
--  2. E, principalmente: se CADA criativo abre com uma frase diferente, a
--     primeira mensagem vira ETIQUETA. É o jeito de saber de qual anúncio a
--     conversa veio SEM depender do gatilho de Clique-para-WhatsApp do
--     ManyChat, que segue travado esperando conectar o login do Facebook.
--
-- Hoje `attribution_channel` só assume 'lead_ads' em toda a base: nenhuma
-- conversa vinda de anúncio tem carimbo, e é por isso que o ROAS real não
-- fecha. Isto aqui não resolve tudo, resolve o que dá para resolver sozinho.
--
-- LIMITE CONHECIDO, e ele é real: o WhatsApp deixa a pessoa APAGAR o texto
-- antes de enviar. Quem apaga fica sem carimbo. Então este número é piso, não
-- total, e nunca deve ser lido como "todas as conversas do anúncio".
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.ctwa_aberturas (
  id          bigint generated always as identity primary key,
  tenant_id   text        not null default 'instituto-lorena',
  trecho      text        not null,
  criativo_id text,
  campanha_id text,
  rotulo      text        not null,
  ativo       boolean     not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.ctwa_aberturas is
  'Frase de abertura de cada criativo de Clique-para-WhatsApp. `trecho` é o pedaço distintivo procurado na primeira mensagem, já sem acento e em minúsculo.';

comment on column public.ctwa_aberturas.trecho is
  'Pedaço DISTINTIVO, não a frase inteira: a pessoa costuma editar o começo e o fim antes de enviar.';

alter table public.ctwa_aberturas enable row level security;
revoke all on table public.ctwa_aberturas from anon;
grant select on table public.ctwa_aberturas to authenticated;
grant all on table public.ctwa_aberturas to service_role;

insert into public.ctwa_aberturas (trecho, criativo_id, rotulo)
select * from (values
  ('naturalidade no transplante', '902755972572270',  'Reedição Lorena · naturalidade e método'),
  ('video do centro cirurgico',   '1828178055284081', 'Centro cirúrgico')
) v(trecho, criativo_id, rotulo)
where not exists (select 1 from public.ctwa_aberturas where trecho = v.trecho);

-- ── Carimbar quem chegou com a frase ────────────────────────────────────────
--
-- Olha só a PRIMEIRA mensagem que a pessoa mandou. Mensagem posterior não
-- serve: alguém pode citar o vídeo no meio da conversa sem ter vindo dele.
create or replace function public.crm_ctwa_carimbar(dias int default 3)
returns table (carimbados int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  -- O trigger enforce_role_write() barra escrita em leads sem papel; aqui a
  -- função É a autoridade, então declara o papel para a transação.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  with candidatos as (
    select l.id as lead_id, a.rotulo, a.criativo_id, a.campanha_id
    from leads l
    join lateral (
      select i.content
      from interactions i
      where i.lead_id = l.id and i.direction = 'in' and i.channel = 'whatsapp'
      order by i.happened_at asc
      limit 1
    ) primeira on true
    join ctwa_aberturas a
      on a.ativo
     and a.tenant_id = l.tenant_id
     and public.crm_nome_chave(primeira.content) like '%' || upper(a.trecho) || '%'
    where l.tenant_id = 'instituto-lorena'
      and l.deleted_at is null
      and l.attribution_channel is null
      and l.created_at >= now() - make_interval(days => greatest(dias, 1))
  ), upd as (
    update leads l
    set attribution_channel = 'ctwa',
        attribution_campaign = coalesce(c.campanha_id, l.attribution_campaign),
        attribution_ad_id    = coalesce(c.criativo_id, l.attribution_ad_id),
        attribution = coalesce(l.attribution, '{}'::jsonb) || jsonb_build_object(
          'channel', 'ctwa',
          'fonte', 'frase de abertura do anúncio',
          'rotulo', c.rotulo,
          'creative_id', c.criativo_id,
          'carimbado_em', now()
        )
    from candidatos c
    where l.id = c.lead_id
    returning 1
  )
  select count(*) into v_n from upd;

  return query select v_n;
end;
$$;

revoke all on function public.crm_ctwa_carimbar(int) from public, anon, authenticated;
grant execute on function public.crm_ctwa_carimbar(int) to service_role;

-- De 15 em 15 minutos. A conversa que chega precisa estar carimbada antes de o
-- CAPI rodar (nos minutos 0 e 30), senão o evento sai sem campanha.
select cron.unschedule('crm-ctwa-carimbar-job') where exists (
  select 1 from cron.job where jobname = 'crm-ctwa-carimbar-job'
);

select cron.schedule(
  'crm-ctwa-carimbar-job',
  '*/15 * * * *',
  $cron$ select public.crm_ctwa_carimbar(3); $cron$
);
