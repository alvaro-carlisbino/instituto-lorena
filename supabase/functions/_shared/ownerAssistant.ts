import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// IA PESSOAL DO DONO (Álvaro) — read-only. Roda quando o número do dono manda mensagem
// na linha do Tricopill (o crm-wapi-webhook intercepta ANTES do bot de vendas). Responde
// sobre vendas, financeiro, rastreio, pedido e estoque. Só CONSULTA — nunca escreve.

const OWNER_TENANT = 'tricopill'
const PAID_ASAAS = ['paid', 'confirmed', 'received', 'approved']

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const digits = (s: string) => String(s ?? '').replace(/\D/g, '')
const last10 = (s: string) => digits(s).slice(-10)

/** É o número do dono? Compara pelo sufixo (últimos 10 dígitos) com sales_receipt_owner_phones. */
export async function isOwnerPhone(admin: SupabaseClient, tenantId: string | undefined, phone: string): Promise<boolean> {
  if (!phone) return false
  const { data } = await admin.from('tenant_integrations').select('notifications')
    .eq('tenant_id', tenantId ?? OWNER_TENANT).maybeSingle()
  const phones = ((data as { notifications?: { sales_receipt_owner_phones?: string[] } } | null)?.notifications?.sales_receipt_owner_phones) ?? []
  const target = last10(phone)
  return phones.some((p) => last10(p) === target)
}

// ── Janelas de tempo em Brasília (UTC-3, sem horário de verão) ──
function brasiliaRange(period: string): { since: string; until: string; label: string } {
  const OFFSET = 3 * 3_600_000 // BRT = UTC-3
  const nowMs = Date.now()
  const b = new Date(nowMs - OFFSET) // "agora" com relógio de Brasília nos campos UTC
  const y = b.getUTCFullYear(), m = b.getUTCMonth(), d = b.getUTCDate()
  const startTodayUtc = Date.UTC(y, m, d, 0, 0, 0) + OFFSET // meia-noite BRT → UTC
  const iso = (ms: number) => new Date(ms).toISOString()
  const nowIso = iso(nowMs)
  switch (period) {
    case 'ontem': return { since: iso(startTodayUtc - 86_400_000), until: iso(startTodayUtc), label: 'ontem' }
    case 'mes': return { since: iso(Date.UTC(y, m, 1, 0, 0, 0) + OFFSET), until: nowIso, label: 'este mês' }
    case 'semana': return { since: iso(nowMs - 7 * 86_400_000), until: nowIso, label: 'últimos 7 dias' }
    default: return { since: iso(startTodayUtc), until: nowIso, label: 'hoje' }
  }
}

function detectPeriod(t: string): string {
  if (/\bontem\b/.test(t)) return 'ontem'
  if (/\bm[eê]s\b|mensal|do mes/.test(t)) return 'mes'
  if (/semana|7 dias|ultimos dias/.test(t)) return 'semana'
  return 'hoje'
}

type PayRow = { amount_cents: number; method?: string | null; customer_name?: string | null; status?: string | null; bling_order_id?: string | null; paid_at?: string | null; phone?: string | null }

async function paidRows(admin: SupabaseClient, since: string, until: string): Promise<PayRow[]> {
  const [{ data: rede }, { data: asaas }] = await Promise.all([
    admin.from('rede_payments').select('amount_cents, method, customer_name, bling_order_id, paid_at, phone')
      .eq('tenant_id', OWNER_TENANT).eq('status', 'paid').gte('paid_at', since).lt('paid_at', until),
    admin.from('asaas_payments').select('amount_cents, method, customer_name, bling_order_id, paid_at, phone')
      .eq('tenant_id', OWNER_TENANT).in('status', PAID_ASAAS).gte('paid_at', since).lt('paid_at', until),
  ])
  return [...((rede ?? []) as PayRow[]), ...((asaas ?? []) as PayRow[])]
}

async function cmdVendas(admin: SupabaseClient, period: string): Promise<string> {
  const { since, until, label } = brasiliaRange(period)
  const rows = await paidRows(admin, since, until)
  const total = rows.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
  if (rows.length === 0) return `📊 *Vendas ${label}*\nNenhuma venda paga ainda.`
  const ticket = total / rows.length
  const ultimas = rows.slice(-5).reverse().map((r) => `• ${(r.customer_name ?? 'Cliente').slice(0, 22)} — ${brl(r.amount_cents ?? 0)}`).join('\n')
  return `📊 *Vendas ${label}*\n*${rows.length}* venda(s) · Total *${brl(total)}*\nTicket médio ${brl(ticket)}\n\nÚltimas:\n${ultimas}`
}

async function cmdFinanceiro(admin: SupabaseClient, period: string): Promise<string> {
  const { since, until, label } = brasiliaRange(period)
  const rows = await paidRows(admin, since, until)
  if (rows.length === 0) return `💰 *Financeiro ${label}*\nSem entradas ainda.`
  const byMethod = new Map<string, { n: number; cents: number }>()
  for (const r of rows) {
    const k = String(r.method ?? 'outro').toLowerCase() === 'pix' ? 'PIX' : String(r.method ?? '').toLowerCase().includes('card') ? 'Cartão' : 'Outro'
    const cur = byMethod.get(k) ?? { n: 0, cents: 0 }
    cur.n++; cur.cents += r.amount_cents ?? 0; byMethod.set(k, cur)
  }
  const total = rows.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
  const linhas = [...byMethod.entries()].map(([k, v]) => `• ${k}: ${v.n}× — ${brl(v.cents)}`).join('\n')
  return `💰 *Financeiro ${label}*\nEntradas: *${brl(total)}* (${rows.length})\n\n${linhas}`
}

async function cmdRastreio(admin: SupabaseClient, query: string): Promise<string> {
  const q = query.trim()
  if (!q) return 'Uso: `/rastreio <nome ou telefone>` — ex.: `/rastreio Maria` ou `/rastreio 44999...`'
  let phones: string[] = []
  if (digits(q).length >= 8) {
    phones = [digits(q)]
  } else {
    const { data: leads } = await admin.from('leads').select('phone').eq('tenant_id', OWNER_TENANT).ilike('patient_name', `%${q}%`).limit(5)
    phones = ((leads ?? []) as { phone?: string }[]).map((l) => l.phone ?? '').filter(Boolean)
  }
  if (phones.length === 0) return `Não achei ninguém com "${q}".`
  const suffixes = phones.map(last10)
  const { data: tr } = await admin.from('tracking_sent').select('tracking, phone, notified_at')
    .eq('tenant_id', OWNER_TENANT).order('notified_at', { ascending: false }).limit(200)
  const hits = ((tr ?? []) as { tracking: string; phone: string; notified_at: string }[])
    .filter((t) => suffixes.includes(last10(t.phone)))
  if (hits.length === 0) return `Achei o cliente "${q}", mas ainda não há código de rastreio enviado pra ele.`
  return `📦 *Rastreio — ${q}*\n` + hits.slice(0, 5).map((h) => `• ${h.tracking}`).join('\n')
}

async function cmdPedido(admin: SupabaseClient, query: string): Promise<string> {
  const q = query.trim()
  if (!q) return 'Uso: `/pedido <nome>` — ex.: `/pedido João`'
  const [{ data: rede }, { data: asaas }] = await Promise.all([
    admin.from('rede_payments').select('customer_name, amount_cents, status, method, bling_order_id, paid_at')
      .eq('tenant_id', OWNER_TENANT).ilike('customer_name', `%${q}%`).order('created_at', { ascending: false }).limit(3),
    admin.from('asaas_payments').select('customer_name, amount_cents, status, method, bling_order_id, paid_at')
      .eq('tenant_id', OWNER_TENANT).ilike('customer_name', `%${q}%`).order('created_at', { ascending: false }).limit(3),
  ])
  const rows = [...((rede ?? []) as PayRow[]), ...((asaas ?? []) as PayRow[])]
  if (rows.length === 0) return `Não achei pedido de "${q}".`
  return `🧾 *Pedidos — ${q}*\n` + rows.slice(0, 4).map((r) =>
    `• ${(r.customer_name ?? '').slice(0, 22)} — ${brl(r.amount_cents ?? 0)} · ${r.status === 'paid' || PAID_ASAAS.includes(String(r.status)) ? '✅ pago' : '⏳ ' + r.status}${r.bling_order_id ? ` · Bling ${r.bling_order_id}` : ''}`,
  ).join('\n')
}

async function cmdEstoque(admin: SupabaseClient, query: string): Promise<string> {
  let qb = admin.from('stock_items').select('name, min_qty, controlled, sku').eq('tenant_id', OWNER_TENANT).eq('active', true).order('name').limit(30)
  if (query.trim()) qb = qb.ilike('name', `%${query.trim()}%`)
  const { data } = await qb
  const rows = (data ?? []) as { name: string; min_qty?: number; controlled?: boolean; sku?: string }[]
  if (rows.length === 0) return query.trim() ? `Nenhum item de estoque com "${query.trim()}".` : 'Nenhum item de estoque cadastrado.'
  const linhas = rows.map((r) => `• ${r.name}${r.min_qty ? ` (mín ${r.min_qty})` : ''}${r.controlled ? ' 🔒' : ''}`).join('\n')
  return `📦 *Estoque* (itens cadastrados)\n${linhas}\n\n_Saldo em tempo real fica no Bling._`
}

function ajuda(): string {
  return [
    '🤖 *Sua central Tricopill* (só eu te respondo por aqui)',
    '',
    '*Comandos:*',
    '• `/vendas` — hoje · `/vendas ontem` · `/vendas mes`',
    '• `/financeiro` — entradas por forma de pagamento',
    '• `/rastreio <nome ou telefone>`',
    '• `/pedido <nome>` — status + Bling',
    '• `/estoque` — itens cadastrados',
    '',
    'Ou fala natural: _"como tá o dia?"_, _"cadê o pedido da Maria?"_, _"vendas do mês"_.',
  ].join('\n')
}

/** Roteador principal. Comandos com `/` primeiro; senão, palavras-chave. Só consulta. */
export async function handleOwnerMessage(admin: SupabaseClient, _tenantId: string | undefined, _phone: string, textRaw: string): Promise<string> {
  const text = String(textRaw ?? '').trim()
  const t = text.toLowerCase()
  try {
    // Comandos explícitos
    if (t.startsWith('/')) {
      const [cmd, ...rest] = text.slice(1).split(/\s+/)
      const arg = rest.join(' ')
      const c = cmd.toLowerCase()
      if (c === 'vendas') return await cmdVendas(admin, detectPeriod(arg.toLowerCase()))
      if (c === 'financeiro' || c === 'financas') return await cmdFinanceiro(admin, detectPeriod(arg.toLowerCase()))
      if (c === 'rastreio' || c === 'rastrear') return await cmdRastreio(admin, arg)
      if (c === 'pedido' || c === 'pedidos') return await cmdPedido(admin, arg)
      if (c === 'estoque') return await cmdEstoque(admin, arg)
      if (c === 'ajuda' || c === 'help' || c === 'start') return ajuda()
      return `Não conheço \`/${cmd}\`. Manda \`/ajuda\`.`
    }
    // Linguagem natural (palavras-chave)
    if (/rastre|c[oó]digo|entreg|envio/.test(t)) {
      const q = text.replace(/.*(rastreio|rastrear|c[oó]digo|entrega|envio)\s*(de|do|da)?\s*/i, '').trim()
      return await cmdRastreio(admin, q)
    }
    if (/pedido|comprou|compra d/.test(t)) {
      const q = text.replace(/.*(pedido|compra)\s*(de|do|da)?\s*/i, '').trim()
      return await cmdPedido(admin, q)
    }
    if (/estoque/.test(t)) return await cmdEstoque(admin, text.replace(/.*estoque\s*(de|do|da)?\s*/i, '').trim())
    if (/financ|faturamento|entrada|receb/.test(t)) return await cmdFinanceiro(admin, detectPeriod(t))
    if (/vend|vendeu|faturou|como (t[aá]|foi) o dia|dia hoje/.test(t)) return await cmdVendas(admin, detectPeriod(t))
    // saudação / não entendi
    return `Oi Álvaro 👋 ${ajuda()}`
  } catch (e) {
    console.warn('[ownerAssistant] erro:', e instanceof Error ? e.message : String(e))
    return '⚠️ Deu um erro aqui ao buscar. Tenta de novo em instantes ou manda `/ajuda`.'
  }
}
