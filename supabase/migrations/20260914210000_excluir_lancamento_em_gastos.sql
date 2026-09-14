-- EXCLUIR LANÇAMENTO EM GASTOS, SEM APAGAR A HISTÓRIA.
--
-- 14/set/2026, pedido do financeiro olhando /gastos: a nota da SEFAZ entra sozinha, e
-- nem toda nota emitida contra o CNPJ foi compra. Proposta comercial faturada antes do "sim",
-- boleto golpe: aparecem como conta a pagar e somam no gasto sem a clínica ter comprado nada.
-- E o Open Finance deixou cópia repetida de lançamento (a pendente que ganhou outro id).
--
-- Duas exclusões, com regras diferentes porque as duas coisas são diferentes:
--
--   CONTA A PAGAR vira 'cancelado'. Não some: a nota continua em purchase_invoices, e é
--   justamente isso que impede o crm-sefaz-sync de lançar a mesma nota de novo na hora
--   seguinte (ele casa por nfe_key).
--
--   LANÇAMENTO DO BANCO só sai se for CÓPIA: precisa existir outro igual em conta, dia, valor e
--   descrição. Pagamento de verdade não se exclui (ver crm_rateio_extrato_nao_se_mexe): o
--   dinheiro saiu, e o que muda é a leitura, como centro "Transferência entre contas".
--
-- Toda exclusão guarda a linha inteira em fin_lancamentos_excluidos e se desfaz por lá.

create table if not exists public.fin_lancamentos_excluidos (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants (id),
  origem text not null check (origem in ('a pagar', 'banco')),
  ref_id uuid not null,
  motivo text not null check (length(btrim(motivo)) > 0),
  snapshot jsonb not null,
  excluido_por uuid references auth.users (id) on delete set null default auth.uid(),
  excluido_em timestamptz not null default now(),
  desfeito_em timestamptz
);

create index if not exists fin_lancamentos_excluidos_tenant_idx
  on public.fin_lancamentos_excluidos (tenant_id, excluido_em desc);

alter table public.fin_lancamentos_excluidos enable row level security;

-- Só leitura pela API. Escrever é pelas funções abaixo, que conferem permissão e regra.
drop policy if exists "fin_lancamentos_excluidos finance read" on public.fin_lancamentos_excluidos;
create policy "fin_lancamentos_excluidos finance read" on public.fin_lancamentos_excluidos
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

/** Conta a pagar que não foi compra: sai do gasto e fica registrada como cancelada. */
create or replace function public.crm_excluir_conta_a_pagar(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.payable_installments%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;
  if v_motivo = '' then
    raise exception 'diga o motivo da exclusão';
  end if;

  select * into v from public.payable_installments p
  where p.id = p_id and p.tenant_id = public.current_tenant_id()
  for update;
  if not found then
    raise exception 'conta a pagar não encontrada';
  end if;
  if v.status = 'cancelado' then
    return;
  end if;
  -- Conciliada é conta que o banco mostrou paga: excluir apagaria um pagamento real.
  if exists (
    select 1 from public.fin_transactions t
    where t.tenant_id = v.tenant_id and t.reconciled_ref_type = 'payable' and t.reconciled_ref_id = v.id
  ) then
    raise exception 'esta conta já foi casada com um pagamento do banco; desfaça a conciliação antes';
  end if;

  insert into public.fin_lancamentos_excluidos (tenant_id, origem, ref_id, motivo, snapshot)
  values (v.tenant_id, 'a pagar', v.id, v_motivo, to_jsonb(v));

  update public.payable_installments p
     set status = 'cancelado',
         note = btrim(concat_ws(' · ', nullif(p.note, ''), 'Excluída em Gastos: ' || v_motivo)),
         updated_at = now()
   where p.id = v.id;
end $$;

revoke all on function public.crm_excluir_conta_a_pagar(uuid, text) from public, anon;
grant execute on function public.crm_excluir_conta_a_pagar(uuid, text) to authenticated;

/**
 * Cópia repetida de lançamento do banco. Recusa se não houver o outro igual: aí não é cópia,
 * é pagamento. A classificação feita na cópia passa para o que fica, para ninguém perder
 * trabalho por ter classificado a linha errada das duas.
 */
create or replace function public.crm_excluir_lancamento_repetido(p_id uuid, p_motivo text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.fin_transactions%rowtype;
  v_fica uuid;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  select * into v from public.fin_transactions t
  where t.id = p_id and t.tenant_id = public.current_tenant_id()
  for update;
  if not found then
    raise exception 'lançamento não encontrado';
  end if;
  if v.reconciled_ref_id is not null then
    raise exception 'este lançamento está conciliado com uma conta; desfaça a conciliação antes';
  end if;

  -- O que fica é o gravado por último: a cópia velha é a pendente que o banco substituiu.
  select d.id into v_fica
  from public.fin_transactions d
  where d.tenant_id = v.tenant_id and d.account_id = v.account_id
    and d.date = v.date and d.amount_cents = v.amount_cents
    and coalesce(d.description, '') = coalesce(v.description, '')
    and d.id <> v.id
  order by d.created_at desc
  limit 1;
  if v_fica is null then
    raise exception 'não existe outro lançamento igual: este não é cópia, é pagamento de verdade';
  end if;

  update public.fin_transactions d
     set cost_center = coalesce(d.cost_center, v.cost_center),
         category_id = case when d.cost_center is null and v.cost_center is not null then v.category_id else coalesce(d.category_id, v.category_id) end,
         category_rule_id = case when d.cost_center is null and v.cost_center is not null then v.category_rule_id else d.category_rule_id end,
         note = coalesce(d.note, v.note),
         counterparty = coalesce(d.counterparty, v.counterparty)
   where d.id = v_fica;

  update public.fin_transaction_splits s
     set transaction_id = v_fica
   where s.transaction_id = v.id
     and not exists (select 1 from public.fin_transaction_splits x where x.transaction_id = v_fica);

  insert into public.fin_lancamentos_excluidos (tenant_id, origem, ref_id, motivo, snapshot)
  values (v.tenant_id, 'banco', v.id, coalesce(nullif(btrim(p_motivo), ''), 'Cópia repetida do Open Finance'), to_jsonb(v));

  delete from public.fin_transactions where id = v.id;
  return v_fica;
end $$;

revoke all on function public.crm_excluir_lancamento_repetido(uuid, text) from public, anon;
grant execute on function public.crm_excluir_lancamento_repetido(uuid, text) to authenticated;

/** Desfaz uma exclusão: a conta volta ao status que tinha, a cópia do banco volta a existir. */
create or replace function public.crm_desfazer_exclusao(p_excluido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.fin_lancamentos_excluidos%rowtype;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  select * into e from public.fin_lancamentos_excluidos x
  where x.id = p_excluido_id and x.tenant_id = public.current_tenant_id() and x.desfeito_em is null
  for update;
  if not found then
    raise exception 'exclusão não encontrada ou já desfeita';
  end if;

  if e.origem = 'a pagar' then
    update public.payable_installments p
       set status = e.snapshot ->> 'status',
           note = e.snapshot ->> 'note',
           updated_at = now()
     where p.id = e.ref_id and p.tenant_id = e.tenant_id;
  else
    insert into public.fin_transactions
    select * from jsonb_populate_record(null::public.fin_transactions, e.snapshot)
    on conflict do nothing;
  end if;

  update public.fin_lancamentos_excluidos set desfeito_em = now() where id = e.id;
end $$;

revoke all on function public.crm_desfazer_exclusao(uuid) from public, anon;
grant execute on function public.crm_desfazer_exclusao(uuid) to authenticated;
