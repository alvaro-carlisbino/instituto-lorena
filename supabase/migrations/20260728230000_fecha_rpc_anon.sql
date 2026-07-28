-- Fecha para o papel `anon` funções SECURITY DEFINER que não deveriam responder
-- sem login.
--
-- Contexto: no Postgres, toda função nasce com EXECUTE para PUBLIC. Os `grant
-- ... to authenticated, service_role` das migrations anteriores ADICIONAM
-- permissão, mas nunca tiraram a de PUBLIC — então o papel `anon` continuava
-- podendo chamar tudo. Como a chave anônima é pública por definição (vai no
-- bundle do painel e do site), qualquer pessoa conseguia executar estas funções.
--
-- Verificado em 28/jul/2026 com a chave anônima real: `crm_funil_comercial`
-- respondeu com os números da clínica (volume de leads, campanhas, nomes dos
-- atendentes) sem nenhuma autenticação.
--
-- Escopo desta migration — apenas o que foi confirmado como chamado SÓ pelo
-- painel autenticado (`src/services/analytics.ts`) ou por ninguém:
--   * as 4 RPCs de analytics: vazavam dado de negócio;
--   * as 2 rotinas de manutenção: `maintenance_reset_crm_data` faz
--     `delete from public.leads` e trunca tabelas, SEM nenhuma checagem de
--     permissão. Não tem chamador em lugar nenhum do repositório.
--
-- Deliberadamente NÃO mexe em funções que podem ser chamadas com a chave
-- anônima pela loja/edge (increment_coupon_use, find_lead_id_by_*,
-- mark_lead_opted_out, signup_create_tenant, seed_tenant_defaults): revogar sem
-- conferir o chamador quebraria fluxo em produção. Ficam para uma revisão à
-- parte.

revoke execute on function public.crm_funil_comercial(timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.crm_analytics_v2(timestamptz, timestamptz, text, text, text) from public, anon;
revoke execute on function public.crm_shosp_agenda_metrics(integer) from public, anon;
revoke execute on function public.tenant_analytics_summary(integer) from public, anon;

revoke execute on function public.maintenance_reset_crm_data() from public, anon;
revoke execute on function public.maintenance_delete_seed_demo_leads() from public, anon;
