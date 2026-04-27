import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { getWhatsappProviderFromEnv } from '../_shared/whatsapp/provider.ts'
import { getEvolutionProviderForLead } from '../_shared/whatsapp/evolutionConfig.ts'
import type { WhatsappProvider } from '../_shared/whatsapp/types.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function nowIso(): string {
  return new Date().toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let body: {
    leadId?: string
    to?: string
    text?: string
    attachments?: Array<{ name?: string; mimeType?: string; base64?: string }>
  }
  try {
    body = (await req.json()) as { leadId?: string; to?: string; text?: string }
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const leadId = String(body.leadId ?? '').trim()
  const to = String(body.to ?? '').trim()
  const text = String(body.text ?? '').trim()
  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  if (!leadId || !to || !text) return json({ error: 'missing_fields' }, 400)

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('id, patient_name, whatsapp_instance_id')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr || !lead) return json({ error: 'lead_not_found' }, 404)

  const waProvider = (Deno.env.get('WHATSAPP_PROVIDER') ?? 'evolution').trim().toLowerCase()
  let provider: WhatsappProvider
  try {
    if (waProvider === 'official') {
      provider = getWhatsappProviderFromEnv()
    } else {
      const row = lead as { id: string; patient_name: string; whatsapp_instance_id: string | null }
      provider = await getEvolutionProviderForLead(admin, row.whatsapp_instance_id)
    }
  } catch (e) {
    return json({ error: 'provider_not_configured', message: e instanceof Error ? e.message : String(e) }, 500)
  }

  try {
    const { data: aiConfig } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()
    const maxPerHour = Number(aiConfig?.max_ai_replies_per_hour ?? 2)
    const minSecondsBetween = Number(aiConfig?.min_seconds_between_ai_replies ?? 240)
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: outboundLastHour } = await admin
      .from('webhook_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'whatsapp-webhook')
      .like('note', 'outbound:%')
      .gte('created_at', oneHourAgoIso)
    if ((outboundLastHour ?? 0) > Math.max(10, maxPerHour * 8)) {
      return json({ error: 'rate_limited', message: 'Limite de segurança atingido. Tente novamente em alguns minutos.' }, 429)
    }

    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('last_human_reply_at')
      .eq('lead_id', leadId)
      .maybeSingle()
    const lastHumanAt = state?.last_human_reply_at ? new Date(String(state.last_human_reply_at)).getTime() : 0
    if (lastHumanAt && (Date.now() - lastHumanAt) / 1000 < Math.min(120, minSecondsBetween)) {
      return json({ error: 'cooldown', message: 'Aguarde alguns segundos antes de enviar outra mensagem.' }, 429)
    }

    const sent = await provider.sendMessage({ to, text, leadId })
    await insertInteraction(admin, {
      leadId: String(lead.id),
      patientName: String(lead.patient_name ?? 'Lead'),
      channel: 'whatsapp',
      direction: 'out',
      author: user.email ?? 'Operador',
      content: text,
    })
    if (attachments.length > 0) {
      await admin.from('crm_media_items').insert(
        attachments.map((file) => ({
          lead_id: leadId,
          direction: 'out',
          media_type: String(file.mimeType ?? '').startsWith('audio/')
            ? 'audio'
            : String(file.mimeType ?? '').startsWith('image/')
              ? 'image'
              : 'document',
          mime_type: String(file.mimeType ?? ''),
          metadata: {
            name: String(file.name ?? 'arquivo'),
            size_base64: String(file.base64 ?? '').length,
            outbound_mode: 'manual_attachment',
          },
        })),
      )
    }

    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'done',
      note: `outbound:${provider.name}:${sent.externalMessageId}`.slice(0, 500),
    })
    await admin.from('crm_conversation_states').upsert({
      lead_id: leadId,
      owner_mode: 'human',
      ai_enabled: true,
      last_human_reply_at: nowIso(),
      updated_at: nowIso(),
    })

    return json({
      ok: true,
      provider: provider.name,
      externalMessageId: sent.externalMessageId,
      status: sent.status,
    })
  } catch (e) {
    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'retry',
      note: `outbound_error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    })
    return json({ error: 'send_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

