-- O QUE É "A RECEBER" DE VERDADE NA CLÍNICA.
--
-- A tela /contas-a-receber mostrava quatro números e três eram estruturalmente zero, porque ela
-- só sabia falar de conta agendada na mão — e a clínica não agenda nada: a venda entra pelo
-- Shosp já paga pelo paciente. O quarto número, "Recebido no mês", mostrava R$ 410.681 em
-- agosto/2026. Também errado, e pior, porque parecia certo:
--
--   cartão   R$ 275.563  — o paciente pagou, o dinheiro está no adquirente, pinga por meses
--   PIX      R$  85.956  — esse sim caiu na conta
--   dinheiro R$  49.162  — está na gaveta, nunca virou depósito
--
-- No banco entraram R$ 200.690 no mesmo período. Ou seja, "Recebido" era a palavra do caixa
-- descrevendo uma coisa que não é caixa. O nome certo é VENDIDO.
--
-- E o a receber de verdade não aparecia em lugar nenhum: R$ 603.727 de parcela de cartão já
-- vendida e ainda não vencida no adquirente — dinheiro que é da clínica e não chegou, que é a
-- definição de conta a receber. Faltava um dado pra calcular: quantas parcelas cada venda tem.
-- O relatório do Shosp traz ("CC 10x") e a importação jogava fora, igual ao que aconteceu com
-- o CPF.

alter table public.fin_receivables
  add column if not exists installments smallint not null default 1
    check (installments between 1 and 36);

comment on column public.fin_receivables.installments is
  'Parcelas da venda no cartão ("CC 10x" = 10). 1 para à vista, PIX, dinheiro. É o que permite '
  'montar o cronograma de repasse do adquirente e saber o que ainda não venceu.';

-- ────────────────────────────────────────────────── cronograma do adquirente

/**
 * O que o adquirente ainda deve, parcela a parcela.
 *
 * Regra igual à da conciliação (ver conciliacaoShosp.ts): débito liquida em D+`p_debito_dias`,
 * crédito solta uma parcela a cada `p_credito_dias`. Só entra venda no CARTÃO — PIX e dinheiro
 * não passam por adquirente nenhum.
 *
 * Devolve por mês de vencimento, e só o que vence DEPOIS de hoje: parcela vencida ou já é
 * dinheiro na conta, ou é divergência, e divergência é assunto da conciliação — não de uma
 * projeção de recebimento.
 *
 * LIMITE CONHECIDO: não desconta ANTECIPAÇÃO. Parcela antecipada já foi paga pelo adquirente e
 * deixou de ser a receber, mas o extrato não diz QUAIS parcelas foram antecipadas — só o valor
 * total do adiantamento. A clínica antecipou R$ 298.119 em mai/jun de 2026, então este número é
 * um TETO. A tela diz isso; esconder seria repetir o erro da "taxa efetiva" da conciliação.
 */
create or replace function public.crm_adquirente_a_receber(
  p_debito_dias integer default 1,
  p_credito_dias integer default 30
)
returns table (mes text, parcelas bigint, amount_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  with cartao as (
    select r.due_date, r.amount_cents, greatest(1, r.installments) as n,
           -- Débito x crédito à vista: os DOIS chegam com installments = 1, e o prazo é
           -- completamente diferente (D+1 contra D+30). O que separa é a nota, onde a
           -- importação grava "Cartão de débito"/"Cartão de crédito". Sem esta distinção,
           -- 705 vendas de crédito à vista (R$ 1,33 mi) eram tratadas como débito e sumiam
           -- do "a receber" no mês em que ainda não tinham vencido.
           case when r.note ilike '%débito%' then p_debito_dias else p_credito_dias end as passo
    from public.fin_receivables r
    where r.tenant_id = public.current_tenant_id()
      and r.method = 'cartao'
      and public.current_user_can_finance()
  ),
  parcelas as (
    select (c.due_date + (c.passo * k))::date as vence,
           -- centavo da divisão vai na primeira, como a maquininha faz
           (c.amount_cents / c.n) + case when k = 1 then c.amount_cents - (c.amount_cents / c.n) * c.n else 0 end as cents
    from cartao c
    cross join lateral generate_series(1, c.n) as k
  )
  select to_char(vence, 'YYYY-MM'), count(*)::bigint, sum(cents)::bigint
  from parcelas
  where vence > current_date
  group by 1
  order by 1;
$$;

revoke all on function public.crm_adquirente_a_receber(integer, integer) from public, anon;
grant execute on function public.crm_adquirente_a_receber(integer, integer) to authenticated;
