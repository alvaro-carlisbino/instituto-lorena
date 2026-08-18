-- Etapa "Em acompanhamento" no follow-up, entre o 3º contato e o desfecho.
--
-- O funil parava em três tentativas: a coluna "3º contato" era "terceira tentativa
-- OU MAIS", então o paciente que segue em negociação na quarta, quinta e sexta
-- ligação ficava empilhado junto de quem acabou de chegar na terceira. Quem olha a
-- fila não conseguia separar "ainda está na sequência normal" de "já passou da
-- sequência e continua conversando".
--
-- A alternativa seria empurrar esse paciente para "não convertido", e é justamente
-- o que não se quer: ele não é perdido, tem proposta viva.
--
-- A regra é automática de propósito, igual ao resto desta view: a coluna é
-- consequência do contato REGISTRADO, nunca de alguém arrastar card. Registrar o
-- 3º contato e agendar o próximo já move o paciente para cá.
-- ATENÇÃO ao mexer nesta view de novo: o `with (security_invoker = true)` NÃO é
-- decoração e NÃO sobrevive a um `create or replace` que o omita. Sem ele a view
-- passa a rodar como dono (postgres), ignora o RLS de `leads` e `lead_followups`,
-- e como `anon` tem SELECT aqui, nome e telefone de todo paciente ficam legíveis
-- com a chave pública. Foi exatamente o que aconteceu na primeira tentativa desta
-- migração, em 18/ago/2026.
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
            f.created_at
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
         limit 1) v on true;

comment on view public.v_followup_kanban is
  'Onde cada paciente está no follow-up: 1º/2º/3º contato, em acompanhamento, não convertido ou encerrado.';
