-- QUEM É QUEM NO EXTRATO — classificação de pagador recorrente, declarada pelo usuário.
--
-- A conciliação Shosp × banco lia a natureza do lançamento por regex embutido. Isso funciona
-- pro óbvio ("REDE VISA", "REND PAGO") e falha exatamente no que mais pesa: o Itaú escreve
-- "PIX TRANSF INSTITU16/07" para R$ 45.515 que não é venda de paciente nenhuma — é a outra
-- conta do grupo mandando dinheiro pra cá. Nenhum regex nasce sabendo disso.
--
-- Em julho/2026 esse único pagador respondia por R$ 412.215 em 22 lançamentos, e todos os 22
-- apareciam como "entrada no banco sem venda" — 22 das 161 divergências da tela eram um fato
-- de organização societária que o motor não tinha como adivinhar.
--
-- Aqui o usuário declara UMA vez e fica valendo. A declaração ganha de qualquer heurística:
-- quem viu o extrato é ele.

create table if not exists public.fin_reconcile_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  -- trecho da descrição do lançamento; casa por "contém", sem acento e sem caixa
  pattern text not null,
  -- adquirente | deposito | nao_venda | venda — mesmo vocabulário do CreditClass no motor
  classe text not null check (classe in ('adquirente', 'deposito', 'nao_venda', 'venda')),
  -- nome que o usuário deu, pra tela poder somar "R$ X de transferência entre contas próprias"
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- Mesma regra duas vezes só gera confusão sobre qual venceu.
-- `lower` e não `unaccent`: unaccent é STABLE, não IMMUTABLE, e índice não aceita — a
-- normalização de acento que importa é a do motor (normHeader), na hora de casar.
create unique index if not exists fin_reconcile_rules_tenant_pattern_uniq
  on public.fin_reconcile_rules (tenant_id, lower(pattern));

create index if not exists fin_reconcile_rules_tenant_idx
  on public.fin_reconcile_rules (tenant_id);

alter table public.fin_reconcile_rules enable row level security;

-- Mesmo padrão das outras fin_*: o tenant lê e escreve só o que é dele, e só quem tem
-- financeiro. Nunca `using (true)` — ver a auditoria de RLS de julho.
drop policy if exists "fin_reconcile_rules finance read" on public.fin_reconcile_rules;
create policy "fin_reconcile_rules finance read" on public.fin_reconcile_rules
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_reconcile_rules finance insert" on public.fin_reconcile_rules;
create policy "fin_reconcile_rules finance insert" on public.fin_reconcile_rules
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_reconcile_rules finance update" on public.fin_reconcile_rules;
create policy "fin_reconcile_rules finance update" on public.fin_reconcile_rules
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance())
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_reconcile_rules finance delete" on public.fin_reconcile_rules;
create policy "fin_reconcile_rules finance delete" on public.fin_reconcile_rules
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());
