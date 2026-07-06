import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction, upsertLeadByPhone } from '../_shared/crm.ts'
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

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

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

function pickField(fields: FieldData[], ...keys: string[]): string {
  for (const k of keys) {
    const f = fields.find((x) => String(x.name ?? '').toLowerCase().includes(k))
    const v = f?.values?.[0]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const pageToken = (Deno.env.get('META_PAGE_TOKEN') ?? '').trim()
  let tenantMap: Record<string, string> = {}
  try {
    tenantMap = JSON.parse(Deno.env.get('META_PAGE_TENANT_MAP') ?? '{}') as Record<string, string>
  } catch { /* mapa opcional */ }

  const entries = Array.isArray(payload.entry) ? (payload.entry as Array<Record<string, unknown>>) : []
  const results: Array<Record<string, unknown>> = []

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as Array<Record<string, unknown>>) : []
    for (const change of changes) {
      if (String(change.field ?? '') !== 'leadgen') continue
      const value = (change.value ?? {}) as Record<string, unknown>
      const leadgenId = String(value.leadgen_id ?? '').trim()
      const pageId = String(value.page_id ?? entry.id ?? '').trim()
      if (!leadgenId) continue

      if (!pageToken) {
        console.error(`[meta-leadform] lead ${leadgenId} recebido mas META_PAGE_TOKEN ausente — não dá pra buscar os dados`)
        results.push({ leadgenId, ok: false, reason: 'sem_page_token' })
        continue
      }

      // Busca o formulário preenchido na Graph (traz campanha/anúncio por nome junto).
      let lead: Record<string, unknown> | null = null
      try {
        const res = await fetch(
          `${GRAPH}/${leadgenId}?fields=field_data,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic&access_token=${encodeURIComponent(pageToken)}`,
        )
        const data = (await res.json()) as Record<string, unknown>
        if (!res.ok) {
          console.error(`[meta-leadform] Graph ${leadgenId} falhou: ${JSON.stringify(data).slice(0, 300)}`)
          results.push({ leadgenId, ok: false, reason: 'graph_error' })
          continue
        }
        lead = data
      } catch (e) {
        console.error(`[meta-leadform] Graph ${leadgenId} exception: ${e instanceof Error ? e.message : e}`)
        results.push({ leadgenId, ok: false, reason: 'graph_exception' })
        continue
      }

      const fields = Array.isArray(lead.field_data) ? (lead.field_data as FieldData[]) : []
      const nome = pickField(fields, 'full_name', 'nome') || 'Lead Meta (formulário)'
      const phoneRaw = pickField(fields, 'phone', 'telefone', 'whatsapp', 'celular')
      const email = pickField(fields, 'email', 'e-mail')
      const phone = normalizeBrPhone(phoneRaw)

      if (phone.length < 10) {
        console.error(`[meta-leadform] lead ${leadgenId} sem telefone utilizável ("${phoneRaw}") — não criado. Campos: ${JSON.stringify(fields).slice(0, 300)}`)
        results.push({ leadgenId, ok: false, reason: 'sem_telefone' })
        continue
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
          customFields: { lead_form: { leadgen_id: leadgenId, form_id: String(lead.form_id ?? ''), ...(email ? { email } : {}), respostas: answers } },
        })
        const resumo = Object.entries(answers).map(([k, v]) => `• ${k}: ${v}`).join('\n')
        await insertInteraction(admin, {
          leadId: up.leadId, patientName: nome, channel: 'system', direction: 'in', author: 'Meta Lead Ads',
          content: `📋 Formulário recebido${campaignName ? ` (campanha: ${campaignName}` : ''}${adName ? ` · anúncio: ${adName}` : ''}${campaignName ? ')' : ''}\n${resumo}`.slice(0, 1500),
          tenantId,
        }).catch(() => {})
        results.push({ leadgenId, ok: true, leadId: up.leadId, status: up.status })
      } catch (e) {
        console.error(`[meta-leadform] upsert ${leadgenId} falhou: ${e instanceof Error ? e.message : e}`)
        results.push({ leadgenId, ok: false, reason: 'upsert_failed' })
      }
    }
  }

  // Sempre 200 pra Meta não ficar reenviando o batch inteiro por causa de 1 lead ruim.
  return json({ ok: true, processed: results })
})
