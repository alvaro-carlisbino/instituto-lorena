import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  evaluateCrmAiAutoReplyGate,
  nowIso,
  runManychatAiAutoReply,
  upsertConversationStateInboundOnly,
} from '../_shared/crmAiAutoReply.ts'
import { insertInteraction, promoteManychatLeadToRealPhone, syntheticPhoneFromManychatSubscriberId, upsertLeadByPhone } from '../_shared/crm.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-manychat-crm-secret',
}

const AI_RATE_SOURCES = ['whatsapp-webhook', 'manychat-webhook'] as const

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

async function ensureManychatLeadId(
  admin: ReturnType<typeof createClient>,
  input: { subscriberId: string; userName: string; text: string; phone?: string },
): Promise<string> {
  const sid = input.subscriberId.trim()
  const digits = input.phone ? digitsOnly(input.phone) : ''
  if (digits.length >= 10) {
    const { leadId } = await promoteManychatLeadToRealPhone(admin, {
      subscriberId: sid,
      patientName: input.userName || 'Lead Instagram',
      realPhoneDigits: digits,
      summary: input.text.slice(0, 500),
    })
    return leadId
  }

  const lead = await upsertLeadByPhone(admin, {
    patientName: input.userName || 'Lead Instagram',
    phone: syntheticPhoneFromManychatSubscriberId(sid),
    summary: input.text.slice(0, 500),
    source: 'meta_instagram',
    customFields: {
      manychat_subscriber_id: sid,
      channel: 'instagram',
    },
  })
  return lead.leadId
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const secret = (Deno.env.get('MANYCHAT_CRM_SECRET') ?? '').trim()
  const hdr = (req.headers.get('x-manychat-crm-secret') ?? '').trim()
  if (!secret || hdr !== secret) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = String(body.action ?? 'message').trim().toLowerCase()
  const subscriberId = String(body.subscriber_id ?? '').trim()
  if (!subscriberId) return json({ error: 'missing_subscriber_id' }, 400)

  if (action === 'merge_phone') {
    const phone = String(body.phone ?? '').trim()
    const digits = digitsOnly(phone)
    if (digits.length < 10) {
      return json({ error: 'invalid_phone', message: 'Telefone deve ter pelo menos 10 dígitos' }, 400)
    }
    try {
      const userName = String(body.user_name ?? body.name ?? 'Lead Instagram').trim() || 'Lead Instagram'
      const summary = String(body.summary ?? body.text ?? '').trim().slice(0, 500)
      const { leadId, merged } = await promoteManychatLeadToRealPhone(admin, {
        subscriberId,
        patientName: userName,
        realPhoneDigits: digits,
        summary,
      })
      return json({ ok: true, leadId, merged, action: 'merge_phone' })
    } catch (e) {
      return json({ error: 'merge_failed', message: e instanceof Error ? e.message : String(e) }, 400)
    }
  }

  const text = String(body.text ?? body.message ?? '').trim()
  if (!text) return json({ error: 'missing_text' }, 400)

  const contextAppend = String(body.context_append ?? body.user_context ?? '').trim()
  const aiInboundUserText = contextAppend ? `${text}\n\n---\n${contextAppend}` : text

  const userName = String(body.user_name ?? body.name ?? 'Lead Instagram').trim() || 'Lead Instagram'
  const phoneOpt = String(body.phone ?? '').trim() || undefined
  const externalMessageId = String(body.external_message_id ?? body.message_id ?? '').trim() ||
    `mc-${subscriberId}-${crypto.randomUUID()}`

  const dedupKey = `manychat:${subscriberId}:${externalMessageId}`
  const { data: existing } = await admin
    .from('webhook_jobs')
    .select('id')
    .eq('source', 'manychat-webhook')
    .eq('note', dedupKey)
    .maybeSingle()
  if (existing?.id) {
    return json({ ok: true, status: 'already_processed', reply: '', handoff_suggested: false })
  }

  const { data: jobRow, error: jobInsertError } = await admin
    .from('webhook_jobs')
    .insert({
      source: 'manychat-webhook',
      status: 'processing',
      note: dedupKey,
    })
    .select('id')
    .single()
  if (jobInsertError) return json({ error: jobInsertError.message }, 400)

  try {
    const leadId = await ensureManychatLeadId(admin, {
      subscriberId,
      userName,
      text,
      phone: phoneOpt,
    })

    await insertInteraction(admin, {
      leadId,
      patientName: userName,
      channel: 'meta',
      direction: 'in',
      author: userName,
      content: text,
      happenedAt: nowIso(),
    })

    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle()
    const { data: config } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()
    const statePrompt = String(state?.prompt_override ?? config?.system_prompt ?? '').trim()

    const gate = await evaluateCrmAiAutoReplyGate(admin, leadId, {
      directionIsInbound: true,
      rateLimitJobSources: [...AI_RATE_SOURCES],
    })

    let reply = ''
    let handoffSuggested = false
    if (gate.canAutoReply) {
      const { replyText, handoffSuggested: ho } = await runManychatAiAutoReply(admin, {
        leadId,
        patientName: userName,
        aiInboundUserText,
        inboundHappenedAt: nowIso(),
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        statePrompt,
        aiJobSource: 'manychat-webhook',
      })
      reply = replyText ?? ''
      handoffSuggested = Boolean(ho)
    } else {
      await upsertConversationStateInboundOnly(admin, {
        leadId,
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        inboundHappenedAt: nowIso(),
      })
    }

    await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))

    return json({
      ok: true,
      leadId,
      reply,
      handoff_suggested: handoffSuggested,
      routing: gate.canAutoReply ? 'ai_auto_reply_attempted' : 'manual_handoff',
    })
  } catch (e) {
    await admin
      .from('webhook_jobs')
      .update({
        status: 'retry',
        note: `${dedupKey}|error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
      })
      .eq('id', String(jobRow.id))
    return json({ error: 'processing_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
