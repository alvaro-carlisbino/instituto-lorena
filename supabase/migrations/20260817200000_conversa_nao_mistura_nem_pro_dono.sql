-- A conversa de um polo não aparece no outro. Nem para o dono.
--
-- 17/ago/2026. A migração de 14/ago consertou o carimbo (a mensagem pertence ao polo da
-- LINHA) e criou a policy de leitura `tenant_isolation_read`, que lê pelo carimbo da
-- MENSAGEM. Funcionou: gestor da clínica vê 0 mensagem de venda, Ingrid vê a conversa
-- inteira no Tricopill.
--
-- Só que a policy nasceu com `or is_super_admin()`, e as DUAS contas de dono são super
-- admin. Para elas a separação nunca existiu: abrindo o próprio lead (Alvaro Carlisbino,
-- 554497168329 — 292 mensagens da clínica e 102 do Tricopill no mesmo lead), o histórico
-- chega embaralhado, "quanto custa o kit de 3 meses?" logo abaixo do menu de transplante
-- capilar. São 19 leads em condição de embaralhar hoje.
--
-- Exceção de super admin em policy de LEITURA de conversa é justamente o que a regra
-- proíbe: polo não mistura nem na tela. Quem precisa do outro lado abre o endereço do
-- outro lado — lá o polo ativo é outro e a mesma policy entrega a outra metade.
--
-- Continua valendo o que já valia:
--   * `service_role` (edge functions, cron, importação) tem BYPASSRLS e não passa por aqui;
--   * a ESCRITA segue na policy antiga de propósito — apertá-la faria a atendente de um
--     polo tomar erro ao responder num lead fixado na linha do outro (ver 14/ago);
--   * o lead continua visível nos dois lados quando a linha é do outro polo; o que muda
--     é só QUAL metade da conversa cada tela mostra.

drop policy if exists tenant_isolation_read on public.interactions;
create policy tenant_isolation_read on public.interactions
  as restrictive
  for select
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists tenant_isolation_read on public.crm_media_items;
create policy tenant_isolation_read on public.crm_media_items
  as restrictive
  for select
  using (tenant_id = (select public.current_tenant_id()));
