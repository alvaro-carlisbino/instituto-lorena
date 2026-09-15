-- Nota que entrou em RESUMO e ganhou o XML depois: a parcela passa a vencer quando o boleto vence.
--
-- 15/set/2026. A NF 2843542 da Surya aparecia em /gastos como "nota sem pagamento no banco",
-- vencida em 08/09. O boleto vence em 08/10, e o XML guardado diz isso desde o dia seguinte.
--
-- Causa: o resumo da SEFAZ não traz duplicata, então o `crm-sefaz-sync` lança UMA parcela vencendo
-- na emissão. Quando o XML completo chega numa rodada seguinte, o passo 2 guardava o arquivo e
-- voltava a nota para a fila do estoque, mas nunca relia a cobrança: a conta a pagar nascida do
-- resumo ficava para sempre com a data de emissão. Eram 23 notas assim, 13 ainda em aberto, e as
-- duas da Doctus (16490 e 16805, quatro boletos cada, R$ 23 mil) apareciam como uma parcela só,
-- já vencida.
--
-- Isto troca a parcela do resumo pelas duplicatas do XML. O XML é lido na edge function (um parser
-- só, o mesmo que lança as notas completas); aqui fica a troca, numa transação, e só se a parcela
-- ainda for exatamente o que o resumo criou. Qualquer mão humana nela (vencimento remarcado, valor
-- corrigido, observação escrita, paga, conciliada, cancelada) e a função não mexe: quem conferiu
-- sabe mais que o XML.

create or replace function public.crm_sefaz_aplicar_duplicatas(
  p_tenant text,
  p_parcela uuid,
  p_dups jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Mesmo texto que o `crm-sefaz-sync` grava na parcela do resumo (NOTA_VENCE_NA_EMISSAO).
  c_nota_resumo constant text := 'Vencimento = emissão: a nota não traz duplicata. Conferir se já foi paga.';
  v record;
  v_n integer;
begin
  if coalesce(trim(p_tenant), '') = '' then
    raise exception 'crm_sefaz_aplicar_duplicatas: polo obrigatório';
  end if;
  if p_dups is null or jsonb_typeof(p_dups) <> 'array' then
    raise exception 'crm_sefaz_aplicar_duplicatas: duplicatas precisam vir em lista';
  end if;

  -- Trava a parcela: se alguém estiver salvando o editor agora, um dos dois espera o outro.
  select p.id, p.invoice_id, p.status, p.note, p.due_date, p.amount_cents, p.import_key,
         p.payment_method, i.issue_date, i.total_cents, i.nfe_key, i.number
    into v
    from public.payable_installments p
    join public.purchase_invoices i on i.id = p.invoice_id
   where p.id = p_parcela and p.tenant_id = p_tenant and i.tenant_id = p_tenant
     for update of p;

  if not found then
    return 0;
  end if;

  -- Ainda é a parcela que o resumo criou, intocada?
  if v.status <> 'aberto'
     or v.note is distinct from c_nota_resumo
     or v.due_date is distinct from v.issue_date
     or v.amount_cents is distinct from v.total_cents
     or v.import_key is distinct from 'sefaz:' || v.nfe_key then
    return 0;
  end if;
  if exists (
    select 1 from public.fin_transactions t
     where t.tenant_id = p_tenant and t.reconciled_ref_type = 'payable' and t.reconciled_ref_id = p_parcela
  ) then
    return 0;
  end if;
  if exists (
    select 1 from public.payable_installments o
     where o.tenant_id = p_tenant and o.invoice_id = v.invoice_id and o.id <> p_parcela and o.status <> 'cancelado'
  ) then
    return 0;
  end if;

  v_n := jsonb_array_length(p_dups);

  -- XML sem duplicata: compra à vista, o vencimento na emissão estava certo. Troca só o texto, e é
  -- isso que tira a parcela da lista de conferência das próximas rodadas.
  if v_n = 0 then
    update public.payable_installments
       set note = 'Vencimento = emissão: nem o XML completo traz duplicata. Conferir se já foi paga.',
           updated_at = now()
     where id = p_parcela;
    return 1;
  end if;

  -- A primeira duplicata fica na parcela que já existe (o centro de custo escolhido vai junto); as
  -- outras nascem como irmãs, com o mesmo centro, fornecedor e razão social. Chave por parcela
  -- quando há mais de uma, pelo mesmo motivo do lançamento normal (índice único por polo).
  update public.payable_installments
     set due_date       = (p_dups -> 0 ->> 'vencimento')::date,
         amount_cents   = (p_dups -> 0 ->> 'centavos')::bigint,
         description    = 'NF ' || v.number || ' — parcela ' || coalesce(p_dups -> 0 ->> 'numero', '1'),
         payment_method = coalesce(v.payment_method, 'boleto'),
         note           = 'Duplicata do XML da NF-e. Conferir se já foi paga.',
         import_key     = case when v_n > 1 then 'sefaz:' || v.nfe_key || ':1' else v.import_key end,
         updated_at     = now()
   where id = p_parcela;

  if v_n > 1 then
    insert into public.payable_installments (
      tenant_id, supplier_id, invoice_id, category_id, account_id, description, due_date,
      amount_cents, status, payment_method, note, cost_center, counterparty, subcategory, import_key
    )
    select p.tenant_id, p.supplier_id, p.invoice_id, p.category_id, p.account_id,
           'NF ' || v.number || ' — parcela ' || coalesce(d.item ->> 'numero', d.ordem::text),
           (d.item ->> 'vencimento')::date,
           (d.item ->> 'centavos')::bigint,
           'aberto', p.payment_method, p.note, p.cost_center, p.counterparty, p.subcategory,
           'sefaz:' || v.nfe_key || ':' || d.ordem
      from public.payable_installments p
     cross join lateral jsonb_array_elements(p_dups) with ordinality as d(item, ordem)
     where p.id = p_parcela and d.ordem > 1;
  end if;

  return v_n;
end;
$$;

-- Só a edge function (service_role) chama. Ninguém no navegador tem o que fazer com isto.
revoke all on function public.crm_sefaz_aplicar_duplicatas(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_sefaz_aplicar_duplicatas(text, uuid, jsonb) to service_role;
