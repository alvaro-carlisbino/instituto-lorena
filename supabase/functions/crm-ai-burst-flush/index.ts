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

// PASSO 2 (rede profunda): conversa presa SEM buffer (o waitUntil/z.ai morreu DEPOIS de zerar o
// buffer no claim → Passo 1 fica cego). Detectada pelo histórico. Margem alta p/ não competir com
// o caminho normal nem com o Passo 1 (z.ai lento chega a ~55s).
const STUCK_SECS = 180

type Admin = ReturnType<typeof createClient>
type FlushLead = {
  id: string; patient_name?: string; phone?: string; whatsapp_instance_id?: string | null
  deleted_at?: string | null; conversation_status?: string | null; tenant_id?: string
}

/** Monta provider W-API + prompt do polo e dispara a resposta da IA (burstFlush). Throw em falha. */
async function deliverAiReply(
  admin: Admin,
  lead: FlushLead,
  args: { text: string; inboundHappenedAt: string; ownerMode: string; aiJobSource: string },
): Promise<{ replied: boolean }> {
  const instRow = await loadWapiInstanceByRowId(admin, String(lead.whatsapp_instance_id))
  if (!instRow) throw new Error('instance_not_found')
  const provider = createWapiProviderForRow(instRow)
  const isSalesBot = String((instRow as { bot_kind?: string }).bot_kind ?? '').toLowerCase() === 'sales'
  const tenantId = String(lead.tenant_id ?? '').trim()

  const { data: state } = await admin
    .from('crm_conversation_states').select('prompt_override').eq('lead_id', lead.id).maybeSingle()
  const { data: config } = tenantId
    ? await admin.from('crm_ai_configs').select('system_prompt').eq('id', 'default').eq('tenant_id', tenantId).maybeSingle()
    : { data: null }
  const statePrompt = String(
    (state as { prompt_override?: string } | null)?.prompt_override ??
    (config as { system_prompt?: string } | null)?.system_prompt ?? '',
  ).trim()

  const res = await runWhatsappAiAutoReply(admin, {
    leadId: lead.id,
    patientName: String(lead.patient_name ?? 'Cliente'),
    fromPhone: String(lead.phone ?? ''),
    aiInboundUserText: args.text,
    inboundHappenedAt: args.inboundHappenedAt,
    ownerMode: args.ownerMode,
    aiEnabled: true,
    statePrompt,
    aiJobSource: args.aiJobSource,
    sendProvider: provider,
    keepAiOn: isSalesBot,
    burstFlush: true,
  })
  return { replied: (res as { replied?: boolean } | undefined)?.replied !== false }
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
      await deliverAiReply(admin, lead, {
        text,
        inboundHappenedAt: String((row as { last_inbound_at?: string }).last_inbound_at ?? nowIso()),
        ownerMode: String((row as { owner_mode?: string }).owner_mode ?? 'auto'),
        aiJobSource: 'burst-flush-cron',
      })
      flushed++
      results.push({ leadId, status: 'flushed' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[burst-flush] lead=${leadId}:`, msg)
      results.push({ leadId, status: msg === 'instance_not_found' ? 'instance_not_found' : 'error' })
    }
  }

  // ── PASSO 2 — REDE DE SEGURANÇA PROFUNDA ────────────────────────────────────────────────
  // Conversa presa SEM buffer: o waitUntil/z.ai morreu DEPOIS do claim (que zera o buffer) →
  // o Passo 1 não vê nada. Aqui detectamos pelo histórico: última interação WhatsApp é do
  // cliente (sem resposta depois) e parada há > STUCK_SECS. Reconstruímos o texto do cliente
  // desde a última resposta e disparamos a IA. Idempotência por external_message_id do inbound
  // (claim em webhook_jobs) p/ não duplicar com a reply normal que possa chegar atrasada.
  const stuckCutoff = new Date(Date.now() - STUCK_SECS * 1000).toISOString()
  let recovered = 0
  const stuckResults: Array<{ leadId: string; status: string }> = []
  const { data: stuckRows } = await admin
    .from('crm_conversation_states')
    .select(`
      lead_id, owner_mode, last_inbound_at, last_ai_reply_at, last_human_reply_at,
      leads!inner ( id, patient_name, phone, whatsapp_instance_id, deleted_at, conversation_status, tenant_id )
    `)
    .neq('owner_mode', 'human')
    .eq('ai_enabled', true)
    .not('last_inbound_at', 'is', null)
    .lt('last_inbound_at', stuckCutoff)
    .is('leads.deleted_at', null)
    // Mais recente primeiro: uma conversa presa AGORA tem last_inbound recente → vai pro topo
    // (PostgREST não compara coluna-a-coluna, então o filtro inbound>reply é feito em código).
    .order('last_inbound_at', { ascending: false })
    .limit(100)

  for (const row of stuckRows ?? []) {
    const leadsRaw = (row as unknown as { leads: unknown }).leads
    const lead = (Array.isArray(leadsRaw) ? leadsRaw[0] : leadsRaw) as FlushLead | null
    const leadId = String((row as { lead_id: string }).lead_id)
    if (!lead) continue
    if (lead.conversation_status === 'lost' || lead.conversation_status === 'closed') continue

    const phoneDigits = String(lead.phone ?? '').replace(/\D/g, '')
    const isRealWhatsapp = phoneDigits.length >= 10 && !phoneDigits.startsWith('888001')
    if (!isRealWhatsapp || !lead.whatsapp_instance_id) continue

    const lastInboundAt = String((row as { last_inbound_at?: string }).last_inbound_at ?? '')
    const inboundMs = lastInboundAt ? Date.parse(lastInboundAt) : 0
    const lastReplyMs = Math.max(
      Date.parse(String((row as { last_ai_reply_at?: string }).last_ai_reply_at ?? '')) || 0,
      Date.parse(String((row as { last_human_reply_at?: string }).last_human_reply_at ?? '')) || 0,
    )
    // Só conversas onde o inbound é mais novo que QUALQUER resposta (presa de verdade).
    if (lastReplyMs && inboundMs && inboundMs <= lastReplyMs) continue

    // Confirma pelo histórico e reconstrói o texto do cliente (inbounds consecutivos no topo).
    const { data: inter } = await admin
      .from('interactions')
      .select('direction, content, happened_at, external_message_id')
      .eq('lead_id', leadId).eq('channel', 'whatsapp')
      .order('happened_at', { ascending: false }).limit(12)
    const list = (inter ?? []) as Array<{ direction: string; content: string; happened_at: string; external_message_id?: string }>
    if (list.length === 0 || list[0].direction !== 'in') continue // já respondido (último é out) ou sem inbound

    const inbound: typeof list = []
    for (const it of list) { if (it.direction !== 'in') break; inbound.push(it) }
    inbound.reverse() // cronológico
    const text = inbound.map((i) => String(i.content ?? '').trim()).filter(Boolean).join('\n').trim().slice(0, 4000)
    if (!text) continue
    const last = inbound[inbound.length - 1]
    const msgKey = String(last.external_message_id ?? last.happened_at)

    // CLAIM idempotente: insere ANTES de enviar (não duplica). Em falha, apaga p/ permitir retry.
    const claimNote = `stuck_claim:${leadId}:${msgKey}`.slice(0, 500)
    const { data: already } = await admin
      .from('webhook_jobs').select('id').eq('note', claimNote).limit(1).maybeSingle()
    if (already) { stuckResults.push({ leadId, status: 'already_claimed' }); continue }
    const { data: claimRow } = await admin
      .from('webhook_jobs').insert({ source: 'burst-flush-stuck', status: 'done', note: claimNote })
      .select('id').maybeSingle()

    try {
      const res = await deliverAiReply(admin, lead, {
        text,
        inboundHappenedAt: lastInboundAt || nowIso(),
        ownerMode: String((row as { owner_mode?: string }).owner_mode ?? 'auto'),
        aiJobSource: 'burst-flush-stuck',
      })
      if (!res.replied) {
        // z.ai indisponível (rate-limit/sem saldo): NÃO respondeu e NÃO mandou desculpa. Libera o
        // claim p/ o cron retentar na próxima rodada (a cada 2 min), até o z.ai voltar.
        const claimId = (claimRow as { id?: string | number } | null)?.id
        if (claimId !== undefined) await admin.from('webhook_jobs').delete().eq('id', claimId)
        stuckResults.push({ leadId, status: 'retry_later' })
      } else {
        recovered++
        stuckResults.push({ leadId, status: 'recovered' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[burst-flush:stuck] lead=${leadId}:`, msg)
      // Apaga o claim p/ permitir nova tentativa numa próxima rodada do cron.
      const claimId = (claimRow as { id?: string | number } | null)?.id
      if (claimId !== undefined) await admin.from('webhook_jobs').delete().eq('id', claimId)
      stuckResults.push({ leadId, status: 'error' })
    }
  }

  return json({
    ok: true,
    candidates: rows?.length ?? 0,
    flushed,
    skipped,
    recovered,
    stuckCandidates: stuckRows?.length ?? 0,
    results,
    stuckResults,
    at: nowIso(),
  })
})
