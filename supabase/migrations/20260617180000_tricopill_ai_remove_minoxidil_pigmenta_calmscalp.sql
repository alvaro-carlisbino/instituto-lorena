-- Remove produtos que NAO podem ser oferecidos pelo bot de vendas Tricopill.
--
-- IMPORTANTE: o system_prompt completo NAO e versionado no repositorio. Ele e mantido
-- diretamente em crm_ai_configs (tenant_id='tricopill', id='default'). Esta migration
-- registra o DELTA aplicado em 2026-06-17:
--   - Apaga da TABELA DE PRECOS: Minoxidil 1mg / 2,5mg / 4mg, ampola de mino (minoxidil),
--     Pigmenta e calm scalp.
--   - Adiciona uma regra PRODUTOS BLOQUEADOS para que a IA nunca oferte/cote esses itens
--     nem caia no fallback "confirmar preco com a atendente" (que ainda os ofereceria).
--
-- Obs.: no catalog_cache (tenant_integrations.bling) so existia "CALMSCALP" com estoque
-- negativo (ja fora do filtro estoque>0). Esse cache e re-sincronizado do Bling, por isso
-- a barreira duravel e a regra de bloqueio no prompt (e, idealmente, desativar no Bling).
--
-- replace() e idempotente; set_config(...true) garante o bypass do trigger enforce_role_write.

do $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update crm_ai_configs
     set system_prompt =
       replace(
       replace(
       replace(
       replace(
       replace(
       replace(
       replace(
         system_prompt,
         E'- calm scalp: R$ 89,00\n', ''),
         E'- ampola de mino: R$ 4,95\n', ''),
         E'- Minoxidil 1mg: R$ 75,00\n', ''),
         E'- Minoxidil 2,5mg: R$ 89,90\n', ''),
         E'- Minoxidil 4mg: R$ 119,90\n', ''),
         E'- Pigmenta: R$ 129,90\n', ''),
         E'\n\nREGRA DE PREÇO:',
         E'\n\nPRODUTOS BLOQUEADOS (NUNCA ofereça, cote, recomende ou inclua em kits — nem mesmo via atendente): Minoxidil (qualquer dosagem, incluindo ampola), Pigmenta e Calm Scalp. Se o cliente perguntar por algum deles, informe educadamente que no momento NÃO trabalhamos com esse produto e, se fizer sentido, ofereça uma alternativa da nossa linha.\n\nREGRA DE PREÇO:')
   where tenant_id = 'tricopill' and id = 'default';
end $$;
