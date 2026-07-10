import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction, upsertLeadByPhone } from '../_shared/crm.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import type { LeadAttribution } from '../_shared/attribution.ts'

// Frente B da atribuição Meta: LEAD ADS (formulário dentro do Facebook/Instagram).
// A Meta chama este webhook a cada formulário enviado (objeto "page", campo "leadgen"),
// a gente busca o lead completo na Graph API e cria/atualiza no CRM com atribuição
// first-touch (attribution_channel='lead_ads', campanha/anúncio preenchidos).
//
// Secrets:
//  - META_LEADGEN_VERIFY_TOKEN  handshake GET da Meta (obrigatório p/ assinar o webhook)
//  - META_APP_SECRET            valida X-Hub-Signature-256 (sem ele, aceita e avisa no log)
//  - META_PAGE_TOKEN            token (system user/página) com leads_retrieval p/ buscar o lead
//  - META_PAGE_TENANT_MAP       opcional, JSON {"<page_id>":"tricopill"}; default instituto-lorena

const GRAPH = 'https://graph.facebook.com/v21.0'
const LEAD_FIELDS =
  'field_data,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic'

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** HMAC-SHA256 do corpo cru com o App Secret → compara com X-Hub-Signature-256. */
async function signatureValid(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return header.slice('sha256='.length) === hex
}

/** Telefone BR do formulário → dígitos com DDI 55 (formulários mandam +55..., 55... ou só DDD+número). */
function normalizeBrPhone(raw: string): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('0')) d = d.replace(/^0+/, '')
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`
  return d
}

type FieldData = { name?: string; values?: unknown[] }

/** Auditoria: registra TODA entrega da Meta em meta_leadgen_events (best-effort, nunca quebra). */
async function logEvent(
  admin: SupabaseClient,
  ev: { leadgenId: string; pageId?: string; formId?: string; status: string; leadId?: string; detail?: string },
): Promise<void> {
  try {
    await admin.from('meta_leadgen_events').insert({
      leadgen_id: ev.leadgenId, page_id: ev.pageId ?? null, form_id: ev.formId ?? null,
      status: ev.status, lead_id: ev.leadId ?? null, detail: (ev.detail ?? '').slice(0, 500) || null,
    })
  } catch { /* auditoria nunca derruba o webhook */ }
}

function pickField(fields: FieldData[], ...keys: string[]): string {
  for (const k of keys) {
    const f = fields.find((x) => String(x.name ?? '').toLowerCase().includes(k))
    const v = f?.values?.[0]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

// ── Leitura do lead na Graph, RESILIENTE ────────────────────────────────────
// A Meta às vezes devolve GraphMethodException (#100 "Unsupported request - method
// type: get") no GET direto /{leadgen_id} de forma intermitente — o mesmo formulário
// tem leadgen_ids que leem e outros que falham. Antes o código tentava UMA vez e
// descartava o lead pra sempre (perdíamos ~70% dos formulários). Agora:
//   1) retry com backoff no GET direto;
//   2) fallback pelo edge /{form_id}/leads (caminho de acesso diferente, costuma
//      passar quando o GET por-id falha) procurando o leadgen_id na lista.

/** GET /{leadgen_id} com retry. Retorna os dados ou o último detalhe de erro. */
async function graphGetLead(
  leadgenId: string, pageToken: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; detail: string }> {
  let lastDetail = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(400 * attempt) // 0, 400, 800, 1200ms
    try {
      const res = await fetch(
        `${GRAPH}/${leadgenId}?fields=${LEAD_FIELDS}&access_token=${encodeURIComponent(pageToken)}`,
      )
      const data = (await res.json()) as Record<string, unknown>
      if (res.ok) return { ok: true, data }
      lastDetail = JSON.stringify(data).slice(0, 400)
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, detail: lastDetail }
}

/** Fallback: acha o lead varrendo /{form_id}/leads (páginas), casando pelo id. */
async function graphFindLeadViaForm(
  formId: string, leadgenId: string, pageToken: string,
): Promise<Record<string, unknown> | null> {
  if (!formId) return null
  let url: string =
    `${GRAPH}/${formId}/leads?fields=${LEAD_FIELDS}&limit=100&access_token=${encodeURIComponent(pageToken)}`
  try {
    for (let page = 0; page < 5 && url; page++) {
      const res = await fetch(url)
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) return null
      const arr = Array.isArray(data.data) ? (data.data as Array<Record<string, unknown>>) : []
      const hit = arr.find((x) => String(x.id ?? '') === leadgenId)
      if (hit) return hit
      url = String((data.paging as Record<string, unknown> | undefined)?.next ?? '')
    }
  } catch { /* fallback é best-effort */ }
  return null
}

type ProcessResult = { leadgenId: string; ok: boolean; leadId?: string; status?: string; reason?: string }

/**
 * Processa UM leadgen (usado tanto pelo webhook ao vivo quanto pela recuperação):
 * busca na Graph (retry + fallback), valida telefone, cria/atualiza o lead com atribuição.
 */
async function processLeadgen(
  admin: SupabaseClient,
  input: { leadgenId: string; pageId: string; formId: string },
  pageToken: string,
  tenantMap: Record<string, string>,
): Promise<ProcessResult> {
  const { leadgenId, pageId, formId: formIdRaw } = input

  if (!pageToken) {
    console.error(`[meta-leadform] lead ${leadgenId} recebido mas META_PAGE_TOKEN ausente`)
    await logEvent(admin, { leadgenId, pageId, formId: formIdRaw, status: 'sem_page_token' })
    return { leadgenId, ok: false, reason: 'sem_page_token' }
  }

  // Busca o formulário preenchido (traz campanha/anúncio por nome junto).
  const primary = await graphGetLead(leadgenId, pageToken)
  let lead: Record<string, unknown> | null = primary.ok ? primary.data : null
  if (!lead) {
    // GET direto falhou mesmo com retry → tenta pelo edge do formulário.
    lead = await graphFindLeadViaForm(formIdRaw, leadgenId, pageToken)
    if (!lead) {
      const detail = primary.ok ? 'fallback_sem_match' : primary.detail
      console.error(`[meta-leadform] Graph ${leadgenId} falhou (retry+fallback): ${detail}`)
      await logEvent(admin, { leadgenId, pageId, formId: formIdRaw, status: 'graph_error', detail })
      return { leadgenId, ok: false, reason: 'graph_error' }
    }
  }

  const fields = Array.isArray(lead.field_data) ? (lead.field_data as FieldData[]) : []
  const nome = pickField(fields, 'full_name', 'nome') || 'Lead Meta (formulário)'
  const phoneRaw = pickField(fields, 'phone', 'telefone', 'whatsapp', 'celular')
  const email = pickField(fields, 'email', 'e-mail')
  const phone = normalizeBrPhone(phoneRaw)

  if (phone.length < 10) {
    console.error(`[meta-leadform] lead ${leadgenId} sem telefone utilizável ("${phoneRaw}") — não criado`)
    await logEvent(admin, { leadgenId, pageId, formId: String(lead.form_id ?? formIdRaw), status: 'skipped_sem_telefone', detail: `nome="${nome}" phoneRaw="${phoneRaw}"` })
    return { leadgenId, ok: false, reason: 'sem_telefone' }
  }

  const campaignName = String(lead.campaign_name ?? '').trim()
  const adName = String(lead.ad_name ?? '').trim()
  const attribution: LeadAttribution = {
    channel: 'lead_ads',
    campaign: campaignName || String(lead.campaign_id ?? '').trim() || undefined,
    adId: String(lead.ad_id ?? '').trim() || undefined,
    adsetId: String(lead.adset_id ?? '').trim() || undefined,
    headline: adName || undefined,
    raw: {
      leadgen_id: leadgenId, page_id: pageId, form_id: String(lead.form_id ?? ''),
      campaign_id: lead.campaign_id, campaign_name: campaignName, ad_id: lead.ad_id,
      ad_name: adName, adset_id: lead.adset_id, adset_name: lead.adset_name,
      is_organic: lead.is_organic, created_time: lead.created_time,
    },
  }

  const answers: Record<string, string> = {}
  for (const f of fields) {
    const k = String(f.name ?? '').trim()
    const v = f.values?.[0]
    if (k && v != null) answers[k] = String(v).slice(0, 300)
  }

  const tenantId = tenantMap[pageId] || 'instituto-lorena'
  const surface = tenantId === 'tricopill' ? 'meta_facebook' : 'meta_instagram'
  try {
    const up = await upsertLeadByPhone(admin, {
      patientName: nome,
      phone,
      summary: `Formulário Meta (Lead Ads)${campaignName ? ` — campanha ${campaignName}` : ''}`,
      source: surface,
      temperature: 'hot',
      score: 70,
      attribution,
      tenantId,
      // Lead de formulário entra na fila de contato ATIVO (etapa "📞 Ligar — Formulário",
      // SLA 15min no board_config) — só na criação; lead existente não muda de etapa.
      ...(tenantId === 'instituto-lorena' ? { pipelineId: 'pipeline-clinica', stageId: 'ligar-formulario' } : {}),
      customFields: { lead_form: { leadgen_id: leadgenId, form_id: String(lead.form_id ?? ''), ...(email ? { email } : {}), respostas: answers } },
    })
    const resumo = Object.entries(answers).map(([k, v]) => `• ${k}: ${v}`).join('\n')
    await insertInteraction(admin, {
      leadId: up.leadId, patientName: nome, channel: 'system', direction: 'in', author: 'Meta Lead Ads',
      content: `📋 Formulário recebido${campaignName ? ` (campanha: ${campaignName}` : ''}${adName ? ` · anúncio: ${adName}` : ''}${campaignName ? ')' : ''}\n${resumo}`.slice(0, 1500),
      tenantId,
    }).catch(() => {})
    await logEvent(admin, { leadgenId, pageId, formId: String(lead.form_id ?? formIdRaw), status: `lead_${up.status}`, leadId: up.leadId, detail: `${nome} | campanha=${campaignName || '-'}` })
    // Lead de formulário NÃO chega conversando — o time precisa chamar ATIVAMENTE.
    await notifyAgents(admin, {
      leadId: up.leadId,
      kind: 'info',
      title: '📋 Lead de formulário Meta — chamar AGORA',
      body: `${nome} · WhatsApp ${phone}${campaignName ? ` · ${campaignName}` : ''}. Preencheu formulário no anúncio — quanto antes o contato, maior a conversão.`,
      includeOwner: true,
      tenantId,
      metadata: { dedupeKey: `leadform-${leadgenId}` },
    }).catch(() => {})
    return { leadgenId, ok: true, leadId: up.leadId, status: up.status }
  } catch (e) {
    console.error(`[meta-leadform] upsert ${leadgenId} falhou: ${e instanceof Error ? e.message : e}`)
    await logEvent(admin, { leadgenId, pageId, formId: String(lead.form_id ?? formIdRaw), status: 'upsert_failed', detail: e instanceof Error ? e.message : String(e) })
    return { leadgenId, ok: false, reason: 'upsert_failed' }
  }
}

/**
 * Recuperação: reprocessa os leadgen_ids que ficaram em graph_error/graph_exception
 * e nunca viraram lead. Disparo manual e protegido por token guardado no banco
 * (tabela app_edge_tokens, name='meta_leadform_recover_token').
 */
async function runRecovery(admin: SupabaseClient, pageToken: string, tenantMap: Record<string, string>, limit: number): Promise<Response> {
  // leadgen_ids que já viraram lead alguma vez (não reprocessa esses)
  const { data: okRows } = await admin.from('meta_leadgen_events').select('leadgen_id').like('status', 'lead_%')
  const done = new Set((okRows ?? []).map((r) => String((r as Record<string, unknown>).leadgen_id)))

  const { data: failRows, error } = await admin
    .from('meta_leadgen_events')
    .select('leadgen_id, page_id, form_id, created_at')
    .in('status', ['graph_error', 'graph_exception'])
    .order('created_at', { ascending: false })
  if (error) return json({ error: 'query_failed', message: error.message }, 500)

  // dedup por leadgen_id, mantendo o registro mais recente, e tirando os já recuperados
  const seen = new Set<string>()
  const targets: Array<{ leadgenId: string; pageId: string; formId: string }> = []
  for (const r of (failRows ?? []) as Array<Record<string, unknown>>) {
    const id = String(r.leadgen_id ?? '')
    if (!id || done.has(id) || seen.has(id)) continue
    seen.add(id)
    targets.push({ leadgenId: id, pageId: String(r.page_id ?? ''), formId: String(r.form_id ?? '') })
    if (targets.length >= limit) break
  }

  const results: ProcessResult[] = []
  for (const t of targets) {
    results.push(await processLeadgen(admin, t, pageToken, tenantMap))
  }
  const recovered = results.filter((r) => r.ok).length
  return json({
    ok: true,
    action: 'recover_failed',
    candidatos: targets.length,
    recuperados: recovered,
    ainda_falhando: results.filter((r) => !r.ok).length,
    detalhe: results,
  })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // ── Handshake de assinatura do webhook (Meta manda GET com challenge) ──
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge') ?? ''
    const expected = (Deno.env.get('META_LEADGEN_VERIFY_TOKEN') ?? '').trim()
    if (mode === 'subscribe' && expected && token === expected) return text(challenge)
    return text('forbidden', 403)
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const rawBody = await req.text()

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const pageToken = (Deno.env.get('META_PAGE_TOKEN') ?? '').trim()
  let tenantMap: Record<string, string> = {}
  try {
    tenantMap = JSON.parse(Deno.env.get('META_PAGE_TENANT_MAP') ?? '{}') as Record<string, string>
  } catch { /* mapa opcional */ }

  // ── Ação de RECUPERAÇÃO (antes da validação de assinatura da Meta) ──
  // Protegida por token guardado no banco; não é chamada pela Meta.
  try {
    const maybe = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
    if (maybe && maybe.action === 'recover_failed') {
      const provided = String(maybe.token ?? '')
      const { data: tok } = await admin
        .from('app_edge_tokens').select('token').eq('name', 'meta_leadform_recover_token').maybeSingle()
      const expected = String((tok as Record<string, unknown> | null)?.token ?? '')
      if (!expected || provided !== expected) return json({ error: 'unauthorized' }, 401)
      const limit = Number.isFinite(Number(maybe.limit)) && Number(maybe.limit) > 0 ? Math.min(200, Math.floor(Number(maybe.limit))) : 50
      return await runRecovery(admin, pageToken, tenantMap, limit)
    }
  } catch { /* não é JSON de recover — segue fluxo normal da Meta */ }

  // Assinatura: valida quando o App Secret estiver configurado (setup em fases).
  const appSecret = (Deno.env.get('META_APP_SECRET') ?? '').trim()
  if (appSecret) {
    const ok = await signatureValid(rawBody, req.headers.get('x-hub-signature-256'), appSecret)
    if (!ok) return json({ error: 'invalid_signature' }, 401)
  } else {
    console.warn('[meta-leadform] META_APP_SECRET ausente — aceitando sem validar assinatura (configure!)')
  }

  let payload: Record<string, unknown>
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const entries = Array.isArray(payload.entry) ? (payload.entry as Array<Record<string, unknown>>) : []
  const results: ProcessResult[] = []

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as Array<Record<string, unknown>>) : []
    for (const change of changes) {
      if (String(change.field ?? '') !== 'leadgen') continue
      const value = (change.value ?? {}) as Record<string, unknown>
      const leadgenId = String(value.leadgen_id ?? '').trim()
      const pageId = String(value.page_id ?? entry.id ?? '').trim()
      const formIdRaw = String(value.form_id ?? '').trim()
      if (!leadgenId) continue
      results.push(await processLeadgen(admin, { leadgenId, pageId, formId: formIdRaw }, pageToken, tenantMap))
    }
  }

  // Sempre 200 pra Meta não ficar reenviando o batch inteiro por causa de 1 lead ruim.
  return json({ ok: true, processed: results })
})
