import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Open Finance via Banco MCP (api.mcp.ai/api/openfinance) — alternativa/complemento ao Pluggy.
// Lê BANCOMCP_ACCESS_TOKEN (JWT agent-auth) ou BANCOMCP_TOKEN (sk_live).
// Actions: status | link | sync

const OF = 'https://api.mcp.ai/api/openfinance'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function bearer(): string {
  const access = (Deno.env.get('BANCOMCP_ACCESS_TOKEN') ?? '').trim()
  const sk = (Deno.env.get('BANCOMCP_TOKEN') ?? '').trim()
  return access || sk
}

async function ofPost(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const token = bearer()
  if (!token) throw new Error('BANCOMCP_ACCESS_TOKEN/BANCOMCP_TOKEN ausente')
  const res = await fetch(`${OF}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || data.ok === false) {
    const msg =
      (data as { error?: string; message?: string }).message ||
      (data as { error?: string }).error ||
      `http_${res.status}`
    throw new Error(String(msg))
  }
  return (data.result as Record<string, unknown>) ?? data
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

type OfAccount = {
  id?: string
  account_id?: string
  name?: string
  marketingName?: string
  number?: string
  type?: string
  balance?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('OPENFINANCE_CRON_SECRET') ?? '').trim()
  const providedCron = (req.headers.get('x-cron-secret') ?? '').trim()
  const isCron = Boolean(cronSecret && providedCron === cronSecret)

  let payload: { action?: string; item?: string; tenant_id?: string; from?: string } = {}
  try {
    payload = await req.json()
  } catch {
    // ok
  }
  const action = payload.action ?? 'status'

  try {
    if (action === 'status') {
      const connections = await ofPost('/connections/list')
      const item = payload.item
      let accounts: Record<string, unknown> | null = null
      let status: Record<string, unknown> | null = null
      try {
        accounts = await ofPost('/accounts/list', item ? { item } : {})
      } catch (e) {
        accounts = { error: e instanceof Error ? e.message : String(e) }
      }
      try {
        status = await ofPost('/connections/status', item ? { item } : {})
      } catch (e) {
        status = { error: e instanceof Error ? e.message : String(e) }
      }
      return json({ ok: true, connections, accounts, status })
    }

    // link + sync precisam de JWT de usuário (RLS) OU cron+service_role+tenant_id
    if (!url) return json({ error: 'server_misconfigured' }, 500)

    if (action === 'link' || action === 'sync') {
      const authHeader = req.headers.get('Authorization') ?? ''
      let db
      let tenantId: string | null = payload.tenant_id ?? null

      if (isCron) {
        if (!serviceRole) return json({ error: 'server_misconfigured' }, 500)
        db = createClient(url, serviceRole)
        if (!tenantId) tenantId = 'instituto-lorena'
      } else {
        if (!anon || !authHeader) return json({ error: 'unauthorized' }, 401)
        db = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
      }

      if (action === 'link') {
        const item = payload.item
        const connections = await ofPost('/connections/list')
        const list = (connections.connections as Array<Record<string, unknown>>) ?? []
        const conn =
          (item
            ? list.find(
                (c) =>
                  String(c.item_id) === item ||
                  String(c.connector_id) === item ||
                  String(c.connector_name).toLowerCase() === item.toLowerCase(),
              )
            : list[0]) ?? null
        if (!conn) return json({ error: 'no_connection', message: 'Nenhuma conexão Open Finance no Banco MCP.' }, 404)

        const itemId = String(conn.item_id)
        const bankName = String(conn.connector_name ?? 'Open Finance')
        const accountsRes = await ofPost('/accounts/list', { item: itemId })
        const results = (accountsRes.results as OfAccount[]) ?? []
        const notice = accountsRes.notice ? String(accountsRes.notice) : null

        if (results.length === 0) {
          return json({
            ok: false,
            bankName,
            itemId,
            accountsLinked: 0,
            inserted: 0,
            notice:
              notice ??
              'Conexão ativa, mas sem contas compartilhadas. Autorize as contas no app do banco (Open Finance / múltipla alçada) ou reconecte selecionando as contas.',
            reconnectUrl: conn.reconnect_url ?? null,
            addConnectionUrl: connections.add_connection_url ?? null,
          })
        }

        let linked = 0
        for (const a of results) {
          const ofAccountId = String(a.id ?? a.account_id ?? '')
          if (!ofAccountId) continue
          const kind = String(a.type ?? '').toUpperCase().includes('CREDIT') ? 'carteira' : 'banco'
          const label = a.marketingName || a.name || bankName
          const row = {
            name: `${bankName} · ${label}`.slice(0, 120),
            kind,
            bank_name: bankName,
            number: a.number ?? null,
            of_provider: 'mcp_ai',
            of_item_id: itemId,
            of_account_id: ofAccountId,
            active: true,
            updated_at: new Date().toISOString(),
            ...(tenantId && isCron ? { tenant_id: tenantId } : {}),
          }
          const { data: existing } = await db
            .from('fin_accounts')
            .select('id')
            .eq('of_account_id', ofAccountId)
            .maybeSingle()
          if (existing) {
            await db.from('fin_accounts').update(row).eq('id', (existing as { id: string }).id)
          } else {
            await db.from('fin_accounts').insert(row)
          }
          linked += 1
        }

        const synced = await syncMcpAccounts(db, itemId, payload.from ?? null, tenantId, isCron)
        return json({ ok: true, bankName, itemId, accountsLinked: linked, ...synced })
      }

      // sync
      const synced = await syncMcpAccounts(db, payload.item ?? null, payload.from ?? null, tenantId, isCron)
      return json({ ok: true, ...synced })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    return json({ error: 'failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})

async function syncMcpAccounts(
  db: ReturnType<typeof createClient>,
  itemId: string | null,
  fromOverride: string | null,
  tenantId: string | null,
  isCron: boolean,
): Promise<{ inserted: number; accounts: number; results: Array<Record<string, unknown>> }> {
  let query = db
    .from('fin_accounts')
    .select('id, tenant_id, of_account_id, of_item_id, of_last_sync_at')
    .eq('of_provider', 'mcp_ai')
    .not('of_account_id', 'is', null)
  if (itemId) query = query.eq('of_item_id', itemId)
  if (isCron && tenantId) query = query.eq('tenant_id', tenantId)
  const { data: accs, error } = await query
  if (error) throw new Error(error.message)

  let inserted = 0
  const results: Array<Record<string, unknown>> = []

  for (const acc of (accs ?? []) as Array<{
    id: string
    tenant_id: string
    of_account_id: string
    of_last_sync_at: string | null
  }>) {
    try {
      const fromDate = fromOverride
        ? new Date(`${fromOverride}T00:00:00Z`)
        : acc.of_last_sync_at
          ? new Date(new Date(acc.of_last_sync_at).getTime() - 3 * 86400_000)
          : new Date(Date.now() - 90 * 86400_000)
      const from = dayStr(fromDate)
      const to = dayStr(new Date())

      const rows: Record<string, unknown>[] = []
      let page = 1
      let totalPages = 1
      do {
        const pageRes = await ofPost('/transactions/list', {
          account_id: acc.of_account_id,
          from,
          to,
          page,
          page_size: 200,
        })
        const list = (pageRes.results as Array<Record<string, unknown>>) ??
          (pageRes.transactions as Array<Record<string, unknown>>) ??
          []
        totalPages = Number(pageRes.total_pages ?? pageRes.totalPages ?? 1)
        for (const t of list) {
          const id = String(t.id ?? t.transaction_id ?? '')
          if (!id) continue
          const amtRaw = Number(
            (t.amount as number | undefined) ??
              (t.transactionAmount as { amount?: string } | undefined)?.amount ??
              0,
          )
          const type = String(t.type ?? t.creditDebitType ?? '').toUpperCase()
          const isCredit =
            type.includes('CREDIT') || type.includes('CREDITO') || (!type && amtRaw >= 0)
          const magnitude = Math.abs(Math.round(amtRaw * 100))
          if (magnitude === 0) continue
          const date = String(t.date ?? t.transactionDateTime ?? '').slice(0, 10) || from
          rows.push({
            tenant_id: acc.tenant_id,
            account_id: acc.id,
            date,
            amount_cents: isCredit ? magnitude : -magnitude,
            direction: isCredit ? 'in' : 'out',
            description: String(t.description ?? t.transactionName ?? 'Lançamento'),
            counterparty: (t.counterparty as string | null) ?? (t.description as string | null) ?? null,
            source: 'openfinance',
            external_id: id,
          })
        }
        page += 1
      } while (page <= totalPages && page <= 30)

      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        const { data: ins, error: insErr } = await db
          .from('fin_transactions')
          .upsert(chunk, { onConflict: 'tenant_id,account_id,external_id', ignoreDuplicates: true })
          .select('id')
        if (insErr) throw insErr
        inserted += (ins ?? []).length
      }
      await db.from('fin_accounts').update({ of_last_sync_at: new Date().toISOString() }).eq('id', acc.id)
      results.push({ account: acc.id, rows: rows.length })
    } catch (e) {
      results.push({ account: acc.id, ok: false, note: e instanceof Error ? e.message : String(e) })
    }
  }

  return { inserted, accounts: (accs ?? []).length, results }
}
