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
 * Teto por tentativa de envio ao W-API. SEM ele o fetch herda o timeout do sistema (~2 min de
 * TCP connect): com 3 rodadas × 2 formatos de JID, um W-API fora do ar segurava a invocação por
 * minutos e o runtime matava a função ANTES do resto do fechamento — a nota de logística e a
 * confirmação ao cliente simplesmente não aconteciam, sem erro nenhum na timeline (caso Celso
 * 17/ago: pagamento e pedido no Bling entraram, a instrução de entrega não).
 */
const WAPI_TIMEOUT_MS = 10_000

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
          signal: AbortSignal.timeout(WAPI_TIMEOUT_MS),
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
  /** Assuntos que PODEM virar DM no WhatsApp do dono. Ausente = todos (como sempre foi). */
  owner_dm_kinds?: OwnerDmKind[]
  /** Kill switch só do comprovante de marketplace. Ausente = ligado. */
  marketplace_receipt_enabled?: boolean
  /**
   * Data (YYYY-MM-DD) a partir da qual pedido de marketplace vira comprovante. Existe para a
   * PRIMEIRA rodada não despejar no grupo a semana inteira de vendas antigas que a varredura
   * enxerga. Ausente = hoje, ou seja: nada retroativo, nunca.
   */
  marketplace_receipt_since?: string
  /**
   * Nome do canal por `loja.id` do Bling — `{ "206142894": "Shopee" }`. O Bling não tem
   * endpoint que traduza esse id (`/canais-de-venda` responde 404), então o nome bonito vem
   * daqui; o CNPJ do intermediador é o plano B. Editável sem deploy quando abrir canal novo.
   */
  marketplace_channel_names?: Record<string, string>
}

/**
 * Assuntos de DM para o dono. Existiam seis lugares no código mandando mensagem para o
 * mesmo número, cada um por conta própria e sem ninguém perguntando se aquilo interessava
 * — o Álvaro cuida do Tricopill e recebia avaliação baixa de paciente da clínica.
 *
 *  • `venda`             — cópia 1:1 de cada venda fechada
 *  • `ads`               — relatório diário do Google Ads
 *  • `sistema_parado`    — a linha caiu/foi banida, ou a IA está sem saldo. Raro por
 *                          natureza, e é o aviso que impede o canal de morrer calado.
 *  • `nps_baixo`         — cliente deu nota ≤6
 *  • `cliente_esperando` — alguém sem resposta há muito tempo (vigia do atendimento)
 */
export type OwnerDmKind = 'venda' | 'ads' | 'sistema_parado' | 'nps_baixo' | 'cliente_esperando'

/**
 * Manda DM para o dono SE aquele assunto estiver liberado para o polo. Sem
 * `owner_dm_kinds` configurado, tudo passa — nenhum tenant perde aviso por causa desta
 * mudança; quem quiser filtrar, escreve a lista.
 */
export async function notifyOwnerWhatsapp(
  admin: SupabaseClient,
  tenantId: string,
  kind: OwnerDmKind,
  text: string,
): Promise<boolean> {
  const tid = String(tenantId ?? '').trim()
  if (!tid || !text.trim()) return false
  try {
    const cfg = await readNotifCfg(admin, tid)
    const permitidos = Array.isArray(cfg.owner_dm_kinds) ? cfg.owner_dm_kinds : null
    if (permitidos && !permitidos.includes(kind)) return false
    const phones = Array.isArray(cfg.sales_receipt_owner_phones)
      ? cfg.sales_receipt_owner_phones.filter(Boolean)
      : []
    let algumOk = false
    for (const p of phones) {
      if (await sendWapiDirectText(admin, tid, String(p), text)) algumOk = true
    }
    return algumOk
  } catch (e) {
    console.warn('[notifyOwnerWhatsapp] falhou:', e instanceof Error ? e.message : String(e))
    return false
  }
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
        signal: AbortSignal.timeout(WAPI_TIMEOUT_MS),
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
    await notifyOwnerWhatsapp(admin, tid, 'sistema_parado', text)
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
  return await notifyOwnerWhatsapp(admin, d.tenantId, 'venda', text)
}

type RedeRow = {
  id: string; tenant_id: string; lead_id?: string | null; method?: string; amount_cents: number; installments?: number
  kit?: string | null; description?: string | null; coupon_code?: string | null; discount_cents?: number | null
  bling_order_id?: string | null; tid?: string | null; customer_name?: string | null
  phone?: string | null; customer_doc?: string | null; freight_cents?: number | null; paid_at?: string | null
}
type AsaasRow = RedeRow & { asaas_payment_id?: string | null }

function methodOf(m?: string | null): 'pix' | 'card' | 'other' {
  const v = String(m ?? '').toLowerCase()
  return v === 'pix' ? 'pix' : v === 'card' || v === 'credit_card' || v === 'cartao' ? 'card' : 'other'
}

type LeadLite = { patient_name?: string | null; phone?: string | null; custom_fields?: Record<string, unknown> | null }

/**
 * Completa o comprador pelo LEAD quando a linha do pagamento veio sem cadastro — cobrança
 * do bot é criada ANTES de o cliente ditar os dados, então customer_name/doc ficam nulos
 * na tabela e o comprovante saía "(sem dados do comprador)" mesmo com o lead completo
 * (caso Jacqueline 20/07). O cadastro vive em custom_fields.cadastro/entrega.
 */
async function enrichBuyerFromLead(admin: SupabaseClient, leadId: string | null | undefined, d: SaleReceiptInput): Promise<SaleReceiptInput> {
  const id = String(leadId ?? '').trim()
  const b = d.buyer ?? {}
  const falta = !(b.name ?? '').trim() || !(b.cpf ?? '').trim() || !(b.phone ?? '').trim() || !b.entrega
  if (!id || !falta) return d
  try {
    const { data } = await admin.from('leads').select('patient_name, phone, custom_fields').eq('id', id).maybeSingle()
    const lead = data as LeadLite | null
    if (!lead) return d
    const cf = (lead.custom_fields ?? {}) as Record<string, unknown>
    const cad = (cf.cadastro ?? {}) as Record<string, unknown>
    const s = (v: unknown) => { const t = String(v ?? '').trim(); return t || undefined }
    return {
      ...d,
      buyer: {
        name: (b.name ?? '').trim() || s(cad.nomeCompleto) || s(lead.patient_name),
        cpf: (b.cpf ?? '').trim() || s(cad.cpf),
        phone: (b.phone ?? '').trim() || s(lead.phone),
        email: (b.email ?? '').trim() || s(cad.email) || s(cf.email),
        entrega: b.entrega ?? ((cf.entrega ?? null) as Record<string, unknown> | null),
      },
    }
  } catch {
    return d // enriquecimento nunca segura o comprovante
  }
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
    // DATA/HORA = quando o cliente PAGOU, não quando o vigia reenviou. Sem isto o
    // comprovante caía em `new Date()` e carimbava a hora do cron: o Pix do Hugo entrou
    // 20/ago 22:56 e o comprovante do grupo dizia 23:02. A janela do reenvio é de 24h, então
    // venda do fim da noite chegava ao financeiro com a data do DIA SEGUINTE — e é por data
    // que a conferência do caixa fecha. 28 comprovantes vieram por este caminho desde junho,
    // o mais atrasado 16h44 depois do pagamento.
    paidAtIso: row.paid_at ?? undefined,
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
    const d = await enrichBuyerFromLead(admin, row.lead_id, rowToReceipt(row, gateway, txId))
    // Comprovante do GRUPO (financeiro) — só se ainda não foi.
    if (row.receipt_group_sent_at == null && await sendSaleReceiptToGroup(admin, d)) groupSent++
    // CÓPIA do DONO (Álvaro) — marca própria, independente do grupo.
    if (row.receipt_owner_sent_at == null && await deliverOwnerCopy(admin, d)) {
      await markReceiptSent(admin, row.id, 'receipt_owner_sent_at')
      ownerSent++
    }
  }

  try {
    const redeCols = 'id, tenant_id, lead_id, method, amount_cents, installments, kit, description, coupon_code, discount_cents, bling_order_id, tid, customer_name, phone, customer_doc, freight_cents, paid_at, receipt_group_sent_at, receipt_owner_sent_at'
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

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * COMPROVANTE DE VENDA DE MARKETPLACE (Shopee, Mercado Livre, TikTok Shop…)
 *
 * A venda do site, do bot e do balcão passa por um gateway nosso, e é o gateway que dispara o
 * comprovante. **Venda de marketplace não passa por gateway nenhum**: ela nasce pronta dentro do
 * Bling pela integração do canal. Resultado até 28/ago/2026: Shopee, Mercado Livre e TikTok Shop
 * vendiam e o grupo do financeiro não ficava sabendo — a conferência do dia só via o que tinha
 * passado por e.Rede/Asaas, e o pedido do marketplace só aparecia se alguém abrisse o Bling.
 *
 * Quem chama isto é a varredura `crm-bling-marketplace-fin`, que já lê esses pedidos para lançar
 * a conta a receber que o Bling não gera.
 *
 * ── Duas diferenças que mudam o TEXTO, não só os dados ──────────────────────────────────────
 *
 * **Não tem hora.** O Bling devolve `data` (YYYY-MM-DD) e mais nada. Carimbar `new Date()` seria
 * repetir o bug que o comprovante normal já levou uma vez: a mensagem diria a hora do cron, e é
 * por data/hora que o caixa fecha. Então aqui não existe linha de hora — existe a data do pedido
 * no canal, e o "detectado em" no rodapé, que é o que de fato aconteceu naquele instante.
 *
 * **Não é dinheiro em caixa.** O marketplace repassa depois (o ML solta ~30 dias). Um comprovante
 * idêntico ao da venda no Pix faria o financeiro somar no caixa do dia um valor que ainda não
 * existe na conta. Por isso o título diz MARKETPLACE, e a data do repasse vem escrita.
 */

/** `transporte.etiqueta` do pedido do Bling — é o único endereço que o marketplace entrega. */
export type MarketplaceEtiqueta = {
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  municipio?: string | null
  uf?: string | null
  cep?: string | null
}

export type MarketplaceSaleReceiptInput = {
  tenantId: string
  /** Id interno do pedido no Bling — é a CHAVE de dedupe em `marketplace_sale_receipts`. */
  blingOrderId: string
  /** Número VISÍVEL do pedido (3734). É o que a busca do Bling acha; o id interno não. */
  numero?: string | null
  /** Nome do canal já resolvido ('Shopee', 'Mercado Livre', 'TikTok Shop'…). */
  canal: string
  /** `loja.id` do Bling — vai no rodapé quando o canal não pôde ser nomeado. */
  canalLojaId?: string | null
  /** `numeroLoja`: o código do pedido DENTRO do marketplace, que é por onde o suporte procura. */
  pedidoDoCanal?: string | null
  amountCents: number
  /** `taxas.taxaComissao` — comissão que o canal já debitou. */
  commissionCents?: number | null
  /** `taxas.custoFrete` — frete pago por nós, não cobrado do cliente. */
  freightCostCents?: number | null
  /** Data do pedido no canal (YYYY-MM-DD). */
  orderDate?: string | null
  /** `parcelas[0].dataVencimento` — quando o canal libera o dinheiro (YYYY-MM-DD). */
  repasseDate?: string | null
  itens?: Array<{ descricao: string; quantidade: number }>
  buyer: { name?: string | null; cpf?: string | null; etiqueta?: MarketplaceEtiqueta | null }
  rastreio?: string | null
}

/**
 * YYYY-MM-DD → DD/MM/YYYY na unha. `new Date('2026-08-21')` é meia-noite UTC, que em Brasília
 * ainda é dia 20 — a data do pedido voltaria um dia inteiro em todo comprovante.
 */
function fmtDiaBr(ymd?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function etiquetaLinha(e?: MarketplaceEtiqueta | null): string {
  const s = (v: unknown) => String(v ?? '').trim()
  const cep = s(e?.cep).replace(/\D/g, '')
  return [
    [s(e?.endereco), s(e?.numero)].filter(Boolean).join(', '),
    s(e?.complemento),
    s(e?.bairro),
    [s(e?.municipio), s(e?.uf)].filter(Boolean).join('/'),
    cep ? `CEP ${cep.replace(/(\d{5})(\d{3})/, '$1-$2')}` : '',
  ].filter(Boolean).join(' — ')
}

export function buildMarketplaceReceiptText(d: MarketplaceSaleReceiptInput): string {
  const { data: hojeData, hora: agoraHora } = brasiliaDateTime()

  const comissao = Number(d.commissionCents ?? 0)
  const freteCusto = Number(d.freightCostCents ?? 0)
  const recebimento: string[] = []
  if (comissao > 0) recebimento.push(`• Comissão do canal: ${fmtBRL(comissao)}`)
  if (freteCusto > 0) recebimento.push(`• Frete (custo nosso): ${fmtBRL(freteCusto)}`)
  if (comissao + freteCusto > 0) {
    recebimento.push(`• Líquido estimado: ${fmtBRL(d.amountCents - comissao - freteCusto)}`)
  }
  const repasse = fmtDiaBr(d.repasseDate)
  recebimento.push(
    repasse
      ? `• Repasse previsto: ${repasse} — *não entra no caixa de hoje*`
      : '• O dinheiro só cai no repasse do canal — *não entra no caixa de hoje*',
  )

  const b = d.buyer ?? {}
  const comprador: string[] = []
  if (b.name?.trim()) comprador.push(`• Nome: ${b.name.trim()}`)
  const cpf = fmtCpf(b.cpf)
  if (cpf) comprador.push(`• CPF: ${cpf}`)
  const end = etiquetaLinha(b.etiqueta)
  if (end) comprador.push(`• Endereço: ${end}`)
  if (!comprador.length) comprador.push('• (o canal não devolveu os dados do comprador)')

  const pedido: string[] = []
  const itens = (d.itens ?? []).filter((i) => String(i?.descricao ?? '').trim())
  if (itens.length) {
    pedido.push(`• Itens: ${itens.map((i) => `${i.quantidade}× ${i.descricao.trim()}`).join(' | ').slice(0, 240)}`)
  }
  if (d.pedidoDoCanal) pedido.push(`• Pedido no canal: ${d.pedidoDoCanal}`)
  if (d.numero) pedido.push(`• Pedido Bling: nº ${d.numero}`)
  else pedido.push(`• Pedido Bling: id ${d.blingOrderId} (interno — na tela do Bling, busque pelo nome do cliente)`)
  if (d.rastreio) pedido.push(`• Rastreio: ${d.rastreio}`)
  pedido.push(`• Detectado em: ${hojeData} ${agoraHora} (Brasília)`)
  pedido.push(`• Ref: bling:${d.blingOrderId}${d.canalLojaId ? ` · loja ${d.canalLojaId}` : ''}`)

  return [
    '🧾 *COMPROVANTE DE VENDA (MARKETPLACE)*',
    '',
    `🛒 Canal: *${d.canal}*`,
    `📅 Data do pedido: ${fmtDiaBr(d.orderDate) || '—'}`,
    `💰 Valor: *${fmtBRL(d.amountCents)}*`,
    '',
    '*💳 Recebimento*',
    ...recebimento,
    '',
    '*👤 Comprador*',
    ...comprador,
    '',
    '*📦 Pedido*',
    ...pedido,
  ].join('\n')
}

type MarketplaceReceiptRow = { group_sent_at?: string | null; owner_sent_at?: string | null }

/**
 * Entrega o comprovante do pedido de marketplace no grupo do financeiro e na DM do dono, e
 * carimba as marcas em `marketplace_sale_receipts`.
 *
 * **A marca é o dedupe** — mesmo desenho do comprovante de gateway: quem já foi não vai de novo,
 * e o que falhou é retentado na rodada seguinte da varredura sem ninguém precisar mandar. Grupo
 * e dono têm marca própria porque falham separado (W-API fora do ar no meio dos dois envios
 * mandaria a venda duas vezes para quem já tinha recebido).
 *
 * Leitura-antes-de-escrever em vez de upsert: no upsert do PostgREST a coluna ausente do payload
 * não entra no DO UPDATE, e mandar `null` APAGA — com dois carimbos independentes na mesma linha
 * isso é jeito fácil de apagar a marca do grupo ao gravar a do dono.
 */
export async function sendMarketplaceSaleReceipt(
  admin: SupabaseClient,
  d: MarketplaceSaleReceiptInput,
): Promise<{ grupo: boolean; dono: boolean; jaEnviado: boolean; erro?: string }> {
  const tid = String(d.tenantId ?? '').trim()
  const orderId = String(d.blingOrderId ?? '').trim()
  if (!tid || !orderId) return { grupo: false, dono: false, jaEnviado: false, erro: 'input_incompleto' }

  try {
    const { data: existente } = await admin.from('marketplace_sale_receipts')
      .select('group_sent_at, owner_sent_at')
      .eq('tenant_id', tid).eq('bling_order_id', orderId).maybeSingle()
    const linha = existente as MarketplaceReceiptRow | null
    const jaGrupo = Boolean(linha?.group_sent_at)
    const jaDono = Boolean(linha?.owner_sent_at)
    if (jaGrupo && jaDono) return { grupo: false, dono: false, jaEnviado: true }

    const cfg = await readNotifCfg(admin, tid)
    if (cfg.marketplace_receipt_enabled === false) {
      return { grupo: false, dono: false, jaEnviado: false, erro: 'desligado' }
    }

    const texto = buildMarketplaceReceiptText(d)

    const jid = String(cfg.sales_receipt_group_jid ?? '').trim()
    const grupoLigado = Boolean(jid) && cfg.sales_receipt_enabled !== false
    const grupo = !jaGrupo && grupoLigado ? await sendWapiGroupText(admin, tid, jid, texto) : false

    // Sem telefone de dono configurado não há o que entregar: carimba assim mesmo, senão a
    // varredura fica reprocessando a mesma venda para sempre (mesma decisão do comprovante 1:1).
    const temDono = Array.isArray(cfg.sales_receipt_owner_phones) && cfg.sales_receipt_owner_phones.filter(Boolean).length > 0
    const dono = !jaDono && (!temDono || await notifyOwnerWhatsapp(admin, tid, 'venda', texto))

    const agora = new Date().toISOString()
    const marcas = {
      ...(grupo ? { group_sent_at: agora } : {}),
      ...(dono ? { owner_sent_at: agora } : {}),
    }
    if (linha) {
      if (Object.keys(marcas).length) {
        await admin.from('marketplace_sale_receipts').update(marcas)
          .eq('tenant_id', tid).eq('bling_order_id', orderId)
      }
    } else {
      await admin.from('marketplace_sale_receipts').insert({
        tenant_id: tid,
        bling_order_id: orderId,
        numero: d.numero ?? null,
        canal: d.canal,
        canal_loja_id: d.canalLojaId ?? null,
        pedido_do_canal: d.pedidoDoCanal ?? null,
        amount_cents: d.amountCents,
        order_date: d.orderDate ?? null,
        ...marcas,
      })
    }

    if (!grupo && !jaGrupo && grupoLigado) {
      console.warn(`[saleReceipt] comprovante de marketplace NÃO entregue (tenant=${tid}, pedido=${orderId})`)
    }
    return { grupo, dono: dono && !jaDono, jaEnviado: false }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    console.warn('[saleReceipt] marketplace exception:', erro)
    return { grupo: false, dono: false, jaEnviado: false, erro }
  }
}
