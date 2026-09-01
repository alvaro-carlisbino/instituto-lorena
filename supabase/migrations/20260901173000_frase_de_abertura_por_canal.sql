-- ─────────────────────────────────────────────────────────────────────────────
-- A frase de abertura não é só de anúncio: cada porta ganha a sua
--
-- 244 leads da clínica abriram a conversa com o texto EXATO
--
--     "Olá, gostaria de agendar uma consulta"
--
-- e nenhum tinha canal. Texto idêntico caractere por caractere em 213 pessoas
-- não é gente escrevendo, é link pré-preenchido. Descoberto em 01/set/2026 ao
-- rastrear as 4 consultas marcadas no dia: 3 das 4 chegaram por essa frase.
--
-- DE ONDE ELA VEM: dos 213, 184 têm `manychat_subscriber_id`. Nos meses em que
-- o ManyChat ainda estava de pé a proporção é fechada, 46 de 46 em junho e
-- 77 de 77 em julho. Em agosto cai para 38 de 63 porque a clínica saiu do
-- ManyChat, e a frase continuou vindo no mesmo volume: o link é o mesmo, o que
-- sumiu foi o registro do assinante. É a ponte Instagram → WhatsApp, o link que
-- o fluxo do Direct manda para tirar a pessoa de lá e trazer para cá.
--
-- É orgânico ou é anúncio que levou ao Direct? Não dá para saber pela frase, e
-- o rótulo diz isso. Ainda assim é o oposto de hoje: 244 conversas deixam de
-- ser "origem desconhecida" e viram "veio do Instagram".
--
-- O QUE MUDA NA MECÂNICA: `ctwa_aberturas` nasceu só para anúncio e a função
-- gravava `attribution_channel = 'ctwa'` fixo. Carimbar o link do Instagram
-- como anúncio seria inventar mídia paga que não existe, então o canal passa a
-- ser coluna da própria linha.
--
-- A tabela e a função mantêm o nome (`ctwa_*`): renomear obrigaria a mexer no
-- cron, nos grants e nas duas migrations que já falam delas, e o ganho seria
-- só cosmético.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.ctwa_aberturas
  add column if not exists canal text not null default 'ctwa';

comment on column public.ctwa_aberturas.canal is
  'Canal gravado em leads.attribution_channel quando a frase casa: ctwa (anúncio Meta), instagram (link do Direct/bio), landing (página /consulta), site, google. Só ctwa é mídia paga.';

comment on table public.ctwa_aberturas is
  'Frase de abertura de cada PORTA de entrada do WhatsApp, não só de anúncio. `trecho` é o pedaço distintivo procurado na primeira mensagem, já sem acento e em minúsculo.';

-- ── Carimbar quem chegou com a frase ────────────────────────────────────────
--
-- Duas mudanças sobre a versão de 25/08:
--  1. o canal vem da linha, não é mais o literal 'ctwa';
--  2. quando um lead casa com mais de uma frase, ganha a MAIS LONGA. Sem isso o
--     UPDATE ... FROM escolhia uma das duas ao acaso, e a frase genérica podia
--     roubar o lead da frase específica.
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
    select distinct on (l.id)
           l.id as lead_id, a.rotulo, a.criativo_id, a.campanha_id, a.canal
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
    order by l.id, length(a.trecho) desc
  ), upd as (
    update leads l
    set attribution_channel = c.canal,
        attribution_campaign = coalesce(c.campanha_id, l.attribution_campaign),
        attribution_ad_id    = coalesce(c.criativo_id, l.attribution_ad_id),
        attribution = coalesce(l.attribution, '{}'::jsonb) || jsonb_build_object(
          'channel', c.canal,
          'fonte', 'frase de abertura',
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

-- ── As portas ───────────────────────────────────────────────────────────────
--
-- JÁ EM USO hoje, e é o que destrava o histórico:
--   · Instagram: o link do Direct. A vírgula depois do "Olá" é o que separa o
--     link de quem digita a mesma intenção na mão.
--   · Landing /consulta: a frase já está no botão desde 27/ago (ConsultaLandingPage).
--
-- AINDA NÃO EXISTEM em lugar nenhum, e por isso não carimbam nada errado. Ficam
-- cadastradas prontas para o dia em que o link for trocado na origem, que é
-- fora deste repo (site oficial, bio do Instagram, perfil do Google).
insert into ctwa_aberturas (tenant_id, trecho, canal, criativo_id, campanha_id, rotulo, ativo)
values
  ('instituto-lorena', 'ola, gostaria de agendar uma consulta', 'instagram', null, null,
   'Instagram: link do Direct para o WhatsApp', true),
  ('instituto-lorena', 'vim pelo site e quero falar sobre a avaliacao capilar', 'landing', null, null,
   'Landing /consulta: botão direto para o WhatsApp', true),
  ('instituto-lorena', 'vim pelo site e quero agendar minha consulta', 'site', null, null,
   'Site oficial: botão de WhatsApp', true),
  ('instituto-lorena', 'vim pelo instagram e quero agendar minha consulta', 'instagram_bio', null, null,
   'Instagram: link da bio', true),
  ('instituto-lorena', 'vim pelo google e quero agendar minha consulta', 'google', null, null,
   'Google: perfil da empresa', true)
on conflict do nothing;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- O cron olha 3 dias. A frase do Instagram existe desde maio, então uma passada
-- longa recupera o histórico inteiro. Só toca em lead com canal nulo.
select public.crm_ctwa_carimbar(200);
