import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// ─────────────────────────────────────────────────────────────────────────────
// Gerador de despesas/receitas RECORRENTES (aluguel, salários, contas fixas).
// Roda 1x/dia. Para cada fin_recurring ativo que ainda NÃO foi gerado no mês corrente,
// cria a conta a pagar (payable_installments) ou a receber (fin_receivables) do mês e
// carimba last_generated_on = 1º dia do mês (idempotente: reexecução no mesmo mês não
// duplica). Multi-tenant: usa o tenant_id da própria regra (service_role, sem RLS).
//
// verify_jwt=false (ver config.toml). Auth opcional por x-cron-secret = FIN_RECURRING_CRON_SECRET.
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

type RecurringRow = {
  id: string
  tenant_id: string
  kind: string
  description: string
  category_id: string | null
  account_id: string | null
  supplier_id: string | null
  amount_cents: number
  day_of_month: number
  payment_method: string | null
  last_generated_on: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('FIN_RECURRING_CRON_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  if (cronSecret && provided !== cronSecret) return json({ error: 'unauthorized' }, 401)
  if (!url || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  const admin = createClient(url, serviceRole)
  const now = new Date()
  const y = now.getUTCFullYear()
  const mo = now.getUTCMonth() // 0-based
  const firstOfMonth = `${y}-${pad(mo + 1)}-01`
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()

  const { data: rulesRaw, error } = await admin
    .from('fin_recurring')
    .select('id, tenant_id, kind, description, category_id, account_id, supplier_id, amount_cents, day_of_month, payment_method, last_generated_on')
    .eq('active', true)
  if (error) return json({ error: 'query_failed', message: error.message }, 500)
  const rules = (rulesRaw ?? []) as RecurringRow[]

  const results: Array<Record<string, unknown>> = []
  let generated = 0

  for (const r of rules) {
    // Já gerou neste mês? (last_generated_on carimba o 1º dia do mês do último ciclo)
    if (r.last_generated_on && r.last_generated_on >= firstOfMonth) {
      continue
    }
    const day = Math.min(Math.max(1, r.day_of_month || 1), lastDay)
    const dueDate = `${y}-${pad(mo + 1)}-${pad(day)}`

    try {
      if (r.kind === 'receivable') {
        const { error: insErr } = await admin.from('fin_receivables').insert({
          tenant_id: r.tenant_id,
          description: r.description,
          category_id: r.category_id,
          account_id: r.account_id,
          amount_cents: r.amount_cents,
          due_date: dueDate,
          method: r.payment_method,
          note: 'Recorrente',
        })
        if (insErr) throw insErr
      } else {
        const { error: insErr } = await admin.from('payable_installments').insert({
          tenant_id: r.tenant_id,
          description: r.description,
          category_id: r.category_id,
          account_id: r.account_id,
          supplier_id: r.supplier_id,
          amount_cents: r.amount_cents,
          due_date: dueDate,
          payment_method: r.payment_method,
          note: 'Recorrente',
        })
        if (insErr) throw insErr
      }
      await admin.from('fin_recurring').update({ last_generated_on: firstOfMonth, updated_at: now.toISOString() }).eq('id', r.id)
      generated += 1
      results.push({ id: r.id, tenant: r.tenant_id, kind: r.kind, dueDate, ok: true })
    } catch (e) {
      results.push({ id: r.id, tenant: r.tenant_id, ok: false, note: e instanceof Error ? e.message : String(e) })
    }
  }

  return json({ ok: true, month: firstOfMonth, candidates: rules.length, generated, results, at: now.toISOString() })
})
