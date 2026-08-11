-- DRE — receita menos despesa, com as ressalvas embutidas no próprio cálculo.
--
-- Receita por COMPETÊNCIA (o que o paciente pagou), não por caixa: é a base do DRE em qualquer
-- lugar, e o caixa é outra pergunta, com tela própria (ver crm_extrato_por_dia).
--
-- Despesa lê as linhas EFETIVAS (crm_saidas_efetivas), então lançamento com rateio entra pelos
-- pedaços em vez de cair inteiro numa categoria só.
--
-- E aplicação financeira + transferência entre contas próprias SAEM do resultado. São o mesmo
-- dinheiro trocando de lugar: em mai-ago/2026 isso é R$ 859.520, e contá-las como despesa
-- erraria o resultado nesse tamanho. O reconhecimento é pelo nome da categoria conter
-- "não é despesa" — que é justamente por isso que as duas categorias foram criadas com essa
-- marca no nome, e não com um nome bonito.
--
-- O que o cálculo NÃO resolve, e a tela declara em destaque: a despesa só conhece o que saiu da
-- conta. Compromisso registrado e não pago não entra, então o resultado é um TETO. Melhor um
-- teto declarado do que um lucro inventado.

create or replace function public.crm_dre(p_de date, p_ate date)
returns table (
  mes text,
  receita_cents bigint,
  despesa_cents bigint,
  despesa_classificada_cents bigint,
  fora_do_resultado_cents bigint,
  resultado_cents bigint
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
  receita as (
    select to_char(r.due_date, 'YYYY-MM') mes, sum(r.amount_cents)::bigint cents
    from public.fin_receivables r
    where r.tenant_id = public.current_tenant_id()
      and r.status <> 'cancelado'
      and r.due_date between p_de and p_ate
      and public.current_user_can_finance()
    group by 1
  ),
  saida as (
    select to_char(e.data, 'YYYY-MM') mes,
           sum(e.amount_cents)::bigint total,
           sum(e.amount_cents) filter (where e.category_id is not null)::bigint classificada,
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

revoke all on function public.crm_dre(date, date) from public, anon;
grant execute on function public.crm_dre(date, date) to authenticated;
