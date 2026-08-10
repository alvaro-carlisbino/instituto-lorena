-- RLS de tenant: trocar função POR LINHA por conjunto avaliado UMA VEZ.
--
-- O boot do CRM ficou lento porque as policies `tenant_isolation` de leads,
-- interactions e crm_media_items chamavam uma função SECURITY DEFINER com o valor da
-- LINHA como argumento (`current_tenant_owns_instance(whatsapp_instance_id)`,
-- `current_tenant_can_see_lead(lead_id)`). Função com argumento da linha não é içada
-- pelo planejador: roda uma vez por linha. Em números reais desta base:
--
--   leads .......... 2.599 chamadas para consultar uma tabela de 3 linhas → Seq Scan 207ms
--   interactions ... 36.055 linhas, ~250 caindo na função por boot          → 410ms
--
-- Duas mudanças, ambas sem alterar QUEM enxerga O QUÊ:
--
-- 1. `IN (select ...)` no lugar da função por linha. O planejador resolve o conjunto
--    uma vez (vira "hashed SubPlan") em vez de chamar a função por registro.
-- 2. `(select f())` no lugar de `f()` nos termos sem argumento. Função STABLE não é
--    pré-avaliada automaticamente num filtro; envolvida num subselect escalar ela vira
--    InitPlan e roda uma vez só. Vale para `current_tenant_id()` e `is_super_admin()`.
--
-- Medido depois, com EXPLAIN ANALYZE e o mesmo JWT:
--   leads ............ 207ms → 4,7ms
--   interactions ..... 410ms → 11,2ms
--
-- Equivalência PROVADA antes de aplicar, não presumida: para os 3 logins reais
-- (gerencia/instituto-lorena, ingrid/tricopill, financeiro/ativo=tricopill), o
-- resultado da policy inteira foi comparado linha a linha entre a versão antiga e a
-- nova em 2.719 leads + 36.083 interações + 274 mídias. Divergências: ZERO.
--
-- Cuidado que apareceu no caminho: `NULL IN (...)` devolve NULL, enquanto a função
-- devolvia `false` (ela testava `p_instance_id is not null`). No WHERE os dois filtram
-- a linha igual, mas quem for comparar os predicados na mão precisa de `coalesce(...,
-- false)` — sem isso 2.264 leads com instância nula parecem divergir e não divergem.

-- ── Conjuntos. SECURITY DEFINER de propósito: as funções que estas substituem também
-- são, então continuam ignorando a RLS das tabelas que consultam. Sem isso a semântica
-- mudaria (e leads dentro de policy de leads convidaria recursão).
create or replace function public.current_tenant_instance_ids()
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $$
  select w.id
  from public.whatsapp_channel_instances w
  where w.tenant_id = (select public.current_tenant_id())
$$;

comment on function public.current_tenant_instance_ids() is
  'Linhas de WhatsApp do polo ativo. Substitui current_tenant_owns_instance(id) nas policies: conjunto avaliado uma vez em vez de função por linha.';

create or replace function public.current_tenant_visible_lead_ids()
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.id
  from public.leads l
  where l.tenant_id = (select public.current_tenant_id())
     or l.whatsapp_instance_id in (select public.current_tenant_instance_ids())
$$;

comment on function public.current_tenant_visible_lead_ids() is
  'Leads que o polo ativo enxerga (por tenant ou pela linha de WhatsApp). Substitui current_tenant_can_see_lead(lead_id) nas policies.';

revoke all on function public.current_tenant_instance_ids() from public, anon;
revoke all on function public.current_tenant_visible_lead_ids() from public, anon;
grant execute on function public.current_tenant_instance_ids() to authenticated, service_role;
grant execute on function public.current_tenant_visible_lead_ids() to authenticated, service_role;

-- ── Policies. Continuam RESTRICTIVE, para ALL, com USING e WITH CHECK — igual ao que
-- estava. Só a expressão muda.
drop policy if exists tenant_isolation on public.leads;
create policy tenant_isolation on public.leads
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or whatsapp_instance_id in (select public.current_tenant_instance_ids())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or whatsapp_instance_id in (select public.current_tenant_instance_ids())
  );

drop policy if exists tenant_isolation on public.interactions;
create policy tenant_isolation on public.interactions
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  );

drop policy if exists tenant_isolation on public.crm_media_items;
create policy tenant_isolation on public.crm_media_items
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  );

-- Mesmo padrão, mesma expressão, três tabelas menores que penduram no mesmo lead.
-- Equivalência conferida do mesmo jeito (0 divergências em 1.841 + 39 + 0 linhas).
drop policy if exists tenant_isolation on public.crm_conversation_states;
create policy tenant_isolation on public.crm_conversation_states
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  );

drop policy if exists tenant_isolation on public.crm_lead_followup_state;
create policy tenant_isolation on public.crm_lead_followup_state
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  );

drop policy if exists tenant_isolation on public.lead_tag_assignments;
create policy tenant_isolation on public.lead_tag_assignments
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or lead_id in (select public.current_tenant_visible_lead_ids())
  );

-- As funções antigas FICAM. Outras policies e código podem chamá-las, e removê-las
-- aqui transformaria um ganho de performance num incidente.
