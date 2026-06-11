/**
 * Atribuição de campanha (Meta Ads) para leads.
 *
 * Origem do dado:
 *  - Anúncios Click-to-WhatsApp / Click-to-Instagram (CTWA): a Meta carimba a
 *    primeira mensagem com um objeto `referral`. Chega via WhatsApp Cloud oficial
 *    (msg.referral) ou via ManyChat (mapeado no corpo do External Request).
 *  - Lead Ads (formulário): preenchido pela Frente B (webhook dedicado).
 *
 * Regra de negócio: atribuição é "first-touch / write-once" — só vale o anúncio
 * que originou o lead. Quem aplica a regra é o upsertLeadByPhone; aqui só
 * normalizamos as várias formas de entrada num formato canônico.
 */

export type LeadAttribution = {
  /** ctwa_whatsapp | ctwa_instagram | lead_ads | ... */
  channel: string
  /** Nome ou id da campanha, quando disponível (ManyChat costuma mapear; o referral cru da Meta não traz). */
  campaign?: string
  adId?: string
  adsetId?: string
  /** Título do anúncio (referral.headline). */
  headline?: string
  /** Corpo/legenda do anúncio (referral.body). */
  body?: string
  /** URL do post/anúncio (referral.source_url). */
  sourceUrl?: string
  /** Click-to-WhatsApp click id — permite cruzar com a Graph API depois. */
  ctwaClid?: string
  /** 'ad' | 'post' (referral.source_type). */
  sourceType?: string
  /** Payload bruto, para auditoria/enriquecimento futuro. */
  raw?: Record<string, unknown>
}

function s(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return typeof v === 'string' ? v.trim() : ''
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function isEmptyAttribution(a: LeadAttribution): boolean {
  return !a.campaign && !a.adId && !a.headline && !a.sourceUrl && !a.ctwaClid && !a.body
}

/**
 * Normaliza o objeto `referral` de uma mensagem WhatsApp Cloud (CTWA) ou de um
 * webhook do Instagram. `channel` informa de qual superfície veio o clique.
 */
export function attributionFromMetaReferral(
  referral: unknown,
  channel: 'ctwa_whatsapp' | 'ctwa_instagram',
): LeadAttribution | null {
  const r = asRecord(referral)
  if (!r) return null
  const attr: LeadAttribution = {
    channel,
    adId: s(r.source_id) || undefined,
    headline: s(r.headline) || undefined,
    body: s(r.body) || undefined,
    sourceUrl: s(r.source_url) || undefined,
    ctwaClid: s(r.ctwa_clid) || undefined,
    sourceType: s(r.source_type) || undefined,
    raw: r,
  }
  return isEmptyAttribution(attr) ? null : attr
}

/**
 * Extrai atribuição do corpo de um webhook ManyChat. Aceita tanto um objeto
 * `attribution` aninhado quanto campos soltos no topo (ad_id, ad_title, campaign,
 * source_url, ctwa_clid) — o que for mais fácil de mapear no External Request.
 */
export function attributionFromManychatBody(
  body: Record<string, unknown>,
  channelHint: string,
): LeadAttribution | null {
  const nested = asRecord(body.attribution)
  const src = nested ?? body
  const campaign = s(src.campaign) || s(src.campaign_name) || s((body as Record<string, unknown>).utm_campaign)
  const adId = s(src.ad_id) || s(src.adId)
  const headline = s(src.ad_title) || s(src.headline) || s(src.ad_name)
  const sourceUrl = s(src.source_url) || s(src.sourceUrl) || s((body as Record<string, unknown>).ad_url)
  const ctwaClid = s(src.ctwa_clid) || s(src.ctwaClid)
  const adsetId = s(src.adset_id) || s(src.adsetId)

  const ch = channelHint === 'instagram' ? 'ctwa_instagram' : 'ctwa_whatsapp'
  const attr: LeadAttribution = {
    channel: ch,
    campaign: campaign || undefined,
    adId: adId || undefined,
    adsetId: adsetId || undefined,
    headline: headline || undefined,
    sourceUrl: sourceUrl || undefined,
    ctwaClid: ctwaClid || undefined,
    raw: nested ?? undefined,
  }
  return isEmptyAttribution(attr) ? null : attr
}

/** Versão compacta para espelhar em custom_fields (o front lê daqui, sem alterar selects). */
export function attributionForCustomFields(a: LeadAttribution): Record<string, unknown> {
  const compact: Record<string, unknown> = { channel: a.channel }
  if (a.campaign) compact.campaign = a.campaign
  if (a.adId) compact.ad_id = a.adId
  if (a.headline) compact.headline = a.headline
  if (a.sourceUrl) compact.source_url = a.sourceUrl
  return compact
}
