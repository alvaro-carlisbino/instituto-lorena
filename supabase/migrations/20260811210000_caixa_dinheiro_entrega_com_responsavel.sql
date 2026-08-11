-- FECHAMENTO DE CAIXA — onde foi parar o dinheiro vivo.
--
-- Entre mai e ago/2026 a clínica recebeu R$ 390.512 em espécie e o extrato do Itaú não tem UM
-- depósito em dinheiro no período (o único parecido é um cheque de R$ 37.800). A conta
-- "Dinheiro / Caixa" do CRM tem zero lançamento. Ou seja: ~R$ 100 mil/mês entram e não existe
-- registro nenhum do destino. Isso não é acusação de nada — é a ausência total de rastro, que
-- é o que impede tanto de confiar quanto de desconfiar.
--
-- Metade desse dinheiro é pagamento de cirurgia (R$ 298.460 casados com paciente operado, ver
-- crm_cirurgias_pagamento), então não é troco de balcão: é entrada alta, em espécie, sem dono.
--
-- Esta tabela registra a ENTREGA: quem tirou do caixa, quem recebeu, e para onde foi. É o
-- mínimo que fecha a conta "recebido em espécie − entregue = o que tem que estar na gaveta".
--
-- O QUE ELA NÃO FAZ, de propósito: não cria lançamento em fin_transactions quando o destino é
-- depósito. O extrato do banco já entra sozinho pelo Open Finance 3x/dia; lançar aqui também
-- contaria o mesmo dinheiro duas vezes. A entrega é o rastro do movimento; o depósito no
-- extrato é o dinheiro; a conciliação amarra os dois. Mesma regra da importação de vendas.

create table if not exists public.fin_cash_handovers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),
  -- dia em que o dinheiro trocou de mão, não o dia do lançamento
  handed_at date not null,
  amount_cents integer not null check (amount_cents > 0),
  -- Texto livre e obrigatório dos dois lados. Poderia ser FK pra app_users, e seria pior:
  -- quem entrega costuma ser a recepção com login compartilhado (ver a atendente da clínica),
  -- e quem recebe às vezes nem tem login. Nome escrito à mão rastreia mais do que um id que
  -- todo mundo divide.
  from_person text not null check (length(btrim(from_person)) > 0),
  to_person text not null check (length(btrim(to_person)) > 0),
  destination text not null check (destination in ('deposito', 'despesa', 'cofre', 'outro')),
  -- conta de destino quando foi depósito; nulo nos outros casos
  account_id uuid references public.fin_accounts (id),
  note text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists fin_cash_handovers_tenant_data_idx
  on public.fin_cash_handovers (tenant_id, handed_at desc);

alter table public.fin_cash_handovers enable row level security;

-- Mesmo padrão das outras fin_*: o tenant lê e escreve só o que é dele, e só quem tem
-- financeiro. Nunca `using (true)`.
drop policy if exists "fin_cash_handovers finance read" on public.fin_cash_handovers;
create policy "fin_cash_handovers finance read" on public.fin_cash_handovers
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_cash_handovers finance insert" on public.fin_cash_handovers;
create policy "fin_cash_handovers finance insert" on public.fin_cash_handovers
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_cash_handovers finance update" on public.fin_cash_handovers;
create policy "fin_cash_handovers finance update" on public.fin_cash_handovers
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance())
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_cash_handovers finance delete" on public.fin_cash_handovers;
create policy "fin_cash_handovers finance delete" on public.fin_cash_handovers
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

-- ────────────────────────────────────────────────────────────── posição do caixa por mês

/**
 * Mês a mês: quanto entrou em espécie (venda do Shosp), quanto saiu registrado, e o que sobra.
 *
 * `sobra_cents` é o que DEVERIA estar na gaveta se todo movimento tivesse sido registrado. Não
 * é auditoria de cofre — é a diferença entre o que o sistema sabe que entrou e o que alguém
 * declarou ter tirado. Enquanto ninguém registrar entrega, esse número é igual ao recebido, e é
 * assim que ele denuncia a ausência de rastro em vez de escondê-la.
 */
create or replace function public.crm_caixa_dinheiro(p_de date, p_ate date)
returns table (
  mes text,
  recebido_cents bigint,
  entregue_cents bigint,
  depositado_cents bigint,
  despesa_cents bigint,
  sobra_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with meses as (
    select to_char(d, 'YYYY-MM') as mes
    from generate_series(date_trunc('month', p_de), date_trunc('month', p_ate), interval '1 month') d
  ),
  recebido as (
    select to_char(r.due_date, 'YYYY-MM') as mes, sum(r.amount_cents)::bigint as cents
    from public.fin_receivables r
    where r.tenant_id = public.current_tenant_id()
      and r.method = 'dinheiro'
      and r.due_date between p_de and p_ate
      and public.current_user_can_finance()
    group by 1
  ),
  entregue as (
    select to_char(h.handed_at, 'YYYY-MM') as mes,
           sum(h.amount_cents)::bigint as cents,
           sum(h.amount_cents) filter (where h.destination = 'deposito')::bigint as deposito,
           sum(h.amount_cents) filter (where h.destination = 'despesa')::bigint as despesa
    from public.fin_cash_handovers h
    where h.tenant_id = public.current_tenant_id()
      and h.handed_at between p_de and p_ate
      and public.current_user_can_finance()
    group by 1
  )
  select m.mes,
         coalesce(r.cents, 0),
         coalesce(e.cents, 0),
         coalesce(e.deposito, 0),
         coalesce(e.despesa, 0),
         coalesce(r.cents, 0) - coalesce(e.cents, 0)
  from meses m
  left join recebido r on r.mes = m.mes
  left join entregue e on e.mes = m.mes
  order by m.mes;
$$;

-- SECURITY DEFINER nasce executável por PUBLIC — inclusive anon.
revoke all on function public.crm_caixa_dinheiro(date, date) from public, anon;
grant execute on function public.crm_caixa_dinheiro(date, date) to authenticated;
