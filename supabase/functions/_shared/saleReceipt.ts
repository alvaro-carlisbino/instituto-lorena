import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { blingGetOrderNumero, getValidBlingToken } from './bling.ts'

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
  /** Número VISÍVEL do pedido no Bling (ex.: 3306) — resolvido automaticamente a partir do id interno. */
  blingOrderNumero?: string | null
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
  // Número visível (3306) é o que a busca do Bling encontra; o id interno da API
  // (26275181279) não acha nada e confundiu o financeiro (caso Kellen 07/07).
  if (d.blingOrderNumero) pedido.push(`• Pedido Bling: nº ${d.blingOrderNumero}`)
  else if (d.blingOrderId) pedido.push(`• Pedido Bling: id ${d.blingOrderId} (interno — na tela do Bling, busque pelo nome do cliente)`)
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
  // Retry com backoff: o W-API dá timeout/erro transiente e, sem retry, a venda sumia
  // calada do grupo (caso João Guerreiro 09/07). 3 rodadas × 2 formatos de JID.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt)) // 0, 600, 1200ms
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
        console.warn(`[saleReceipt] envio ao grupo falhou (tentativa ${attempt + 1}, phone=${phone}):`, body.slice(0, 180))
      } catch (e) {
        console.warn('[saleReceipt] envio ao grupo (exception):', e instanceof Error ? e.message : String(e))
      }
    }
  }
  return false
}

type NotifCfg = {
  sales_receipt_group_jid?: string
  sales_receipt_enabled?: boolean
  /** Números (dígitos, DDI 55…) que recebem uma CÓPIA 1:1 de cada venda (dono/gestor). */
  sales_receipt_owner_phones?: string[]
}

/** Envia texto 1:1 (DM) via W-API. `phone` = só dígitos (DDI+DDD+número). Retry 3×. */
export async function sendWapiDirectText(admin: SupabaseClient, tenantId: string, phone: string, text: string): Promise<boolean> {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 12 || !text.trim()) return false
  const creds = await loadWapiCreds(admin, tenantId)
  if (!creds) return false
  const url = `${creds.baseUrl}/message/send-text?instanceId=${encodeURIComponent(creds.instanceId)}`
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt))
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + creds.token },
        body: JSON.stringify({ phone: digits, message: text }),
      })
      const body = await res.text()
      let parsed: Record<string, unknown> = {}
      try { parsed = body ? JSON.parse(body) : {} } catch { /* corpo não-JSON */ }
      const apiError = parsed.error === true || Boolean(parsed.errorMessage) || String(parsed.status ?? '').toLowerCase() === 'error'
      if (res.ok && !apiError) return true
      console.warn(`[saleReceipt] DM dono falhou (tentativa ${attempt + 1}):`, body.slice(0, 160))
    } catch (e) {
      console.warn('[saleReceipt] DM dono (exception):', e instanceof Error ? e.message : String(e))
    }
  }
  return false
}

async function readNotifCfg(admin: SupabaseClient, tenantId: string): Promise<NotifCfg> {
  const { data } = await admin.from('tenant_integrations').select('notifications').eq('tenant_id', tenantId).maybeSingle()
  return (((data as { notifications?: NotifCfg } | null)?.notifications) ?? {}) as NotifCfg
}

/**
 * Alerta os donos no WhatsApp quando o modelo de IA (z.ai) está SEM SALDO (erro 1113) — o
 * ÚNICO modo de falha que o retry automático NÃO cura sozinho (precisa recarregar a conta).
 * Reusa os contatos do comprovante de venda (owner_phones + grupo). Dedupe: no máximo 1 alerta
 * a cada 30 min por tenant (via webhook_jobs). Best-effort — nunca derruba o fluxo do bot.
 */
export async function alertOwnerAiOutOfBalance(admin: SupabaseClient, tenantId: string): Promise<void> {
  const tid = String(tenantId ?? '').trim()
  if (!tid) return
  try {
    const bucket = Math.floor(Date.now() / (30 * 60 * 1000))
    const key = `zai_balance_alert:${tid}:${bucket}`
    const { data: seen } = await admin.from('webhook_jobs').select('id').eq('note', key).limit(1).maybeSingle()
    if (seen) return
    await admin.from('webhook_jobs').insert({ source: 'crm-ai-balance-alert', status: 'done', note: key })
    const cfg = await readNotifCfg(admin, tid)
    const text =
      '🚨 Bot fora do ar: a conta do modelo de IA (z.ai) está SEM SALDO (erro 1113). ' +
      'Os clientes estão sem resposta automática. Recarregue a conta para o bot voltar a responder.'
    const phones = Array.isArray(cfg.sales_receipt_owner_phones) ? cfg.sales_receipt_owner_phones.filter(Boolean) : []
    for (const ph of phones) {
      try { await sendWapiDirectText(admin, tid, String(ph), text) } catch { /* best-effort */ }
    }
    const jid = String(cfg.sales_receipt_group_jid ?? '').trim()
    if (jid) { try { await sendWapiGroupText(admin, tid, jid, text) } catch { /* best-effort */ } }
  } catch { /* alerta nunca derruba o bot */ }
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
export async function sendSaleReceiptToGroup(admin: SupabaseClient, d: SaleReceiptInput): Promise<boolean> {
  try {
    const cfg = await readNotifCfg(admin, d.tenantId)
    const jid = String(cfg.sales_receipt_group_jid ?? '').trim()
    if (!jid || cfg.sales_receipt_enabled === false) return false
    // Resolve o número VISÍVEL do pedido (o que a busca do Bling acha) a partir do id
    // interno da API. Best-effort: sem token ou com falha, a mensagem sai com o id.
    if (d.blingOrderId && !d.blingOrderNumero) {
      try {
        const token = await getValidBlingToken(admin, d.tenantId)
        if (token) d = { ...d, blingOrderNumero: await blingGetOrderNumero(token, d.blingOrderId) }
      } catch { /* segue com o id interno */ }
    }
    const ok = await sendWapiGroupText(admin, d.tenantId, jid, buildSaleReceiptText(d))
    if (ok) {
      // Marca a venda como "comprovante enviado" pra o vigia (crm-payment-confirm-watch)
      // não reenviar. Faz nas DUAS tabelas por id — só a que casar é atualizada.
      await markReceiptSent(admin, d.paymentId, 'receipt_group_sent_at')
    } else {
      console.warn(`[saleReceipt] comprovante NÃO entregue ao grupo (tenant=${d.tenantId}, payment=${d.paymentId})`)
    }
    return ok
  } catch (e) {
    console.warn('[saleReceipt] exception:', e instanceof Error ? e.message : String(e))
    return false
  }
}

/** Carimba a marca (receipt_group_sent_at | receipt_owner_sent_at) na venda pelo id. */
async function markReceiptSent(admin: SupabaseClient, paymentId: string, column: 'receipt_group_sent_at' | 'receipt_owner_sent_at'): Promise<void> {
  const nowIso = new Date().toISOString()
  await Promise.all([
    admin.from('rede_payments').update({ [column]: nowIso }).eq('id', paymentId).is(column, null),
    admin.from('asaas_payments').update({ [column]: nowIso }).eq('id', paymentId).is(column, null),
  ].map((p) => p.then(() => {}, () => {})))
}

/** Entrega a CÓPIA 1:1 da venda pros números do dono (config sales_receipt_owner_phones). */
async function deliverOwnerCopy(admin: SupabaseClient, d: SaleReceiptInput): Promise<boolean> {
  const cfg = await readNotifCfg(admin, d.tenantId)
  const phones = Array.isArray(cfg.sales_receipt_owner_phones) ? cfg.sales_receipt_owner_phones.filter(Boolean) : []
  if (phones.length === 0) return true // nada configurado = nada a entregar (não fica reprocessando)
  if (d.blingOrderId && !d.blingOrderNumero) {
    try {
      const token = await getValidBlingToken(admin, d.tenantId)
      if (token) d = { ...d, blingOrderNumero: await blingGetOrderNumero(token, d.blingOrderId) }
    } catch { /* segue com o id interno */ }
  }
  const text = buildSaleReceiptText(d)
  let anyOk = false
  for (const p of phones) {
    if (await sendWapiDirectText(admin, d.tenantId, p, text)) anyOk = true
  }
  return anyOk
}

type RedeRow = {
  id: string; tenant_id: string; method?: string; amount_cents: number; installments?: number
  kit?: string | null; description?: string | null; coupon_code?: string | null; discount_cents?: number | null
  bling_order_id?: string | null; tid?: string | null; customer_name?: string | null
  phone?: string | null; customer_doc?: string | null; freight_cents?: number | null; paid_at?: string | null
}
type AsaasRow = RedeRow & { asaas_payment_id?: string | null }

function methodOf(m?: string | null): 'pix' | 'card' | 'other' {
  const v = String(m ?? '').toLowerCase()
  return v === 'pix' ? 'pix' : v === 'card' || v === 'credit_card' || v === 'cartao' ? 'card' : 'other'
}

function rowToReceipt(row: RedeRow, gateway: string, transactionId?: string | null): SaleReceiptInput {
  return {
    tenantId: row.tenant_id,
    paymentId: row.id,
    gateway,
    method: methodOf(row.method),
    installments: row.installments ?? undefined,
    amountCents: row.amount_cents,
    freightCents: row.freight_cents ?? undefined,
    discountCents: row.discount_cents ?? undefined,
    couponCode: row.coupon_code ?? undefined,
    produto: (row.description && row.description.trim()) || (row.kit ? `Tricopill (${row.kit})` : 'Tricopill'),
    blingOrderId: row.bling_order_id ?? undefined,
    transactionId: transactionId ?? row.tid ?? undefined,
    buyer: { name: row.customer_name, cpf: row.customer_doc, phone: row.phone },
    origem: 'Rede de segurança (reenvio automático)',
  }
}

/**
 * VIGIA "sempre enviar": reenvia o comprovante de toda venda PAGA que ficou sem ele
 * (receipt_group_sent_at IS NULL). Dedupe pela própria marca — nunca duplica. Chamado
 * pelo cron do crm-payment-confirm-watch. Só age em vendas recentes (janela) e dá uma
 * folga (minAge) pro envio inline confirmar sozinho antes de o vigia entrar.
 */
export async function resendMissingSaleReceipts(
  admin: SupabaseClient,
  opts?: { maxAgeHours?: number; minAgeMinutes?: number; limit?: number },
): Promise<{ checked: number; groupSent: number; ownerSent: number }> {
  const maxAgeHours = opts?.maxAgeHours ?? 24
  const minAgeMinutes = opts?.minAgeMinutes ?? 5
  const limit = opts?.limit ?? 30
  const sinceIso = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString()
  const untilIso = new Date(Date.now() - minAgeMinutes * 60_000).toISOString()
  const missing = 'receipt_group_sent_at.is.null,receipt_owner_sent_at.is.null'

  let checked = 0, groupSent = 0, ownerSent = 0
  const handle = async (row: RedeRow & { receipt_group_sent_at?: string | null; receipt_owner_sent_at?: string | null }, gateway: string, txId?: string | null) => {
    checked++
    const d = rowToReceipt(row, gateway, txId)
    // Comprovante do GRUPO (financeiro) — só se ainda não foi.
    if (row.receipt_group_sent_at == null && await sendSaleReceiptToGroup(admin, d)) groupSent++
    // CÓPIA do DONO (Álvaro) — marca própria, independente do grupo.
    if (row.receipt_owner_sent_at == null && await deliverOwnerCopy(admin, d)) {
      await markReceiptSent(admin, row.id, 'receipt_owner_sent_at')
      ownerSent++
    }
  }

  try {
    const redeCols = 'id, tenant_id, method, amount_cents, installments, kit, description, coupon_code, discount_cents, bling_order_id, tid, customer_name, phone, customer_doc, freight_cents, paid_at, receipt_group_sent_at, receipt_owner_sent_at'
    const { data: rede } = await admin.from('rede_payments').select(redeCols)
      .eq('status', 'paid').or(missing)
      .gte('paid_at', sinceIso).lte('paid_at', untilIso).limit(limit)
    for (const row of (rede ?? []) as RedeRow[]) await handle(row, 'e.Rede')

    const asaasCols = redeCols.replace(' tid,', ' asaas_payment_id,')
    const { data: asaas } = await admin.from('asaas_payments').select(asaasCols)
      .in('status', ['paid', 'confirmed', 'received', 'approved']).or(missing)
      .gte('paid_at', sinceIso).lte('paid_at', untilIso).limit(limit)
    for (const row of (asaas ?? []) as AsaasRow[]) await handle(row, 'Asaas', row.asaas_payment_id)
  } catch (e) {
    console.warn('[saleReceipt] resendMissing exception:', e instanceof Error ? e.message : String(e))
  }
  return { checked, groupSent, ownerSent }
}
