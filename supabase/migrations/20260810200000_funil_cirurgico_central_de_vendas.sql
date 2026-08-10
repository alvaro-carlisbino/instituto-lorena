-- Central de Vendas da clínica: o que hoje vive em duas planilhas de Excel.
--
-- Origem do desenho: "FOLLOW-UP TRANSPLANTE - ALINE.xlsx" e "FOLLOW-UP SPA - INGRID.xlsx".
-- Os nomes de etapa e de campo saíram do vocabulário que elas já usam (FECHADO,
-- AGENDADO, NÃO FECHOU, "definindo" na data do procedimento), de propósito: trocar
-- de ferramenta já é atrito suficiente sem trocar também as palavras.
--
-- Dois achados da planilha que viraram regra aqui:
--   1. As colunas de 1º/2º/3º/4º contato da Aline pararam de ser preenchidas em 2022.
--      O follow-up não está "sem periodicidade", ele não está registrado. Por isso
--      lead_followups tem `scheduled_for` NOT NULL: não existe follow-up sem data.
--   2. Existe venda de 31/07/2026 com data de procedimento em 04/01/2026, três meses
--      no passado. Digitação livre em célula não tem como reclamar; aqui reclama.
--
-- Os dois funis reaproveitam pipelines que já existiam VAZIOS no banco
-- (pipeline-processo-cirurgico e pipeline-protocolos, zero leads cada). Ninguém
-- perde card, e o funil da Dandara (pipeline-clinica, 2.054 leads) não é tocado.

-- O trigger enforce_role_write() barra escrita em pipelines, pipeline_stages e
-- automation_rules para quem não tem can_edit_boards, e migration não tem sessão
-- de usuário. Se apresenta como service_role, o mesmo caminho que as edges usam.
-- LOCAL: morre no fim da transação, não vaza para a conexão do pool.
set local request.jwt.claims = '{"role":"service_role"}';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Os dois funis
-- ─────────────────────────────────────────────────────────────────────────────

update public.pipelines set name = 'CIRÚRGICO (TRANSPLANTE)' where id = 'pipeline-processo-cirurgico';
update public.pipelines set name = 'PROTOCOLOS E SPA' where id = 'pipeline-protocolos';

-- Reaponta as automações que citavam as etapas antigas ANTES de apagá-las, senão
-- viram regra órfã que nunca dispara (e ninguém percebe, porque regra que não
-- dispara não dá erro).
update public.automation_rules
set trigger_config = jsonb_build_object('stageId', 'cir-agendada'),
    action_config = jsonb_build_object(
      'title', 'Checklist de exames e documentacao pre-cirurgia',
      'taskType', 'follow_up',
      'hoursOffset', 24
    )
where id = 'auto-cx-pre';

update public.automation_rules
set trigger_config = jsonb_build_object('stageId', 'cir-realizada'),
    action_config = jsonb_build_object(
      'title', 'Primeiro contato pos-cirurgia (dor, curativo, duvidas)',
      'taskType', 'follow_up',
      'hoursOffset', 4
    )
where id = 'auto-cx-pos';

-- Segurança: só apaga etapa que não tem lead em cima. Se algum dia alguém rodar
-- isto num banco onde os funis não estão mais vazios, a migration falha em vez de
-- deixar lead apontando para etapa inexistente (card some da tela).
do $$
declare orfaos int;
begin
  select count(*) into orfaos
  from public.leads
  where deleted_at is null
    and pipeline_id in ('pipeline-processo-cirurgico', 'pipeline-protocolos');
  if orfaos > 0 then
    raise exception 'Ha % lead(s) nos funis que seriam remodelados. Migre-os antes.', orfaos;
  end if;
end $$;

delete from public.pipeline_stages
where pipeline_id in ('pipeline-processo-cirurgico', 'pipeline-protocolos');

insert into public.pipeline_stages (id, pipeline_id, name, position) values
  ('cir-consulta-realizada', 'pipeline-processo-cirurgico', 'Consulta realizada',      0),
  ('cir-follow-up',          'pipeline-processo-cirurgico', 'Em follow-up',            1),
  ('cir-vendido-sem-data',   'pipeline-processo-cirurgico', 'Vendido sem data',        2),
  ('cir-agendada',           'pipeline-processo-cirurgico', 'Cirurgia agendada',       3),
  ('cir-proximo-mes',        'pipeline-processo-cirurgico', 'Cirurgia do próximo mês', 4),
  ('cir-realizada',          'pipeline-processo-cirurgico', 'Realizada',               5),
  ('cir-nao-fechou',         'pipeline-processo-cirurgico', 'Não fechou',              6),
  ('cir-cancelou',           'pipeline-processo-cirurgico', 'Cancelou',                7),
  ('pro-consulta-realizada', 'pipeline-protocolos', 'Consulta realizada',      0),
  ('pro-proposta',           'pipeline-protocolos', 'Proposta enviada',        1),
  ('pro-follow-up',          'pipeline-protocolos', 'Em follow-up',            2),
  ('pro-agendado',           'pipeline-protocolos', 'Agendado',                3),
  ('pro-fechado',            'pipeline-protocolos', 'Fechado',                 4),
  ('pro-em-sessoes',         'pipeline-protocolos', 'Em protocolo (sessões)',  5),
  ('pro-nao-fechou',         'pipeline-protocolos', 'Não fechou',              6);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Vendas da clínica (a aba VENDAS das duas planilhas)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table if not exists public.clinic_sales (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null default 'instituto-lorena' references public.tenants (id),
  kind                text not null check (kind in ('cirurgia', 'protocolo')),

  lead_id             text references public.leads (id) on delete set null,
  shosp_prontuario    text,
  patient_name        text not null,
  phone               text,
  city                text,
  -- "Indicação", "Indicação/instagram", "Já é paciente", "indicação da cocamar".
  -- Texto livre de propósito: a planilha usa frase, e o tráfego pago preenche
  -- sozinho pelo attribution do lead quando ele veio de anúncio.
  origin              text,

  sold_at             date not null,
  consultation_at     date,
  -- Ingrid: CONSULTA CLÍNICA / RETORNO 1 MÊS / RETORNO CLÍNICO
  consultation_type   text,
  procedure_label     text not null,

  -- Três papéis distintos. A planilha da Aline já separa MÉDICO de MÉDICO QUE
  -- ATENDEU e eles divergem em várias linhas, então guardar um campo só perderia
  -- informação que ela mantém na mão hoje.
  seller_doctor       text,
  attending_doctor    text,
  performing_doctor   text,
  anesthetist         text,

  value_cents         bigint not null default 0 check (value_cents >= 0),
  deposit_cents       bigint check (deposit_cents is null or deposit_cents >= 0),
  deposit_at          date,
  payment_method      text,
  installments        int check (installments is null or installments between 1 and 24),
  invoice_issued      boolean not null default false,

  scheduled_at        timestamptz,
  -- O "definindo" da coluna DATA DO PROC.: vendeu e não marcou. Precisa ser
  -- estado explícito, não célula vazia, senão some no meio da lista.
  schedule_pending    boolean not null default false,
  duration_minutes    int,
  room                text,
  hotel_needed        boolean not null default false,

  contract_url        text,
  note                text,

  status              text not null default 'vendida'
                      check (status in ('vendida', 'agendada', 'realizada', 'cancelada')),
  canceled_at         date,
  cancel_reason       text,
  -- A planilha de Cancelamentos usa "Em avaliação" enquanto ninguém decidiu.
  refund_status       text,
  cancel_note         text,

  surgery_account_id  uuid references public.surgery_accounts (id) on delete set null,
  -- Vínculo com o espelho do sistema do centro cirúrgico (srg_surgeries.id é o id
  -- do MySQL). Sem FK: o espelho é recarregado inteiro a cada sync.
  srg_surgery_id      int,
  gcal_event_id       text,

  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Venda agendada precisa de data; venda sem data precisa estar marcada como tal.
  constraint clinic_sales_data_ou_pendente check (
    scheduled_at is not null or schedule_pending or status in ('vendida', 'cancelada')
  )
);

create index if not exists clinic_sales_tenant_kind_idx on public.clinic_sales (tenant_id, kind, sold_at desc);
create index if not exists clinic_sales_lead_idx on public.clinic_sales (lead_id);
create index if not exists clinic_sales_scheduled_idx on public.clinic_sales (scheduled_at) where status in ('vendida', 'agendada');

drop trigger if exists clinic_sales_touch on public.clinic_sales;
create trigger clinic_sales_touch before update on public.clinic_sales
  for each row execute function public.touch_updated_at();

alter table public.clinic_sales enable row level security;
drop policy if exists "clinic_sales tenant read" on public.clinic_sales;
drop policy if exists "clinic_sales tenant insert" on public.clinic_sales;
drop policy if exists "clinic_sales tenant update" on public.clinic_sales;
drop policy if exists "clinic_sales tenant delete" on public.clinic_sales;
create policy "clinic_sales tenant read" on public.clinic_sales
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "clinic_sales tenant insert" on public.clinic_sales
  for insert to authenticated with check (tenant_id = public.current_tenant_id());
create policy "clinic_sales tenant update" on public.clinic_sales
  for update to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy "clinic_sales tenant delete" on public.clinic_sales
  for delete to authenticated using (tenant_id = public.current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Follow-up com data (as colunas 1º/2º/3º contato, agora com dono e prazo)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.lead_followups (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'instituto-lorena' references public.tenants (id),
  lead_id       text not null references public.leads (id) on delete cascade,
  attempt_no    int not null default 1,
  scheduled_for date not null,
  done_at       timestamptz,
  channel       text,
  -- "sem resposta", "vai pensar", "pediu para chamar depois", "fechou", "não fechou"
  outcome       text,
  note          text,
  owner_id      text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Um follow-up ABERTO por paciente. Dois em aberto é a mesma bagunça da planilha:
-- ninguém sabe qual é o próximo contato de verdade.
create unique index if not exists lead_followups_um_aberto_idx
  on public.lead_followups (lead_id) where done_at is null;
create index if not exists lead_followups_agenda_idx
  on public.lead_followups (tenant_id, scheduled_for) where done_at is null;
create index if not exists lead_followups_lead_idx on public.lead_followups (lead_id, created_at desc);

drop trigger if exists lead_followups_touch on public.lead_followups;
create trigger lead_followups_touch before update on public.lead_followups
  for each row execute function public.touch_updated_at();

alter table public.lead_followups enable row level security;
drop policy if exists "lead_followups tenant read" on public.lead_followups;
drop policy if exists "lead_followups tenant write" on public.lead_followups;
create policy "lead_followups tenant read" on public.lead_followups
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "lead_followups tenant write" on public.lead_followups
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Documentação pré-cirúrgica e lembretes automáticos
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.surgery_checklist_catalog (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default 'instituto-lorena' references public.tenants (id),
  item       text not null,
  required   boolean not null default true,
  position   int not null default 0,
  active     boolean not null default true,
  unique (tenant_id, item)
);

-- Lista provisória: precisa ser conferida com a Aline, é ela quem sabe o exame
-- que o anestesista exige. A tela deixa editar sem passar por migration.
insert into public.surgery_checklist_catalog (tenant_id, item, required, position) values
  ('instituto-lorena', 'Exames pré-operatórios', true, 0),
  ('instituto-lorena', 'Avaliação cardiológica / risco cirúrgico', true, 1),
  ('instituto-lorena', 'Contrato assinado', true, 2),
  ('instituto-lorena', 'Termo de consentimento assinado', true, 3),
  ('instituto-lorena', 'Pagamento da entrada', true, 4),
  ('instituto-lorena', 'Foto pré-operatória', false, 5),
  ('instituto-lorena', 'Reserva de hotel (paciente de fora)', false, 6)
on conflict (tenant_id, item) do nothing;

create table if not exists public.surgery_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default 'instituto-lorena' references public.tenants (id),
  sale_id     uuid not null references public.clinic_sales (id) on delete cascade,
  item        text not null,
  required    boolean not null default true,
  position    int not null default 0,
  received_at timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  unique (sale_id, item)
);
create index if not exists surgery_checklist_pend_idx
  on public.surgery_checklist_items (sale_id) where received_at is null;

create table if not exists public.surgery_reminders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'instituto-lorena' references public.tenants (id),
  sale_id       uuid not null references public.clinic_sales (id) on delete cascade,
  kind          text not null check (kind in ('d30', 'd15', 'd7', 'd2')),
  scheduled_for date not null,
  status        text not null default 'pendente'
                check (status in ('pendente', 'enviado', 'simulado', 'cancelado', 'erro')),
  channel       text,
  message       text,
  sent_at       timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (sale_id, kind)
);
create index if not exists surgery_reminders_fila_idx
  on public.surgery_reminders (scheduled_for) where status = 'pendente';

drop trigger if exists surgery_reminders_touch on public.surgery_reminders;
create trigger surgery_reminders_touch before update on public.surgery_reminders
  for each row execute function public.touch_updated_at();

alter table public.surgery_checklist_catalog enable row level security;
alter table public.surgery_checklist_items enable row level security;
alter table public.surgery_reminders enable row level security;
drop policy if exists "checklist_catalog tenant" on public.surgery_checklist_catalog;
drop policy if exists "checklist_items tenant" on public.surgery_checklist_items;
drop policy if exists "surgery_reminders tenant" on public.surgery_reminders;
create policy "checklist_catalog tenant" on public.surgery_checklist_catalog
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy "checklist_items tenant" on public.surgery_checklist_items
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy "surgery_reminders tenant" on public.surgery_reminders
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. A venda empurra o card e arma os lembretes sozinha
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Etapa do funil derivada da venda. É função e não regra na tela porque a venda
 * pode nascer em três lugares (Central de Vendas, importação da planilha, cron
 * que confere o espelho da cirurgia) e as três precisam concordar.
 *
 * "Cirurgia do próximo mês" é janela de 30 dias, recalculada todo dia pelo cron.
 * Ninguém arrasta esse card: card que depende de alguém lembrar de mover é
 * exatamente o que faz o paciente não receber o aviso dos exames.
 */
-- STABLE, não IMMUTABLE: depende de now(). Marcada immutable, o planner teria
-- licença para congelar o resultado e a raia do "próximo mês" pararia no tempo.
create or replace function public.clinic_sale_stage(sale public.clinic_sales)
returns text language sql stable as $$
  select case
    when sale.kind = 'protocolo' then case
      when sale.status = 'cancelada' then 'pro-nao-fechou'
      when sale.status = 'realizada' then 'pro-em-sessoes'
      when sale.scheduled_at is not null then 'pro-agendado'
      else 'pro-fechado'
    end
    else case
      when sale.status = 'cancelada' then 'cir-cancelou'
      when sale.status = 'realizada' then 'cir-realizada'
      when sale.scheduled_at is null then 'cir-vendido-sem-data'
      when sale.scheduled_at < now() then 'cir-agendada'
      when sale.scheduled_at <= now() + interval '30 days' then 'cir-proximo-mes'
      else 'cir-agendada'
    end
  end
$$;

create or replace function public.clinic_sales_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  alvo_dia date;
  etapa text;
  funil text;
begin
  -- 1. Card vai para a etapa que a venda determina.
  if new.lead_id is not null then
    etapa := public.clinic_sale_stage(new);
    funil := case when new.kind = 'protocolo' then 'pipeline-protocolos' else 'pipeline-processo-cirurgico' end;
    update public.leads
      set pipeline_id = funil,
          stage_id = etapa,
          stage_entered_at = case when stage_id is distinct from etapa then now() else stage_entered_at end,
          updated_at = now()
    where id = new.lead_id
      and (pipeline_id is distinct from funil or stage_id is distinct from etapa);
  end if;

  if new.kind <> 'cirurgia' then
    return new;
  end if;

  -- 2. Checklist de documentação nasce junto com o agendamento.
  if new.scheduled_at is not null then
    insert into public.surgery_checklist_items (tenant_id, sale_id, item, required, position)
    select new.tenant_id, new.id, c.item, c.required, c.position
    from public.surgery_checklist_catalog c
    where c.tenant_id = new.tenant_id and c.active
      and (c.item <> 'Reserva de hotel (paciente de fora)' or new.hotel_needed)
    on conflict (sale_id, item) do nothing;
  end if;

  -- 3. Lembretes D-30 / D-15 / D-7 / D-2.
  --    Quem vende faltando 10 dias para a cirurgia não pode ficar sem o aviso dos
  --    exames, então o lembrete que já venceu é reagendado para hoje em vez de
  --    nascer morto no passado.
  if new.scheduled_at is not null and new.status in ('vendida', 'agendada') then
    alvo_dia := (new.scheduled_at at time zone 'America/Sao_Paulo')::date;
    insert into public.surgery_reminders (tenant_id, sale_id, kind, scheduled_for)
    select new.tenant_id, new.id, k.kind, greatest(alvo_dia - k.dias, current_date)
    from (values ('d30', 30), ('d15', 15), ('d7', 7), ('d2', 2)) as k(kind, dias)
    where alvo_dia - k.dias >= current_date - 3
    on conflict (sale_id, kind) do update
      set scheduled_for = excluded.scheduled_for
      where public.surgery_reminders.status = 'pendente'
        and public.surgery_reminders.scheduled_for is distinct from excluded.scheduled_for;
  end if;

  -- 4. Cirurgia cancelada ou remarcada não dispara lembrete velho.
  if new.status = 'cancelada' then
    update public.surgery_reminders set status = 'cancelado'
    where sale_id = new.id and status = 'pendente';
  end if;

  return new;
end $$;

drop trigger if exists clinic_sales_after_write on public.clinic_sales;
create trigger clinic_sales_after_write after insert or update on public.clinic_sales
  for each row execute function public.clinic_sales_after_write();

/**
 * Passagem diária: recalcula a raia (a cirurgia de 40 dias vira "do próximo mês"
 * sem ninguém tocar) e fecha a venda cuja cirurgia já apareceu no espelho do
 * centro cirúrgico. Sem o espelho confirmando, a venda NÃO vira "realizada"
 * sozinha só porque a data passou: data no passado prova agendamento, não
 * cirurgia feita.
 */
create or replace function public.clinic_sales_refresh()
returns table (movidos int, realizadas int)
language plpgsql security definer set search_path = public as $$
declare m int := 0; r int := 0;
begin
  with casadas as (
    select s.id as sale_id, g.id as srg_id
    from public.clinic_sales s
    join public.srg_surgeries g
      on g.deleted_at is null
     and g.lead_id is not null
     and g.lead_id = s.lead_id
     and g.dia = (s.scheduled_at at time zone 'America/Sao_Paulo')::date
    where s.kind = 'cirurgia'
      and s.status in ('vendida', 'agendada')
      and s.scheduled_at is not null
  )
  update public.clinic_sales s
    set status = 'realizada', srg_surgery_id = c.srg_id
  from casadas c where c.sale_id = s.id;
  get diagnostics r = row_count;

  update public.leads l
    set stage_id = public.clinic_sale_stage(s),
        stage_entered_at = now(),
        updated_at = now()
  from public.clinic_sales s
  where s.lead_id = l.id
    and s.kind = 'cirurgia'
    and s.status in ('vendida', 'agendada', 'realizada')
    and l.pipeline_id = 'pipeline-processo-cirurgico'
    and l.stage_id is distinct from public.clinic_sale_stage(s);
  get diagnostics m = row_count;

  return query select m, r;
end $$;

revoke all on function public.clinic_sales_refresh() from public, anon;
grant execute on function public.clinic_sales_refresh() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Painel de follow-up (hoje, atrasados, semana)
-- ─────────────────────────────────────────────────────────────────────────────

-- security_invoker: sem isso a view roda como dona (postgres) e devolve a fila dos
-- dois polos para qualquer um que consultar, furando a RLS das tabelas de baixo.
create or replace view public.v_followup_agenda with (security_invoker = true) as
select
  f.id,
  f.tenant_id,
  f.lead_id,
  f.attempt_no,
  f.scheduled_for,
  f.owner_id,
  f.channel,
  f.note,
  l.patient_name,
  l.phone,
  l.pipeline_id,
  l.stage_id,
  l.source,
  case
    when f.scheduled_for < current_date then 'atrasado'
    when f.scheduled_for = current_date then 'hoje'
    when f.scheduled_for <= current_date + 7 then 'semana'
    else 'futuro'
  end as bucket,
  current_date - f.scheduled_for as dias_atraso
from public.lead_followups f
join public.leads l on l.id = f.lead_id and l.deleted_at is null
where f.done_at is null;

comment on view public.v_followup_agenda is
  'Fila de follow-up em aberto. Alimenta o painel Hoje/Atrasados da Central de Vendas.';
