-- A tarefa da landing caía na fila de PACIENTE da clínica.
--
-- Desde 31/ago o cron `crm-landing-retomada` abre tarefa em `lead_followups` para o lead
-- da landing /consulta que parou de responder. Acontece que `lead_followups` é a mesma
-- tabela que sustenta o quadro de follow-up da Central de Vendas — a fila da Aline, feita
-- de quem CONSULTOU e tem proposta viva. Resultado, medido em 04/set: 6 cards abertos no
-- quadro dela eram lead cru de anúncio, sem consulta, sem agendamento na Shosp, sem
-- pré-reserva e sem venda, parados na etapa "contato" do funil de triagem.
--
-- A tela não tinha como separar: a tabela não dizia QUEM abriu a tarefa. Por isso a coluna
-- nasce aqui, e não como mais um filtro adivinhado no front — [[crm_followup_quadro_come_paciente]]
-- é a lápide do filtro que adivinha (lista fixa de funis que comeu quatro pacientes com
-- proposta de R$ 5.800 anotada).
--
-- O que a Aline vinha fazendo enquanto isso: DISPENSAR o card para limpar a tela. Nove
-- leads da landing estão dispensados hoje — e o cron lê dispensa como ordem humana de
-- encerrar, então esses nove nunca receberam a retomada automática da Sofia. Ou seja: a
-- fila errada não só atrapalhava a fila dela, matava a rotina do outro lado.
alter table public.lead_followups
  add column if not exists origin text not null default 'clinica';

comment on column public.lead_followups.origin is
  'De quem é a fila: clinica (a Aline/Ingrid marcaram contato com paciente) ou landing_retomada (o cron crm-landing-retomada abriu tarefa para lead cru da landing /consulta). A tela usa isto para separar as duas filas sem esconder card de ninguém.';

-- Backfill pelas duas notas que só a rotina escreve — a de abertura e a de fechamento
-- automático. Tarefa que a Aline tenha aberto na mão para um lead da landing NÃO bate
-- nenhum dos dois padrões e continua sendo dela, que é o certo: quem marcou contato foi
-- gente.
update public.lead_followups f
set origin = 'landing_retomada'
from public.leads l
where l.id = f.lead_id
  and f.origin = 'clinica'
  and l.custom_fields ? 'origem_landing'
  and (
    f.note like 'Lead da landing /consulta, tentativa%'
    or f.note like '%tentativa: retomada automática enviada pela Sofia%'
    or f.note like '%venceu sem contato (envio recusado)%'
  );

-- ATENÇÃO: o `with (security_invoker = true)` NÃO é decoração e NÃO sobrevive a um
-- `create or replace` que o omita. Sem ele a view roda como dono (postgres), ignora o RLS
-- de `leads` e `lead_followups`, e como `anon` tem SELECT aqui, nome e telefone de todo
-- paciente ficam legíveis com a chave pública. Aconteceu em 18/ago/2026.
--
-- `origin` entra no FIM da lista de colunas de propósito: `create or replace view` recusa
-- mudança de ordem ou de nome do que já existe.
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
            when u.done_at is null and u.attempt_no <= 1 then 'contato_1'::text
            when u.done_at is null and u.attempt_no = 2 then 'contato_2'::text
            when u.done_at is null and u.attempt_no = 3 then 'contato_3'::text
            -- Da 4ª tentativa em aberto para a frente: saiu da sequência e segue vivo.
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
  'Onde cada paciente está no follow-up: 1º/2º/3º contato, em acompanhamento, não convertido ou encerrado. Quem foi tirado do quadro (dismissed_at) não aparece. `origin` diz de qual fila o card é: clinica (paciente) ou landing_retomada (lead cru da landing).';
