-- Dois pedidos da Aline (comercial do transplante), 08/09 e 11/09/2026.
--
-- 1. "ao lado do primeiro contato, um botão (observação), para eu registrar porque não
--    fechou ainda, colocar a objeção".
--
--    A nota que já existia no quadro de follow-up é da TENTATIVA: registrar o contato
--    grava a nota na linha que fecha, e a linha nova (a do próximo contato) nasce sem
--    nota. Resultado: o card que acabou de andar para "1º contato" chega vazio, e o
--    motivo de o paciente não ter fechado some da tela justo quando ela vai ligar de
--    novo. A objeção é do PACIENTE, não da ligação, então mora fora de `lead_followups`.
--
--    Guarda histórico em vez de um campo que se sobrescreve: a objeção muda ao longo da
--    negociação ("preço" vira "esperando o 13º"), e era assim na planilha dela, o
--    parêntese do nome ia sendo reescrito e o anterior se perdia. O card mostra a última.
--    Texto livre, sem lista de motivos: mesma decisão de `clinic_atendimentos.origem`,
--    normalizar agora seria inventar uma taxonomia que ninguém pediu.
--
-- 2. "um quadradinho para checar escrito (contrato enviado) lá no registro de venda".
--
--    Em 14/09 a venda ganhou `contract_signed`, mas entre vender e assinar há o envio, e
--    é nele que ela cobra o paciente. Assinado implica enviado: o gatilho garante, para
--    nenhuma tela mostrar "assinado" e "não enviado" na mesma linha.

begin;

-- ---------------------------------------------------------------------------
-- 1. Objeção do follow-up
-- ---------------------------------------------------------------------------
create table if not exists public.lead_followup_observacoes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default 'instituto-lorena' references public.tenants (id),
  lead_id     text not null references public.leads (id) on delete cascade,
  texto       text not null check (length(btrim(texto)) > 0),
  -- Login da recepção é compartilhado: diz de qual conta veio, não de qual pessoa.
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists lead_followup_observacoes_lead_idx
  on public.lead_followup_observacoes (lead_id, created_at desc);

alter table public.lead_followup_observacoes enable row level security;
drop policy if exists "lead_followup_observacoes tenant" on public.lead_followup_observacoes;
create policy "lead_followup_observacoes tenant" on public.lead_followup_observacoes
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- A policy já barra anon; o revoke deixa escrito (texto de negociação de paciente).
revoke all on public.lead_followup_observacoes from anon;

comment on table public.lead_followup_observacoes is
  'Por que o paciente ainda não fechou (a objeção), escrito pela comercial no quadro de follow-up. É do paciente e atravessa as tentativas; a nota da tentativa continua em lead_followups.note.';

-- A última objeção vai na própria view do quadro, e não numa segunda consulta da tela:
-- a lista inteira passaria do teto de 1.000 linhas do PostgREST com o tempo.
-- Colunas novas no FIM: `create or replace view` recusa mudar ordem ou nome do que já
-- existe, e v_clinic_atendimentos depende desta.
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
            when u.done_at is null and u.attempt_no <= 1 then 'atendimento'::text
            when u.done_at is null and u.attempt_no = 2 then 'contato_1'::text
            when u.done_at is null and u.attempt_no = 3 then 'contato_2'::text
            when u.done_at is null and u.attempt_no = 4 then 'contato_3'::text
            when u.done_at is null then 'em_acompanhamento'::text
            when v.venda_id is not null then 'encerrado'::text
            when u.outcome = 'Fechou'::text then 'encerrado'::text
            else 'nao_convertido'::text
        end as coluna,
    greatest(current_date - u.scheduled_for, 0) as dias_atraso,
    u.origin,
    o.texto as objecao,
    o.created_at as objecao_em
   from ultimo u
     join leads l on l.id = u.lead_id and l.deleted_at is null
     left join lateral ( select s.id as venda_id,
            s.sold_at as venda_em,
            s.scheduled_at as cirurgia_em
           from clinic_sales s
          where s.lead_id = u.lead_id and s.status <> 'cancelada'::text
          order by s.sold_at desc
         limit 1) v on true
     left join lateral ( select ob.texto, ob.created_at
           from lead_followup_observacoes ob
          where ob.lead_id = u.lead_id
          order by ob.created_at desc
         limit 1) o on true
  where u.dismissed_at is null;

comment on view public.v_followup_kanban is
  'Onde cada paciente está no follow-up: atendimento (aconteceu e ninguém ligou ainda), 1º/2º/3º contato (contatos JÁ FEITOS), em acompanhamento, não convertido ou encerrado. Quem foi tirado do quadro (dismissed_at) não aparece. `origin` diz de qual fila o card é: clinica (paciente) ou landing_retomada (lead cru da landing). `objecao` é a última observação de por que ainda não fechou.';

-- ---------------------------------------------------------------------------
-- 2. Contrato enviado
-- ---------------------------------------------------------------------------
alter table public.clinic_sales
  add column if not exists contract_sent boolean not null default false;

comment on column public.clinic_sales.contract_sent is
  'O contrato já foi enviado ao paciente. Assinado implica enviado (gatilho clinic_sales_contrato_assinado_foi_enviado).';

create or replace function public.clinic_sales_contrato_assinado_foi_enviado()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.contract_signed then
    new.contract_sent := true;
  end if;
  return new;
end $function$;

revoke all on function public.clinic_sales_contrato_assinado_foi_enviado() from public, anon, authenticated;

drop trigger if exists clinic_sales_contrato_assinado_foi_enviado on public.clinic_sales;
create trigger clinic_sales_contrato_assinado_foi_enviado
  before insert or update on public.clinic_sales
  for each row execute function public.clinic_sales_contrato_assinado_foi_enviado();

-- O update passa por `clinic_sales_after_write`, que escreve em `leads` e bate em
-- `enforce_role_write()`. A própria guarda libera service_role.
set local request.jwt.claims = '{"role":"service_role"}';

update public.clinic_sales
   set contract_sent = true
 where contract_signed
   and not contract_sent;

commit;
