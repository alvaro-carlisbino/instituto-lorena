-- Desliga a linha "SDR" (Evolution). Ela estava viva no cadastro e morta no mundo.
--
-- Medição de 11/ago/2026, janela de 45 dias:
--   wa-molsxxx7  "SDR"  channel_provider=evolution  active=true  sort_order=0
--   → ZERO mensagens de saída. Envio devolve evolution_send_failed_530 (Cloudflare
--     "origin unreachable": o servidor Evolution não responde).
--   → 13 mensagens de ENTRADA no período: gente escrevendo e ninguém conseguindo responder.
--
-- O agravante é o `sort_order = 0`: essa era a linha PADRÃO do tenant instituto-lorena.
-- Ou seja, o destino de todo lead da clínica sem linha fixada era um servidor fora do ar.
-- O tráfego real não morreu junto porque a clínica conversa por ManyChat, que é um caminho
-- anterior no crm-send-message — mas toda automação que força o caminho WhatsApp (lembrete
-- de cirurgia, NPS, follow-up) caía nela. 88 leads estão fixados nessa linha e 79 têm
-- custom_fields.provider = 'evolution'.
--
-- Com active = false:
--   • o padrão do tenant passa a ser wa-wapi-mpyi00su ("Aline — Comercial TC", W-API, viva);
--   • os 88 fixados também saem por ela, por causa da guarda de linha inativa adicionada em
--     resolveOutboundProviderForLead (antes o filtro `active` só existia na escolha do
--     padrão, então quem já estava fixado continuava sendo mandado para o buraco).
--
-- O que NÃO muda:
--   • o vínculo dos 88 leads continua apontando para a SDR. É o registro de onde a pessoa
--     conversava, e religar a instância devolve as conversas para lá sem remendo no banco.
--   • a ENTRADA continua funcionando: resolveTenantFromEvolutionInstance não filtra por
--     `active`, então mensagem que chegar por essa linha segue sendo registrada. A clínica
--     não fica surda.
--
-- Para reverter: active = true. Só faz sentido depois de o servidor Evolution voltar a
-- responder — conferir com um envio real antes, não pelo cadastro.

-- session_replication_role: a migration roda sem JWT de app, e o enforce_role_write()
-- exige can_manage_users para escrever aqui. Mesmo padrão dos seeds anteriores.
set session_replication_role = 'replica';

update public.whatsapp_channel_instances
   set active = false
 where id = 'wa-molsxxx7'
   and tenant_id = 'instituto-lorena';

set session_replication_role = 'origin';
