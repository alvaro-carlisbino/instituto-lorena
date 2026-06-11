import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Rede / Itaú (e.Rede) — link de pagamento por CARTÃO.
 * Config por polo em tenant_integrations.rede: { pv, token, env?, base_url?, link_path? }.
 * Auth: Basic base64(pv:token).
 *
 * IMPORTANTE: a API e.Rede padrão é de TRANSAÇÕES (exige dados do cartão). Para um
 * LINK hospedado é preciso o produto "Link de Pagamento" da Rede e o endpoint correto.
 * Este módulo deixa o ponto de integração pronto e configurável (link_path) — gera o
 * link a partir do campo de retorno assim que credenciais + endpoint forem definidos.
 */

export type RedeConfig = {
  pv: string
  token: string
  baseUrl: string
  env: 'sandbox' | 'prod'
  linkPath: string | null
}

const PROD_BASE = 'https://api.userede.com.br'
const SANDBOX_BASE = 'https://rede-sandbox.userede.com.br'

export async function readRedeConfig(admin: SupabaseClient, tenantId: string): Promise<RedeConfig | null> {
  if (!tenantId) return null
  const { data } = await admin.from('tenant_integrations').select('rede').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { rede?: Record<string, unknown> } | null)?.rede ?? {}) as Record<string, unknown>
  const pv = typeof cfg.pv === 'string' ? cfg.pv.trim() : ''
  const token = typeof cfg.token === 'string' ? cfg.token.trim() : ''
  if (!pv || !token) return null
  const env: 'sandbox' | 'prod' = cfg.env === 'prod' ? 'prod' : 'sandbox'
  const baseUrl = (typeof cfg.base_url === 'string' && cfg.base_url.trim()
    ? cfg.base_url.trim()
    : env === 'prod' ? PROD_BASE : SANDBOX_BASE).replace(/\/$/, '')
  const linkPath = typeof cfg.link_path === 'string' && cfg.link_path.trim() ? cfg.link_path.trim() : null
  return { pv, token, baseUrl, env, linkPath }
}

export type RedeLinkResult = { payLink: string; reference: string; amountCents: number }

/**
 * Gera um link de pagamento por cartão na Rede. Lança erro claro enquanto faltar
 * credencial (rede_nao_configurado) ou o endpoint do produto de link (rede_link_path_nao_configurado).
 */
export async function createRedePaymentLink(
  admin: SupabaseClient,
  args: { tenantId: string; amountCents: number; description: string; reference: string },
): Promise<RedeLinkResult> {
  const cfg = await readRedeConfig(admin, args.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  if (!cfg.linkPath) throw new Error('rede_link_path_nao_configurado')

  const amountCents = Math.round(args.amountCents)
  if (!Number.isFinite(amountCents) || amountCents < 100) throw new Error('rede_valor_invalido')

  const basic = btoa(`${cfg.pv}:${cfg.token}`)
  const body = {
    reference: args.reference,
    amount: amountCents,
    description: String(args.description ?? '').slice(0, 100),
    kind: 'credit',
  }
  const res = await fetch(`${cfg.baseUrl}${cfg.linkPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
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

  // Procura o link de pagamento em campos comuns de retorno.
  const links = (parsed.links as Array<{ rel?: string; href?: string }> | undefined) ?? []
  const payLink =
    (typeof parsed.paymentUrl === 'string' && parsed.paymentUrl) ||
    (typeof parsed.url === 'string' && parsed.url) ||
    (typeof parsed.returnUrl === 'string' && parsed.returnUrl) ||
    links.find((l) => String(l.rel ?? '').toUpperCase().includes('PAY'))?.href ||
    ''
  if (!payLink) throw new Error('rede_sem_link_no_retorno')

  return { payLink, reference: args.reference, amountCents }
}
