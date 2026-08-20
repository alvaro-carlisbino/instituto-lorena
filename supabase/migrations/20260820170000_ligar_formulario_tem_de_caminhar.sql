-- ─────────────────────────────────────────────────────────────────────────────
-- "📞 Ligar — Formulário" era uma coluna de mão única.
--
-- O webhook do Meta Lead Ads joga todo lead de formulário em `ligar-formulario`
-- (crm-meta-leadform-webhook), e `upsertLeadByPhone` PRESERVA o stage_id em toda
-- mensagem que chega depois (_shared/crm.ts). Resultado: nada, em lugar nenhum do
-- código, tira um card dali. Só sai se uma pessoa arrastar na tela.
--
-- Em 20/08/2026 a coluna tinha 803 cards. Separados por evidência do que já aconteceu:
--
--   A    5  a pessoa respondeu no WhatsApp, no próprio card
--   B   63  a pessoa conversou, mas a conversa está no card IRMÃO (o sombra 888001…
--           que o ManyChat criava). O card do formulário é duplicata e nunca vai
--           receber mensagem nenhuma — 24 dos irmãos já estão em Triagem capilar,
--           18 em Encerrado, 8 em Avaliação, 7 em Follow UP 3, 7 em Contato.
--   C    5  tem consulta no Shosp (1 futura, 1 já realizada, 3 desmarcadas)
--   D  245  a gente mandou e a pessoa nunca respondeu (237 receberam o template do
--           ManyChat, 8 receberam texto de gente) — continua sendo "ligar", e NÃO
--           entra na fila: segunda apresentação para quem calou na primeira é
--           exatamente o "insistir com quem nunca respondeu" que vira denúncia, e
--           denúncia é o que bane linha não-oficial.
--   E  552  ninguém falou com essa pessoa, nunca, em canal nenhum, por nenhum meio.
--
-- Esta migração faz três coisas: o gatilho que impede o problema de voltar, o
-- backfill de A/B/C, e a reabordagem de E pela fila da linha da casa.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. O gatilho: quem responde sai da fila de ligação ───────────────────────
--
-- No padrão dos gatilhos que já vivem em `interactions` (last_inbound_at,
-- last_interaction_at): a regra mora no banco, não em cada rota. São quatro
-- caminhos de inbound hoje (W-API, Evolution, oficial da Meta, ManyChat) e carimbar
-- em cada um é como o `last_interaction_at` ficou congelado antes.
--
-- Estreito de propósito: só a clínica, só esta etapa. Se a pessoa escreveu, ela não
-- está mais na fila de "ninguém falou com ela ainda" — está conversando, e o lugar
-- disso é Contato (que já tem a automação `auto-contato`, tarefa de próxima ação
-- em 24h). Nenhuma outra etapa é tocada: quem está em Follow UP 2 continua lá.

create or replace function public._sai_da_fila_de_ligacao()
returns trigger
language plpgsql
as $function$
begin
  if new.direction = 'in' and new.channel in ('whatsapp', 'meta') then
    update public.leads
       set stage_id = 'contato',
           stage_entered_at = now(),
           updated_at = now()
     where id = new.lead_id
       and pipeline_id = 'pipeline-clinica'
       and stage_id = 'ligar-formulario';
  end if;
  return new;
end;
$function$;

comment on function public._sai_da_fila_de_ligacao() is
  'Resposta da pessoa tira o card de "📞 Ligar — Formulário" e põe em Contato. A coluna '
  'significa "ninguém falou com esta pessoa ainda"; quem escreveu já falou.';

drop trigger if exists interactions_sai_da_fila_de_ligacao on public.interactions;
create trigger interactions_sai_da_fila_de_ligacao
  after insert on public.interactions
  for each row execute function public._sai_da_fila_de_ligacao();


-- ── 2. Backfill dos 803 cards presos ─────────────────────────────────────────
--
-- Num bloco só porque `enforce_role_write()` exige o claim de service_role para
-- escrever em `leads`, e `set_config(..., true)` só vale dentro de uma transação.

do $backfill$
declare
  qtd_consulta integer;
  qtd_conversa integer;
  qtd_duplicata integer;
  qtd_fila integer;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- ── C: tem consulta no Shosp ───────────────────────────────────────────────
  --
  -- Primeiro este, porque agendamento ganha de conversa: quem já marcou passou de
  -- "está conversando". Consulta futura ainda de pé → "Consulta agendada". Consulta
  -- que já passou sem ter sido desmarcada → "Consulta Realizada" (a Shosp não diz
  -- "Atendido": comparecimento se lê por hora passada). Desmarcada NÃO conta como
  -- agendamento — essa gente cai na regra de conversa logo abaixo, ou fica na fila.
  update public.leads l
     set stage_id = case
           when a.data >= current_date then 'consulta'
           else 'stage-1777902160674'
         end,
         stage_entered_at = now(),
         updated_at = now()
    from (
          select distinct on (lead_id) lead_id, data, status
            from public.shosp_appointments
           where lead_id is not null
             and coalesce(status, '') not in ('Desmarcado', 'Cancelado')
           order by lead_id, data desc
         ) a
   where a.lead_id = l.id
     and l.deleted_at is null
     and l.pipeline_id = 'pipeline-clinica'
     and l.stage_id = 'ligar-formulario';
  get diagnostics qtd_consulta = row_count;

  -- ── A: respondeu no próprio card ───────────────────────────────────────────
  -- O que o gatilho teria feito se existisse desde sempre.
  update public.leads l
     set stage_id = 'contato',
         stage_entered_at = now(),
         updated_at = now()
   where l.deleted_at is null
     and l.pipeline_id = 'pipeline-clinica'
     and l.stage_id = 'ligar-formulario'
     and exists (
       select 1 from public.interactions i
        where i.lead_id = l.id and i.direction = 'in' and i.channel in ('whatsapp', 'meta')
     );
  get diagnostics qtd_conversa = row_count;

  -- ── B: o card do formulário é duplicata do card da conversa ────────────────
  --
  -- O par-sombra do ManyChat: a pessoa preencheu o formulário (card com telefone
  -- real) e depois escreveu pelo ManyChat, que criava OUTRO lead com telefone
  -- sintético 888001… amarrado ao subscriber. A conversa, o follow-up e o funil todo
  -- aconteceram no card sombra. O card do formulário nunca vai receber mensagem — o
  -- gatilho de cima jamais vai disparar nele — e ficar em "Ligar" é pedir para
  -- alguém ligar para quem já está sendo atendido.
  --
  -- Vai para Encerrado com o motivo apontando o card vivo, e sai das métricas para a
  -- pessoa não contar duas vezes no funil. Nada é apagado: o dia em que
  -- `crm-merge-leads` parar de dizer "ok" sem mesclar, estes são os pares a fundir.
  with irmao as (
    select distinct on (lf.id)
           lf.id as duplicata_id,
           viva.id as card_da_conversa
      from public.leads lf
      join public.leads viva
        on viva.deleted_at is null
       and viva.id <> lf.id
       and (
             (   nullif(lf.custom_fields ->> 'manychat_subscriber_id', '') is not null
             and viva.custom_fields ->> 'manychat_subscriber_id' = lf.custom_fields ->> 'manychat_subscriber_id')
          or (   length(regexp_replace(coalesce(lf.phone, ''), '\D', '', 'g')) >= 12
             and regexp_replace(coalesce(viva.phone, ''), '\D', '', 'g')
               = regexp_replace(coalesce(lf.phone, ''), '\D', '', 'g'))
           )
     where lf.deleted_at is null
       and lf.pipeline_id = 'pipeline-clinica'
       and lf.stage_id = 'ligar-formulario'
       and exists (
         select 1 from public.interactions i
          where i.lead_id = viva.id and i.direction = 'in' and i.channel in ('whatsapp', 'meta')
       )
     order by lf.id, viva.last_interaction_at desc nulls last
  )
  update public.leads l
     set stage_id = 'fechado',
         stage_entered_at = now(),
         lost_reason = 'Duplicata do formulário: a conversa está no card ' || irmao.card_da_conversa,
         excluded_from_metrics = true,
         custom_fields = coalesce(l.custom_fields, '{}'::jsonb)
                         || jsonb_build_object('duplicata_de', irmao.card_da_conversa),
         updated_at = now()
    from irmao
   where irmao.duplicata_id = l.id;
  get diagnostics qtd_duplicata = row_count;

  -- ── E: reabordagem pela fila da linha da casa ──────────────────────────────
  --
  -- Ninguém nunca falou com essa gente. Eles pediram contato e não receberam nenhum —
  -- primeiro porque o disparo do ManyChat só nasceu em 27/jul (e o lote de julho é
  -- anterior), depois porque o ManyChat saiu do WhatsApp em 19/ago.
  --
  -- Só quem NUNCA recebeu saída nenhuma. Os 237 que receberam o template do ManyChat e
  -- ficaram calados ficam de fora: uma segunda apresentação para quem não respondeu à
  -- primeira é o item 4 da lista de riscos da guarda anti-ban, e a linha está no
  -- primeiro dia de aquecimento. Esses precisam de ligação, não de outra mensagem.
  --
  -- Por que agendar em ONDAS, e não enfileirar os 722 de uma vez: o
  -- `drainOutreachQueue` só pega linha com `scheduled_at` já vencido, e desiste de vez
  -- (`blocked`) na 40ª recusa. Jogar 722 com data de hoje faria a guarda recusar por
  -- teto milhares de vezes em algumas horas e MATAR a maior parte da fila em silêncio —
  -- o oposto do que a fila existe para fazer. Cada lead sai com a data do seu próprio
  -- dia, e no dia dele a fila tem 6 a 30 nomes, que é o que a linha aguenta.
  --
  -- A rampa acompanha o aquecimento da linha (começou 20/ago 14h11, 14 dias, teto de
  -- optin indo de 10 a 40/dia) e deixa folga para os formulários NOVOS de cada dia, que
  -- têm prioridade sobre backlog. Mais novo primeiro: um formulário de ontem ainda
  -- lembra de ter preenchido, um de 04/mai não.
  --
  -- Quem escrever antes da vez sai da fila sozinho ('a pessoa escreveu antes', no drain).
  with elegivel as (
    select l.id,
           l.patient_name,
           regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') as tel,
           l.created_at,
           row_number() over (order by l.created_at desc) as pos
      from public.leads l
     where l.deleted_at is null
       and l.tenant_id = 'instituto-lorena'
       and l.pipeline_id = 'pipeline-clinica'
       and l.stage_id = 'ligar-formulario'
       and l.opted_out_at is null
       and length(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')) >= 12
       and not exists (
         select 1 from public.interactions i
          where i.lead_id = l.id and i.direction = 'in' and i.channel in ('whatsapp', 'meta')
       )
       -- Nenhuma saída, de espécie nenhuma: nem o template do ManyChat, nem texto de gente.
       and not exists (
         select 1 from public.interactions i
          where i.lead_id = l.id and i.direction = 'out' and i.channel in ('whatsapp', 'meta')
       )
       and not exists (
         select 1 from public.whatsapp_outreach_queue q
          where q.lead_id = l.id and q.status in ('pending', 'sent')
       )
  ),
  plano as (
    -- Vagas por dia: 6 hoje, subindo até 30 no 14º dia, junto com o aquecimento.
    select d as dia,
           greatest(6, least(30, floor(6 + (30.0 - 6.0) * d / 14.0)::int)) as vagas
      from generate_series(0, 89) d
  ),
  slot as (
    select row_number() over (order by p.dia, s.i) as pos,
           p.dia,
           s.i as ordem_no_dia
      from plano p
      cross join lateral generate_series(1, p.vagas) s(i)
  ),
  linha as (
    select id from public.whatsapp_channel_instances
     where tenant_id = 'instituto-lorena' and active
     order by sort_order limit 1
  )
  insert into public.whatsapp_outreach_queue
    (tenant_id, instance_id, lead_id, phone, message, kind, source, scheduled_at)
  select 'instituto-lorena',
         (select id from linha),
         e.id,
         e.tel,
         case
           -- Até 15 dias a apresentação normal ainda é verdade.
           when e.created_at > now() - interval '15 days' then
             'Oi, ' || coalesce(nullif(split_part(btrim(e.patient_name), ' ', 1), ''), 'tudo bem') ||
             '! Aqui é a Sofia, do Instituto Lorena Visentainer 😊 Vi que você deixou seu contato ' ||
             'pra saber mais sobre o tratamento capilar. Me conta rapidinho o que você tem notado no seu cabelo?'
           -- Passou disso, fingir que o formulário é de agora é mentira, e a pessoa percebe.
           else
             'Oi, ' || coalesce(nullif(split_part(btrim(e.patient_name), ' ', 1), ''), 'tudo bem') ||
             '! Aqui é a Sofia, do Instituto Lorena Visentainer. Você deixou seu contato com a gente ' ||
             'há um tempo pra saber sobre tratamento capilar e acabamos não te respondendo, desculpa ' ||
             'a demora. Ainda faz sentido eu te explicar como funciona a avaliação?'
         end,
         'optin',
         'leadform_backlog',
         -- 08:00 do dia da onda, com ~21 min entre um nome e o outro (o dia inteiro cabe
         -- na janela 08–20) e um empurrão aleatório: a fila abrindo em ponto todo dia não
         -- parece gente.
         ((current_date + s.dia)::timestamp at time zone 'America/Sao_Paulo')
           + interval '8 hours'
           + ((s.ordem_no_dia - 1) * interval '21 minutes')
           + (floor(random() * 300) * interval '1 second')
    from elegivel e
    join slot s on s.pos = e.pos
   where (select id from linha) is not null
  on conflict do nothing;
  get diagnostics qtd_fila = row_count;

  raise notice 'ligar-formulario: % para consulta, % para contato, % duplicatas encerradas, % na fila de reabordagem',
    qtd_consulta, qtd_conversa, qtd_duplicata, qtd_fila;
end;
$backfill$;
