import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { nowIso } from '../_shared/crmAiAutoReply.ts'
import {
  pushManychatInstagramDmAfterReply,
  pushManychatWhatsappDmAfterReply,
  readManychatPushConfigForTenantChannel,
} from '../_shared/manychatPublicApi.ts'
import { insertInteraction } from '../_shared/crm.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/**
 * Schedule de follow-ups automáticos (janela de 24h após último inbound sem resposta).
 *
 * Intervalos (em horas após o último inbound sem resposta):
 *   1h  → follow-up 1
 *   2h  → follow-up 2
 *   4h  → follow-up 3
 *   8h  → follow-up 4
 *  16h  → follow-up 5
 *  24h  → follow-up 6 (último da janela)
 *
 * Só corre se: ai_enabled=true, owner_mode não é 'human',
 * e o lead ainda não respondeu após o último outbound da IA.
 */

const FOLLOWUP_HOURS = [1, 2, 4, 8, 16, 24]

// VENDAS (Tricopill): 1º follow-up em 15 MIN (0,25h) — "atendimento sem resposta >15min".
// Depois reforça em 1h e 4h. Cadência curta porque venda esfria rápido.
const FOLLOWUP_HOURS_SALES = [0.25, 1, 4]
const FOLLOWUP_MESSAGES_SALES = [
  'Oi, {name}! 💚 Vi que ficou pendente aqui — posso te ajudar a finalizar o seu Tricopill? É só me chamar! 🌿',
  '{name}, ainda dá pra garantir o seu Tricopill 😊 Quer que eu te ajude a fechar agora? Qualquer dúvida (pagamento, frete, prazo) é só perguntar.',
  'Oi {name}! Última passadinha por aqui 💚 Quando quiser fechar o seu Tricopill, é só responder que eu cuido de tudo pra você!',
]

const FOLLOWUP_MESSAGES = [
  'Olá, {name}! 😊 Vi que você entrou em contato conosco. Ainda posso te ajudar? É só responder aqui!',
  'Oi, {name}! Estou aqui para te ajudar com qualquer dúvida sobre nossos serviços. Me conta o que você precisa? 💆',
  '{name}, sei que a vida é corrida! Quando tiver um tempinho, adoraria te apresentar as opções do Instituto Lorena Visentainer. 🌟',
  'Olá! Ainda estou disponível para te ajudar, {name}. Temos ótimas opções de tratamento — qual é a sua maior necessidade hoje? ✨',
  '{name}, última tentativa por hoje 😊 Se precisar de nós, estamos sempre aqui! Basta responder esta mensagem.',
  'Oi {name}! Este é nosso último contato por enquanto. Quando estiver pronto(a), pode nos chamar que respondemos rapidinho. Até logo! 👋',
]

function getFollowupMessage(followupCount: number, patientName: string, messages: string[] = FOLLOWUP_MESSAGES): string {
  const idx = Math.min(followupCount, messages.length - 1)
  return messages[idx].replace(/\{name\}/g, patientName || 'você')
}

/** Verifica se um lead precisa de follow-up agora. Retorna o índice do follow-up (0-based) ou null. */
function needsFollowup(state: {
  last_inbound_at: string | null
  last_ai_reply_at: string | null
  last_human_reply_at: string | null
  last_followup_at: string | null
  followup_count: number
  followup_window_start: string | null
}, hours: number[] = FOLLOWUP_HOURS): { followupIndex: number } | null {
  const now = Date.now()

  // Precisa de inbound
  const lastInboundMs = state.last_inbound_at ? new Date(state.last_inbound_at).getTime() : 0
  if (!lastInboundMs) return null

  // Se houve resposta (humana ou IA) DEPOIS do inbound → não precisa de follow-up
  const lastAiMs = state.last_ai_reply_at ? new Date(state.last_ai_reply_at).getTime() : 0
  const lastHumanMs = state.last_human_reply_at ? new Date(state.last_human_reply_at).getTime() : 0
  const lastOutboundMs = Math.max(lastAiMs, lastHumanMs)

  // Se o outbound é mais recente que o inbound → o paciente está aguardando (nós já respondemos)
  if (lastOutboundMs > lastInboundMs) return null

  // O inbound é mais recente → paciente ainda aguarda nossa resposta
  // Usamos followup_window_start se disponível (para manter a contagem correta), caso contrário last_inbound_at
  const windowStartMs = state.followup_window_start
    ? new Date(state.followup_window_start).getTime()
    : lastInboundMs

  const elapsedHours = (now - windowStartMs) / (1000 * 60 * 60)

  // Janela expirada (último intervalo + 1h de margem) → não enviar mais
  if (elapsedHours > Math.max(...hours) + 1) return null

  const followupCount = state.followup_count ?? 0

  // Qual é o próximo follow-up a enviar?
  const nextFollowupHour = hours[followupCount]
  if (nextFollowupHour === undefined) return null // Todos já enviados

  // Ainda não chegou a hora do próximo follow-up
  if (elapsedHours < nextFollowupHour) return null

  return { followupIndex: followupCount }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('CRON_INBOX_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()

  if (cronSecret && provided !== cronSecret) return json({ error: 'unauthorized' }, 401)
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  const admin = createClient(supabaseUrl, serviceRole)

  // Busca leads que precisam de follow-up:
  // - ai_enabled = true
  // - owner_mode != 'human'
  // - last_inbound_at existe
  // - Inbound mais recente que qualquer outbound (ou sem outbound)
  // - followup_count < 6 (máximo de 6 follow-ups)
  // - Não está deleted (leads.deleted_at IS NULL)
  const { data: candidates, error: fetchErr } = await admin
    .from('crm_conversation_states')
    .select(`
      lead_id,
      owner_mode,
      ai_enabled,
      last_inbound_at,
      last_ai_reply_at,
      last_human_reply_at,
      last_followup_at,
      followup_count,
      followup_window_start,
      leads!inner (
        id,
        patient_name,
        phone,
        custom_fields,
        whatsapp_instance_id,
        deleted_at,
        conversation_status,
        tenant_id,
        stage_id
      )
    `)
    .eq('ai_enabled', true)
    .neq('owner_mode', 'human')
    .not('last_inbound_at', 'is', null)
    .lt('followup_count', FOLLOWUP_HOURS.length)
    .is('leads.deleted_at', null)

  if (fetchErr) {
    console.error('crm-followup-scheduler fetch:', fetchErr)
    return json({ error: fetchErr.message }, 500)
  }

  const rows = candidates ?? []
  let sent = 0
  let skipped = 0
  const results: Array<{ leadId: string; status: string; followupIndex?: number }> = []

  for (const row of rows) {
    const lead = (row as { leads: Record<string, unknown> }).leads as {
      id: string
      patient_name: string
      phone: string
      custom_fields: Record<string, unknown> | null
      whatsapp_instance_id: string | null
      deleted_at: string | null
      conversation_status: string | null
      tenant_id: string
    }

    if (!lead) { skipped++; continue }

    // Ignora leads perdidos/fechados
    if (lead.conversation_status === 'lost' || lead.conversation_status === 'closed') {
      skipped++
      continue
    }

    // Quem JÁ CONVERTEU não recebe follow-up de venda (pedido do Álvaro, 16/jul):
    // clínica com consulta agendada/fechado, ou venda paga no Tricopill. Pra esses o
    // contato certo é o fluxo de FEEDBACK (pós-consulta) ou a recompra (pós-frasco),
    // nunca "e aí, vamos fechar?" — soa robô e queima a relação.
    const CONVERTED_STAGES = new Set(['fechado', 'consulta', 'tricopill__vd-pago'])
    if (CONVERTED_STAGES.has(String((lead as { stage_id?: string }).stage_id ?? ''))) {
      skipped++
      continue
    }

    const state = {
      last_inbound_at: String(row.last_inbound_at ?? ''),
      last_ai_reply_at: row.last_ai_reply_at ? String(row.last_ai_reply_at) : null,
      last_human_reply_at: row.last_human_reply_at ? String(row.last_human_reply_at) : null,
      last_followup_at: row.last_followup_at ? String(row.last_followup_at) : null,
      followup_count: Number(row.followup_count ?? 0),
      followup_window_start: row.followup_window_start ? String(row.followup_window_start) : null,
    }

    // VENDAS (Tricopill): cadência curta (1º em 15min) + mensagens de venda. Clínica: padrão.
    const isSales = String(lead.tenant_id ?? '') === 'tricopill'
    const cadenceHours = isSales ? FOLLOWUP_HOURS_SALES : FOLLOWUP_HOURS
    const cadenceMsgs = isSales ? FOLLOWUP_MESSAGES_SALES : FOLLOWUP_MESSAGES

    const check = needsFollowup(state, cadenceHours)
    if (!check) { skipped++; continue }

    const { followupIndex } = check
    const leadId = String(row.lead_id)
    const patientName = String(lead.patient_name || 'você')
    const followupText = getFollowupMessage(followupIndex, patientName, cadenceMsgs)

    // Determina o canal de envio
    const customFields = lead.custom_fields ?? {}
    const channel = String(customFields.channel ?? 'instagram').toLowerCase()
    const subscriberId = String(customFields.manychat_subscriber_id ?? '')
    const phone = String(lead.phone ?? '')

    // Determina se é WhatsApp real (phone digits >= 10 e não sintético 888001...)
    const phoneDigits = phone.replace(/[^0-9]/g, '')
    const isRealWhatsapp = phoneDigits.length >= 10 && !phoneDigits.startsWith('888001')

    try {
      if (isRealWhatsapp && lead.whatsapp_instance_id) {
        // WhatsApp via Evolution API - usar crm-send-message interno
        const { data: sendResult, error: sendErr } = await admin.functions.invoke('crm-send-message', {
          body: {
            leadId,
            text: followupText,
            channel: 'whatsapp',
            source: 'followup_scheduler',
          },
        })

        if (sendErr || (sendResult as { ok?: boolean })?.ok === false) {
          console.warn(`followup WA send failed lead=${leadId}:`, sendErr ?? sendResult)
          results.push({ leadId, status: 'send_failed' })
          continue
        }

        await insertInteraction(admin, {
          leadId,
          patientName,
          channel: 'whatsapp',
          direction: 'out',
          author: 'Assistente IA (follow-up)',
          content: followupText,
          happenedAt: nowIso(),
        })
      } else if (subscriberId) {
        // ManyChat (Instagram DM ou WhatsApp via ManyChat)
        const pushChannel = channel === 'whatsapp' ? 'whatsapp' : 'instagram'
        const mcCfg = await readManychatPushConfigForTenantChannel(admin, lead.tenant_id, pushChannel)

        if (!mcCfg) {
          console.warn(`followup: no manychat config for channel=${pushChannel} lead=${leadId}`)
          results.push({ leadId, status: 'no_manychat_config' })
          skipped++
          continue
        }

        const pushArgs = {
          apiKey: mcCfg.apiKey,
          subscriberId,
          replyText: followupText,
          fieldId: mcCfg.fieldId,
          flowNs: mcCfg.flowNs,
          messageTag: mcCfg.messageTag || undefined,
        }

        const pushResult = pushChannel === 'whatsapp'
          ? await pushManychatWhatsappDmAfterReply(pushArgs)
          : await pushManychatInstagramDmAfterReply(pushArgs)

        if (!pushResult.ok) {
          console.warn(`followup MC push failed lead=${leadId}:`, pushResult.error)
          results.push({ leadId, status: 'push_failed' })
          continue
        }

        await insertInteraction(admin, {
          leadId,
          patientName,
          channel: 'meta',
          direction: 'out',
          author: 'Assistente IA (follow-up)',
          content: followupText,
          happenedAt: nowIso(),
        })
      } else {
        // Sem canal identificado
        skipped++
        results.push({ leadId, status: 'no_channel' })
        continue
      }

      // Atualiza o estado de follow-up
      const newCount = followupIndex + 1
      const windowStart = state.followup_window_start ?? state.last_inbound_at

      await admin
        .from('crm_conversation_states')
        .update({
          followup_count: newCount,
          followup_window_start: windowStart,
          last_followup_at: nowIso(),
          last_ai_reply_at: nowIso(), // Marca como outbound para não gerar outro follow-up imediato
          updated_at: nowIso(),
        })
        .eq('lead_id', leadId)

      // Espelha em crm_lead_followup_state para o badge no Kanban (KanbanLeadCard lê current_step/status).
      // current_step = índice 0-based do último follow-up enviado; status = 'completed' no último (índice 5),
      // 'active' até lá. Mensagens novas do paciente disparam status='interrupted' no whatsapp-webhook.
      const isLastFollowup = newCount >= cadenceHours.length
      await admin.from('crm_lead_followup_state').upsert({
        lead_id: leadId,
        current_step: followupIndex,
        last_sent_at: nowIso(),
        status: isLastFollowup ? 'completed' : 'active',
        updated_at: nowIso(),
      })

      sent++
      results.push({ leadId, status: 'sent', followupIndex })
    } catch (e) {
      console.error(`followup error lead=${leadId}:`, e)
      results.push({ leadId, status: 'error' })
    }
  }

  return json({
    ok: true,
    processed: rows.length,
    sent,
    skipped,
    results,
    at: nowIso(),
  })
})
