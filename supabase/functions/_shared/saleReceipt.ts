import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Comprovante de venda no GRUPO do WhatsApp (lançamento + conferência do financeiro).
 * Toda venda confirmada (Pix e.Rede, cartão, Asaas, assinatura e confirmação manual)
 * dispara uma mensagem padronizada com DATA, HORA, VALOR, DADOS DO PAGAMENTO e DADOS
 * DO COMPRADOR para o grupo configurado em tenant_integrations.notifications:
 *   { "sales_receipt_group_jid": "1203...@g.us", "sales_receipt_enabled": true }
 * O grupo se auto-registra: alguém manda "#comprovantes" no grupo (com a linha W-API
 * do tenant dentro) e o crm-wapi-webhook grava o JID aqui. Tudo best-effort: comprovante
 * NUNCA derruba a confirmação do pagamento.
 */

export type SaleReceiptInput = {
  /** Tenant "dono" da venda (define config do grupo e a linha W-API que envia). */
  tenantId: string
  /** Id interno do pagamento (rede_payments/asaas_payments/manual) — ref de conferência. */
  paymentId: string
  gateway: string // 'e.Rede' | 'Asaas' | 'Manual (painel)' ...
  method: 'pix' | 'card' | 'other'
  installments?: number
  amountCents: number
  freightCents?: number
  discountCents?: number
  couponCode?: string | null
  /** Produto vendido (label do kit ou descrição da cobrança). */
  produto?: string | null
  blingOrderId?: string | null
  /** Id da transação no gateway (TID e.Rede / payment id Asaas). */
  transactionId?: string | null
  paidAtIso?: string
  buyer: {
    name?: string | null
    cpf?: string | null
    phone?: string | null
    email?: string | null
    /** custom_fields.entrega do lead (cep/logradouro/numero/bairro/cidade/uf/delivery_mode). */
    entrega?: Record<string, unknown> | null
  }
  /** Contexto extra: 'Confirmação manual por x@y', 'Assinatura — ciclo 3', 'Link avulso'... */
  origem?: string | null
}

const fmtBRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function fmtCpf(raw?: string | null): string {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d
}

function fmtPhoneBr(raw?: string | null): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return d
}

/** Data e hora em Brasília, independente do fuso do runtime (Edge roda em UTC). */
function brasiliaDateTime(iso?: string): { data: string; hora: string } {
  const dt = iso ? new Date(iso) : new Date()
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt)
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(dt)
  return { data, hora }
}

function enderecoLinha(ent?: Record<string, unknown> | null): { linha: string; modo: string } {
  const e = ent ?? {}
  const s = (v: unknown) => String(v ?? '').trim()
  const modoRaw = s(e.delivery_mode)
  const modo = modoRaw === 'retirada_clinica'
    ? 'Retirada na clínica'
    : modoRaw === 'entrega_local_maringa'
      ? 'Entrega local (Maringá)'
      : modoRaw === 'envio_externo'
        ? 'Envio externo (Correios/transportadora)'
        : ''
  const cep = s(e.cep).replace(/\D/g, '')
  const linha = [
    [s(e.logradouro), s(e.numero)].filter(Boolean).join(', '),
    s(e.complemento),
    s(e.bairro),
    [s(e.cidade), s(e.uf)].filter(Boolean).join('/'),
    cep ? `CEP ${cep.replace(/(\d{5})(\d{3})/, '$1-$2')}` : '',
  ].filter(Boolean).join(' — ')
  return { linha, modo }
}

export function buildSaleReceiptText(d: SaleReceiptInput): string {
  const { data, hora } = brasiliaDateTime(d.paidAtIso)
  const metodo = d.method === 'pix'
    ? 'PIX'
    : d.method === 'card'
      ? `Cartão de crédito${(d.installments ?? 1) > 1 ? ` ${d.installments}x` : ' à vista'}`
      : 'Outro'

  const pg: string[] = [`• Forma: ${metodo} — ${d.gateway}`]
  if (d.transactionId) pg.push(`• Transação: ${d.transactionId}`)
  if (d.couponCode) pg.push(`• Cupom: ${d.couponCode}${d.discountCents ? ` (−${fmtBRL(d.discountCents)})` : ''}`)
  if (d.freightCents && d.freightCents > 0) pg.push(`• Frete incluído: ${fmtBRL(d.freightCents)}`)

  const b = d.buyer ?? {}
  const { linha: endLinha, modo } = enderecoLinha(b.entrega)
  const comprador: string[] = []
  if (b.name?.trim()) comprador.push(`• Nome: ${b.name.trim()}`)
  const cpf = fmtCpf(b.cpf)
  if (cpf) comprador.push(`• CPF: ${cpf}`)
  const fone = fmtPhoneBr(b.phone)
  if (fone) comprador.push(`• WhatsApp: ${fone}`)
  if (b.email?.trim()) comprador.push(`• E-mail: ${b.email.trim()}`)
  if (endLinha) comprador.push(`• Endereço: ${endLinha}`)
  if (modo) comprador.push(`• Entrega: ${modo}`)
  if (!comprador.length) comprador.push('• (sem dados do comprador — completar no CRM)')

  const pedido: string[] = []
  if (d.produto?.trim()) pedido.push(`• Produto: ${d.produto.trim().slice(0, 120)}`)
  if (d.blingOrderId) pedido.push(`• Pedido Bling: #${d.blingOrderId}`)
  if (d.origem?.trim()) pedido.push(`• Origem: ${d.origem.trim()}`)
  pedido.push(`• Ref: ${d.paymentId}`)

  return [
    '🧾 *COMPROVANTE DE VENDA*',
    '',
    `📅 Data: ${data}`,
    `🕐 Hora: ${hora} (Brasília)`,
    `💰 Valor: *${fmtBRL(d.amountCents)}*`,
    '',
    '*💳 Pagamento*',
    ...pg,
    '',
    '*👤 Comprador*',
    ...comprador,
    '',
    '*📦 Pedido*',
    ...pedido,
  ].join('\n')
}

type WapiRow = { wapi_instance_id?: string; wapi_token?: string; wapi_base_url?: string | null }

async function loadWapiCreds(admin: SupabaseClient, tenantId: string): Promise<{ instanceId: string; token: string; baseUrl: string } | null> {
  const { data } = await admin.from('whatsapp_channel_instances')
    .select('wapi_instance_id, wapi_token, wapi_base_url')
    .eq('tenant_id', tenantId).eq('channel_provider', 'wapi').eq('active', true).limit(1).maybeSingle()
  const row = data as WapiRow | null
  const instanceId = row?.wapi_instance_id ? String(row.wapi_instance_id).trim() : ''
  const token = row?.wapi_token ? String(row.wapi_token).trim() : ''
  if (!instanceId || !token) return null
  const baseUrl = ((row?.wapi_base_url ? String(row.wapi_base_url) : '').trim() || 'https://api.w-api.app/v1').replace(/\/$/, '')
  return { instanceId, token, baseUrl }
}

/**
 * Envia texto para um GRUPO via W-API. Diferente do envio 1:1, o "phone" é o JID do
 * grupo (1203...@g.us) e NÃO pode passar pelo digitsOnly. Tenta o JID completo e, se a
 * API recusar, o id sem sufixo (variação aceita por alguns planos). Best-effort.
 */
export async function sendWapiGroupText(admin: SupabaseClient, tenantId: string, groupJid: string, text: string): Promise<boolean> {
  const jid = String(groupJid ?? '').trim()
  if (!jid || !text.trim()) return false
  const creds = await loadWapiCreds(admin, tenantId)
  if (!creds) return false
  const url = `${creds.baseUrl}/message/send-text?instanceId=${encodeURIComponent(creds.instanceId)}`
  const candidates = jid.includes('@') ? [jid, jid.split('@')[0]] : [jid, `${jid}@g.us`]
  for (const phone of candidates) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + creds.token },
        body: JSON.stringify({ phone, message: text }),
      })
      const body = await res.text()
      let parsed: Record<string, unknown> = {}
      try { parsed = body ? JSON.parse(body) : {} } catch { /* corpo não-JSON */ }
      const apiError = parsed.error === true || Boolean(parsed.errorMessage) || String(parsed.status ?? '').toLowerCase() === 'error'
      if (res.ok && !apiError) return true
      console.warn(`[saleReceipt] envio ao grupo falhou (phone=${phone}):`, body.slice(0, 180))
    } catch (e) {
      console.warn('[saleReceipt] envio ao grupo (exception):', e instanceof Error ? e.message : String(e))
    }
  }
  return false
}

type NotifCfg = { sales_receipt_group_jid?: string; sales_receipt_enabled?: boolean }

async function readNotifCfg(admin: SupabaseClient, tenantId: string): Promise<NotifCfg> {
  const { data } = await admin.from('tenant_integrations').select('notifications').eq('tenant_id', tenantId).maybeSingle()
  return (((data as { notifications?: NotifCfg } | null)?.notifications) ?? {}) as NotifCfg
}

/**
 * Grava o grupo que recebe os comprovantes do tenant (chamado pelo crm-wapi-webhook
 * quando alguém manda "#comprovantes" no grupo).
 */
export async function registerSalesReceiptGroup(admin: SupabaseClient, tenantId: string, groupJid: string): Promise<void> {
  const cur = await readNotifCfg(admin, tenantId)
  const notifications = { ...cur, sales_receipt_group_jid: String(groupJid).trim(), sales_receipt_enabled: true }
  await admin.from('tenant_integrations')
    .upsert({ tenant_id: tenantId, notifications, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' })
}

/**
 * Ponto ÚNICO chamado pelos downstreams de pagamento. Sem grupo configurado (ou
 * desligado), sai silenciosamente — nunca lança.
 */
export async function sendSaleReceiptToGroup(admin: SupabaseClient, d: SaleReceiptInput): Promise<void> {
  try {
    const cfg = await readNotifCfg(admin, d.tenantId)
    const jid = String(cfg.sales_receipt_group_jid ?? '').trim()
    if (!jid || cfg.sales_receipt_enabled === false) return
    const ok = await sendWapiGroupText(admin, d.tenantId, jid, buildSaleReceiptText(d))
    if (!ok) console.warn(`[saleReceipt] comprovante NÃO entregue ao grupo (tenant=${d.tenantId}, payment=${d.paymentId})`)
  } catch (e) {
    console.warn('[saleReceipt] exception:', e instanceof Error ? e.message : String(e))
  }
}
