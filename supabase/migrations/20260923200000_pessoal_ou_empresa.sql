-- "PESSOAL OU EMPRESA?": compra do cartão da empresa que ninguém sabe se foi da clínica.
--
-- 23/set/2026. O Mercado Livre entra no Itaú Empresas Mastercard (final 4310) como
-- "MERCADOLIVRE*MERCADOL" e o valor, sem dizer o que foi comprado nem qual plástico comprou.
-- Parte é da clínica, parte é pessoal, e somada no gasto ela infla o custo da operação.
--
-- O centro fica no grupo "Não é gasto" e a categoria leva "(não é despesa)": é o que tira a linha
-- do total em /gastos e do resultado no DRE (mesma convenção de 20260914220000). A diferença para
-- os outros do grupo é que este não é resposta, é pergunta: a tela mostra em âmbar até alguém
-- reclassificar para o centro da clínica ou para "Retirada sócios".
--
-- Só o instituto-lorena: é o cartão dele.

insert into public.fin_categories (tenant_id, name, kind)
select 'instituto-lorena', 'Pessoal ou empresa? (não é despesa)', 'despesa'
where not exists (
  select 1 from public.fin_categories c
  where c.tenant_id = 'instituto-lorena' and c.name = 'Pessoal ou empresa? (não é despesa)'
);

insert into public.fin_cost_centers (tenant_id, name, sort_order, grupo, description, category_id)
select 'instituto-lorena', 'Pessoal ou empresa?', 930, 'Não é gasto',
       'Compra do cartão da empresa que ainda não se sabe se foi da clínica ou pessoal. Fica fora do total até alguém reclassificar.',
       (select c.id from public.fin_categories c
         where c.tenant_id = 'instituto-lorena' and c.name = 'Pessoal ou empresa? (não é despesa)' limit 1)
on conflict do nothing;

-- A regra carimba as próximas na entrada (fin_transactions_aplica_regra).
insert into public.fin_category_rules (tenant_id, pattern, category_id, direction, cost_center)
select 'instituto-lorena', 'MERCADOLIVRE',
       (select c.id from public.fin_categories c
         where c.tenant_id = 'instituto-lorena' and c.name = 'Pessoal ou empresa? (não é despesa)' limit 1),
       'out', 'Pessoal ou empresa?'
on conflict (tenant_id, lower(pattern), coalesce(direction, 'all'))
do update set category_id = excluded.category_id, cost_center = excluded.cost_center, cost_detail = null;

-- As que já estão no banco: só as sem centro. As que alguém já classificou (Marketing,
-- Administrativo, Atendimento) foram respondidas por quem sabia, e não se desfaz resposta.
update public.fin_transactions t
   set cost_center = 'Pessoal ou empresa?',
       category_id = r.category_id,
       category_rule_id = r.id
  from public.fin_category_rules r
 where r.tenant_id = 'instituto-lorena' and lower(r.pattern) = 'mercadolivre' and r.direction = 'out'
   and t.tenant_id = 'instituto-lorena'
   and t.direction = 'out'
   and t.cost_center is null
   and (public.crm_texto_casa(t.description, 'MERCADOLIVRE') or public.crm_texto_casa(t.counterparty, 'MERCADOLIVRE'));
