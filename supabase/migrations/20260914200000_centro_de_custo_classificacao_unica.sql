-- CENTRO DE CUSTO É A CLASSIFICAÇÃO. UMA LISTA SÓ.
--
-- 14/set/2026. O financeiro da clínica classificava a saída em DUAS listas que se sobrepunham:
-- a categoria (semeada pelo sistema: "Salários e pró-labore", "Impostos e taxas", "Outros") e o
-- centro de custo (o vocabulário da planilha da clínica: "Salários e encargos", "Impostos",
-- "Pagamentos médicos"). O Extrato perguntava uma, o Gastos perguntava a outra, e quem
-- classificava num lugar não via o número mexer no outro. Na prática a categoria virou ruído:
-- centenas de lançamentos carimbados como "Outros" sem centro nenhum.
--
-- A decisão (pedido do financeiro): a lista que vale é a de CENTRO DE CUSTO. A categoria
-- continua existindo por baixo, porque o DRE e a regra "não é despesa" dependem dela, mas passa
-- a ser DERIVADA do centro. Uma pergunta por lançamento.

-- ────────────────────────────────────────────── o centro se explica

alter table public.fin_cost_centers
  add column if not exists description text,
  add column if not exists grupo text,
  add column if not exists category_id uuid references public.fin_categories (id) on delete set null;

comment on column public.fin_cost_centers.description is
  'O que entra neste centro, em uma frase. Aparece no seletor, onde a dúvida acontece.';
comment on column public.fin_cost_centers.grupo is
  'Cabeçalho que agrupa centros no seletor e no relatório (Pessoas, Operação, Não é gasto).';
comment on column public.fin_cost_centers.category_id is
  'Linha do DRE em que este centro entra. A categoria do lançamento é derivada daqui.';

-- Os dois que faltavam na lista: dinheiro que sai da conta e não é gasto. Sem eles, a
-- transferência entre contas não tinha centro possível e inflava o total de gastos.
insert into public.fin_cost_centers (tenant_id, name, sort_order)
select t.id, v.nome, v.ord
from public.tenants t
cross join (values ('Transferência entre contas', 900), ('Aplicação financeira', 910)) v(nome, ord)
where exists (select 1 from public.fin_cost_centers c where c.tenant_id = t.id)
on conflict do nothing;

with v(nome, grupo, ord, descr, categoria) as (values
  ('Salários e encargos', 'Pessoas', 10, 'Folha CLT: salário, FGTS, INSS, férias, 13º e rescisão.', 'Salários e pró-labore'),
  ('Pagamentos médicos', 'Pessoas', 20, 'Médicos, anestesistas e profissionais pagos por procedimento ou plantão.', 'Salários e pró-labore'),
  ('Benefícios', 'Pessoas', 30, 'Vale-transporte, alimentação e plano de saúde da equipe.', 'Salários e pró-labore'),
  ('RH/DP', 'Pessoas', 40, 'Exame admissional, uniforme, curso, recrutamento e confraternização.', 'Salários e pró-labore'),
  ('Centro Cirúrgico', 'Operação', 50, 'Material, insumo, equipamento e serviço usados nas cirurgias.', 'Fornecedores e insumos'),
  ('Atendimento', 'Operação', 60, 'Recepção, copa, material de consulta e cuidado com o paciente.', 'Fornecedores e insumos'),
  ('SPA', 'Operação', 70, 'Produtos e serviços do SPA.', 'Fornecedores e insumos'),
  ('Londrina', 'Operação', 80, 'Gastos da unidade de Londrina.', 'Outros'),
  ('Devolução paciente', 'Operação', 90, 'Estorno ou devolução de dinheiro para paciente.', 'Outros'),
  ('Infraestrutura', 'Estrutura', 100, 'Aluguel, água, luz, telefone, internet e manutenção do prédio.', 'Manutenção'),
  ('Obra', 'Estrutura', 110, 'Reforma, construção e móveis da obra.', 'Manutenção'),
  ('Administrativo', 'Estrutura', 120, 'Sistemas, contabilidade, jurídico, escritório e tarifa de banco.', 'Outros'),
  ('Marketing', 'Comercial', 130, 'Anúncios, agência, influenciador, brinde e evento.', 'Marketing e anúncios'),
  ('Impostos', 'Impostos e sócios', 140, 'DARF, ISS, taxas da prefeitura e parcelamento de imposto.', 'Impostos e taxas'),
  ('Retirada sócios', 'Impostos e sócios', 150, 'Pró-labore e distribuição de lucro para os sócios.', 'Pró-labore sócios'),
  ('Transferência entre contas', 'Não é gasto', 900, 'Dinheiro que só mudou de uma conta da clínica para outra. Fica fora do total de gastos.', 'Transferência entre contas próprias (não é despesa)'),
  ('Aplicação financeira', 'Não é gasto', 910, 'Dinheiro guardado em investimento. Fica fora do total de gastos.', 'Aplicação financeira (não é despesa)')
)
update public.fin_cost_centers cc
   set grupo = coalesce(cc.grupo, v.grupo),
       description = coalesce(cc.description, v.descr),
       sort_order = v.ord,
       category_id = coalesce(
         cc.category_id,
         (select c.id from public.fin_categories c
           where c.tenant_id = cc.tenant_id and c.kind = 'despesa' and c.name = v.categoria
           limit 1)
       )
  from v
 where lower(cc.name) = lower(v.nome);

-- ────────────────────────────────────────────── categoria derivada do centro

-- Centro sem linha do DRE configurada cai em "Outros": o lançamento classificado nunca pode
-- voltar a contar como "sem categoria" só porque alguém criou um centro novo na configuração.
create or replace function public.crm_categoria_do_centro(p_tenant text, p_centro text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select cc.category_id from public.fin_cost_centers cc
      where cc.tenant_id = p_tenant and lower(cc.name) = lower(btrim(p_centro)) and cc.category_id is not null
      limit 1),
    (select c.id from public.fin_categories c
      where c.tenant_id = p_tenant and c.kind = 'despesa' and c.name = 'Outros'
      order by c.active desc
      limit 1)
  )
$$;

revoke all on function public.crm_categoria_do_centro(text, text) from public, anon, authenticated;

-- Mudar a linha do DRE de um centro arrasta os lançamentos dele. Sem isso a configuração
-- diria uma coisa e o DRE mostraria outra.
create or replace function public.fin_cost_centers_rederiva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is distinct from old.category_id then
    update public.fin_transactions t
       set category_id = public.crm_categoria_do_centro(new.tenant_id, new.name)
     where t.tenant_id = new.tenant_id and t.direction = 'out' and t.cost_center = new.name;
    update public.fin_category_rules r
       set category_id = public.crm_categoria_do_centro(new.tenant_id, new.name)
     where r.tenant_id = new.tenant_id and r.cost_center = new.name;
  end if;
  return new;
end $$;

drop trigger if exists fin_cost_centers_rederiva on public.fin_cost_centers;
create trigger fin_cost_centers_rederiva
  after update of category_id on public.fin_cost_centers
  for each row execute function public.fin_cost_centers_rederiva();

-- ────────────────────────────────────────────── o que já estava classificado

-- 1) Quem só tinha categoria específica ganha o centro equivalente. Só as que não deixam
--    dúvida: "Salários e pró-labore" pode ser folha ou médico, "Fornecedores" e "Outros" não
--    dizem onde; esses ficam sem centro para alguém olhar.
with m(categoria, centro) as (values
  ('Transferência entre contas próprias (não é despesa)', 'Transferência entre contas'),
  ('Aplicação financeira (não é despesa)', 'Aplicação financeira'),
  ('Impostos e taxas', 'Impostos'),
  ('Marketing e anúncios', 'Marketing'),
  ('Água/luz/telefone/internet', 'Infraestrutura'),
  ('Aluguel', 'Infraestrutura'),
  ('Manutenção', 'Infraestrutura'),
  ('Taxas bancárias', 'Administrativo'),
  ('Pró-labore sócios', 'Retirada sócios')
)
update public.fin_transactions t
   set cost_center = cc.name
  from public.fin_categories c, m, public.fin_cost_centers cc
 where c.id = t.category_id and c.name = m.categoria
   and cc.tenant_id = t.tenant_id and lower(cc.name) = lower(m.centro)
   and t.cost_center is null and t.direction = 'out';

with m(categoria, centro) as (values
  ('Transferência entre contas próprias (não é despesa)', 'Transferência entre contas'),
  ('Aplicação financeira (não é despesa)', 'Aplicação financeira'),
  ('Impostos e taxas', 'Impostos'),
  ('Marketing e anúncios', 'Marketing'),
  ('Água/luz/telefone/internet', 'Infraestrutura'),
  ('Aluguel', 'Infraestrutura'),
  ('Manutenção', 'Infraestrutura'),
  ('Taxas bancárias', 'Administrativo'),
  ('Pró-labore sócios', 'Retirada sócios')
)
update public.fin_category_rules r
   set cost_center = cc.name
  from public.fin_categories c, m, public.fin_cost_centers cc
 where c.id = r.category_id and c.name = m.categoria
   and cc.tenant_id = r.tenant_id and lower(cc.name) = lower(m.centro)
   and r.cost_center is null and coalesce(r.direction, 'out') = 'out';

-- 2) Quem tem centro: a categoria passa a seguir o centro. Quando as duas discordavam, o
--    centro ganha, porque é a lista que o financeiro de fato usa.
update public.fin_transactions t
   set category_id = public.crm_categoria_do_centro(t.tenant_id, t.cost_center)
 where t.direction = 'out' and t.cost_center is not null
   and t.category_id is distinct from public.crm_categoria_do_centro(t.tenant_id, t.cost_center);

update public.fin_category_rules r
   set category_id = public.crm_categoria_do_centro(r.tenant_id, r.cost_center)
 where r.cost_center is not null
   and r.category_id is distinct from public.crm_categoria_do_centro(r.tenant_id, r.cost_center);

update public.fin_transaction_splits s
   set category_id = public.crm_categoria_do_centro(s.tenant_id, s.cost_center)
 where s.cost_center is not null
   and s.category_id is distinct from public.crm_categoria_do_centro(s.tenant_id, s.cost_center);

-- ────────────────────────────────────────────── classificar

-- O extrato do Itaú escreve "BOLETO  PAGO" com dois espaços e o padrão da regra é guardado com
-- um. Comparar sem normalizar o espaço fazia regra nenhuma casar com boleto.
create or replace function public.crm_texto_casa(p_texto text, p_pattern text)
returns boolean
language sql
immutable
as $$
  select regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g')
         ilike '%' || regexp_replace(btrim(p_pattern), '\s+', ' ', 'g') || '%'
$$;

/**
 * Quantos lançamentos um "aplicar aos iguais" vai mexer, ANTES de mexer.
 *
 * Conta os sem centro que casam com o padrão e os que uma regra de mesmo padrão já tinha
 * carimbado (eles seguem a regra se ela mudar). Carimbo em massa sem mostrar o tamanho antes é
 * como se classificam dezenas de PIX QR-CODE como uma coisa só.
 */
create or replace function public.crm_iguais_sem_centro(p_pattern text, p_excluir uuid default null)
returns table (qtd bigint, amount_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint, coalesce(sum(abs(t.amount_cents)), 0)::bigint
  from public.fin_transactions t
  where t.tenant_id = public.current_tenant_id()
    and public.current_user_can_finance()
    and length(btrim(coalesce(p_pattern, ''))) >= 4
    and t.direction = 'out'
    and (p_excluir is null or t.id <> p_excluir)
    and (
      t.cost_center is null
      or t.category_rule_id in (
        select r.id from public.fin_category_rules r
        where r.tenant_id = t.tenant_id and lower(r.pattern) = lower(btrim(p_pattern))
      )
    )
    and (public.crm_texto_casa(t.description, p_pattern) or public.crm_texto_casa(t.counterparty, p_pattern));
$$;

revoke all on function public.crm_iguais_sem_centro(text, uuid) from public, anon;
grant execute on function public.crm_iguais_sem_centro(text, uuid) to authenticated;

/**
 * Classifica UMA saída do banco num centro e, se vier padrão, vira regra que carimba os iguais.
 *
 * Devolve quantos lançamentos ALÉM deste foram carimbados. A categoria nunca vem do cliente:
 * é derivada do centro aqui dentro, então não existe mais lançamento com centro de um jeito e
 * categoria de outro.
 */
create or replace function public.crm_classificar_saida(
  p_transaction_id uuid,
  p_centro text,
  p_pattern text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
  v_centro text;
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

  -- Classificado à mão: sai do rastro de regra, senão "desfazer regra" apagaria a escolha.
  update public.fin_transactions t
     set cost_center = v_centro, category_id = v_cat, category_rule_id = null
   where t.id = p_transaction_id and t.tenant_id = v_tenant and t.direction = 'out';
  if not found then
    raise exception 'lançamento não encontrado';
  end if;

  if v_pattern is not null and length(v_pattern) >= 4 then
    insert into public.fin_category_rules (tenant_id, pattern, category_id, direction, cost_center)
    values (v_tenant, v_pattern, v_cat, 'out', v_centro)
    on conflict (tenant_id, lower(pattern), coalesce(direction, 'all'))
    do update set category_id = excluded.category_id, cost_center = excluded.cost_center
    returning id into v_rule;

    update public.fin_transactions t
       set cost_center = v_centro, category_id = v_cat, category_rule_id = v_rule
     where t.tenant_id = v_tenant
       and t.direction = 'out'
       and t.id <> p_transaction_id
       and (t.cost_center is null or t.category_rule_id = v_rule)
       and (public.crm_texto_casa(t.description, v_pattern) or public.crm_texto_casa(t.counterparty, v_pattern));
    get diagnostics n = row_count;
  end if;

  return n;
end $$;

revoke all on function public.crm_classificar_saida(uuid, text, text) from public, anon;
grant execute on function public.crm_classificar_saida(uuid, text, text) to authenticated;

-- Desfazer uma regra tira também o centro que ELA pôs. O centro posto à mão antes da regra
-- (regra antiga, que só carimbava categoria) fica.
create or replace function public.crm_desfazer_regra_categoria(p_rule_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  update public.fin_transactions t
     set category_id = null,
         category_rule_id = null,
         cost_center = case when r.cost_center is not null and t.cost_center = r.cost_center then null else t.cost_center end
    from public.fin_category_rules r
   where r.id = p_rule_id
     and t.tenant_id = public.current_tenant_id()
     and t.category_rule_id = p_rule_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.crm_desfazer_regra_categoria(uuid) from public, anon;
grant execute on function public.crm_desfazer_regra_categoria(uuid) to authenticated;

-- ────────────────────────────────────────────── regra vale para o que ainda vai chegar

-- A regra só carimbava o que já existia no momento em que era criada. O extrato do mês seguinte
-- chegava pelo Open Finance sem classificação nenhuma, e quem classificou "COPEL" em agosto
-- classificava de novo em setembro. É isso que faz alguém desistir de classificar.
create or replace function public.fin_transactions_aplica_regra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if new.category_id is not null or new.cost_center is not null then
    return new;
  end if;

  select fr.id, fr.category_id, fr.cost_center into r
  from public.fin_category_rules fr
  where fr.tenant_id = new.tenant_id
    and (fr.direction is null or fr.direction = new.direction)
    and length(btrim(fr.pattern)) >= 4
    and (public.crm_texto_casa(new.description, fr.pattern) or public.crm_texto_casa(new.counterparty, fr.pattern))
  -- Regra que diz o centro ganha da que só diz categoria; entre iguais, o padrão mais longo é
  -- o mais específico.
  order by (fr.cost_center is not null) desc, length(fr.pattern) desc
  limit 1;

  if found then
    new.category_id := r.category_id;
    new.cost_center := case when new.direction = 'out' then r.cost_center end;
    new.category_rule_id := r.id;
  end if;
  return new;
end $$;

drop trigger if exists fin_transactions_aplica_regra on public.fin_transactions;
create trigger fin_transactions_aplica_regra
  before insert on public.fin_transactions
  for each row execute function public.fin_transactions_aplica_regra();

-- ────────────────────────────────────────────── as leituras passam a olhar o centro

-- "Classificada" agora quer dizer "tem centro de custo".
create or replace function public.crm_extrato_por_dia(p_de date, p_ate date)
returns table (dia date, entrou_cents bigint, saiu_cents bigint, saida_classificada_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.date,
         coalesce(sum(t.amount_cents) filter (where t.direction = 'in'), 0)::bigint,
         coalesce(sum(abs(t.amount_cents)) filter (where t.direction = 'out'), 0)::bigint,
         coalesce(sum(abs(t.amount_cents)) filter (where t.direction = 'out' and t.cost_center is not null), 0)::bigint
  from public.fin_transactions t join public.fin_accounts a on a.id = t.account_id
  where t.tenant_id = public.current_tenant_id() and a.kind = 'banco'
    and t.date between p_de and p_ate and public.current_user_can_finance()
  group by t.date order by t.date;
$$;

create or replace function public.crm_dre(p_de date, p_ate date)
returns table (mes text, receita_cents bigint, despesa_cents bigint, despesa_classificada_cents bigint, fora_do_resultado_cents bigint, resultado_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  with meses as (
    select to_char(d, 'YYYY-MM') as mes
    from generate_series(date_trunc('month', p_de), date_trunc('month', p_ate), interval '1 month') d
  ),
  -- RECEITA = o que o paciente pagou (regime de competência), não o que caiu na conta.
  receita as (
    select to_char(r.due_date, 'YYYY-MM') mes, sum(r.amount_cents)::bigint cents
    from public.fin_receivables r
    where r.tenant_id = public.current_tenant_id()
      and r.status <> 'cancelado'
      and r.due_date between p_de and p_ate
      and public.current_user_can_finance()
    group by 1
  ),
  -- DESPESA lê as linhas EFETIVAS: lançamento com rateio entra pelos pedaços.
  saida as (
    select to_char(e.data, 'YYYY-MM') mes,
           sum(e.amount_cents)::bigint total,
           sum(e.amount_cents) filter (where e.cost_center is not null)::bigint classificada,
           -- Aplicação e transferência entre contas próprias saem do resultado.
           sum(e.amount_cents) filter (where e.categoria ilike '%não é despesa%')::bigint fora
    from public.crm_saidas_efetivas(p_de, p_ate) e
    group by 1
  )
  select m.mes,
         coalesce(r.cents, 0),
         coalesce(s.total, 0) - coalesce(s.fora, 0),
         coalesce(s.classificada, 0) - coalesce(s.fora, 0),
         coalesce(s.fora, 0),
         coalesce(r.cents, 0) - (coalesce(s.total, 0) - coalesce(s.fora, 0))
  from meses m
  left join receita r on r.mes = m.mes
  left join saida s on s.mes = m.mes
  order by m.mes;
$$;

-- /gastos: a nota da SEFAZ ganha o nome do fornecedor (o resumo só dizia "NF 147, à vista"), a
-- linha diz se é gasto de verdade, e o lançamento que o Open Finance gravou duas vezes aparece
-- marcado em vez de somar calado.
drop function if exists public.crm_saidas_tudo(date, date);

create function public.crm_saidas_tudo(p_de date, p_ate date)
returns table (
  origem text, id text, data date, descricao text, contraparte text,
  amount_cents bigint, categoria text, centro_custo text, conciliado boolean,
  nao_e_gasto boolean, possivel_duplicado boolean, status text
)
language sql
stable
security definer
set search_path = public
as $$
  -- 1) o que de fato saiu da conta
  select 'banco', t.id::text, t.date,
         coalesce(t.description, ''), coalesce(t.counterparty, ''),
         abs(t.amount_cents)::bigint, c.name, t.cost_center,
         t.reconciled_ref_id is not null,
         coalesce(c.name ilike '%não é despesa%', false),
         -- O Open Finance devolve o lançamento PENDENTE com um id e, quando compensa, com outro.
         -- A cópia criada antes, igual em conta, dia, descrição e valor, é a pendente que ficou.
         (t.source = 'openfinance' and exists (
           select 1 from public.fin_transactions d
           where d.tenant_id = t.tenant_id and d.account_id = t.account_id
             and d.date = t.date and d.amount_cents = t.amount_cents
             and coalesce(d.description, '') = coalesce(t.description, '')
             and d.id <> t.id and d.source = 'openfinance'
             and d.created_at > t.created_at + interval '1 hour'
         )),
         'pago'
  from public.fin_transactions t
  join public.fin_accounts a on a.id = t.account_id
  left join public.fin_categories c on c.id = t.category_id
  where t.tenant_id = public.current_tenant_id() and a.kind = 'banco'
    and t.direction = 'out' and t.date between p_de and p_ate
    and public.current_user_can_finance()
  union all
  -- 2) compromisso que ainda não apareceu no extrato (senão conta duas vezes)
  select 'a pagar', p.id::text, p.due_date,
         coalesce(p.description, ''), coalesce(nullif(p.counterparty, ''), s.name, ''),
         p.amount_cents::bigint, c.name, p.cost_center, false,
         coalesce(c.name ilike '%não é despesa%', false),
         false,
         p.status
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
$$;

revoke all on function public.crm_saidas_tudo(date, date) from public, anon;
grant execute on function public.crm_saidas_tudo(date, date) to authenticated;

-- Função de gatilho não é para ser chamada por ninguém de fora.
revoke all on function public.fin_transactions_aplica_regra() from public, anon, authenticated;
revoke all on function public.fin_cost_centers_rederiva() from public, anon, authenticated;

-- ────────────────────────────────────────────── centro e categoria nunca discordam

-- Garantido no banco, e não em cada tela: a sugestão da IA, a planilha de gastos, o editor de
-- parcela e a regra antiga ainda mandam categoria própria. Com o gatilho, qualquer caminho que
-- grave um centro sai com a categoria do centro.
create or replace function public.fin_deriva_categoria_do_centro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cost_center is not null then
    new.category_id := coalesce(public.crm_categoria_do_centro(new.tenant_id, new.cost_center), new.category_id);
  end if;
  return new;
end $$;

revoke all on function public.fin_deriva_categoria_do_centro() from public, anon, authenticated;

drop trigger if exists fin_transactions_deriva_categoria on public.fin_transactions;
create trigger fin_transactions_deriva_categoria
  before insert or update of cost_center, category_id on public.fin_transactions
  for each row when (new.direction = 'out')
  execute function public.fin_deriva_categoria_do_centro();

drop trigger if exists fin_category_rules_deriva_categoria on public.fin_category_rules;
create trigger fin_category_rules_deriva_categoria
  before insert or update of cost_center, category_id on public.fin_category_rules
  for each row execute function public.fin_deriva_categoria_do_centro();

drop trigger if exists payable_installments_deriva_categoria on public.payable_installments;
create trigger payable_installments_deriva_categoria
  before insert or update of cost_center, category_id on public.payable_installments
  for each row execute function public.fin_deriva_categoria_do_centro();

drop trigger if exists fin_transaction_splits_deriva_categoria on public.fin_transaction_splits;
create trigger fin_transaction_splits_deriva_categoria
  before insert or update of cost_center, category_id on public.fin_transaction_splits
  for each row execute function public.fin_deriva_categoria_do_centro();

-- A regra vinda da sugestão da IA diz centro: ela precisa alcançar também o lançamento que já
-- tinha categoria genérica ("Outros") e nenhum centro.
create or replace function public.crm_aplicar_regra_categoria(
  p_pattern text,
  p_category_id uuid,
  p_direction text default null,
  p_sobrescrever boolean default false,
  p_cost_center text default null,
  p_rule_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  update public.fin_transactions t
     set category_id = p_category_id,
         cost_center = coalesce(p_cost_center, t.cost_center),
         category_rule_id = coalesce(p_rule_id, t.category_rule_id)
   where t.tenant_id = public.current_tenant_id()
     and (p_direction is null or t.direction = p_direction)
     and (p_sobrescrever or t.category_id is null or (p_cost_center is not null and t.cost_center is null))
     and (public.crm_texto_casa(t.description, p_pattern) or public.crm_texto_casa(t.counterparty, p_pattern));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean, text, uuid) from public, anon;
grant execute on function public.crm_aplicar_regra_categoria(text, uuid, text, boolean, text, uuid) to authenticated;

-- O que foi classificado entre a primeira parte desta migração e os gatilhos.
update public.fin_transactions t
   set category_id = public.crm_categoria_do_centro(t.tenant_id, t.cost_center)
 where t.direction = 'out' and t.cost_center is not null
   and t.category_id is distinct from public.crm_categoria_do_centro(t.tenant_id, t.cost_center);
