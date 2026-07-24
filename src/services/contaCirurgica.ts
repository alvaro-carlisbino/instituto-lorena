import { supabase } from '@/lib/supabaseClient'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type SurgeryLineKind =
  | 'mat_med'
  | 'hora_sala'
  | 'anestesia'
  | 'pagamento'
  | 'consumo'
  | 'acrescimo'
  | 'desconto'
  | 'outro'

export const SURGERY_LINE_KINDS: Array<{ value: SurgeryLineKind; label: string }> = [
  { value: 'mat_med', label: 'Mat/Med' },
  { value: 'consumo', label: 'Material de consumo' },
  { value: 'hora_sala', label: 'Hora sala' },
  { value: 'anestesia', label: 'Anestesia' },
  { value: 'acrescimo', label: 'Acréscimo' },
  { value: 'desconto', label: 'Desconto' },
  { value: 'pagamento', label: 'Pagamento' },
  { value: 'outro', label: 'Outro' },
]

export type SurgeryAccountLine = {
  id: string
  kind: SurgeryLineKind
  description: string
  qty: number
  unitCents: number
  stockItemId: string | null
}

export type SurgeryAccount = {
  id: string
  leadId: string | null
  patientName: string
  procedureLabel: string | null
  surgeryDate: string | null
  kitId: string | null
  status: 'aberta' | 'fechada' | 'cancelada'
  note: string | null
  createdAt: string
  lines: SurgeryAccountLine[]
}

const KIND_SET = new Set(SURGERY_LINE_KINDS.map((k) => k.value))

function mapAccount(
  r: Record<string, unknown>,
  lines: SurgeryAccountLine[],
): SurgeryAccount {
  const status = r.status === 'fechada' || r.status === 'cancelada' ? r.status : 'aberta'
  return {
    id: String(r.id),
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    patientName: String(r.patient_name ?? ''),
    procedureLabel: r.procedure_label != null ? String(r.procedure_label) : null,
    surgeryDate: r.surgery_date != null ? String(r.surgery_date) : null,
    kitId: r.kit_id != null ? String(r.kit_id) : null,
    status,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    lines,
  }
}

export async function listSurgeryAccounts(): Promise<SurgeryAccount[]> {
  const client = assertClient()
  const [accs, lines] = await Promise.all([
    client
      .from('surgery_accounts')
      .select('id, lead_id, patient_name, procedure_label, surgery_date, kit_id, status, note, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    client
      .from('surgery_account_lines')
      .select('id, account_id, kind, description, qty, unit_cents, stock_item_id'),
  ])
  if (accs.error) throw new Error(accs.error.message)
  if (lines.error) throw new Error(lines.error.message)
  const byAcc = new Map<string, SurgeryAccountLine[]>()
  for (const r of lines.data ?? []) {
    const key = String(r.account_id)
    const list = byAcc.get(key) ?? []
    const kind = KIND_SET.has(r.kind as SurgeryLineKind) ? (r.kind as SurgeryLineKind) : 'outro'
    list.push({
      id: String(r.id),
      kind,
      description: String(r.description ?? ''),
      qty: Number(r.qty ?? 1),
      unitCents: Number(r.unit_cents ?? 0),
      stockItemId: r.stock_item_id != null ? String(r.stock_item_id) : null,
    })
    byAcc.set(key, list)
  }
  return (accs.data ?? []).map((r) => mapAccount(r as Record<string, unknown>, byAcc.get(String(r.id)) ?? []))
}

export async function createSurgeryAccount(payload: {
  leadId?: string | null
  patientName: string
  procedureLabel?: string
  surgeryDate?: string | null
  kitId?: string | null
  note?: string
  lines: Array<{
    kind: SurgeryLineKind
    description: string
    qty: number
    unitCents: number
    stockItemId?: string | null
  }>
}): Promise<string> {
  const client = assertClient()
  if (payload.patientName.trim().length < 2) throw new Error('Informe o paciente.')
  const lines = payload.lines.filter((l) => l.description.trim())
  const { data, error } = await client
    .from('surgery_accounts')
    .insert({
      lead_id: payload.leadId || null,
      patient_name: payload.patientName.trim(),
      procedure_label: payload.procedureLabel?.trim() || null,
      surgery_date: payload.surgeryDate || null,
      kit_id: payload.kitId || null,
      note: payload.note?.trim() || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const accountId = String((data as { id: unknown }).id)
  if (lines.length > 0) {
    const { error: linesErr } = await client.from('surgery_account_lines').insert(
      lines.map((l) => ({
        account_id: accountId,
        kind: l.kind,
        description: l.description.trim(),
        qty: l.qty > 0 ? l.qty : 1,
        unit_cents: l.unitCents,
        stock_item_id: l.stockItemId || null,
      })),
    )
    if (linesErr) {
      await client.from('surgery_accounts').delete().eq('id', accountId)
      throw new Error(linesErr.message)
    }
  }
  return accountId
}

export async function addSurgeryLine(
  accountId: string,
  line: {
    kind: SurgeryLineKind
    description: string
    qty: number
    unitCents: number
    stockItemId?: string | null
  },
): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('surgery_account_lines').insert({
    account_id: accountId,
    kind: line.kind,
    description: line.description.trim(),
    qty: line.qty > 0 ? line.qty : 1,
    unit_cents: line.unitCents,
    stock_item_id: line.stockItemId || null,
  })
  if (error) throw new Error(error.message)
}

export async function setSurgeryAccountStatus(
  id: string,
  status: 'aberta' | 'fechada' | 'cancelada',
): Promise<void> {
  const client = assertClient()
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'fechada') patch.closed_at = new Date().toISOString()
  const { error } = await client.from('surgery_accounts').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export function surgeryAccountTotals(account: SurgeryAccount): {
  chargesCents: number
  paymentsCents: number
  balanceCents: number
} {
  let charges = 0
  let payments = 0
  for (const l of account.lines) {
    const lineTotal = Math.round(l.qty * l.unitCents)
    if (l.kind === 'pagamento' || l.kind === 'desconto') payments += Math.abs(lineTotal)
    else charges += lineTotal
  }
  return { chargesCents: charges, paymentsCents: payments, balanceCents: charges - payments }
}

/** Abre janela de impressão com a conta do paciente (PDF via print do browser). */
export function printSurgeryAccountPdf(
  account: SurgeryAccount,
  opts?: { itemNames?: Map<string, string> },
): void {
  const totals = surgeryAccountTotals(account)
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const kindLabel = (k: SurgeryLineKind) => SURGERY_LINE_KINDS.find((x) => x.value === k)?.label ?? k
  const rows = account.lines
    .map((l) => {
      const name =
        l.stockItemId && opts?.itemNames?.get(l.stockItemId)
          ? `${l.description} (${opts.itemNames.get(l.stockItemId)})`
          : l.description
      const total = Math.round(l.qty * l.unitCents)
      return `<tr>
        <td>${kindLabel(l.kind)}</td>
        <td>${name}</td>
        <td style="text-align:right">${l.qty}</td>
        <td style="text-align:right">${brl(l.unitCents)}</td>
        <td style="text-align:right">${brl(total)}</td>
      </tr>`
    })
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Conta — ${account.patientName}</title>
    <style>
      body{font-family:Georgia,serif;color:#1a1a1a;padding:32px;max-width:800px;margin:0 auto}
      h1{font-size:22px;margin:0 0 4px} .meta{color:#555;font-size:13px;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left}
      th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666}
      .tot{margin-top:20px;font-size:14px} .tot strong{font-size:16px}
      @media print{body{padding:0}}
    </style></head><body>
    <h1>Conta do paciente — Centro cirúrgico</h1>
    <div class="meta">
      <div><strong>${account.patientName}</strong></div>
      <div>${[account.procedureLabel, account.surgeryDate ? new Date(`${account.surgeryDate}T12:00:00`).toLocaleDateString('pt-BR') : null].filter(Boolean).join(' · ') || '—'}</div>
      <div>Status: ${account.status} · Emitido em ${new Date().toLocaleString('pt-BR')}</div>
    </div>
    <table>
      <thead><tr><th>Tipo</th><th>Descrição</th><th style="text-align:right">Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Sem itens</td></tr>'}</tbody>
    </table>
    <div class="tot">
      <div>Cobranças: ${brl(totals.chargesCents)}</div>
      <div>Pagamentos/descontos: ${brl(totals.paymentsCents)}</div>
      <div><strong>Saldo: ${brl(totals.balanceCents)}</strong></div>
    </div>
    <script>window.onload=()=>{window.print()}</script>
    </body></html>`
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
  if (!w) throw new Error('Permita pop-ups para imprimir o PDF.')
  w.document.write(html)
  w.document.close()
}
