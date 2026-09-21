-- O QUE O BANCO RETIROU DO EXTRATO SAI DO NOSSO TAMBÉM.
--
-- 21/set/2026, Kauan em /gastos: dois "SISPAG FORNECEDORES" (R$ 5.257,25 em 11/09 e
-- R$ 1.636,29 em 10/09) para classificar, "mas no extrato não aparece como saída". Ele estava
-- certo: o Itaú não mostra mais nenhum dos dois.
--
-- O Itaú publica o AGENDAMENTO na véspera, perto das 21h: "SISPAG FORNECEDORES",
-- "PIX AGENDADO ...", "DA VIVO ...". Na manhã seguinte ele some e no lugar entra o lançamento
-- de verdade, com OUTRO id e outra descrição ("BOLETO PAGO SULMEDIC COM"), ou não entra nada,
-- quando o pagamento não sai. O sync grava por id e nunca apagava, então o agendamento ficava
-- para sempre ao lado do compensado. Entre 13/08 e 11/09 foram 16 lançamentos, R$ 97.024,80:
-- 13 contando a mesma saída duas vezes e 3 (R$ 8.574,24) que nunca saíram da conta.
--
-- Desde 14/09 o sync pula o lançamento PENDENTE (commit 11566c9) e não nasceu fantasma novo.
-- Esta função é a outra metade: limpa o que já entrou e pega o caso em que o conector manda
-- tudo como pendente, que o sync deixa passar de propósito para o extrato não parar.
--
-- A ARMADILHA que isso resolve de quebra: o financeiro apagou "cópias" à mão em 14 e 15/09 e,
-- sem nada na tela que dissesse qual das duas era o agendamento, apagou as VERDADEIRAS
-- (BOLETO PAGO PORTO S COMP, DA COPEL) e ficou com os fantasmas. O sync devolve as verdadeiras
-- quando olha a janela delas, e esta função tira os fantasmas levando a classificação junto.
--
-- Não é editar o extrato (crm_rateio_extrato_nao_se_mexe): é o nosso ficar igual ao do banco.
-- Cada linha retirada vai inteira para fin_lancamentos_excluidos, com o motivo.

create or replace function public.crm_banco_retirou_do_extrato(
  p_account uuid,
  p_de date,
  p_ate date,
  p_vistos text[],
  p_teto integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.fin_transactions%rowtype;
  par public.fin_transactions%rowtype;
  v_total integer;
  v_itens jsonb := '[]'::jsonb;
  v_pulados jsonb := '[]'::jsonb;
  v_motivo text;
begin
  -- Banco que não devolveu nada não prova nada: o provedor responde lista vazia quando a
  -- janela passa de uns dois meses, e quando está fora do ar.
  if p_vistos is null or cardinality(p_vistos) = 0 or p_de is null or p_ate is null or p_de > p_ate then
    return jsonb_build_object('retirados', 0, 'nota', 'sem lista do banco para comparar');
  end if;

  select count(*) into v_total
  from public.fin_transactions t
  where t.account_id = p_account
    and t.source = 'openfinance'
    and t.external_id is not null
    and t.date between p_de and p_ate
    and not (t.external_id = any (p_vistos));

  if v_total = 0 then
    return jsonb_build_object('retirados', 0);
  end if;

  -- Muita coisa sumindo de uma vez é mais provável ser resposta pela metade do provedor do que
  -- o banco retirando. Nessa hora não se apaga nada e o motivo vai para a conta.
  if v_total > p_teto then
    raise exception 'o banco deixou de mostrar % lançamentos entre % e %, acima do teto de %; nada foi apagado',
      v_total, to_char(p_de, 'DD/MM'), to_char(p_ate, 'DD/MM'), p_teto;
  end if;

  for v in
    select * from public.fin_transactions t
    where t.account_id = p_account
      and t.source = 'openfinance'
      and t.external_id is not null
      and t.date between p_de and p_ate
      and not (t.external_id = any (p_vistos))
    order by t.date, t.created_at
    for update
  loop
    -- O lançamento de verdade: mesma conta, mesmo valor, que o banco AINDA mostra, até 5 dias
    -- depois (PIX agendado na sexta sai na segunda). Entre dois iguais, o ainda sem centro de
    -- custo, para dois agendamentos de mesmo valor não caírem no mesmo compensado.
    select d.* into par
    from public.fin_transactions d
    where d.tenant_id = v.tenant_id
      and d.account_id = v.account_id
      and d.id <> v.id
      and d.amount_cents = v.amount_cents
      and d.date between v.date - 1 and v.date + 5
      and d.external_id = any (p_vistos)
    order by abs(d.date - v.date), (d.cost_center is null) desc, (d.reconciled_ref_id is null) desc, d.created_at
    limit 1;

    if found then
      -- Os dois ligados a contas diferentes: escolher uma é decisão de gente.
      if v.reconciled_ref_id is not null and par.reconciled_ref_id is not null
         and par.reconciled_ref_id <> v.reconciled_ref_id then
        v_pulados := v_pulados || jsonb_build_object('id', v.id, 'data', v.date, 'valor', v.amount_cents,
          'motivo', 'agendamento e compensado ligados a contas a pagar diferentes');
        continue;
      end if;

      -- A classificação e a conciliação feitas no agendamento passam para o compensado, sem
      -- passar por cima do que o compensado já tiver. Mesma regra de crm_excluir_lancamento_repetido.
      update public.fin_transactions d
         set cost_center = coalesce(d.cost_center, v.cost_center),
             category_id = case when d.cost_center is null and v.cost_center is not null
                                then v.category_id else coalesce(d.category_id, v.category_id) end,
             category_rule_id = case when d.cost_center is null and v.cost_center is not null
                                     then v.category_rule_id else d.category_rule_id end,
             cost_detail = case when d.cost_center is null and v.cost_center is not null then v.cost_detail
                                when d.cost_center = v.cost_center then coalesce(d.cost_detail, v.cost_detail)
                                else d.cost_detail end,
             note = coalesce(d.note, v.note),
             counterparty = case
               when v.counterparty is not null and v.counterparty is distinct from v.description
                 and (d.counterparty is null or d.counterparty = d.description)
               then v.counterparty else d.counterparty end,
             reconciled_ref_type = case when d.reconciled_ref_id is null then v.reconciled_ref_type else d.reconciled_ref_type end,
             reconciled_ref_id = coalesce(d.reconciled_ref_id, v.reconciled_ref_id)
       where d.id = par.id;

      update public.fin_transaction_splits s
         set transaction_id = par.id
       where s.transaction_id = v.id
         and not exists (select 1 from public.fin_transaction_splits x where x.transaction_id = par.id);

      v_motivo := format('Agendamento que o banco trocou pelo lançamento compensado (%s, %s)',
                         btrim(coalesce(par.description, '')), to_char(par.date, 'DD/MM'));
    else
      -- Não saiu da conta. Conta a pagar que tinha sido dada como paga por ele volta a aberta:
      -- deixá-la "paga" seria dizer que um dinheiro que não saiu pagou a nota.
      if v.reconciled_ref_type = 'payable' and v.reconciled_ref_id is not null then
        update public.payable_installments p
           set status = 'aberto',
               paid_at = null,
               auto_reconciled_at = null,
               auto_reconciled_confidence = null,
               updated_at = now()
         where p.id = v.reconciled_ref_id
           and p.tenant_id = v.tenant_id
           and p.status = 'pago';
      end if;
      v_motivo := 'O banco retirou do extrato: agendamento que não saiu da conta';
    end if;

    insert into public.fin_lancamentos_excluidos (tenant_id, origem, ref_id, motivo, snapshot)
    values (v.tenant_id, 'banco', v.id, v_motivo, to_jsonb(v));

    delete from public.fin_transactions where id = v.id;

    v_itens := v_itens || jsonb_build_object(
      'data', v.date, 'valor', v.amount_cents, 'descricao', v.description,
      'compensado', par.id);
  end loop;

  return jsonb_build_object('retirados', jsonb_array_length(v_itens), 'itens', v_itens, 'pulados', v_pulados);
end $$;

revoke all on function public.crm_banco_retirou_do_extrato(uuid, date, date, text[], integer) from public, anon, authenticated;
grant execute on function public.crm_banco_retirou_do_extrato(uuid, date, date, text[], integer) to service_role;
