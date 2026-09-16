-- VINCULAR NOTA EM ABERTO AO PAGAMENTO QUE SAIU COM OUTRO VALOR, E VER SE A NOTA ENTROU NO ESTOQUE.
--
-- 16/set/2026, pedido do Kauan (financeiro). A nota chega com o boleto, vence, e a clínica paga
-- um dia depois com juros e multa. O motor automático casa só valor EXATO (de propósito: chegar
-- perto é onde conciliação começa a inventar pagamento), então a nota fica "sem pagamento no
-- banco" para sempre, com o pagamento dela ali do lado no extrato.
--
-- O botão para ligar os dois já existia em Contas a pagar, mas procurava na janela curta do
-- navegador, abria direto em "paguei de outro jeito" quando não havia valor exato (justamente o
-- caso dos juros) e escondia os valores diferentes atrás de um clique. Não existia em Gastos,
-- que é onde a nota aparece como "sem pagamento no banco".
--
-- 1) crm_conciliacao_candidatos: as saídas do extrato ainda soltas em volta do vencimento de UMA
--    parcela, com a diferença de valor e se o nome do fornecedor aparece na descrição. O nome é
--    comparado pelo mesmo `crm_fornecedor_tokens` do motor, para não existir uma segunda regra
--    de "nome bate" no navegador. Quem decide é a pessoa; a função só ordena.
--
-- 2) crm_conciliacao_confirmar passa a levar o centro de custo da nota para a linha do banco
--    quando a linha não tem nenhum. Ligada, a parcela sai de Gastos e quem fica é a linha do
--    banco: sem isso a nota já classificada voltava como "falta classificar".
--
-- 3) crm_notas_estoque: por nota, quantos produtos entraram no estoque e por que não entrou.
--    O dado existia (movimento com ref_type='purchase_invoice'), mas só aparecia abrindo nota
--    por nota, e o financeiro não achou.

-- ────────────────────────────────────────────── 1) candidatos para vincular

create or replace function public.crm_conciliacao_candidatos(p_parcela uuid)
returns table (
  transacao_id uuid,
  data date,
  descricao text,
  conta text,
  valor_cents bigint,
  -- Positivo: saiu MAIS que a nota (juros, multa). Negativo: saiu menos (desconto).
  diferenca_cents bigint,
  nome_bate boolean,
  -- Dias entre o vencimento e a saída. Positivo = pago com atraso.
  dias integer
)
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select p.id, p.tenant_id, p.amount_cents::bigint as amount_cents, p.due_date,
           public.crm_fornecedor_tokens(coalesce(s.name, p.counterparty, '')) as toks
    from public.payable_installments p
    left join public.stock_suppliers s on s.id = p.supplier_id
    where p.id = p_parcela
      and p.tenant_id = public.current_tenant_id()
      and public.current_user_can_finance()
  ),
  c as (
    select
      t.id,
      t.date,
      coalesce(nullif(btrim(t.description), ''), t.counterparty, '') as descricao,
      coalesce(fa.name, '') as conta,
      abs(t.amount_cents)::bigint as valor,
      abs(t.amount_cents)::bigint - a.amount_cents as diferenca,
      exists (
        select 1 from unnest(a.toks) k
        where position(left(k, 10) in
          public.crm_txt_chave(coalesce(t.description, '') || ' ' || coalesce(t.counterparty, ''))) > 0
      ) as nome_bate,
      (t.date - a.due_date) as dias
    from a
    join public.fin_transactions t
      on t.tenant_id = a.tenant_id
     and t.direction = 'out'
     and t.reconciled_ref_id is null
     -- Janela larga de propósito: nota que chegou só em RESUMO vence na emissão, e o boleto
     -- dela pode cair 30, 60 ou 90 dias depois. Aqui quem escolhe é gente, não o motor.
     and t.date between a.due_date - 45 and a.due_date + 150
    left join public.fin_accounts fa on fa.id = t.account_id
  )
  select id, date, descricao, conta, valor, diferenca, nome_bate, dias
  from c
  order by (diferenca = 0) desc, nome_bate desc, abs(diferenca), abs(dias)
  limit 1000;
$$;

comment on function public.crm_conciliacao_candidatos(uuid) is
  'Saídas do extrato ainda não ligadas em volta do vencimento de uma parcela, com diferença de '
  'valor e se o nome do fornecedor aparece. Para vincular à mão o que o motor automático não '
  'casa (juros, multa, desconto).';

revoke all on function public.crm_conciliacao_candidatos(uuid) from public, anon;
grant execute on function public.crm_conciliacao_candidatos(uuid) to authenticated;

-- ────────────────────────────────────────────── 2) confirmar leva o centro de custo

create or replace function public.crm_conciliacao_confirmar(p_parcela uuid, p_transacao uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
  v_data date;
  v_conta uuid;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  -- `reconciled_ref_id is null` na condição: dois usuários na mesma fila não podem gastar o
  -- mesmo lançamento em duas parcelas.
  select t.date, t.account_id into v_data, v_conta
  from public.fin_transactions t
  where t.id = p_transacao
    and t.tenant_id = v_tenant
    and t.direction = 'out'
    and t.reconciled_ref_id is null;

  if v_data is null then
    return false;
  end if;

  -- Só preenche centro VAZIO: o que a regra ou alguém já classificou no extrato fica.
  update public.fin_transactions t
     set reconciled_ref_type = 'payable',
         reconciled_ref_id = p_parcela,
         cost_center = coalesce(t.cost_center, p.cost_center)
    from public.payable_installments p
   where t.id = p_transacao and t.reconciled_ref_id is null
     and p.id = p_parcela and p.tenant_id = v_tenant;

  update public.payable_installments
     set status = 'pago',
         paid_at = (v_data::text || ' 12:00:00')::timestamptz,
         account_id = coalesce(account_id, v_conta),
         updated_at = now()
   where id = p_parcela and tenant_id = v_tenant and status = 'aberto';

  return true;
end $$;

revoke all on function public.crm_conciliacao_confirmar(uuid, uuid) from public, anon;
grant execute on function public.crm_conciliacao_confirmar(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────── 3) a nota entrou no estoque?

create or replace function public.crm_notas_estoque()
returns table (
  invoice_id uuid,
  -- Produtos distintos que entraram por esta nota.
  itens integer,
  -- Já no financeiro, esperando a entrada (roda ao abrir a aba Notas fiscais).
  pendente boolean,
  da_sefaz boolean,
  -- A SEFAZ mandou a lista de produtos. Sem ela (só o resumo) não há o que dar entrada.
  tem_xml boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pi.id,
    coalesce(m.itens, 0)::integer,
    coalesce(sd.estoque_pendente, false),
    sd.id is not null,
    coalesce(sd.tem_xml, false)
  from public.purchase_invoices pi
  left join lateral (
    select count(distinct mv.item_id) as itens
    from public.stock_movements mv
    where mv.ref_type = 'purchase_invoice'
      and mv.ref_id = pi.id::text
      and mv.tenant_id = pi.tenant_id
      and mv.qty_delta > 0
  ) m on true
  left join lateral (
    select d.id, d.estoque_pendente, d.xml is not null as tem_xml
    from public.sefaz_documentos d
    where d.invoice_id = pi.id and d.tenant_id = pi.tenant_id
    order by (d.xml is not null) desc
    limit 1
  ) sd on true
  where pi.tenant_id = public.current_tenant_id();
$$;

comment on function public.crm_notas_estoque() is
  'Por nota de compra do polo: quantos produtos entraram no estoque, se a entrada está pendente '
  'e se a SEFAZ mandou a lista de produtos (XML) ou só o resumo.';

revoke all on function public.crm_notas_estoque() from public, anon;
grant execute on function public.crm_notas_estoque() to authenticated;
