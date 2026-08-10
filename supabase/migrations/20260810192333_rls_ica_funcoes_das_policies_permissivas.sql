-- Segunda metade do conserto de RLS (a primeira é 20260810192225).
--
-- Trocar a função por linha nas policies RESTRICTIVE deixou o filtro barato, e aí o
-- planejador fez algo pior: com o custo baixo ele ABANDONOU o índice de
-- `happened_at` e passou a fazer Seq Scan + sort em 36 mil linhas. Resultado: a
-- consulta de interações foi de 410ms para 641ms. Ficou pior do que antes.
--
-- O que ainda custava caro por linha eram as policies PERMISSIVE, que ninguém tinha
-- olhado: `can_route_leads()` (COST 100, e por dentro chama current_profile_role(),
-- que consulta app_profiles), `auth.role()` e `is_staff_user()`. Nenhuma depende da
-- linha — mas função STABLE não é pré-avaliada num filtro, então rodavam 36 mil vezes.
--
-- Envolvendo cada uma em `(select ...)` elas viram InitPlan e rodam UMA vez. Com o
-- filtro inteiro barato, o planejador volta ao Index Scan.
--
-- Medido com EXPLAIN ANALYZE, role authenticated, mesmo JWT:
--   interactions ... 410ms  →  641ms (só a 1ª metade)  →  12,1ms (com esta)
--   leads .......... 354ms  →                              8,7ms
--
-- Visibilidade conferida depois de aplicar: para os 3 logins reais, a contagem de
-- linhas visíveis em leads, interactions, crm_media_items, crm_conversation_states,
-- crm_lead_followup_state e lead_tag_assignments bate exatamente com o que o
-- predicado antigo entregava. (Uma diferença de 1 linha em interactions era o bot
-- gravando entre as duas medições; refeito no mesmo snapshot, deu igual.)

drop policy if exists "leads read auth" on public.leads;
create policy "leads read auth" on public.leads
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists "leads route manage" on public.leads;
create policy "leads route manage" on public.leads
  for all using ((select public.can_route_leads()))
  with check ((select public.can_route_leads()));

drop policy if exists "interactions read auth" on public.interactions;
create policy "interactions read auth" on public.interactions
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists "interactions route manage" on public.interactions;
create policy "interactions route manage" on public.interactions
  for all using ((select public.can_route_leads()))
  with check ((select public.can_route_leads()));

drop policy if exists crm_media_items_read_authenticated on public.crm_media_items;
create policy crm_media_items_read_authenticated on public.crm_media_items
  for select to authenticated using ((select public.is_staff_user()));
