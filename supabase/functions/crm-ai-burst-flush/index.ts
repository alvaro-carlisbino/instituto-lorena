import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { nowIso, runWhatsappAiAutoReply } from '../_shared/crmAiAutoReply.ts'
import { createWapiProviderForRow, loadWapiInstanceByRowId } from '../_shared/whatsapp/wapiConfig.ts'

/**
 * crm-ai-burst-flush — REDE DE SEGURANÇA do auto-reply (cron, a cada 2 min).
 *
 * O webhook do WhatsApp agenda a resposta da IA em `EdgeRuntime.waitUntil` (background).
 * Quando esse background é descartado (isolate reciclado) ou o z.ai demora demais, o buffer
 * fica preso em `crm_conversation_states.ai_inbound_burst_text` e o cliente NUNCA recebe
 * resposta — até alguém abrir a conversa no painel. Já aconteceu (lead esperou 1h+).
 *
 * Aqui varremos bursts parados há > STALE_SECS, fazemos um CLAIM ATÔMICO (update … where
 * ai_inbound_burst_text is not null) p/ não competir/duplicar com o flush do waitUntil, e
 * disparamos a MESMA resposta (runWhatsappAiAutoReply burstFlush). Só toca em bursts já
 * presos — não altera o caminho normal do webhook.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// Só age em bursts parados há mais que isto (deixa o flush rápido do waitUntil, debounce ~3s, agir antes).
const STALE_SECS = 45

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

  const cutoff = new Date(Date.now() - STALE_SECS * 1000).toISOString()
  const { data: rows, error } = await admin
    .from('crm_conversation_states')
    .select(`
      lead_id, owner_mode, ai_enabled, last_inbound_at, ai_inbound_burst_updated_at,
      leads!inner ( id, patient_name, phone, whatsapp_instance_id, deleted_at, conversation_status, tenant_id )
    `)
    .not('ai_inbound_burst_text', 'is', null)
    .neq('owner_mode', 'human')
    .eq('ai_enabled', true)
    .lt('ai_inbound_burst_updated_at', cutoff)
    .is('leads.deleted_at', null)
    .limit(25)

  if (error) {
    console.error('[burst-flush] fetch:', error.message)
    return json({ ok: false, error: error.message }, 500)
  }

  let flushed = 0
  let skipped = 0
  const results: Array<{ leadId: string; status: string }> = []

  for (const row of rows ?? []) {
    const leadsRaw = (row as unknown as { leads: unknown }).leads
    const lead = (Array.isArray(leadsRaw) ? leadsRaw[0] : leadsRaw) as {
      id: string; patient_name?: string; phone?: string; whatsapp_instance_id?: string | null
      deleted_at?: string | null; conversation_status?: string | null; tenant_id?: string
    } | null
    const leadId = String((row as { lead_id: string }).lead_id)
    if (!lead) { skipped++; continue }
    if (lead.conversation_status === 'lost' || lead.conversation_status === 'closed') { skipped++; continue }

    const phoneDigits = String(lead.phone ?? '').replace(/\D/g, '')
    const isRealWhatsapp = phoneDigits.length >= 10 && !phoneDigits.startsWith('888001')
    if (!isRealWhatsapp || !lead.whatsapp_instance_id) { skipped++; results.push({ leadId, status: 'no_wapi_channel' }); continue }

    // CLAIM ATÔMICO: quem zerar o buffer primeiro (cron OU waitUntil) processa; o outro vê null.
    const { data: claimed } = await admin
      .from('crm_conversation_states')
      .update({ ai_inbound_burst_text: null, ai_inbound_burst_updated_at: null, updated_at: nowIso() })
      .eq('lead_id', leadId)
      .not('ai_inbound_burst_text', 'is', null)
      .select('ai_inbound_burst_text')
      .maybeSingle()
    const text = String((claimed as { ai_inbound_burst_text?: string } | null)?.ai_inbound_burst_text ?? '').trim()
    if (!text) { skipped++; continue } // já flushado por outro caminho

    try {
      const instRow = await loadWapiInstanceByRowId(admin, String(lead.whatsapp_instance_id))
      if (!instRow) { results.push({ leadId, status: 'instance_not_found' }); continue }
      const provider = createWapiProviderForRow(instRow)
      const isSalesBot = String((instRow as { bot_kind?: string }).bot_kind ?? '').toLowerCase() === 'sales'
      const tenantId = String(lead.tenant_id ?? '').trim()

      const { data: state } = await admin
        .from('crm_conversation_states').select('prompt_override').eq('lead_id', leadId).maybeSingle()
      const { data: config } = tenantId
        ? await admin.from('crm_ai_configs').select('system_prompt').eq('id', 'default').eq('tenant_id', tenantId).maybeSingle()
        : { data: null }
      const statePrompt = String(
        (state as { prompt_override?: string } | null)?.prompt_override ??
        (config as { system_prompt?: string } | null)?.system_prompt ?? '',
      ).trim()

      await runWhatsappAiAutoReply(admin, {
        leadId,
        patientName: String(lead.patient_name ?? 'Cliente'),
        fromPhone: String(lead.phone ?? ''),
        aiInboundUserText: text,
        inboundHappenedAt: String((row as { last_inbound_at?: string }).last_inbound_at ?? nowIso()),
        ownerMode: String((row as { owner_mode?: string }).owner_mode ?? 'auto'),
        aiEnabled: true,
        statePrompt,
        aiJobSource: 'burst-flush-cron',
        sendProvider: provider,
        keepAiOn: isSalesBot,
        burstFlush: true,
      })
      flushed++
      results.push({ leadId, status: 'flushed' })
    } catch (e) {
      console.error(`[burst-flush] lead=${leadId}:`, e instanceof Error ? e.message : String(e))
      results.push({ leadId, status: 'error' })
    }
  }

  return json({ ok: true, candidates: rows?.length ?? 0, flushed, skipped, results, at: nowIso() })
})
