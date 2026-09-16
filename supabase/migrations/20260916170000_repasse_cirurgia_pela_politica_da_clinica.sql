-- REPASSE DE CIRURGIA PELA POLÍTICA DA CLÍNICA, NÃO POR PESSOA.
--
-- 16/09/2026, tarde. A regra por pessoa (20260916130000) nasceu vazia, e a Luana mandou como a
-- clínica paga de verdade. Não depende de quem é o médico, e sim do papel dele na venda:
--
--   Médico
--     * atendeu a consulta, vendeu e opera ............................ 13% do valor
--     * só opera (recebeu a venda de outro médico) .................... R$ 3.200 fixo
--     * atendeu e passou para outro médico operar ...................... R$ 500 de indicação
--   Anestesia, pelo procedimento
--     * sobrancelha .................................................... R$ 1.750
--     * feminina, e masculina sem raspagem ............................. R$ 2.500
--     * masculina com raspagem abaixo de 3.000 UF ...................... R$ 1.750
--     * nanofat e células autólogas .................................... R$ 500
--
-- Decisões do Álvaro no mesmo dia: vale para a Dra. Lorena também; masculina com raspagem e
-- 3.000 UF ou mais paga R$ 2.500; "sem raspagem" é marcado pela Aline na venda; cirurgia
-- combinada paga o MAIOR valor e o nanofat SOMA R$ 500.
--
-- O que a venda não tinha e passou a ter: `sem_raspagem` e `follicular_units` (previsão). Quando
-- a venda está ligada à cirurgia da sala, vale o número implantado lá (`total_implantados`), e a
-- sala mudar esse número recalcula a anestesia.
--
-- Os valores moram em `clinic_payout_policy`, uma linha por polo, editável na tela de Repasses.
-- Mudar recalcula todas as cirurgias do polo que não foram digitadas à mão. Protocolo continua
-- com a regra por pessoa: a Luana não mandou regra de protocolo.
--
-- Uma implementação só: o formulário da venda pede a prévia ao banco (`clinic_repasse_previa`)
-- em vez de repetir a conta no navegador.

-- ── 1. a política ───────────────────────────────────────────────────────────────────────────

create table if not exists public.clinic_payout_policy (
  tenant_id                 text primary key default public.current_tenant_id() references public.tenants (id),
  medico_mesmo_pct          numeric(6, 3) not null default 13 check (medico_mesmo_pct between 0 and 100),
  medico_cirurgiao_cents    bigint not null default 320000 check (medico_cirurgiao_cents >= 0),
  medico_indicacao_cents    bigint not null default 50000 check (medico_indicacao_cents >= 0),
  anest_sobrancelha_cents   bigint not null default 175000 check (anest_sobrancelha_cents >= 0),
  anest_padrao_cents        bigint not null default 250000 check (anest_padrao_cents >= 0),
  anest_masc_pequena_cents  bigint not null default 175000 check (anest_masc_pequena_cents >= 0),
  anest_limite_uf           integer not null default 3000 check (anest_limite_uf > 0),
  anest_nanofat_cents       bigint not null default 50000 check (anest_nanofat_cents >= 0),
  updated_at                timestamptz not null default now(),
  updated_by                uuid default auth.uid()
);

comment on table public.clinic_payout_policy is
  'Quanto a clínica paga por cirurgia: médico pelo papel na venda (13% / fixo / indicação) e '
  'anestesia pelo procedimento. Uma linha por polo. Mudar recalcula as cirurgias.';

drop trigger if exists clinic_payout_policy_touch on public.clinic_payout_policy;
create trigger clinic_payout_policy_touch before update on public.clinic_payout_policy
  for each row execute function public.clinic_payout_rules_touch();

alter table public.clinic_payout_policy enable row level security;

drop policy if exists "clinic_payout_policy read" on public.clinic_payout_policy;
create policy "clinic_payout_policy read" on public.clinic_payout_policy
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists "clinic_payout_policy insert" on public.clinic_payout_policy;
create policy "clinic_payout_policy insert" on public.clinic_payout_policy
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_user_can_finance()));

drop policy if exists "clinic_payout_policy update" on public.clinic_payout_policy;
create policy "clinic_payout_policy update" on public.clinic_payout_policy
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_user_can_finance()))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_user_can_finance()));

grant select, insert, update on public.clinic_payout_policy to authenticated;

insert into public.clinic_payout_policy (tenant_id) values ('instituto-lorena')
on conflict (tenant_id) do nothing;

-- ── 2. o que a venda precisa dizer ──────────────────────────────────────────────────────────

alter table public.clinic_sales
  add column if not exists sem_raspagem boolean not null default false,
  add column if not exists follicular_units integer;

alter table public.clinic_sales drop constraint if exists clinic_sales_follicular_units_nonneg;
alter table public.clinic_sales
  add constraint clinic_sales_follicular_units_nonneg check (follicular_units is null or follicular_units >= 0);

comment on column public.clinic_sales.sem_raspagem is
  'Transplante sem raspagem. Muda a anestesia da cirurgia masculina (política da clínica).';
comment on column public.clinic_sales.follicular_units is
  'Unidades foliculares previstas, digitadas na venda. Com a cirurgia da sala ligada, vale o implantado de lá.';

-- ── 3. a conta ──────────────────────────────────────────────────────────────────────────────

-- UF que vale: implantado na sala, senão a previsão da venda. Definer porque a sala tem RLS
-- própria e quem salva a venda nem sempre enxerga o espelho.
create or replace function public._clinic_sale_uf(p_tenant text, p_srg integer, p_digitado integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(g.total_implantados, 0)
       from public.srg_surgeries g
      where g.id = p_srg and g.tenant_id = p_tenant and g.deleted_at is null),
    nullif(p_digitado, 0)
  )
$$;

revoke all on function public._clinic_sale_uf(text, integer, integer) from public, anon;
grant execute on function public._clinic_sale_uf(text, integer, integer) to authenticated, service_role;

-- Médico de cirurgia. Sem linha = polo sem política; total nulo = venda sem quem opera.
create or replace function public.clinic_repasse_cirurgia(
  p_tenant text, p_atendeu text, p_opera text, p_valor bigint
)
returns table (total_cents bigint, cirurgiao_cents bigint, indicacao_cents bigint, pct numeric, regra text)
language sql
stable
security invoker
set search_path = public
as $$
  with papel as (
    select case
             when nullif(btrim(p_opera), '') is null then 'sem_cirurgiao'
             -- Sem quem atendeu, quem opera é tratado como quem vendeu: toda cirurgia registrada
             -- até 16/09 tem os dois preenchidos.
             when nullif(btrim(p_atendeu), '') is null
               or lower(btrim(p_atendeu)) = lower(btrim(p_opera)) then 'mesmo_medico'
             else 'outro_cirurgiao'
           end as regra
  )
  select
    case papel.regra
      when 'mesmo_medico' then round(coalesce(p_valor, 0) * pol.medico_mesmo_pct / 100)::bigint
      when 'outro_cirurgiao' then pol.medico_cirurgiao_cents + pol.medico_indicacao_cents
    end,
    case papel.regra
      when 'mesmo_medico' then round(coalesce(p_valor, 0) * pol.medico_mesmo_pct / 100)::bigint
      when 'outro_cirurgiao' then pol.medico_cirurgiao_cents
    end,
    case papel.regra when 'outro_cirurgiao' then pol.medico_indicacao_cents else 0 end,
    pol.medico_mesmo_pct,
    papel.regra
  from public.clinic_payout_policy pol, papel
  where pol.tenant_id = p_tenant
$$;

revoke all on function public.clinic_repasse_cirurgia(text, text, text, bigint) from public, anon;
grant execute on function public.clinic_repasse_cirurgia(text, text, text, bigint) to authenticated, service_role;

-- Anestesia de cirurgia pelo nome do procedimento. O nome é texto livre ("Tc Frontal/ Coroa",
-- "TC Feminino + Sobrancelhas", "Sobrancelha + nanofat"), então a leitura é por palavra.
-- Procedimento que não diz nada reconhecível não devolve linha: vira zero e a tela avisa.
create or replace function public.clinic_anestesia_cirurgia(
  p_tenant text, p_procedimento text, p_sem_raspagem boolean, p_uf integer
)
returns table (total_cents bigint, regra text)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  pol public.clinic_payout_policy%rowtype;
  t text;
  capilar boolean;
  base bigint;
  descr text;
begin
  select * into pol from public.clinic_payout_policy where tenant_id = p_tenant;
  if not found then
    return;
  end if;

  t := translate(lower(coalesce(p_procedimento, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  -- "Transplante" sozinho não diz que é cabelo: a sala chama a de sobrancelha de
  -- "Transplante Sobrancelhas c/ Cilios".
  capilar := t ~ '\m(tc|capilar|frontal|coroa|barba|calvicie|hairline|topetes?|escalpe)\M'
          or (t ~ '\mtransplante\M' and t !~ '(sobrancel|cilio)');

  if capilar then
    if t ~ 'femin' then
      base := pol.anest_padrao_cents;
      descr := 'feminina';
    elsif coalesce(p_sem_raspagem, false) then
      base := pol.anest_padrao_cents;
      descr := 'sem raspagem';
    elsif p_uf is null then
      -- Sem o número ainda, fica no valor cheio: a sala ou a previsão corrigem depois.
      base := pol.anest_padrao_cents;
      descr := 'com raspagem, UF a informar';
    elsif p_uf < pol.anest_limite_uf then
      base := pol.anest_masc_pequena_cents;
      descr := 'com raspagem, ' || replace(to_char(p_uf, 'FM999,999'), ',', '.') || ' UF';
    else
      base := pol.anest_padrao_cents;
      descr := 'com raspagem, ' || replace(to_char(p_uf, 'FM999,999'), ',', '.') || ' UF';
    end if;
  end if;

  if t ~ '(sobrancel|cilio)' then
    if base is null then
      base := pol.anest_sobrancelha_cents;
      descr := 'sobrancelha';
    else
      -- Cirurgia combinada paga o maior valor, não a soma.
      base := greatest(base, pol.anest_sobrancelha_cents);
      descr := descr || ' e sobrancelha, vale o maior';
    end if;
  end if;

  if t ~ '(nanofat|autolog|celulas)' then
    base := coalesce(base, 0) + pol.anest_nanofat_cents;
    descr := coalesce(descr || ' + nanofat', 'nanofat');
  end if;

  if base is null then
    return;
  end if;
  total_cents := base;
  regra := descr;
  return next;
end
$$;

revoke all on function public.clinic_anestesia_cirurgia(text, text, boolean, integer) from public, anon;
grant execute on function public.clinic_anestesia_cirurgia(text, text, boolean, integer) to authenticated, service_role;

-- O gatilho da venda: cirurgia pela política, protocolo pela regra da pessoa (como era).
create or replace function public.clinic_sales_repasse_pela_regra()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.kind = 'cirurgia' then
    if not new.cost_doctor_manual then
      new.cost_doctor_cents := coalesce(
        (select r.total_cents
           from public.clinic_repasse_cirurgia(new.tenant_id, new.attending_doctor, new.performing_doctor, new.value_cents) r),
        0);
    end if;
    if not new.cost_anesthesia_manual then
      new.cost_anesthesia_cents := coalesce(
        (select a.total_cents
           from public.clinic_anestesia_cirurgia(
             new.tenant_id, new.procedure_label, new.sem_raspagem,
             public._clinic_sale_uf(new.tenant_id, new.srg_surgery_id, new.follicular_units)) a),
        0);
    end if;
  else
    if not new.cost_doctor_manual then
      new.cost_doctor_cents := coalesce(
        public.clinic_payout_cents(new.tenant_id, 'medico', new.kind, new.performing_doctor, new.value_cents), 0);
    end if;
    if not new.cost_anesthesia_manual then
      new.cost_anesthesia_cents := coalesce(
        public.clinic_payout_cents(new.tenant_id, 'anestesia', new.kind, new.anesthetist, new.value_cents), 0);
    end if;
  end if;
  return new;
end
$$;

-- ── 4. prévia para o formulário ─────────────────────────────────────────────────────────────

create or replace function public.clinic_repasse_previa(
  p_procedimento text,
  p_atendeu text,
  p_opera text,
  p_valor bigint,
  p_sem_raspagem boolean,
  p_uf integer,
  p_srg integer default null
)
returns table (
  tem_politica boolean,
  medico_cents bigint,
  cirurgiao_cents bigint,
  indicacao_cents bigint,
  medico_pct numeric,
  medico_regra text,
  anestesia_cents bigint,
  anestesia_regra text,
  uf integer,
  uf_da_sala boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with t as (select public.current_tenant_id() as tenant),
  u as (
    select public._clinic_sale_uf(t.tenant, p_srg, null) as sala,
           public._clinic_sale_uf(t.tenant, p_srg, p_uf) as vale
      from t
  )
  select
    exists (select 1 from public.clinic_payout_policy pol, t where pol.tenant_id = t.tenant),
    m.total_cents, m.cirurgiao_cents, m.indicacao_cents, m.pct, m.regra,
    a.total_cents, a.regra,
    u.vale, u.sala is not null
  from t
  cross join u
  left join lateral public.clinic_repasse_cirurgia(t.tenant, p_atendeu, p_opera, p_valor) m on true
  left join lateral public.clinic_anestesia_cirurgia(t.tenant, p_procedimento, p_sem_raspagem, u.vale) a on true
$$;

revoke all on function public.clinic_repasse_previa(text, text, text, bigint, boolean, integer, integer) from public, anon;
grant execute on function public.clinic_repasse_previa(text, text, text, bigint, boolean, integer, integer) to authenticated;

-- ── 5. mudar a política ou a sala recalcula ─────────────────────────────────────────────────

-- Encosta nas cirurgias do polo que não foram digitadas à mão e deixa o gatilho da venda
-- refazer a conta. Só onde o valor muda de fato. Gravar só custo não dispara o after_write
-- (card, checklist e lembrete), ver 20260916130000.
create or replace function public._clinic_repasse_reaplicar_cirurgias(p_tenant text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.clinic_sales s
     set updated_at = s.updated_at
   where s.tenant_id = p_tenant
     and s.kind = 'cirurgia'
     and s.status <> 'cancelada'
     and (
       (not s.cost_doctor_manual and s.cost_doctor_cents is distinct from coalesce(
          (select r.total_cents
             from public.clinic_repasse_cirurgia(s.tenant_id, s.attending_doctor, s.performing_doctor, s.value_cents) r), 0))
       or
       (not s.cost_anesthesia_manual and s.cost_anesthesia_cents is distinct from coalesce(
          (select a.total_cents
             from public.clinic_anestesia_cirurgia(s.tenant_id, s.procedure_label, s.sem_raspagem,
                    public._clinic_sale_uf(s.tenant_id, s.srg_surgery_id, s.follicular_units)) a), 0))
     );
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public._clinic_repasse_reaplicar_cirurgias(text) from public, anon, authenticated;

create or replace function public.clinic_payout_policy_reaplica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._clinic_repasse_reaplicar_cirurgias(new.tenant_id);
  return null;
end
$$;

revoke all on function public.clinic_payout_policy_reaplica() from public, anon, authenticated;

drop trigger if exists clinic_payout_policy_reaplica on public.clinic_payout_policy;
create trigger clinic_payout_policy_reaplica after insert or update on public.clinic_payout_policy
  for each row execute function public.clinic_payout_policy_reaplica();

-- A sala grava as UF implantadas no fim da cirurgia. A venda ligada a ela troca a previsão pelo
-- número real sem ninguém abrir a venda.
create or replace function public.srg_surgeries_uf_reaplica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clinic_sales s
     set updated_at = s.updated_at
   where s.srg_surgery_id = new.id
     and s.kind = 'cirurgia'
     and s.status <> 'cancelada'
     and not s.cost_anesthesia_manual;
  return null;
end
$$;

revoke all on function public.srg_surgeries_uf_reaplica() from public, anon, authenticated;

drop trigger if exists srg_surgeries_uf_reaplica on public.srg_surgeries;
create trigger srg_surgeries_uf_reaplica after update of total_implantados on public.srg_surgeries
  for each row when (old.total_implantados is distinct from new.total_implantados)
  execute function public.srg_surgeries_uf_reaplica();

-- ── 6. as cirurgias já registradas ──────────────────────────────────────────────────────────

select public._clinic_repasse_reaplicar_cirurgias('instituto-lorena');
