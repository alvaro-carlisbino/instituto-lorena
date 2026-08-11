-- A chave pública do site conseguia ler paciente e CPF.
--
-- `crm_buscar_pacientes` e `crm_paciente_360_ref` são SECURITY DEFINER e nasceram com o
-- GRANT padrão do Postgres (EXECUTE para PUBLIC). Elas filtram por
-- `current_tenant_id()`, que para anon é NULL — o que corta o lado do CRM. Mas o ramo
-- do Shosp NÃO tem filtro de tenant (é dado de clínica por natureza), então com a
-- anon key — que vai no bundle do frontend, é pública por definição — dava para:
--
--   select * from crm_buscar_pacientes('silva', 5)
--     → ANDREIA REGINA ... DA SILVA, CPF 07288631974
--   select crm_paciente_360_ref('shosp','<prontuario>')
--     → nome, CPF e o histórico de consultas da pessoa
--
-- Verificado em produção com `set role anon` antes deste patch. Dado de saúde, LGPD.
--
-- A migração `fecha_rpc_anon` (28/jul) fez essa varredura; estas funções nasceram
-- depois (10/ago) e passaram batido. Fechadas junto as demais que devolviam dado de
-- negócio (consulta não paga, estoque, reengajamento, tricoscopia).
--
-- FICA ABERTO de propósito:
--   signup_create_tenant ........ o cadastro roda deslogado
--   clinica_numeros_publicos .... alimenta o site institucional
--   clinica_referencia_por_area . idem
--   increment_coupon_use ........ pode ser chamada pelo checkout do site (repo
--                                 separado, não deu para verificar aqui) — fechar às
--                                 cegas quebraria venda. Revisar quando der.
--   current_tenant_id, is_super_admin, current_profile_role, my_tenants e as demais
--   auxiliares: são avaliadas DENTRO das policies de RLS. Revogar de anon quebra a
--   leitura das tabelas que anon legitimamente lê.

revoke execute on function public.crm_buscar_pacientes(text, integer) from anon, public;
revoke execute on function public.crm_paciente_360_ref(text, text) from anon, public;
revoke execute on function public.crm_paciente_360(text) from anon, public;
revoke execute on function public.crm_identidade(text, text) from anon, public;

revoke execute on function public.medical_record_list(text) from anon, public;
revoke execute on function public.medical_record_create(text, text, text, uuid, jsonb) from anon, public;

revoke execute on function public.hairmetrix_evolucao(text, text) from anon, public;
revoke execute on function public.hairmetrix_evolucao_paciente(uuid, text) from anon, public;
revoke execute on function public.hairmetrix_pendentes_vinculo(integer) from anon, public;
revoke execute on function public.hairmetrix_sugerir_leads(uuid, integer) from anon, public;

revoke execute on function public.crm_pending_human_handoff(integer) from anon, public;
revoke execute on function public.crm_unpaid_appointment_alerts() from anon, public;
revoke execute on function public.crm_estoque_alerts() from anon, public;
revoke execute on function public.tricopill_reengage_overview() from anon, public;

revoke execute on function public.mark_lead_opted_out(text, text) from anon, public;
revoke execute on function public.clear_lead_opt_out(text) from anon, public;
revoke execute on function public.find_lead_id_by_phone_digits(text) from anon, public;
revoke execute on function public.find_lead_id_by_manychat_subscriber(text) from anon, public;
revoke execute on function public.tenant_llm_config(text, text) from anon, public;

revoke execute on function public.set_active_tenant(text) from anon, public;
revoke execute on function public.seed_tenant_defaults(text) from anon, public;
revoke execute on function public.seed_tenant_defaults(text, text) from anon, public;

-- E garante que quem está logado continua executando tudo isso.
grant execute on function public.crm_buscar_pacientes(text, integer) to authenticated, service_role;
grant execute on function public.crm_paciente_360_ref(text, text) to authenticated, service_role;
grant execute on function public.crm_paciente_360(text) to authenticated, service_role;
grant execute on function public.crm_identidade(text, text) to authenticated, service_role;
grant execute on function public.medical_record_list(text) to authenticated, service_role;
grant execute on function public.medical_record_create(text, text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.hairmetrix_evolucao(text, text) to authenticated, service_role;
grant execute on function public.hairmetrix_evolucao_paciente(uuid, text) to authenticated, service_role;
grant execute on function public.hairmetrix_pendentes_vinculo(integer) to authenticated, service_role;
grant execute on function public.hairmetrix_sugerir_leads(uuid, integer) to authenticated, service_role;
grant execute on function public.crm_pending_human_handoff(integer) to authenticated, service_role;
grant execute on function public.crm_unpaid_appointment_alerts() to authenticated, service_role;
grant execute on function public.crm_estoque_alerts() to authenticated, service_role;
grant execute on function public.tricopill_reengage_overview() to authenticated, service_role;
grant execute on function public.mark_lead_opted_out(text, text) to authenticated, service_role;
grant execute on function public.clear_lead_opt_out(text) to authenticated, service_role;
grant execute on function public.find_lead_id_by_phone_digits(text) to authenticated, service_role;
grant execute on function public.find_lead_id_by_manychat_subscriber(text) to service_role;
grant execute on function public.tenant_llm_config(text, text) to service_role;
grant execute on function public.set_active_tenant(text) to authenticated, service_role;
grant execute on function public.seed_tenant_defaults(text) to authenticated, service_role;
grant execute on function public.seed_tenant_defaults(text, text) to authenticated, service_role;
