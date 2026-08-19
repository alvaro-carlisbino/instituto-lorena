-- ─────────────────────────────────────────────────────────────────────────────
-- Tirar o paciente do quadro de follow-up
--
-- A coluna "Encerrado" guarda quem fechou, e fechar quase sempre quer dizer que a
-- cirurgia aconteceu: em 19/08/2026 eram 28 cards, 24 deles com a cirurgia JÁ
-- FEITA. O atendimento acabou, não há contato para marcar, e o card fica no
-- quadro para sempre porque a coluna é consequência de ter venda, não de alguém
-- ter decidido que aquilo ainda importa.
--
-- Mesmo padrão das filas da Central de Vendas: tirar do quadro não apaga nem
-- fecha follow-up nenhum. O histórico continua inteiro na ficha do paciente, e o
-- carimbo diz quem tirou, quando e por quê. Marcar um novo contato traz o
-- paciente de volta sozinho, porque a linha nova nasce sem dispensa.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lead_followups
  add column if not exists dismissed_at     timestamptz,
  add column if not exists dismissed_by     uuid,
  add column if not exists dismissed_reason text;

comment on column public.lead_followups.dismissed_at is
  'Quando este follow-up saiu do quadro. Null = aparece no kanban. Não fecha o follow-up nem apaga histórico.';

create index if not exists lead_followups_dismissed_idx
  on public.lead_followups (lead_id) where dismissed_at is not null;

-- ATENÇÃO: o `with (security_invoker = true)` NÃO é decoração e NÃO sobrevive a um
-- `create or replace` que o omita. Sem ele a view roda como dono (postgres),
-- ignora o RLS de `leads` e `lead_followups`, e como `anon` tem SELECT aqui, nome
-- e telefone de todo paciente ficam legíveis com a chave pública. Aconteceu em
-- 18/ago/2026 na primeira tentativa da migração anterior desta view.
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
            f.dismissed_at
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
            when u.done_at is null and u.attempt_no <= 1 then 'contato_1'::text
            when u.done_at is null and u.attempt_no = 2 then 'contato_2'::text
            when u.done_at is null and u.attempt_no = 3 then 'contato_3'::text
            -- Da 4ª tentativa em aberto para a frente: saiu da sequência e segue vivo.
            when u.done_at is null then 'em_acompanhamento'::text
            when v.venda_id is not null then 'encerrado'::text
            when u.outcome = 'Fechou'::text then 'encerrado'::text
            else 'nao_convertido'::text
        end as coluna,
    greatest(current_date - u.scheduled_for, 0) as dias_atraso
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
  'Onde cada paciente está no follow-up: 1º/2º/3º contato, em acompanhamento, não convertido ou encerrado. Quem foi tirado do quadro (dismissed_at) não aparece.';
