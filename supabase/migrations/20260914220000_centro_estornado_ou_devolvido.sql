-- "ESTORNADO OU DEVOLVIDO": o terceiro jeito de dinheiro sair da conta sem ser gasto.
--
-- 14/set/2026. O financeiro pediu botão de apagar para lançamento "errado" em /gastos. Pagamento
-- que saiu do banco não se apaga (o extrato é o árbitro, ver crm_rateio_extrato_nao_se_mexe),
-- mas um PIX que voltou ou uma cobrança estornada também não é gasto. Sem um centro para isso,
-- a única saída era classificar como outra coisa ou deixar somando no total.
--
-- Mesma convenção dos outros dois do grupo "Não é gasto": a categoria leva "(não é despesa)" no
-- nome, e é isso que tira a linha do resultado no DRE (crm_dre) e do total em /gastos.

insert into public.fin_categories (tenant_id, name, kind)
select t.id, 'Estornado ou devolvido (não é despesa)', 'despesa'
from public.tenants t
where exists (select 1 from public.fin_cost_centers c where c.tenant_id = t.id)
  and not exists (
    select 1 from public.fin_categories c
    where c.tenant_id = t.id and c.name = 'Estornado ou devolvido (não é despesa)'
  );

insert into public.fin_cost_centers (tenant_id, name, sort_order, grupo, description, category_id)
select t.id, 'Estornado ou devolvido', 920, 'Não é gasto',
       'Dinheiro que saiu e voltou: PIX devolvido, cobrança estornada. Fica fora do total de gastos.',
       (select c.id from public.fin_categories c
         where c.tenant_id = t.id and c.name = 'Estornado ou devolvido (não é despesa)' limit 1)
from public.tenants t
where exists (select 1 from public.fin_cost_centers c where c.tenant_id = t.id)
on conflict do nothing;
