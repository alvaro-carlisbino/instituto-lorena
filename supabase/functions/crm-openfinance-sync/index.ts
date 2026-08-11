import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// ─────────────────────────────────────────────────────────────────────────────
// Sync AUTOMÁTICO do Open Finance (Pluggy) — roda 1x/dia via pg_cron. Puxa as
// transações novas de TODAS as contas ligadas (todos os tenants) pro razão de caixa.
// service_role (sem JWT de usuário), por isso grava tenant_id EXPLÍCITO (o da conta).
// Idempotente: dedup por (tenant, conta, id da transação). verify_jwt=false + x-cron-secret.
// ─────────────────────────────────────────────────────────────────────────────

const PLUGGY = 'https://api.pluggy.ai'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function pluggyAuth(): Promise<string> {
  const res = await fetch(`${PLUGGY}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: Deno.env.get('PLUGGY_CLIENT_ID') ?? '',
      clientSecret: Deno.env.get('PLUGGY_CLIENT_SECRET') ?? '',
    }),
  })
  const b = (await res.json().catch(() => ({}))) as { apiKey?: string; message?: string }
  if (!res.ok || !b.apiKey) throw new Error(`pluggy_auth_failed: ${b.message ?? res.status}`)
  return b.apiKey
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

type Acc = { id: string; tenant_id: string; of_account_id: string; of_last_sync_at: string | null }
type PluggyTxn = { id: string; description?: string; amount?: number; date?: string; type?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('OPENFINANCE_CRON_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  if (cronSecret && provided !== cronSecret) return json({ error: 'unauthorized' }, 401)
  if (!url || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  const admin = createClient(url, serviceRole)

  // BACKFILL. O sync normal é incremental: parte de `of_last_sync_at` e nunca volta atrás.
  // Isso está certo pro dia a dia e errado quando falta histórico — o extrato da clínica só
  // existe de 12/mai/2026 pra frente, e o relatório de vendas do Shosp vem com um ano inteiro,
  // então tudo antes disso aparecia como venda que "não caiu no banco". Com `?from=YYYY-MM-DD`
  // (ou `{ from }` no corpo) dá pra pedir o período antigo de novo. O upsert por external_id
  // cuida da duplicata, então repetir é seguro; o que o Pluggy não tiver, ele não devolve.
  const body = (await req.json().catch(() => ({}))) as { from?: string; accountId?: string }
  const qs = new URL(req.url).searchParams
  const backfillFrom = (body.from ?? qs.get('from') ?? '').trim()
  const soConta = (body.accountId ?? qs.get('accountId') ?? '').trim()
  if (backfillFrom && !/^\d{4}-\d{2}-\d{2}$/.test(backfillFrom)) {
    return json({ error: 'from_invalido', message: 'use from=YYYY-MM-DD' }, 400)
  }

  let query = admin
    .from('fin_accounts')
    .select('id, tenant_id, of_account_id, of_last_sync_at')
    .eq('of_provider', 'pluggy')
    .not('of_account_id', 'is', null)
  if (soConta) query = query.eq('id', soConta)
  const { data: accsRaw, error } = await query
  if (error) return json({ error: 'query_failed', message: error.message }, 500)
  const accs = (accsRaw ?? []) as Acc[]
  if (accs.length === 0) return json({ ok: true, accounts: 0, inserted: 0, note: 'nenhuma conta Open Finance ligada' })

  let apiKey: string
  try {
    apiKey = await pluggyAuth()
  } catch (e) {
    return json({ error: 'pluggy_auth', message: e instanceof Error ? e.message : String(e) }, 502)
  }

  let inserted = 0
  const results: Array<Record<string, unknown>> = []
  for (const acc of accs) {
    try {
      const fromDate = acc.of_last_sync_at
        ? new Date(new Date(acc.of_last_sync_at).getTime() - 3 * 86400_000)
        : new Date(Date.now() - 180 * 86400_000)
      // Backfill pedido na mão ganha do incremental — é justamente para voltar atrás.
      const from = backfillFrom || dayStr(fromDate)

      const rows: Record<string, unknown>[] = []
      let page = 1
      let totalPages = 1
      do {
        const res = await fetch(`${PLUGGY}/transactions?accountId=${acc.of_account_id}&from=${from}&pageSize=500&page=${page}`, {
          headers: { 'X-API-KEY': apiKey },
        })
        const data = (await res.json().catch(() => ({}))) as { results?: PluggyTxn[]; totalPages?: number }
        if (!res.ok) throw new Error(`transactions ${res.status}`)
        totalPages = Number(data.totalPages ?? 1)
        for (const t of data.results ?? []) {
          const amt = Number(t.amount ?? 0)
          const isCredit = t.type ? t.type === 'CREDIT' : amt >= 0
          const magnitude = Math.abs(Math.round(amt * 100))
          if (magnitude === 0) continue
          rows.push({
            tenant_id: acc.tenant_id,
            account_id: acc.id,
            date: String(t.date ?? '').slice(0, 10) || from,
            amount_cents: isCredit ? magnitude : -magnitude,
            direction: isCredit ? 'in' : 'out',
            description: t.description ?? 'Lançamento',
            counterparty: t.description ?? null,
            source: 'openfinance',
            external_id: t.id,
          })
        }
        page += 1
      } while (page <= totalPages && page <= 20)

      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        const { data: ins, error: insErr } = await admin
          .from('fin_transactions')
          .upsert(chunk, { onConflict: 'tenant_id,account_id,external_id', ignoreDuplicates: true })
          .select('id')
        if (insErr) throw insErr
        inserted += (ins ?? []).length
      }
      await admin.from('fin_accounts').update({ of_last_sync_at: new Date().toISOString() }).eq('id', acc.id)
      results.push({
        account: acc.id,
        tenant: acc.tenant_id,
        from,
        rows: rows.length,
        // O laço para em 20 páginas × 500. Num backfill longo isso pode cortar o começo do
        // período — e extrato cortado vira "venda que não caiu no banco". Melhor dizer.
        ...(totalPages > 20 ? { truncado: true, paginas: totalPages } : {}),
      })
    } catch (e) {
      results.push({ account: acc.id, ok: false, note: e instanceof Error ? e.message : String(e) })
    }
  }

  return json({ ok: true, accounts: accs.length, inserted, backfillFrom: backfillFrom || null, results })
})
