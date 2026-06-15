import { supabase } from '@/lib/supabaseClient'

/**
 * Resumo de pagamento de um lead (polo de vendas / Tricopill).
 *
 * Consolida as duas tabelas de cobrança — `rede_payments` (cartão e.Rede) e
 * `pagbank_checkouts` (Pix/checkout PagBank) — por `lead_id`. O RLS dessas
 * tabelas é `tenant_id = current_tenant_id()`, então só vêm cobranças do polo
 * ativo (sem vazamento entre polos). Leads de polos sem cobrança (ex.: clínica)
 * simplesmente não aparecem no mapa.
 */
export type LeadPaymentSummary = {
  status: 'paid' | 'pending'
  method: 'pix' | 'card'
  amountCents: number
  paidAt: string | null
}

// Mesma regra canônica de "pago" do BI (crm-tricopill-bi).
const PAID_STATUSES = new Set(['paid', 'pago', 'available', 'approved', 'completed'])
function isPaid(status: unknown, paidAt: unknown): boolean {
  if (paidAt != null && String(paidAt).length > 0) return true
  return typeof status === 'string' && PAID_STATUSES.has(status.toLowerCase())
}

type Row = LeadPaymentSummary & { leadId: string; ts: number }

/**
 * Mapa `leadId -> resumo de pagamento`. Por lead, escolhe a melhor cobrança:
 * "paid" ganha de "pending"; empate desempata pela mais recente (paid_at/created_at).
 */
export async function fetchLeadPaymentSummaries(): Promise<Record<string, LeadPaymentSummary>> {
  if (!supabase) return {}

  const [redeRes, pagRes] = await Promise.all([
    supabase
      .from('rede_payments')
      .select('lead_id, amount_cents, status, paid_at, created_at')
      .not('lead_id', 'is', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('pagbank_checkouts')
      .select('lead_id, amount_cents, status, paid_at, created_at')
      .not('lead_id', 'is', null)
      .order('created_at', { ascending: false }),
  ])

  const rows: Row[] = []
  const push = (data: unknown, method: 'pix' | 'card') => {
    if (!Array.isArray(data)) return
    for (const raw of data) {
      const r = raw as Record<string, unknown>
      const leadId = r.lead_id != null ? String(r.lead_id) : ''
      if (!leadId) continue
      const paid = isPaid(r.status, r.paid_at)
      const tsRaw = (r.paid_at as string) || (r.created_at as string) || ''
      rows.push({
        leadId,
        method,
        amountCents: Number(r.amount_cents) || 0,
        status: paid ? 'paid' : 'pending',
        paidAt: (r.paid_at as string) ?? null,
        ts: Date.parse(tsRaw) || 0,
      })
    }
  }
  if (!redeRes.error) push(redeRes.data, 'card')
  if (!pagRes.error) push(pagRes.data, 'pix')

  // paid antes de pending; dentro do mesmo status, mais recente primeiro.
  rows.sort((a, b) => {
    const pa = a.status === 'paid' ? 1 : 0
    const pb = b.status === 'paid' ? 1 : 0
    if (pa !== pb) return pb - pa
    return b.ts - a.ts
  })

  const out: Record<string, LeadPaymentSummary> = {}
  for (const r of rows) {
    if (out[r.leadId]) continue
    out[r.leadId] = { status: r.status, method: r.method, amountCents: r.amountCents, paidAt: r.paidAt }
  }
  return out
}
