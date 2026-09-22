-- A ENTRADA DO TRANSPLANTE JÁ É O PAGAMENTO DO ANESTESISTA.
--
-- 22/09/2026. O Álvaro mandou o print do formulário da venda do Gustavo Frederico com dois
-- grifos: em cima, Entrada R$ 2.500,00; embaixo, Anestesia R$ 2.500,00. O mesmo dinheiro,
-- descontado duas vezes.
--
-- Como a clínica trabalha: o paciente paga R$ 2.500 de entrada e essa entrada É o que o
-- anestesista recebe. A Aline cadastra no campo Valor o que sobra para a clínica, ou seja, o
-- valor JÁ vem sem a entrada. Aí a política de repasse (20260916170000) somava a anestesia
-- cheia por cima, e o lucro da venda saía R$ 2.500 menor do que é. Em 16 cirurgias o campo
-- ainda está marcado "entrada paga para o anestesista", mas o erro não depende dessa marcação:
-- o Gustavo do print não tinha marcação nenhuma e errava igual.
--
-- A conta passa a ser: anestesia que sai da clínica = o que a política manda MENOS a entrada
-- que o paciente já pagou, nunca abaixo de zero. Vale para qualquer entrada de cirurgia,
-- independente de quem recebeu o dinheiro:
--   * entrada paga direto ao anestesista — a clínica não desembolsa nada, e o valor da venda
--     não conta esse dinheiro;
--   * entrada paga à clínica — entra e sai pela mesma porta, e o valor da venda também não
--     conta esse dinheiro. O lucro é o mesmo nos dois casos.
--
-- `deposit_payee` continua servindo ao financeiro (procurar ou não o Pix no extrato), só não
-- manda mais na conta do lucro.
--
-- Quem digitou o valor da anestesia à mão (`cost_anesthesia_manual`) continua intocado.

-- ── 1. a conta, num lugar só ────────────────────────────────────────────────────────────────

create or replace function public.clinic_anestesia_da_clinica(p_politica bigint, p_entrada bigint)
returns bigint
language sql
immutable
as $$
  select greatest(0, coalesce(p_politica, 0) - greatest(0, coalesce(p_entrada, 0)))
$$;

comment on function public.clinic_anestesia_da_clinica(bigint, bigint) is
  'Anestesia que ainda sai do caixa da clínica: o valor da política menos a entrada que o '
  'paciente já pagou (a entrada do transplante é o pagamento do anestesista). Nunca negativo.';

revoke all on function public.clinic_anestesia_da_clinica(bigint, bigint) from public, anon;
grant execute on function public.clinic_anestesia_da_clinica(bigint, bigint) to authenticated, service_role;

-- ── 2. o gatilho que grava o custo da venda ────────────────────────────────────────────────

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
      -- A entrada abate o repasse da anestesia: ver o cabeçalho desta migration.
      new.cost_anesthesia_cents := public.clinic_anestesia_da_clinica(
        (select a.total_cents
           from public.clinic_anestesia_cirurgia(
             new.tenant_id, new.procedure_label, new.sem_raspagem,
             public._clinic_sale_uf(new.tenant_id, new.srg_surgery_id, new.follicular_units)) a),
        new.deposit_cents);
    end if;
  else
    if not new.cost_doctor_manual then
      new.cost_doctor_cents := coalesce(
        public.clinic_payout_cents(new.tenant_id, 'medico', new.kind, new.performing_doctor, new.value_cents), 0);
    end if;
    -- Protocolo não tem entrada de anestesista: a regra por pessoa continua inteira.
    if not new.cost_anesthesia_manual then
      new.cost_anesthesia_cents := coalesce(
        public.clinic_payout_cents(new.tenant_id, 'anestesia', new.kind, new.anesthetist, new.value_cents), 0);
    end if;
  end if;
  return new;
end
$$;

-- ── 3. a prévia do formulário ──────────────────────────────────────────────────────────────

-- Muda a assinatura (entra `p_entrada`) e o que devolve, então a antiga sai de cena para não
-- ficarem duas funções disputando a mesma chamada.
drop function if exists public.clinic_repasse_previa(text, text, text, bigint, boolean, integer, integer);

create or replace function public.clinic_repasse_previa(
  p_procedimento text,
  p_atendeu text,
  p_opera text,
  p_valor bigint,
  p_sem_raspagem boolean,
  p_uf integer,
  p_srg integer default null,
  p_entrada bigint default 0
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
  uf_da_sala boolean,
  -- O que a política manda, antes de abater a entrada.
  anestesia_politica_cents bigint,
  -- Quanto da entrada do paciente já cobriu a anestesia.
  anestesia_entrada_cents bigint
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
    -- Sem regra de anestesia o campo continua nulo: "o procedimento não diz qual anestesia"
    -- é diferente de "a entrada pagou tudo".
    case when a.total_cents is null then null
         else public.clinic_anestesia_da_clinica(a.total_cents, p_entrada) end,
    a.regra,
    u.vale, u.sala is not null,
    a.total_cents,
    least(coalesce(a.total_cents, 0), greatest(0, coalesce(p_entrada, 0)))
  from t
  cross join u
  left join lateral public.clinic_repasse_cirurgia(t.tenant, p_atendeu, p_opera, p_valor) m on true
  left join lateral public.clinic_anestesia_cirurgia(t.tenant, p_procedimento, p_sem_raspagem, u.vale) a on true
$$;

revoke all on function public.clinic_repasse_previa(text, text, text, bigint, boolean, integer, integer, bigint) from public, anon;
grant execute on function public.clinic_repasse_previa(text, text, text, bigint, boolean, integer, integer, bigint) to authenticated;

-- ── 4. recalcular o que já está cadastrado ─────────────────────────────────────────────────

-- Mesma função de 20260916170000, agora enxergando a entrada. Continua encostando só nas
-- vendas cujo valor muda, e só gravando `updated_at` para o gatilho de cima refazer a conta
-- (gravar custo não dispara card, checklist nem lembrete: ver 20260916130000).
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
       (not s.cost_anesthesia_manual and s.cost_anesthesia_cents is distinct from public.clinic_anestesia_da_clinica(
          (select a.total_cents
             from public.clinic_anestesia_cirurgia(s.tenant_id, s.procedure_label, s.sem_raspagem,
                    public._clinic_sale_uf(s.tenant_id, s.srg_surgery_id, s.follicular_units)) a),
          s.deposit_cents))
     );
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public._clinic_repasse_reaplicar_cirurgias(text) from public, anon, authenticated;

-- A entrada agora muda o custo, então mexer nela precisa refazer a conta. O gatilho BEFORE já
-- roda em todo update da venda, mas a venda editada por outra tela (financeiro, conferência)
-- passa pelo mesmo caminho — nada a acrescentar aqui além de reaplicar o histórico:

select public._clinic_repasse_reaplicar_cirurgias('instituto-lorena');
