import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Rede / Itaú — produto "Link de Pagamento" (useredecloud).
 * OAuth2 client_credentials: Basic(client_id:client_secret) -> access_token (Bearer).
 * Criar link: POST /payment-link/v1/create com Bearer + header Company-number (PV).
 * Config por polo em tenant_integrations.rede:
 *   { client_id, client_secret, company_number, created_by?, env?, token_base?, pay_base?,
 *     access_token?, token_expires_at? (cache) }
 */

const SANDBOX_TOKEN_BASE = 'https://rl7-sandbox-api.useredecloud.com.br'
const SANDBOX_PAY_BASE = 'https://payments-apisandbox.useredecloud.com.br'
const PROD_TOKEN_BASE = 'https://rl7-api.useredecloud.com.br'
const PROD_PAY_BASE = 'https://payments-api.useredecloud.com.br'

export type RedeConfig = {
  clientId: string
  clientSecret: string
  companyNumber: string
  createdBy: string
  env: 'sandbox' | 'prod'
  tokenBase: string
  payBase: string
}

export async function readRedeConfig(admin: SupabaseClient, tenantId: string): Promise<RedeConfig | null> {
  if (!tenantId) return null
  const { data } = await admin.from('tenant_integrations').select('rede').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { rede?: Record<string, unknown> } | null)?.rede ?? {}) as Record<string, unknown>
  const clientId = typeof cfg.client_id === 'string' ? cfg.client_id.trim() : ''
  const clientSecret = typeof cfg.client_secret === 'string' ? cfg.client_secret.trim() : ''
  const companyNumber = typeof cfg.company_number === 'string' ? cfg.company_number.trim() : ''
  // Company-number (PV) é OPCIONAL — a doc do "Link de Pagamento" não o exige.
  if (!clientId || !clientSecret) return null
  const env: 'sandbox' | 'prod' = cfg.env === 'prod' ? 'prod' : 'sandbox'
  const tokenBase = (typeof cfg.token_base === 'string' && cfg.token_base.trim()
    ? cfg.token_base.trim()
    : env === 'prod' ? PROD_TOKEN_BASE : SANDBOX_TOKEN_BASE).replace(/\/$/, '')
  const payBase = (typeof cfg.pay_base === 'string' && cfg.pay_base.trim()
    ? cfg.pay_base.trim()
    : env === 'prod' ? PROD_PAY_BASE : SANDBOX_PAY_BASE).replace(/\/$/, '')
  const createdBy = typeof cfg.created_by === 'string' && cfg.created_by.trim() ? cfg.created_by.trim() : 'crm@institutolorena.com.br'
  return { clientId, clientSecret, companyNumber, createdBy, env, tokenBase, payBase }
}

async function getRedeAccessToken(admin: SupabaseClient, tenantId: string, cfg: RedeConfig): Promise<string> {
  const { data } = await admin.from('tenant_integrations').select('rede').eq('tenant_id', tenantId).maybeSingle()
  const stored = ((data as { rede?: Record<string, unknown> } | null)?.rede ?? {}) as Record<string, unknown>
  const cached = typeof stored.access_token === 'string' ? stored.access_token : ''
  const exp = typeof stored.token_expires_at === 'string' ? Date.parse(stored.token_expires_at) : 0
  if (cached && exp && Date.now() < exp) return cached

  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`)
  const res = await fetch(`${cfg.tokenBase}/oauth/token?grant_type=client_credentials`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  })
  const text = await res.text()
  let parsed: { access_token?: string; expires_in?: number } = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {}
  }
  if (!res.ok || !parsed.access_token) throw new Error(`rede_token_${res.status}: ${text.slice(0, 200)}`)

  const expiresAt = new Date(Date.now() + (Number(parsed.expires_in ?? 300) - 30) * 1000).toISOString()
  await admin.from('tenant_integrations').upsert({
    tenant_id: tenantId,
    rede: { ...stored, access_token: parsed.access_token, token_expires_at: expiresAt },
  })
  return parsed.access_token
}

export type RedeLinkResult = { payLink: string; reference: string; amountCents: number; id: string | null }

function findUrlDeep(node: unknown): string | null {
  if (typeof node === 'string') return /^https?:\/\//.test(node) ? node : null
  if (!node || typeof node !== 'object') return null
  const obj = node as Record<string, unknown>
  for (const key of ['paymentLink', 'shortUrl', 'url', 'link', 'paymentUrl']) {
    const v = obj[key]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  }
  for (const v of Object.values(obj)) {
    const found = findUrlDeep(v)
    if (found) return found
  }
  return null
}

/** Cria um link de pagamento por cartão na Rede e devolve a URL. */
export async function createRedePaymentLink(
  admin: SupabaseClient,
  args: { tenantId: string; amountCents: number; description: string; reference: string; installments?: number },
): Promise<RedeLinkResult> {
  const cfg = await readRedeConfig(admin, args.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')

  const amountCents = Math.round(args.amountCents)
  if (!Number.isFinite(amountCents) || amountCents < 100) throw new Error('rede_valor_invalido')
  const amount = Math.round(amountCents) / 100 // reais (decimal)

  // expirationDate no formato MM/DD/YYYY, +7 dias.
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const mm = String(exp.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(exp.getUTCDate()).padStart(2, '0')
  const expirationDate = `${mm}/${dd}/${exp.getUTCFullYear()}`

  const token = await getRedeAccessToken(admin, args.tenantId, cfg)
  const body = {
    amount,
    expirationDate,
    installments: Math.max(1, Math.min(12, args.installments ?? 1)),
    createdBy: cfg.createdBy,
    paymentOptions: ['credit'],
    description: String(args.description ?? 'Pagamento').slice(0, 100),
    comments: args.reference.slice(0, 100),
  }
  const res = await fetch(`${cfg.payBase}/payment-link/v1/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cfg.companyNumber ? { 'Company-number': cfg.companyNumber } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  if (!res.ok) throw new Error(`rede_${res.status}: ${text.slice(0, 300)}`)

  const payLink = findUrlDeep(parsed)
  if (!payLink) throw new Error(`rede_sem_link_no_retorno: ${text.slice(0, 200)}`)
  const id = typeof parsed.id === 'string' ? parsed.id : typeof parsed.paymentLinkId === 'string' ? parsed.paymentLinkId : null

  return { payLink, reference: args.reference, amountCents, id }
}
