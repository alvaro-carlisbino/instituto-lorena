-- Centro de custo responde ONDE o dinheiro foi. A subclassificação responde EM QUÊ.
--
-- Pedido do financeiro em 18/09/2026: "além de escolher o centro de custo daquele gasto, devemos
-- poder detalhar mais informação. Foi um gasto para o centro cirúrgico, mas foi gasto com o quê?
-- Salários, mas para quem? Benefício, mas qual?".
--
-- Hoje a clínica tem dois níveis — grupo (Pessoas, Operação, Estrutura…) e centro de custo
-- (Salários e encargos com 111 lançamentos, Centro Cirúrgico com 115, Benefícios com 10). O
-- terceiro nível não existia, então "Salários e encargos: R$ 111 mil" era tudo que dava para
-- responder. Serve para pagar, não para decidir.
--
-- O detalhe é NOME, não id, pelo mesmo motivo de `cost_center`: ele viaja junto do lançamento,
-- da parcela e da regra, e relatório que junta as três não precisa de três joins para escrever
-- uma palavra. Renomear um detalhe é raro; contar errado por causa de join, não.

create table if not exists public.fin_cost_details (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  -- A que centro este detalhe pertence, pelo nome do centro.
  cost_center text not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Um detalhe por centro: "Férias" pode existir em Salários e em Pagamentos médicos, e são coisas
-- diferentes. Sem o centro na chave, o segundo cadastro morreria por engano.
create unique index if not exists fin_cost_details_unico
  on public.fin_cost_details (tenant_id, lower(cost_center), lower(name));

alter table public.fin_cost_details enable row level security;

drop policy if exists "fin_cost_details finance read" on public.fin_cost_details;
create policy "fin_cost_details finance read" on public.fin_cost_details
  for select using (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

drop policy if exists "fin_cost_details finance write" on public.fin_cost_details;
create policy "fin_cost_details finance write" on public.fin_cost_details
  for all using (tenant_id = public.current_tenant_id() and public.current_user_can_finance())
  with check (tenant_id = public.current_tenant_id() and public.current_user_can_finance());

-- O detalhe acompanha o lançamento, a parcela e a regra. Na regra é o que faz a classificação
-- valer a pena: carimbar centro numa tela e voltar depois para dizer "em quê" é duas passadas na
-- mesma lista, e a segunda ninguém faz.
alter table public.fin_transactions add column if not exists cost_detail text;
alter table public.payable_installments add column if not exists cost_detail text;
alter table public.fin_category_rules add column if not exists cost_detail text;

create index if not exists fin_transactions_cost_detail_idx
  on public.fin_transactions (tenant_id, cost_center, cost_detail)
  where cost_detail is not null;

-- Assinatura nova: `p_detalhe` no fim, com default. A antiga SAI de cena — duas assinaturas
-- vivas deixam o PostgREST ambíguo quando o cliente manda parâmetro por nome.
drop function if exists public.crm_classificar_saida(uuid, text, text);
drop function if exists public.crm_classificar_saida(uuid, text, text, text);

create function public.crm_classificar_saida(
  p_transaction_id uuid,
  p_centro text,
  p_pattern text default null,
  p_detalhe text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_centro text;
  v_detalhe text := nullif(btrim(coalesce(p_detalhe, '')), '');
  v_cat uuid;
  v_rule uuid;
  v_pattern text := nullif(btrim(coalesce(p_pattern, '')), '');
  n integer := 0;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  select cc.name into v_centro
  from public.fin_cost_centers cc
  where cc.tenant_id = v_tenant and lower(cc.name) = lower(btrim(p_centro)) and cc.active;
  if v_centro is null then
    raise exception 'centro de custo não existe: %', p_centro;
  end if;
  v_cat := public.crm_categoria_do_centro(v_tenant, v_centro);

  -- Detalhe novo nasce da própria classificação: obrigar a cadastrar antes é a diferença entre
  -- alguém detalhar o gasto e alguém deixar em branco. Ele fica na lista para a próxima vez.
  if v_detalhe is not null then
    insert into public.fin_cost_details (tenant_id, cost_center, name)
    values (v_tenant, v_centro, v_detalhe)
    on conflict (tenant_id, lower(cost_center), lower(name)) do nothing;
    -- Vale o nome já cadastrado, para "ferias" não virar um segundo "Férias" na lista.
    select d.name into v_detalhe
    from public.fin_cost_details d
    where d.tenant_id = v_tenant and lower(d.cost_center) = lower(v_centro)
      and lower(d.name) = lower(v_detalhe);
  end if;

  -- Classificado à mão: sai do rastro de regra, senão "desfazer regra" apagaria a escolha.
  update public.fin_transactions t
     set cost_center = v_centro, cost_detail = v_detalhe, category_id = v_cat, category_rule_id = null
   where t.id = p_transaction_id and t.tenant_id = v_tenant and t.direction = 'out';
  if not found then
    raise exception 'lançamento não encontrado';
  end if;

  if v_pattern is not null and length(v_pattern) >= 4 then
    insert into public.fin_category_rules (tenant_id, pattern, category_id, direction, cost_center, cost_detail)
    values (v_tenant, v_pattern, v_cat, 'out', v_centro, v_detalhe)
    on conflict (tenant_id, lower(pattern), coalesce(direction, 'all'))
    do update set category_id = excluded.category_id,
                  cost_center = excluded.cost_center,
                  cost_detail = excluded.cost_detail
    returning id into v_rule;

    update public.fin_transactions t
       set cost_center = v_centro, cost_detail = v_detalhe, category_id = v_cat, category_rule_id = v_rule
     where t.tenant_id = v_tenant
       and t.direction = 'out'
       and t.id <> p_transaction_id
       and (t.cost_center is null or t.category_rule_id = v_rule)
       and (public.crm_texto_casa(t.description, v_pattern) or public.crm_texto_casa(t.counterparty, v_pattern));
    get diagnostics n = row_count;
  end if;

  return n;
end $function$;

revoke all on function public.crm_classificar_saida(uuid, text, text, text) from public, anon;
grant execute on function public.crm_classificar_saida(uuid, text, text, text) to authenticated;

-- Gasto por centro e detalhe: é a pergunta "Salários e encargos, e dentro disso o quê?" virando
-- uma consulta só. Sem detalhe, a linha sai como "sem detalhe" — em vez de sumir, ela cobra.
create or replace function public.crm_gasto_por_detalhe(p_de date, p_ate date, p_centro text default null)
returns table(centro text, detalhe text, qtd bigint, amount_cents bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(t.cost_center, 'Sem centro de custo'),
         coalesce(t.cost_detail, 'Sem detalhe'),
         count(*)::bigint,
         sum(abs(t.amount_cents))::bigint
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind in ('banco', 'carteira')
    and t.direction = 'out'
    and not (a.kind = 'banco' and public.crm_e_pagamento_de_fatura(t.description))
    and t.date between p_de and p_ate
    and (p_centro is null or lower(t.cost_center) = lower(p_centro))
    and public.current_user_can_finance()
  group by 1, 2
  order by 4 desc;
$function$;

revoke all on function public.crm_gasto_por_detalhe(date, date, text) from public, anon;
grant execute on function public.crm_gasto_por_detalhe(date, date, text) to authenticated;

-- Gastos precisa mostrar e editar o detalhe na linha, então ele viaja junto na listagem.
drop function if exists public.crm_saidas_tudo(date, date);
create function public.crm_saidas_tudo(p_de date, p_ate date)
returns table(
  origem text, id text, data date, descricao text, contraparte text, amount_cents bigint,
  categoria text, centro_custo text, conciliado boolean, nao_e_gasto boolean,
  possivel_duplicado boolean, status text, conta text, do_cartao boolean, centro_detalhe text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 1) o que de fato saiu: da conta corrente e do cartão (o item, não a fatura)
  select 'banco', t.id::text, t.date,
         coalesce(t.description, ''), coalesce(t.counterparty, ''),
         abs(t.amount_cents)::bigint, c.name, t.cost_center,
         t.reconciled_ref_id is not null,
         coalesce(c.name ilike '%não é despesa%', false),
         (t.source = 'openfinance' and exists (
           select 1 from public.fin_transactions d
           where d.tenant_id = t.tenant_id and d.account_id = t.account_id
             and d.date = t.date and d.amount_cents = t.amount_cents
             and coalesce(d.description, '') = coalesce(t.description, '')
             and d.id <> t.id and d.source = 'openfinance'
             and d.created_at > t.created_at + interval '1 hour'
         )),
         'pago', a.name, a.kind = 'carteira', t.cost_detail
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  left join public.fin_categories c on c.id = t.category_id
  where t.tenant_id = public.current_tenant_id()
    and a.kind in ('banco', 'carteira')
    and t.direction = 'out'
    and not (a.kind = 'banco' and public.crm_e_pagamento_de_fatura(t.description))
    and t.date between p_de and p_ate
    and public.current_user_can_finance()
  union all
  -- 2) compromisso que ainda não apareceu no extrato (senão conta duas vezes)
  select 'a pagar', p.id::text, p.due_date,
         coalesce(p.description, ''), coalesce(nullif(p.counterparty, ''), s.name, ''),
         p.amount_cents::bigint, c.name, p.cost_center, false,
         coalesce(c.name ilike '%não é despesa%', false),
         false,
         p.status, null::text, false, p.cost_detail
  from public.payable_installments p
  left join public.fin_categories c on c.id = p.category_id
  left join public.stock_suppliers s on s.id = p.supplier_id
  where p.tenant_id = public.current_tenant_id()
    and p.due_date between p_de and p_ate
    and p.status <> 'cancelado'
    and not exists (
      select 1 from public.fin_transactions t2
      where t2.tenant_id = p.tenant_id and t2.reconciled_ref_type = 'payable' and t2.reconciled_ref_id = p.id
    )
    and public.current_user_can_finance()
  order by 3 desc;
$function$;

revoke all on function public.crm_saidas_tudo(date, date) from public, anon;
grant execute on function public.crm_saidas_tudo(date, date) to authenticated;
