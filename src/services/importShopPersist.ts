import { supabase } from '@/lib/supabaseClient'
import { createReceivables } from '@/services/financeiro'
import type { ShopImportRow } from '@/services/importShop'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

/** Grava linhas parseadas: pagamentos → contas a receber; custos → contas a pagar. */
export async function createPayablesFromImport(
  rows: ShopImportRow[],
): Promise<{ receivables: number; payables: number }> {
  const client = assertClient()
  let receivables = 0
  let payables = 0
  const today = new Date().toISOString().slice(0, 10)

  for (const r of rows) {
    const due = r.date || today
    if (r.kind === 'pagamento') {
      await createReceivables({
        description: r.description,
        customerName: r.counterparty,
        amountCents: r.amountCents,
        firstDueDate: due,
        installments: 1,
        note: 'Importação shop',
      })
      receivables += 1
      continue
    }
    // custo (e "outro" como custo)
    const { error } = await client.from('payable_installments').insert({
      description: r.description,
      due_date: due,
      amount_cents: r.amountCents,
      status: 'aberto',
      note: r.counterparty ? `Shop · ${r.counterparty}` : 'Importação shop',
    })
    if (error) throw new Error(error.message)
    payables += 1
  }
  return { receivables, payables }
}

export { createReceivables }
