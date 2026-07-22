import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// ─────────────────────────────────────────────────────────────────────────────
// Open Finance (Pluggy) — conciliação bancária AUTOMÁTICA da clínica.
//   connect_token → o app abre o widget do Pluggy (o cliente loga no banco DENTRO
//                   do Pluggy; a gente nunca vê a senha do banco).
//   link          → dado o itemId (conexão) que o widget devolveu, grava as contas
//                   do banco como fin_accounts do tenant e faz o 1º sync.
//   sync          → puxa as transações das contas ligadas pro razão de caixa
//                   (fin_transactions, source 'openfinance', dedup por id do Pluggy).
//
// Segurança: as credenciais Pluggy vivem em secrets (PLUGGY_CLIENT_ID/SECRET). Escritas
// no banco usam o JWT do usuário (RLS → tenant automático), então cada clínica só mexe
// no que é dela. verify_jwt=true (default): só usuário logado chama.
// ─────────────────────────────────────────────────────────────────────────────

const PLUGGY = 'https://api.pluggy.ai'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function pluggyAuth(): Promise<string> {
  const clientId = Deno.env.get('PLUGGY_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET') ?? ''
  const res = await fetch(`${PLUGGY}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  })
  const b = (await res.json().catch(() => ({}))) as { apiKey?: string; message?: string }
  if (!res.ok || !b.apiKey) throw new Error(`pluggy_auth_failed: ${b.message ?? res.status}`)
  return b.apiKey
}

async function pluggyGet(apiKey: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${PLUGGY}${path}`, { headers: { 'X-API-KEY': apiKey } })
  const b = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`pluggy_get_failed ${path}: ${(b.message as string) ?? res.status}`)
  return b
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

type PluggyAccount = {
  id: string
  type?: string
  subtype?: string
  name?: string
  marketingName?: string
  number?: string
  balance?: number
}
type PluggyTxn = { id: string; description?: string; amount?: number; date?: string; type?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!url || !anon) return json({ error: 'server_misconfigured' }, 500)
  if (!authHeader) return json({ error: 'unauthorized' }, 401)

  // Cliente com o JWT do usuário → todas as escritas respeitam RLS (tenant automático).
  const db = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })

  let payload: { action?: string; itemId?: string } = {}
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
  const action = payload.action ?? ''

  try {
    // ── connect_token: token efêmero pro widget do Pluggy no front ────────────
    if (action === 'connect_token') {
      const apiKey = await pluggyAuth()
      const res = await fetch(`${PLUGGY}/connect_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify(payload.itemId ? { itemId: payload.itemId } : {}),
      })
      const b = (await res.json().catch(() => ({}))) as { accessToken?: string; message?: string }
      if (!res.ok || !b.accessToken) throw new Error(`connect_token_failed: ${b.message ?? res.status}`)
      return json({ token: b.accessToken })
    }

    // ── link: grava as contas do item como fin_accounts e faz o 1º sync ───────
    if (action === 'link') {
      const itemId = payload.itemId
      if (!itemId) return json({ error: 'missing_itemId' }, 400)
      const apiKey = await pluggyAuth()

      // nome do banco (connector) pra rotular a conta
      let bankName = 'Open Finance'
      try {
        const item = await pluggyGet(apiKey, `/items/${itemId}`)
        const connector = item.connector as { name?: string } | undefined
        if (connector?.name) bankName = connector.name
      } catch {
        // segue sem o nome bonito
      }

      const accData = await pluggyGet(apiKey, `/accounts?itemId=${itemId}`)
      const accounts = (accData.results ?? []) as PluggyAccount[]
      let linked = 0
      for (const a of accounts) {
        const kind = a.type === 'CREDIT' ? 'carteira' : 'banco'
        const label = a.marketingName || a.name || `${bankName}`
        const { data: existing } = await db.from('fin_accounts').select('id').eq('of_account_id', a.id).maybeSingle()
        if (existing) {
          await db
            .from('fin_accounts')
            .update({ of_provider: 'pluggy', of_item_id: itemId, bank_name: bankName, active: true, updated_at: new Date().toISOString() })
            .eq('id', (existing as { id: string }).id)
        } else {
          await db.from('fin_accounts').insert({
            name: `${bankName} · ${label}`.slice(0, 120),
            kind,
            bank_name: bankName,
            number: a.number ?? null,
            of_provider: 'pluggy',
            of_item_id: itemId,
            of_account_id: a.id,
          })
        }
        linked += 1
      }

      const synced = await syncTransactions(db, apiKey, itemId)
      return json({ ok: true, bankName, accountsLinked: linked, ...synced })
    }

    // ── sync: puxa transações das contas ligadas (todas ou de um item) ────────
    if (action === 'sync') {
      const apiKey = await pluggyAuth()
      const synced = await syncTransactions(db, apiKey, payload.itemId ?? null)
      return json({ ok: true, ...synced })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    return json({ error: 'failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// Puxa transações de todas as fin_accounts ligadas (RLS já limita ao tenant do usuário) e
// grava no razão de caixa com dedup. Retorna contagem por conta.
async function syncTransactions(
  db: ReturnType<typeof createClient>,
  apiKey: string,
  itemId: string | null,
): Promise<{ inserted: number; accounts: number }> {
  let query = db
    .from('fin_accounts')
    .select('id, of_account_id, of_last_sync_at')
    .eq('of_provider', 'pluggy')
    .not('of_account_id', 'is', null)
  if (itemId) query = query.eq('of_item_id', itemId)
  const { data: accounts, error } = await query
  if (error) throw new Error(error.message)

  let inserted = 0
  for (const acc of (accounts ?? []) as Array<{ id: string; of_account_id: string; of_last_sync_at: string | null }>) {
    // janela: do último sync (com 3 dias de folga) ou 180 dias atrás
    const fromDate = acc.of_last_sync_at
      ? new Date(new Date(acc.of_last_sync_at).getTime() - 3 * 86400_000)
      : new Date(Date.now() - 180 * 86400_000)
    const from = dayStr(fromDate)

    const rows: Record<string, unknown>[] = []
    let page = 1
    let totalPages = 1
    do {
      const data = await pluggyGet(apiKey, `/transactions?accountId=${acc.of_account_id}&from=${from}&pageSize=500&page=${page}`)
      const results = (data.results ?? []) as PluggyTxn[]
      totalPages = Number(data.totalPages ?? 1)
      for (const t of results) {
        const amt = Number(t.amount ?? 0)
        const isCredit = t.type ? t.type === 'CREDIT' : amt >= 0
        const magnitude = Math.abs(Math.round(amt * 100))
        if (magnitude === 0) continue
        rows.push({
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
      const { data: ins, error: insErr } = await db
        .from('fin_transactions')
        .upsert(chunk, { onConflict: 'tenant_id,account_id,external_id', ignoreDuplicates: true })
        .select('id')
      if (insErr) throw new Error(insErr.message)
      inserted += (ins ?? []).length
    }
    await db.from('fin_accounts').update({ of_last_sync_at: new Date().toISOString() }).eq('id', acc.id)
  }
  return { inserted, accounts: (accounts ?? []).length }
}
