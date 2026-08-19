-- "Cirurgia foi paga?" responde também para quem VENDEU a cirurgia.
--
-- A Aline passou a trabalhar inteiramente no sistema em 19/08/2026. A pergunta que
-- ela faz todo dia já tinha tela, e a tela não abria para ela: é gestor com
-- `can_view_finance = false`. Liberar a rota não bastaria — a guarda estava DENTRO
-- da função, e ela veria a tela montada e vazia, que é pior que tela trancada.
--
-- O que sai daqui é a cobrança da venda dela: paciente, dia, status da sala e o
-- pagamento casado por CPF. Valor de cirurgia ela já vê na Central de Vendas.
-- Contas a pagar, extrato do banco, DRE e caixa continuam exigindo o papel de
-- financeiro, na RLS de `fin_transactions` e `fin_receivables`, que não muda aqui.
--
-- O corpo é o mesmo de 20260811 (ver [[crm_cirurgia_foi_paga]]); muda uma linha.

create or replace function public.crm_cirurgias_pagamento(p_de date, p_ate date)
returns table (
  surgery_id integer, dia date, paciente text, prontuario text, status text,
  vinculo text, recebido_cents bigint, recebido_qtd integer,
  primeiro_pagamento date, ultimo_pagamento date, formas text[], em_especie_cents bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cir as (
    select s.id, s.dia, s.paciente_nome, s.shosp_prontuario, s.status,
           nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '') as cpf,
           public.srg_norm_name(s.paciente_nome) as nome_norm
    from public.srg_surgeries s
    left join public.shosp_patients p on p.prontuario = s.shosp_prontuario
    where s.deleted_at is null and s.dia between p_de and p_ate
      and s.tenant_id = public.current_tenant_id()
      -- Era só `current_user_can_finance()`. Quem vende a cirurgia cobra a cirurgia.
      and (public.current_user_can_finance() or public.can_route_leads())
  ),
  rec as (
    select r.amount_cents, r.due_date, r.method, r.customer_doc,
           public.srg_norm_name(r.customer_name) as nome_norm
    from public.fin_receivables r
    where r.tenant_id = public.current_tenant_id()
  ),
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
$function$;

-- PUBLIC executa função por padrão, e anon entra em PUBLIC.
revoke all on function public.crm_cirurgias_pagamento(date, date) from public, anon;
grant execute on function public.crm_cirurgias_pagamento(date, date) to authenticated, service_role;
