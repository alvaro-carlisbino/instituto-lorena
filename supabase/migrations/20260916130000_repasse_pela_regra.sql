-- Repasse do médico e da anestesia pela REGRA de cada um, não pela calculadora.
--
-- 16/09/2026, a Luana: "quando a Aline está lançando a venda, ela já está cadastrando o médico
-- e anestesista e os repasses não estão calculando automaticamente". Não calculavam porque não
-- existia regra em lugar nenhum: `cost_doctor_cents` era campo digitado, e em 441 vendas ninguém
-- digitou. O extrato também não entrega a regra: o Dr. Matheus recebe R$ 10.000 no mês e o
-- Grupo Ingá manda fatura mensal, nada amarrado a uma cirurgia.
--
-- Decisão do Álvaro: regra configurável por pessoa. Cada médico e cada anestesia tem percentual
-- do valor da venda OU valor fixo por procedimento, separado por tipo de venda.
--
-- Como a conta anda:
--   * a venda calcula ao salvar (trigger BEFORE), então Central de Vendas, Resultado por cirurgia
--     e `profit_cents` leem o mesmo número gravado. Três telas somando cada uma a sua regra é como
--     nasce divergência de fechamento;
--   * mudar a regra recalcula as vendas daquela pessoa que não foram corrigidas à mão;
--   * valor digitado vence a regra (`cost_*_manual`): sempre vai existir a cirurgia com acerto
--     diferente. Desmarcar devolve a venda para a regra;
--   * anestesia tem coluna própria. Somada ao "repasse do médico", daria um número que não bate
--     com o que o médico recebe nem com a fatura do anestesista.

-- ── 1. a regra ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.clinic_payout_rules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default public.current_tenant_id() references public.tenants (id),
  role         text not null check (role in ('medico', 'anestesia')),
  -- A grafia que a venda grava: `performing_doctor` (espelho da sala) ou `anesthetist`
  -- (`anesthesia_providers`). Casa sem diferença de caixa nem espaço nas pontas.
  person_name  text not null check (length(btrim(person_name)) > 0),
  kind         text not null default 'cirurgia' check (kind in ('cirurgia', 'protocolo')),
  mode         text not null check (mode in ('percentual', 'fixo')),
  percent      numeric(6, 3) check (percent is null or (percent >= 0 and percent <= 100)),
  fixed_cents  bigint check (fixed_cents is null or fixed_cents >= 0),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Regra de dinheiro de médico: precisa dizer quem mexeu por último.
  updated_by   uuid default auth.uid(),
  constraint clinic_payout_rules_valor check (
    (mode = 'percentual' and percent is not null) or (mode = 'fixo' and fixed_cents is not null)
  )
);

-- "Matheus Amaral" e "matheus amaral " seriam duas regras e a venda pegaria qualquer uma.
create unique index if not exists clinic_payout_rules_pessoa_unq
  on public.clinic_payout_rules (tenant_id, role, kind, lower(btrim(person_name)));

create or replace function public.clinic_payout_rules_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;

drop trigger if exists clinic_payout_rules_touch on public.clinic_payout_rules;
create trigger clinic_payout_rules_touch before update on public.clinic_payout_rules
  for each row execute function public.clinic_payout_rules_touch();

alter table public.clinic_payout_rules enable row level security;

-- Ler é de toda a equipe: a Aline registra a venda e o formulário mostra o repasse calculado.
drop policy if exists "clinic_payout_rules read" on public.clinic_payout_rules;
create policy "clinic_payout_rules read" on public.clinic_payout_rules
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

-- Mudar é do financeiro e da gerência: muda o lucro de todas as vendas da pessoa.
drop policy if exists "clinic_payout_rules insert" on public.clinic_payout_rules;
create policy "clinic_payout_rules insert" on public.clinic_payout_rules
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_user_can_finance()));

drop policy if exists "clinic_payout_rules update" on public.clinic_payout_rules;
create policy "clinic_payout_rules update" on public.clinic_payout_rules
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_user_can_finance()))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_user_can_finance()));

drop policy if exists "clinic_payout_rules delete" on public.clinic_payout_rules;
create policy "clinic_payout_rules delete" on public.clinic_payout_rules
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_user_can_finance()));

grant select, insert, update, delete on public.clinic_payout_rules to authenticated;

comment on table public.clinic_payout_rules is
  'Quanto cada médico que opera e cada anestesia recebe por venda: % do valor ou valor fixo. A venda calcula sozinha ao salvar.';

-- ── 2. a venda ──────────────────────────────────────────────────────────────────────────────

alter table public.clinic_sales
  add column if not exists cost_anesthesia_cents bigint not null default 0,
  add column if not exists cost_doctor_manual boolean not null default false,
  add column if not exists cost_anesthesia_manual boolean not null default false;

alter table public.clinic_sales drop constraint if exists clinic_sales_cost_anesthesia_nonneg;
alter table public.clinic_sales
  add constraint clinic_sales_cost_anesthesia_nonneg check (cost_anesthesia_cents >= 0);

alter table public.clinic_sales
  alter column profit_cents set expression as (
    value_cents - cost_materials_cents - cost_doctor_cents - cost_anesthesia_cents - tax_cents - cost_other_cents
  );

comment on column public.clinic_sales.cost_anesthesia_cents is
  'Custo da anestesia desta venda. Sai da regra do anestesista, salvo quando cost_anesthesia_manual.';
comment on column public.clinic_sales.cost_doctor_manual is
  'O repasse do médico foi digitado nesta venda e não segue a regra.';
comment on column public.clinic_sales.cost_anesthesia_manual is
  'O custo da anestesia foi digitado nesta venda e não segue a regra.';
comment on column public.clinic_sales.profit_cents is
  'Valor vendido menos material, repasse médico, anestesia, imposto e outros. Gerada.';

-- ── 3. a conta ──────────────────────────────────────────────────────────────────────────────

-- Null quando a pessoa não tem regra: quem chama decide que isso é zero.
create or replace function public.clinic_payout_cents(
  p_tenant text, p_role text, p_kind text, p_person text, p_value_cents bigint
)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select case r.mode
           when 'percentual' then round(coalesce(p_value_cents, 0) * r.percent / 100)::bigint
           else r.fixed_cents
         end
    from public.clinic_payout_rules r
   where r.tenant_id = p_tenant
     and r.role = p_role
     and r.kind = p_kind
     and lower(btrim(r.person_name)) = lower(btrim(p_person))
   limit 1
$$;

revoke all on function public.clinic_payout_cents(text, text, text, text, bigint) from public, anon;
grant execute on function public.clinic_payout_cents(text, text, text, text, bigint) to authenticated, service_role;

create or replace function public.clinic_sales_repasse_pela_regra()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not new.cost_doctor_manual then
    new.cost_doctor_cents := coalesce(
      public.clinic_payout_cents(new.tenant_id, 'medico', new.kind, new.performing_doctor, new.value_cents), 0);
  end if;
  if not new.cost_anesthesia_manual then
    new.cost_anesthesia_cents := coalesce(
      public.clinic_payout_cents(new.tenant_id, 'anestesia', new.kind, new.anesthetist, new.value_cents), 0);
  end if;
  return new;
end
$$;

drop trigger if exists clinic_sales_repasse_pela_regra on public.clinic_sales;
create trigger clinic_sales_repasse_pela_regra before insert or update on public.clinic_sales
  for each row execute function public.clinic_sales_repasse_pela_regra();

-- ── 4. mudar a regra recalcula a história ────────────────────────────────────────────────────

-- Só toca a venda cujo valor muda de fato: regra salva sem alteração não escreve nada.
-- Venda cancelada fica de fora; se for reaberta, o próprio salvar recalcula.
create or replace function public._clinic_payout_reaplicar(p_tenant text, p_role text, p_kind text, p_person text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role = 'medico' then
    update public.clinic_sales s
       set cost_doctor_cents = coalesce(
             public.clinic_payout_cents(p_tenant, 'medico', p_kind, s.performing_doctor, s.value_cents), 0)
     where s.tenant_id = p_tenant
       and s.kind = p_kind
       and s.status <> 'cancelada'
       and not s.cost_doctor_manual
       and lower(btrim(s.performing_doctor)) = lower(btrim(p_person))
       and s.cost_doctor_cents is distinct from coalesce(
             public.clinic_payout_cents(p_tenant, 'medico', p_kind, s.performing_doctor, s.value_cents), 0);
  elsif p_role = 'anestesia' then
    update public.clinic_sales s
       set cost_anesthesia_cents = coalesce(
             public.clinic_payout_cents(p_tenant, 'anestesia', p_kind, s.anesthetist, s.value_cents), 0)
     where s.tenant_id = p_tenant
       and s.kind = p_kind
       and s.status <> 'cancelada'
       and not s.cost_anesthesia_manual
       and lower(btrim(s.anesthetist)) = lower(btrim(p_person))
       and s.cost_anesthesia_cents is distinct from coalesce(
             public.clinic_payout_cents(p_tenant, 'anestesia', p_kind, s.anesthetist, s.value_cents), 0);
  end if;
end
$$;

revoke all on function public._clinic_payout_reaplicar(text, text, text, text) from public, anon, authenticated;

create or replace function public.clinic_payout_rules_reaplica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Renomear a pessoa da regra recalcula as duas pontas: quem perdeu a regra volta a zero.
  if tg_op in ('UPDATE', 'DELETE') then
    perform public._clinic_payout_reaplicar(old.tenant_id, old.role, old.kind, old.person_name);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public._clinic_payout_reaplicar(new.tenant_id, new.role, new.kind, new.person_name);
  end if;
  return null;
end
$$;

revoke all on function public.clinic_payout_rules_reaplica() from public, anon, authenticated;

drop trigger if exists clinic_payout_rules_reaplica on public.clinic_payout_rules;
create trigger clinic_payout_rules_reaplica after insert or update or delete on public.clinic_payout_rules
  for each row execute function public.clinic_payout_rules_reaplica();

-- ── 5. gravar custo não mexe em card nem em lembrete ─────────────────────────────────────────

-- Recalcular o repasse de 100 vendas do Dr. Matheus passava 100 vezes pelo
-- `clinic_sales_after_write`: move card de funil, rearma checklist e lembrete de paciente. Nada
-- disso depende de custo. A atualização que só mexe em custo passa direto; qualquer outra
-- coluna alterada dispara como antes. Mesma função, só o gatilho dividido.
drop trigger if exists clinic_sales_after_write on public.clinic_sales;
drop trigger if exists clinic_sales_after_write_upd on public.clinic_sales;

create trigger clinic_sales_after_write after insert on public.clinic_sales
  for each row execute function public.clinic_sales_after_write();

create trigger clinic_sales_after_write_upd after update on public.clinic_sales
  for each row
  when (
    (to_jsonb(old) - array['cost_materials_cents', 'cost_doctor_cents', 'cost_anesthesia_cents', 'tax_cents',
                           'cost_other_cents', 'cost_doctor_manual', 'cost_anesthesia_manual', 'profit_cents',
                           'updated_at'])
    is distinct from
    (to_jsonb(new) - array['cost_materials_cents', 'cost_doctor_cents', 'cost_anesthesia_cents', 'tax_cents',
                           'cost_other_cents', 'cost_doctor_manual', 'cost_anesthesia_manual', 'profit_cents',
                           'updated_at'])
  )
  execute function public.clinic_sales_after_write();

-- ── 6. o resultado por cirurgia enxerga a anestesia ──────────────────────────────────────────

drop function if exists public.crm_resultado_procedimentos(date, date);
create or replace function public.crm_resultado_procedimentos(p_de date, p_ate date)
returns table (
  sale_id uuid,
  kind text,
  status text,
  dia date,
  patient_name text,
  lead_id text,
  procedure_label text,
  receita_cents bigint,
  cobrado_kits_cents bigint,
  materiais_kits_cents bigint,
  materiais_manual_cents bigint,
  custo_medico_cents bigint,
  custo_anestesia_cents bigint,
  imposto_cents bigint,
  outros_cents bigint,
  kits integer,
  kit_ids uuid[],
  vinculo text,
  srg_surgery_id integer,
  shosp_prontuario text,
  medico_manual boolean,
  anestesia_manual boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with pode as (
    -- Lucro de cirurgia é dado de gestão: mesma régua da tela "Cirurgia foi paga?".
    select (public.current_user_can_finance() or public.can_route_leads()) as ok
  ),
  vendas as (
    select s.id, s.kind, s.status, s.patient_name, s.lead_id, s.procedure_label, s.srg_surgery_id, s.shosp_prontuario,
           coalesce(s.value_cents, 0) as receita,
           coalesce(s.cost_materials_cents, 0) as mat_manual,
           coalesce(s.cost_doctor_cents, 0) as medico,
           coalesce(s.cost_anesthesia_cents, 0) as anestesia,
           coalesce(s.tax_cents, 0) as imposto,
           coalesce(s.cost_other_cents, 0) as outros,
           s.cost_doctor_manual as medico_manual,
           s.cost_anesthesia_manual as anestesia_manual,
           coalesce((s.scheduled_at at time zone 'America/Sao_Paulo')::date, s.sold_at) as dia
      from public.clinic_sales s, pode
     where pode.ok
       and s.status <> 'cancelada'
       and s.kind in ('cirurgia', 'protocolo')
       and coalesce((s.scheduled_at at time zone 'America/Sao_Paulo')::date, s.sold_at) between p_de and p_ate
  ),
  kits as (
    select k.id, k.lead_id, k.clinic_sale_id, k.patient_name, k.name, k.procedure_label,
           coalesce(k.scheduled_for, (k.created_at at time zone 'America/Sao_Paulo')::date) as dia,
           coalesce((select sum(-m.qty_delta * coalesce(m.unit_cost_cents, 0))
                       from public.stock_movements m
                      where m.ref_type = 'stock_kit' and m.ref_id = k.id::text), 0)::bigint as custo,
           coalesce((select sum(i.charge_cents) from public.stock_kit_items i where i.kit_id = k.id), 0)::bigint as cobrado
      from public.stock_kits k, pode
     where pode.ok and k.status <> 'cancelado'
  ),
  elo as (
    select k.id as kit_id,
           coalesce(
             k.clinic_sale_id,
             (select v.id from vendas v
               where k.lead_id is not null and v.lead_id = k.lead_id and abs(v.dia - k.dia) <= 7
               order by abs(v.dia - k.dia), (v.kind = 'cirurgia') desc
               limit 1)
           ) as sale_id,
           case when k.clinic_sale_id is not null then 'manual' else 'automatico' end as vinculo
      from kits k
  )
  select v.id, v.kind, v.status, v.dia, v.patient_name, v.lead_id, v.procedure_label,
         v.receita,
         coalesce(sum(k.cobrado), 0)::bigint,
         coalesce(sum(k.custo), 0)::bigint,
         v.mat_manual, v.medico, v.anestesia, v.imposto, v.outros,
         count(k.id)::int,
         coalesce(array_agg(k.id) filter (where k.id is not null), '{}'),
         case when count(k.id) = 0 then 'sem_kit'
              when bool_or(e.vinculo = 'automatico') then 'automatico'
              else 'manual' end,
         v.srg_surgery_id, v.shosp_prontuario,
         v.medico_manual, v.anestesia_manual
    from vendas v
    left join elo e on e.sale_id = v.id
    left join kits k on k.id = e.kit_id
   group by v.id, v.kind, v.status, v.dia, v.patient_name, v.lead_id, v.procedure_label,
            v.receita, v.mat_manual, v.medico, v.anestesia, v.imposto, v.outros, v.srg_surgery_id,
            v.shosp_prontuario, v.medico_manual, v.anestesia_manual
  union all
  -- Kit no período sem venda achada: custo que ninguém está cobrando. Precisa aparecer.
  select null, 'sem_venda', null, k.dia, k.patient_name, k.lead_id, coalesce(k.procedure_label, k.name),
         0, k.cobrado, k.custo, 0, 0, 0, 0, 0, 1, array[k.id], 'sem_venda', null, null, false, false
    from kits k
    join elo e on e.kit_id = k.id
   where e.sale_id is null and k.dia between p_de and p_ate
  order by 4 desc
$$;

revoke all on function public.crm_resultado_procedimentos(date, date) from public, anon;
grant execute on function public.crm_resultado_procedimentos(date, date) to authenticated, service_role;
