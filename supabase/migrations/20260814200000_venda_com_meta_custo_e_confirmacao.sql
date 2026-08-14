-- A venda da clínica vista pela gestão, e a fila de cirurgia vista pela recepção.
--
-- Sai da conversa de 14/08/2026 com a gerente. São cinco perguntas que hoje não
-- têm resposta no sistema:
--
--   1. "A entrada foi paga para a clínica ou para o anestesista?" — a venda sabe
--      QUANTO entrou e QUANDO, nunca PARA QUEM. Nas cirurgias em que o
--      anestesista recebe direto, o dinheiro nunca passa pela conta da clínica e
--      o financeiro procura um Pix que não existe.
--   2. "Esta cirurgia está confirmada?" — a fila mostrava documento pendente,
--      seis caixinhas por paciente. Quem atende não preenche seis caixinhas; ela
--      quer dizer confirmada, não confirmada ou remanejar, e seguir.
--   3. "Quanto sobrou desta venda?" — valor vendido existe, custo não. Material,
--      repasse do médico e imposto ficam em planilha, quando ficam.
--   4. "Estamos batendo a meta?" — não existe meta em lugar nenhum do CRM.
--   5. "Quantas datas de cirurgia estão sem paciente?" — a agenda sabe o que está
--      marcado; o que está ABERTO e vazio não é dado de lugar nenhum, é decisão
--      da clínica. Por isso vira tabela, não conta derivada.
--
-- O checklist pré-operatório (surgery_checklist_items) continua existindo e
-- continua nascendo com o agendamento: ele sai da tela, não do banco. Se a
-- confirmação simples se mostrar rasa demais, o dado dos meses anteriores está lá.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A venda: para quem foi a entrada, se está confirmada, e o que ela custou
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clinic_sales
  -- 'clinica' | 'anestesista'. Null enquanto ninguém disse — não inventa que foi
  -- para a clínica só porque é o caso mais comum.
  add column if not exists deposit_payee text,
  add column if not exists confirmation_status text not null default 'nao_confirmada',
  add column if not exists confirmation_at timestamptz,
  add column if not exists confirmation_note text,
  add column if not exists cost_materials_cents bigint not null default 0,
  add column if not exists cost_doctor_cents bigint not null default 0,
  add column if not exists tax_cents bigint not null default 0,
  add column if not exists cost_other_cents bigint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinic_sales_deposit_payee_ck') then
    alter table public.clinic_sales add constraint clinic_sales_deposit_payee_ck
      check (deposit_payee is null or deposit_payee in ('clinica', 'anestesista'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinic_sales_confirmation_ck') then
    alter table public.clinic_sales add constraint clinic_sales_confirmation_ck
      check (confirmation_status in ('confirmada', 'nao_confirmada', 'remanejar'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinic_sales_custos_ck') then
    alter table public.clinic_sales add constraint clinic_sales_custos_ck
      check (
        cost_materials_cents >= 0 and cost_doctor_cents >= 0
        and tax_cents >= 0 and cost_other_cents >= 0
      );
  end if;
end $$;

-- Lucro é coluna gerada, não conta na tela: o mesmo número é lido pelo painel da
-- gestão, pelo relatório e por quem abrir a tabela no SQL. Três lugares somando
-- por conta própria é como nasce divergência de fechamento.
alter table public.clinic_sales
  add column if not exists profit_cents bigint
  generated always as (
    value_cents - cost_materials_cents - cost_doctor_cents - tax_cents - cost_other_cents
  ) stored;

comment on column public.clinic_sales.deposit_payee is
  'Para quem a entrada foi paga: clinica ou anestesista. Null = ninguém informou.';
comment on column public.clinic_sales.confirmation_status is
  'Confirmação da cirurgia com o paciente: confirmada, nao_confirmada, remanejar.';
comment on column public.clinic_sales.profit_cents is
  'Valor vendido menos material, repasse médico, imposto e outros. Gerada.';

create index if not exists clinic_sales_confirmacao_idx
  on public.clinic_sales (tenant_id, confirmation_status)
  where kind = 'cirurgia' and status in ('vendida', 'agendada');

-- Cirurgia que já foi remarcada volta para "não confirmada": data nova não herda
-- o "sim" que o paciente deu para a data velha.
create or replace function public.clinic_sales_reset_confirmacao()
returns trigger language plpgsql as $$
begin
  if new.scheduled_at is distinct from old.scheduled_at
     and new.confirmation_status = old.confirmation_status
     and old.confirmation_status = 'confirmada' then
    new.confirmation_status := 'nao_confirmada';
    new.confirmation_at := null;
  end if;
  return new;
end $$;

drop trigger if exists clinic_sales_confirmacao_segue_a_data on public.clinic_sales;
create trigger clinic_sales_confirmacao_segue_a_data
  before update of scheduled_at on public.clinic_sales
  for each row execute function public.clinic_sales_reset_confirmacao();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Meta de vendas do mês
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.clinic_sales_targets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default 'instituto-lorena' references public.tenants (id),
  -- Sempre o dia 1: o mês é a unidade, e date evita o "2026-8" contra "2026-08".
  month        date not null,
  kind         text not null check (kind in ('cirurgia', 'protocolo')),
  -- Null = a clínica inteira. Preenchido = a meta daquela consultora.
  seller_name  text,
  target_cents bigint not null default 0 check (target_cents >= 0),
  target_count int not null default 0 check (target_count >= 0),
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint clinic_sales_targets_dia_1 check (extract(day from month) = 1)
);

-- coalesce no índice porque null nunca colide com null: sem isso a clínica podia
-- ter duas metas gerais do mesmo mês, e o painel escolheria uma no sorteio.
create unique index if not exists clinic_sales_targets_unq
  on public.clinic_sales_targets (tenant_id, month, kind, coalesce(seller_name, '*'));

drop trigger if exists clinic_sales_targets_touch on public.clinic_sales_targets;
create trigger clinic_sales_targets_touch before update on public.clinic_sales_targets
  for each row execute function public.touch_updated_at();

alter table public.clinic_sales_targets enable row level security;
drop policy if exists "clinic_sales_targets tenant" on public.clinic_sales_targets;
create policy "clinic_sales_targets tenant" on public.clinic_sales_targets
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on table public.clinic_sales_targets is
  'Meta de faturamento e de quantidade por mês, por tipo de venda e (opcional) por consultora.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Datas de cirurgia abertas (as que ainda não têm paciente)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.surgery_open_dates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default 'instituto-lorena' references public.tenants (id),
  dia        date not null,
  -- Quantas cirurgias cabem no dia. É o que transforma "dia aberto" em número:
  -- dia com 2 vagas e 1 marcada ainda tem 1 vaga sobrando.
  slots      int not null default 1 check (slots between 1 and 12),
  doctor     text,
  room       text,
  note       text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dia)
);

create index if not exists surgery_open_dates_dia_idx on public.surgery_open_dates (tenant_id, dia);

drop trigger if exists surgery_open_dates_touch on public.surgery_open_dates;
create trigger surgery_open_dates_touch before update on public.surgery_open_dates
  for each row execute function public.touch_updated_at();

alter table public.surgery_open_dates enable row level security;
drop policy if exists "surgery_open_dates tenant" on public.surgery_open_dates;
create policy "surgery_open_dates tenant" on public.surgery_open_dates
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on table public.surgery_open_dates is
  'Datas que a clínica abriu para operar. Vaga não ocupada por venda é data sem paciente.';

-- Quantas vagas sobraram em cada data aberta, já descontando o que está marcado.
-- Conta a venda pela data local (America/Sao_Paulo): scheduled_at é timestamptz e
-- comparar direto com date jogaria a cirurgia das 7h da manhã para o dia anterior.
create or replace view public.v_surgery_open_dates with (security_invoker = true) as
select
  d.id,
  d.tenant_id,
  d.dia,
  d.slots,
  d.doctor,
  d.room,
  d.note,
  coalesce(m.marcadas, 0) as marcadas,
  greatest(d.slots - coalesce(m.marcadas, 0), 0) as vagas_livres
from public.surgery_open_dates d
left join lateral (
  select count(*) as marcadas
  from public.clinic_sales s
  where s.tenant_id = d.tenant_id
    and s.kind = 'cirurgia'
    and s.status <> 'cancelada'
    and s.scheduled_at is not null
    and (s.scheduled_at at time zone 'America/Sao_Paulo')::date = d.dia
) m on true;

comment on view public.v_surgery_open_dates is
  'Datas abertas com as vagas que sobraram. vagas_livres > 0 = data sem paciente.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Follow-up em kanban (1º / 2º / 3º contato / não convertido / encerrado)
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma linha por paciente, não por tentativa: a coluna do kanban é onde o PACIENTE
 * está, e ele está num lugar só.
 *
 * O follow-up em aberto manda. Só quando não existe nenhum aberto é que o último
 * encerrado decide entre "não convertido" e "encerrado" — e quem fechou venda cai
 * em encerrado mesmo que a última tentativa tenha sido registrada como "sem
 * resposta", porque o fato de ter comprado vale mais que o rótulo da ligação.
 */
create or replace view public.v_followup_kanban with (security_invoker = true) as
with ultimo as (
  select distinct on (f.lead_id)
    f.id, f.tenant_id, f.lead_id, f.attempt_no, f.scheduled_for, f.done_at,
    f.outcome, f.channel, f.note, f.owner_id, f.created_at
  from public.lead_followups f
  order by f.lead_id, (f.done_at is null) desc, f.created_at desc
)
select
  u.id as followup_id,
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
    when u.done_at is null and u.attempt_no <= 1 then 'contato_1'
    when u.done_at is null and u.attempt_no = 2  then 'contato_2'
    when u.done_at is null                       then 'contato_3'
    when v.venda_id is not null                  then 'encerrado'
    when u.outcome = 'Fechou'                    then 'encerrado'
    else 'nao_convertido'
  end as coluna,
  greatest(current_date - u.scheduled_for, 0) as dias_atraso
from ultimo u
join public.leads l on l.id = u.lead_id and l.deleted_at is null
left join lateral (
  select s.id as venda_id, s.sold_at as venda_em, s.scheduled_at as cirurgia_em
  from public.clinic_sales s
  where s.lead_id = u.lead_id and s.status <> 'cancelada'
  order by s.sold_at desc
  limit 1
) v on true;

comment on view public.v_followup_kanban is
  'Onde cada paciente está no follow-up: 1º/2º/3º contato, não convertido ou encerrado.';
