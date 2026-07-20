import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Conversões de COMPRA server-side. Dispara no momento em que o pagamento CONFIRMA no
 * backend (finalizeRedePaid / finalizeAsaasPaid / PagBank) — não na tela. Isso captura
 * 100% das vendas, inclusive PIX (que confirma depois que o cliente sai do checkout),
 * que era o grande furo: o gtag/Meta client-side só contava quem chegava na /obrigado.
 *
 * Três destinos, todos best-effort e idempotentes (nunca derrubam o pagamento):
 *  1) Funil interno (storefront_events type=purchase) → painel /tricopill-loja. SEM credencial.
 *  2) GA4 Measurement Protocol (env GA4_MEASUREMENT_ID + GA4_API_SECRET). Alimenta o GA4 e,
 *     com GA4↔Google Ads ligados, a conversão importada no Google Ads.
 *  3) Meta Conversions API (env META_PIXEL_ID + META_CAPI_TOKEN). Purchase server-side com
 *     fbc/fbp + email/telefone com hash. event_id = orderId → dedupe com o Pixel do navegador.
 *
 * Dedupe por orderId (payId): se já existe um purchase com esse payId (client-side ou já
 * disparado antes), NÃO repete.
 */

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Telefone BR → E.164 sem o '+': 55 + DDD + número. */
function phoneE164BR(raw: unknown): string {
  let d = onlyDigits(raw)
  if (!d) return ''
  if (d.length >= 12 && d.startsWith('55')) return d
  if (d.length === 10 || d.length === 11) return '55' + d
  return d
}

type LeadRow = {
  id: string
  phone?: string | null
  tenant_id?: string | null
  custom_fields?: Record<string, unknown> | null
}

type PurchaseInput = {
  leadId: string
  /** valor cobrado, em centavos */
  valueCents: number
  /** id único do pedido/pagamento — vira transaction_id / event_id / dedupe key */
  orderId: string
  method?: string
  gateway?: string
  /** produto (pra item do GA4/Meta) */
  productName?: string
  /** fallback de contato quando o lead não tem no cadastro */
  email?: string | null
  phone?: string | null
  cpf?: string | null
}

function pickAttr(cf: Record<string, unknown>): { gclid?: string; fbclid?: string; gaClientId?: string; gaSessionId?: string } {
  const attr = (cf.attribution ?? {}) as Record<string, unknown>
  const first = (attr.first ?? {}) as Record<string, unknown>
  const last = (attr.last ?? {}) as Record<string, unknown>
  const ga = (attr.ga ?? {}) as Record<string, unknown>
  const gclid = String(first.gclid ?? last.gclid ?? attr.gclid ?? '').trim() || undefined
  const fbclid = String(first.fbclid ?? last.fbclid ?? attr.fbclid ?? '').trim() || undefined
  const gaClientId = String(ga.client_id ?? '').trim() || undefined
  const gaSessionId = String(ga.session_id ?? '').trim() || undefined
  return { gclid, fbclid, gaClientId, gaSessionId }
}

/** fbc a partir do fbclid (Meta aceita este formato quando não há cookie _fbc). */
function fbcFromFbclid(fbclid: string | undefined, tsMs: number): string | undefined {
  if (!fbclid) return undefined
  return `fb.1.${tsMs}.${fbclid}`
}

// ---- Google Data Manager API (offline click conversion via gclid) --------
// Sobe a venda direto pro Google Ads — 100% server-side, imune a
// bloqueador/consentimento/tag do site. Atribui ao clique do anúncio pelo gclid.
// Tudo por env (secret): liga sem mexer no código.
// ATENÇÃO: integrações novas são OBRIGADAS a usar a Data Manager API — o endpoint
// antigo (ConversionUploadService.UploadClickConversions do Google Ads API) devolve
// "limited to existing users" pra developer tokens aprovados de 2025 em diante.
// Requisitos: Data Manager API habilitada no projeto Google Cloud do OAuth client
// + refresh token com o escopo https://www.googleapis.com/auth/datamanager
// (o escopo adwords sozinho dá 403). Developer token NÃO é usado aqui.

export async function googleAdsAccessToken(): Promise<string | null> {
  const clientId = (Deno.env.get('GOOGLE_ADS_CLIENT_ID') ?? '').trim()
  const clientSecret = (Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') ?? '').trim()
  const refreshToken = (Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') ?? '').trim()
  if (!clientId || !clientSecret || !refreshToken) return null
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { access_token?: string }
    return typeof j.access_token === 'string' ? j.access_token : null
  } catch {
    return null
  }
}

/**
 * Sobe UMA conversão de clique pro Google Ads (uploadClickConversions). Reusa no disparo
 * ao vivo e no backfill. Nunca lança — devolve {ok,error} pra o backfill reportar o motivo
 * (ex.: "developer token não aprovado", "gclid não encontrado na conta").
 */
export async function uploadGoogleAdsConversion(args: {
  gclid: string; valueReais: number; orderId: string; when?: Date
}): Promise<{ ok: boolean; error?: string }> {
  const customerId = onlyDigits(Deno.env.get('GOOGLE_ADS_CUSTOMER_ID'))
  const loginCustomerId = onlyDigits(Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'))
  const actionId = onlyDigits(Deno.env.get('GOOGLE_ADS_CONVERSION_ACTION_ID'))
  if (!customerId || !actionId) return { ok: false, error: 'nao_configurado' }
  if (!args.gclid) return { ok: false, error: 'sem_gclid' }
  const accessToken = await googleAdsAccessToken()
  if (!accessToken) return { ok: false, error: 'sem_access_token (confira client_id/secret/refresh_token)' }
  const body = {
    destinations: [{
      operatingAccount: { accountType: 'GOOGLE_ADS', accountId: customerId },
      // Quando o acesso é via conta de gerenciador (MCC), o login vai aqui.
      ...(loginCustomerId ? { loginAccount: { accountType: 'GOOGLE_ADS', accountId: loginCustomerId } } : {}),
      productDestinationId: actionId,
    }],
    events: [{
      adIdentifiers: { gclid: args.gclid },
      eventTimestamp: (args.when ?? new Date()).toISOString(),
      transactionId: args.orderId,
      conversionValue: Math.max(0, args.valueReais),
      currency: 'BRL',
      eventSource: 'WEB',
    }],
  }
  try {
    const res = await fetch('https://datamanager.googleapis.com/v1/events:ingest', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `http_${res.status}: ${text.slice(0, 400)}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Único ponto de entrada. Chame no fluxo de pagamento CONFIRMADO. Nunca lança.
 */
export async function dispatchPurchaseConversions(admin: SupabaseClient, input: PurchaseInput): Promise<void> {
  try {
    if (!input.leadId || !input.orderId || !(input.valueCents > 0)) return

    // Dedupe: já existe purchase com este payId? (client-side na /obrigado ou disparo anterior)
    const { data: dup } = await admin
      .from('storefront_events')
      .select('id')
      .eq('type', 'purchase')
      .eq('meta->>payId', input.orderId)
      .limit(1)
      .maybeSingle()
    if (dup) return

    const { data: leadRow } = await admin
      .from('leads')
      .select('id, phone, tenant_id, custom_fields')
      .eq('id', input.leadId)
      .maybeSingle()
    const lead = leadRow as LeadRow | null
    if (!lead) return
    const cf = (lead.custom_fields ?? {}) as Record<string, unknown>
    const origin = String(cf.origin ?? '').trim()
    const { gclid, fbclid, gaClientId, gaSessionId } = pickAttr(cf)
    // Escopo: funil interno + GA4 + Meta são só do SITE. Vendas do bot/link do WhatsApp têm
    // o próprio relatório no CRM e não são tráfego web. MAS o Google Ads é exceção: se o
    // lead tem gclid (clicou no anúncio e fechou na conversa — ponte SITE-<sid>), a
    // conversão volta pro Google mesmo com a venda fechando fora do site.
    if (origin !== 'site') {
      if (gclid) {
        const r = await uploadGoogleAdsConversion({ gclid, valueReais: Math.round(input.valueCents) / 100, orderId: input.orderId })
        if (!r.ok && r.error && r.error !== 'nao_configurado') console.warn('[gads] upload falhou:', r.error)
      }
      return
    }
    const cad = (cf.cadastro ?? {}) as Record<string, unknown>
    const ent = (cf.entrega ?? {}) as Record<string, unknown>

    const email = String(input.email ?? cf.email ?? cad.email ?? '').trim().toLowerCase()
    const phone = phoneE164BR(input.phone ?? lead.phone ?? cad.telefone ?? ent.telefone)
    const cpf = onlyDigits(input.cpf ?? cad.cpf)
    const valueReais = Math.round(input.valueCents) / 100
    const nowSec = Math.floor(Date.now() / 1000)

    // Sessão do funil: reaproveita a session_id dos eventos do site desse lead (stitching
    // com o begin_checkout), senão sintetiza uma estável a partir do orderId.
    let sessionId: string | null = null
    const { data: sess } = await admin
      .from('storefront_events')
      .select('session_id')
      .eq('lead_id', input.leadId)
      .not('session_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    sessionId = (sess as { session_id?: string } | null)?.session_id ?? `srv-${input.orderId}`

    // 1) Funil interno (painel /tricopill-loja).
    await admin.from('storefront_events').insert({
      tenant_id: String(lead.tenant_id ?? 'tricopill'),
      type: 'purchase',
      product_name: input.productName ?? 'Tricopill',
      value_cents: Math.round(input.valueCents),
      session_id: sessionId,
      lead_id: input.leadId,
      path: '/obrigado',
      attribution: (cf.attribution ?? null) as Record<string, unknown> | null,
      meta: { payId: input.orderId, method: input.method, gateway: input.gateway, source: 'server', value: valueReais, currency: 'BRL' },
    })

    // 2) GA4 Measurement Protocol
    const ga4Id = (Deno.env.get('GA4_MEASUREMENT_ID') ?? '').trim()
    const ga4Secret = (Deno.env.get('GA4_API_SECRET') ?? '').trim()
    if (ga4Id && ga4Secret) {
      const userData: Record<string, unknown> = {}
      if (email) userData.sha256_email_address = await sha256Hex(email)
      if (phone) userData.sha256_phone_number = await sha256Hex(phone)
      // client_id do GA4 capturado no checkout (costura o PIX à sessão do clique). Sem ele,
      // cai no id de sessão do funil ou num sintético (conta, mas atribui a "direct").
      const body = {
        client_id: gaClientId ?? sessionId,
        events: [{
          name: 'purchase',
          params: {
            currency: 'BRL',
            value: valueReais,
            transaction_id: input.orderId,
            ...(gaSessionId ? { session_id: gaSessionId } : {}),
            items: [{ item_name: input.productName ?? 'Tricopill', quantity: 1, price: valueReais }],
            ...(gclid ? { gclid } : {}),
          },
        }],
        ...(Object.keys(userData).length ? { user_data: userData } : {}),
      }
      try {
        await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(ga4Id)}&api_secret=${encodeURIComponent(ga4Secret)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
        })
      } catch { /* best-effort */ }
    }

    // 3) Meta Conversions API
    const metaPixel = (Deno.env.get('META_PIXEL_ID') ?? '').trim()
    const metaToken = (Deno.env.get('META_CAPI_TOKEN') ?? '').trim()
    if (metaPixel && metaToken && (fbclid || email || phone)) {
      const em = email ? [await sha256Hex(email)] : undefined
      const ph = phone ? [await sha256Hex(phone)] : undefined
      const externalId = cpf ? [await sha256Hex(cpf)] : (input.leadId ? [await sha256Hex(input.leadId)] : undefined)
      const userData: Record<string, unknown> = {}
      if (em) userData.em = em
      if (ph) userData.ph = ph
      if (externalId) userData.external_id = externalId
      const fbc = fbcFromFbclid(fbclid, Date.now())
      if (fbc) userData.fbc = fbc
      const payload = {
        data: [{
          event_name: 'Purchase',
          event_time: nowSec,
          event_id: input.orderId,
          action_source: 'website',
          event_source_url: 'https://tricopill.com.br/obrigado',
          user_data: userData,
          custom_data: { currency: 'BRL', value: valueReais },
        }],
      }
      try {
        await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(metaPixel)}/events?access_token=${encodeURIComponent(metaToken)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
        })
      } catch { /* best-effort */ }
    }

    // 4) Google Ads API — sobe a compra direto pro Google Ads pelo gclid (server-side).
    //    Só faz sentido com gclid (é o que amarra ao clique do anúncio). Best-effort.
    if (gclid) {
      const r = await uploadGoogleAdsConversion({ gclid, valueReais, orderId: input.orderId })
      if (!r.ok && r.error && r.error !== 'nao_configurado') {
        console.warn('[gads] upload falhou:', r.error)
      }
    }
  } catch { /* conversões nunca derrubam o pagamento */ }
}
