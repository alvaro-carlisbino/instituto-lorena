-- CIRURGIA FOI PAGA? — o vínculo entre a cirurgia realizada e o dinheiro que entrou.
--
-- A regra da casa é "não se opera sem 100% pago". Para conferir isso o sistema precisava ligar
-- `srg_surgeries` (o que foi feito na sala) a `fin_receivables` (o que foi cobrado no Shosp), e
-- o único elo que existia era o NOME DO PACIENTE. Nome não é chave: em 11/ago/2026 o cruzamento
-- por nome deu 44 de 174 cirurgias "sem nenhum pagamento", e boa parte disso é grafia diferente,
-- registro de teste, ou pagamento feito por cônjuge — ou seja, não dava pra distinguir buraco
-- de verdade de falha de casamento. Uma lista que mistura as duas coisas não é usável: ninguém
-- vai auditar 44 casos sabendo que a maioria é ruído.
--
-- O elo bom já existia e não estava sendo usado: `srg_surgeries.shosp_prontuario` →
-- `shosp_patients.cpf`. Faltava o CPF do outro lado, na conta a receber — o relatório de vendas
-- do Shosp traz CPF em coluna própria e a importação jogava fora.

alter table public.fin_receivables
  add column if not exists customer_doc text;

comment on column public.fin_receivables.customer_doc is
  'CPF/CNPJ do pagador, só dígitos, como veio da origem. É o que liga a venda à cirurgia e ao '
  'paciente do Shosp sem depender da grafia do nome.';

-- Busca por documento é o caminho quente do vínculo. Parcial porque a maioria das contas a
-- receber criadas na mão não tem documento nenhum.
create index if not exists fin_receivables_doc_idx
  on public.fin_receivables (tenant_id, customer_doc)
  where customer_doc is not null;

-- ────────────────────────────────────────────────────────────────── cirurgia × pagamento

/**
 * Uma linha por cirurgia realizada, com o que entrou do paciente.
 *
 * `vinculo` é tão importante quanto o valor: diz COMO a cirurgia achou o dinheiro. Sem isso a
 * tela volta a misturar "não pagou" com "não consegui casar o nome", que é o problema que esta
 * migration existe pra resolver. Ordem de confiança: cpf > prontuario > nome > nenhum.
 *
 * Não devolve "falta pagar" porque o preço contratado da cirurgia NÃO existe em lugar nenhum do
 * banco — o Shosp guarda o que foi cobrado, não o que foi combinado. Inventar um esperado aqui
 * seria a mesma classe de erro da "taxa efetiva" que a conciliação já cometeu uma vez.
 */
create or replace function public.crm_cirurgias_pagamento(p_de date, p_ate date)
returns table (
  surgery_id integer, dia date, paciente text, prontuario text, status text, vinculo text,
  recebido_cents bigint, recebido_qtd integer, primeiro_pagamento date, ultimo_pagamento date,
  formas text[], em_especie_cents bigint
) language sql stable security definer set search_path = public as $$
  with cir as (
    select s.id, s.dia, s.paciente_nome, s.shosp_prontuario, s.status,
           nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '') as cpf,
           public.srg_norm_name(s.paciente_nome) as nome_norm
    from public.srg_surgeries s
    left join public.shosp_patients p on p.prontuario = s.shosp_prontuario
    where s.deleted_at is null and s.dia between p_de and p_ate
      and s.tenant_id = public.current_tenant_id()
      -- SECURITY DEFINER passa por cima da RLS, entao a cerca do financeiro tem que estar
      -- AQUI dentro: sem isto, quem nao ve financeiro veria quanto cada paciente pagou.
      and public.current_user_can_finance()
  ),
  -- Normaliza o nome UMA vez por conta a receber. Dentro do join eram 174 x 3.353 chamadas
  -- de srg_norm_name (que chama unaccent) e a funcao estourava o timeout da conexao.
  rec as (
    select r.amount_cents, r.due_date, r.method, r.customer_doc,
           public.srg_norm_name(r.customer_name) as nome_norm
    from public.fin_receivables r
    where r.tenant_id = public.current_tenant_id()
  ),
  -- Dois joins de IGUALDADE em vez de um join com OR: com OR o planner cai em laco
  -- aninhado e compara toda cirurgia contra toda conta a receber.
  casado as (
    select c.id, k.amount_cents, k.due_date, k.method, 'cpf' as via
    from cir c join rec k on k.customer_doc = c.cpf where c.cpf is not null
    union all
    select c.id, k.amount_cents, k.due_date, k.method, 'nome'
    from cir c join rec k on k.nome_norm = c.nome_norm where c.cpf is null
  )
  select c.id, c.dia, c.paciente_nome, c.shosp_prontuario, c.status,
         case when bool_or(k.via = 'cpf') then 'cpf'
              when count(k.id) > 0 then 'nome'
              when c.cpf is not null then 'sem_pagamento'
              else 'sem_vinculo' end,
         coalesce(sum(k.amount_cents), 0)::bigint, count(k.id)::integer,
         min(k.due_date), max(k.due_date),
         coalesce(array_agg(distinct k.method) filter (where k.method is not null), '{}'),
         coalesce(sum(k.amount_cents) filter (where k.method = 'dinheiro'), 0)::bigint
  from cir c left join casado k on k.id = c.id
  group by c.id, c.dia, c.paciente_nome, c.shosp_prontuario, c.status, c.cpf
  order by c.dia desc;
$$;

-- SECURITY DEFINER nasce executavel por PUBLIC -- inclusive anon. Esta funcao devolve nome de
-- paciente e valor pago; ja vazamos nome+CPF por esquecer isto uma vez.
revoke all on function public.crm_cirurgias_pagamento(date, date) from public, anon;
grant execute on function public.crm_cirurgias_pagamento(date, date) to authenticated;
