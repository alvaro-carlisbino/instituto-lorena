-- O quadro de follow-up começava no "1º contato", e ninguém tinha feito contato nenhum.
--
-- Pedido da Aline em 08/set, com a planilha dela na mão: "eu queria que nesta coluna antes
-- do primeiro contato tivesse uma coluna com o nome ATENDIMENTOS, e encontrássemos uma
-- forma de eu colocar os atendimentos que foram indicados transplante".
--
-- O que ela faz na planilha AGOSTO//2026: cada linha é um ATENDIMENTO do médico — consulta
-- ou retorno — em que o transplante foi indicado. Origem (indicação, Instagram, já é
-- paciente), nome, cidade, telefone, e-mail, e a data com o médico. Depois disso é que
-- começa a ligação. A cor da linha diz se fechou.
--
-- No CRM esse primeiro estado não existia: quem saía da fila de pós-consulta com destino
-- cirúrgico já nascia em "1º contato · Primeira tentativa marcada", sem que tentativa
-- nenhuma tivesse acontecido. Por isso a Aline olhava a primeira coluna e não reconhecia a
-- fila dela ("está puxando paciente que não fui eu que coloquei"): a coluna misturava o
-- atendimento que ela registrou com qualquer card que ganhou data de contato.
--
-- Duas coisas nascem aqui:
--
--   1. A coluna `atendimento` no quadro. Não é filtro novo nem tabela nova — é a leitura
--      honesta do que já estava gravado: follow-up ABERTO com `attempt_no <= 1` quer dizer
--      exatamente "o atendimento aconteceu e ninguém ligou ainda". Conferido em 08/set:
--      dos 38 follow-ups abertos, os 12 com attempt_no = 1 são os únicos sem NENHUMA
--      tentativa concluída, e todos os demais têm. A régua não chuta.
--
--      Consequência: "1º contato" passa a significar UM CONTATO FEITO, e não "uma data
--      marcada". É o que a planilha sempre quis dizer.
--
--   2. `clinic_atendimentos`: o fato do atendimento, com os campos da planilha. Serve para
--      o que o follow-up não sabe responder — quantos atendimentos a semana teve e quantos
--      fecharam. O follow-up conta o TRABALHO (a ligação); o atendimento conta a SAFRA.

-- ---------------------------------------------------------------------------
-- 1. A coluna do quadro
-- ---------------------------------------------------------------------------
-- ATENÇÃO: o `with (security_invoker = true)` NÃO é decoração e NÃO sobrevive a um
-- `create or replace` que o omita. Sem ele a view roda como dono (postgres), ignora o RLS
-- de `leads` e `lead_followups`, e como `anon` tem SELECT aqui, nome e telefone de todo
-- paciente ficam legíveis com a chave pública. Aconteceu em 18/ago/2026.
create or replace view public.v_followup_kanban with (security_invoker = true) as
 with ultimo as (
         select distinct on (f.lead_id) f.id,
            f.tenant_id,
            f.lead_id,
            f.attempt_no,
            f.scheduled_for,
            f.done_at,
            f.outcome,
            f.channel,
            f.note,
            f.owner_id,
            f.created_at,
            f.dismissed_at,
            f.origin
           from lead_followups f
          order by f.lead_id, (f.done_at is null) desc, f.created_at desc
        )
 select u.id as followup_id,
    u.tenant_id,
    u.lead_id,
    u.attempt_no,
    u.scheduled_for,
    u.done_at,
    u.outcome,
    u.channel,
    u.note,
    u.owner_id,
    l.patient_name,
    l.phone,
    l.pipeline_id,
    l.stage_id,
    l.source,
    v.venda_id,
    v.venda_em,
    v.cirurgia_em,
        case
            -- Atendimento registrado, ninguém ligou ainda. Era isto que a tela chamava de
            -- "1º contato" e fazia a fila parecer de outra pessoa.
            when u.done_at is null and u.attempt_no <= 1 then 'atendimento'::text
            when u.done_at is null and u.attempt_no = 2 then 'contato_1'::text
            when u.done_at is null and u.attempt_no = 3 then 'contato_2'::text
            when u.done_at is null and u.attempt_no = 4 then 'contato_3'::text
            -- Da 5ª tentativa em aberto para a frente: saiu da sequência e segue vivo.
            when u.done_at is null then 'em_acompanhamento'::text
            when v.venda_id is not null then 'encerrado'::text
            when u.outcome = 'Fechou'::text then 'encerrado'::text
            else 'nao_convertido'::text
        end as coluna,
    greatest(current_date - u.scheduled_for, 0) as dias_atraso,
    u.origin
   from ultimo u
     join leads l on l.id = u.lead_id and l.deleted_at is null
     left join lateral ( select s.id as venda_id,
            s.sold_at as venda_em,
            s.scheduled_at as cirurgia_em
           from clinic_sales s
          where s.lead_id = u.lead_id and s.status <> 'cancelada'::text
          order by s.sold_at desc
         limit 1) v on true
  -- O filtro fica AQUI, e não dentro do `ultimo`: dispensar o follow-up mais
  -- recente tira o paciente do quadro. Filtrando lá dentro, o quadro voltaria a
  -- mostrar o mesmo paciente com uma tentativa antiga, que é pior que não tirar.
  where u.dismissed_at is null;

comment on view public.v_followup_kanban is
  'Onde cada paciente está no follow-up: atendimento (aconteceu e ninguém ligou ainda), 1º/2º/3º contato (contatos JÁ FEITOS), em acompanhamento, não convertido ou encerrado. Quem foi tirado do quadro (dismissed_at) não aparece. `origin` diz de qual fila o card é: clinica (paciente) ou landing_retomada (lead cru da landing).';

-- ---------------------------------------------------------------------------
-- 2. O atendimento como fato
-- ---------------------------------------------------------------------------
-- Os campos são os da planilha dela, um a um. `origem` é texto livre de propósito:
-- na planilha aparece "Indicação", "Indicação/Dale", "indicação da cocamar",
-- "instagram", "pesqui google", "Já é paciente" — normalizar isso agora seria inventar
-- uma taxonomia que ninguém pediu e perder o que ela escreve.
create table if not exists public.clinic_atendimentos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default 'instituto-lorena' references public.tenants (id),
  lead_id     text references public.leads (id) on delete set null,
  -- O item da fila de pós-consulta que gerou este atendimento. Único para que
  -- encaminhar duas vezes o mesmo paciente não vire dois atendimentos na safra.
  item_id     text unique,
  paciente    text not null,
  telefone    text,
  cidade      text,
  email       text,
  origem      text,
  tipo        text not null default 'consulta' check (tipo in ('consulta', 'retorno')),
  -- O que o médico indicou. É o que separa a safra da Aline (transplante) da da
  -- Ingrid (protocolo e spa) sem depender do funil onde o card foi parar.
  indicacao   text not null default 'cirurgia' check (indicacao in ('cirurgia', 'protocolo')),
  atendido_em date not null default (now() at time zone 'America/Sao_Paulo')::date,
  medico      text,
  observacao  text,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- De onde a linha veio. Não é metadado de curiosidade: o histórico só conhece a safra
-- INTEIRA a partir de 19/ago (quando a fila de pós-consulta começou). Antes disso, o
-- único atendimento que ficou gravado é o que VIROU VENDA — então uma semana feita só de
-- `venda` fecha em 100% por construção, e a tela precisa poder dizer isso em vez de
-- mostrar um número bonito e falso.
alter table public.clinic_atendimentos
  add column if not exists fonte text not null default 'manual'
  check (fonte in ('manual', 'pos_consulta', 'venda'));

create index if not exists clinic_atendimentos_tenant_idx
  on public.clinic_atendimentos (tenant_id, atendido_em desc);
create index if not exists clinic_atendimentos_lead_idx
  on public.clinic_atendimentos (lead_id);

alter table public.clinic_atendimentos enable row level security;
drop policy if exists "clinic_atendimentos tenant" on public.clinic_atendimentos;
create policy "clinic_atendimentos tenant" on public.clinic_atendimentos
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- A RLS já barra `anon` (a policy é `to authenticated`), mas o GRANT vem de fábrica no
-- Supabase e não declara nada. Aqui está gravado nome, telefone e e-mail de paciente:
-- em 18/ago uma view aberta a anon vazou nome e CPF com a chave pública. O revoke deixa a
-- intenção escrita, e não dependente de a policy nunca mudar.
revoke all on public.clinic_atendimentos from anon;

comment on table public.clinic_atendimentos is
  'Atendimento do médico (consulta ou retorno) em que transplante ou protocolo foi indicado. É a SAFRA: o denominador de "quantos fecharam na semana". O trabalho de ligar mora em lead_followups.';

-- ---------------------------------------------------------------------------
-- 3. A safra com o desfecho junto
-- ---------------------------------------------------------------------------
-- `fechou` é a venda daquele paciente a partir do dia do atendimento. Venda anterior ao
-- atendimento não conta: é de outra safra (o retorno de quem já tinha comprado).
create or replace view public.v_clinic_atendimentos with (security_invoker = true) as
select a.id,
       a.tenant_id,
       a.lead_id,
       a.paciente,
       a.telefone,
       a.cidade,
       a.email,
       a.origem,
       a.tipo,
       a.indicacao,
       a.atendido_em,
       a.medico,
       a.observacao,
       a.created_at,
       v.venda_id,
       v.venda_em,
       v.valor_cents,
       (v.venda_id is not null) as fechou,
       f.coluna,
       f.scheduled_for as proximo_contato,
       -- No fim da lista de propósito: `create or replace view` recusa mudar ordem ou
       -- nome do que já existe.
       a.fonte
  from public.clinic_atendimentos a
  left join lateral (
        select s.id as venda_id, s.sold_at as venda_em, s.value_cents as valor_cents
          from public.clinic_sales s
         where s.lead_id = a.lead_id
           and s.status <> 'cancelada'
           and s.kind = a.indicacao
           and s.sold_at >= a.atendido_em
         order by s.sold_at
         limit 1
       ) v on true
  left join public.v_followup_kanban f on f.lead_id = a.lead_id;

revoke all on public.v_clinic_atendimentos from anon;

comment on view public.v_clinic_atendimentos is
  'A safra de atendimentos com o desfecho colado: fechou ou não, e em que coluna do follow-up o paciente está hoje. É daqui que sai a porcentagem de fechamento da semana.';

-- ---------------------------------------------------------------------------
-- 4. O que já está gravado vira safra
-- ---------------------------------------------------------------------------
-- Sem isto a tela nasce vazia e a Aline teria de redigitar agosto inteiro.

-- 4a. Quem saiu da fila de pós-consulta com destino. `consulta_em` é a data do
--     atendimento; `resolved_at` é quando ela decidiu, e não serve como safra.
insert into public.clinic_atendimentos
  (item_id, tenant_id, lead_id, paciente, telefone, indicacao, atendido_em, observacao, created_by, created_at, fonte)
select r.item_id,
       r.tenant_id,
       r.lead_id,
       r.paciente,
       l.phone,
       r.outcome,
       coalesce(r.consulta_em, r.resolved_at::date),
       r.reason,
       r.resolved_by,
       r.resolved_at,
       'pos_consulta'
  from public.post_consultation_resolutions r
  left join public.leads l on l.id = r.lead_id
 where r.outcome in ('cirurgia', 'protocolo')
on conflict (item_id) do nothing;

-- 4b. A venda já diz em que consulta ela nasceu (`consultation_at`), e essa consulta é um
--     atendimento que aconteceu. Sem esta parte a taxa da semana sairia com o numerador
--     cheio e o denominador furado — quem fechou não estaria na safra.
--
--     Só venda COM lead: o desfecho da safra é lido pelo lead (é assim que
--     `v_clinic_atendimentos` acha a venda), então venda solta entraria no denominador
--     sem poder aparecer no numerador — baixaria a taxa por construção.
insert into public.clinic_atendimentos
  (tenant_id, lead_id, paciente, telefone, cidade, origem, tipo, indicacao, atendido_em, medico, created_at, fonte)
select distinct on (s.lead_id, s.consultation_at, s.kind)
       s.tenant_id,
       s.lead_id,
       coalesce(s.patient_name, '—'),
       s.phone,
       s.city,
       s.origin,
       case when s.consultation_type ilike '%retorno%' then 'retorno' else 'consulta' end,
       s.kind,
       s.consultation_at,
       coalesce(s.attending_doctor, s.seller_doctor),
       s.created_at,
       'venda'
  from public.clinic_sales s
 where s.consultation_at is not null
   and s.lead_id is not null
   and s.status <> 'cancelada'
   and s.kind in ('cirurgia', 'protocolo')
   and not exists (
        select 1 from public.clinic_atendimentos a
         where a.lead_id = s.lead_id
           and a.atendido_em = s.consultation_at
           and a.indicacao = s.kind
       )
 order by s.lead_id, s.consultation_at, s.kind, s.sold_at;

-- 4c. Corretivo para o banco onde 4a/4b já rodaram antes de `fonte` existir: a linha com
--     `item_id` veio da fila; a que casa com uma venda no mesmo dia veio da venda.
update public.clinic_atendimentos a
   set fonte = 'pos_consulta'
 where a.item_id is not null and a.fonte = 'manual';

update public.clinic_atendimentos a
   set fonte = 'venda'
 where a.item_id is null
   and a.fonte = 'manual'
   and exists (
        select 1 from public.clinic_sales s
         where s.lead_id = a.lead_id
           and s.consultation_at = a.atendido_em
           and s.kind = a.indicacao
           and s.status <> 'cancelada'
       );
