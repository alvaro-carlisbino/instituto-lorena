import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { getValidBlingToken } from '../_shared/bling.ts'

// Ferramenta ADMIN (one-off) para atualizar preços de venda no Bling em lote, a
// partir de uma lista {nome, preco}. Protegida por header x-bulk-secret.
//   dryRun:true  -> só casa por nome e devolve o de-para (NÃO grava)
//   dryRun:false -> grava o preço novo (GET produto + PUT preco) nos casados
// Casamento por nome normalizado (sem acento/pontuação). Bling v3.

const BLING_API = 'https://api.bling.com.br/Api/v3'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-bulk-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function norm(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const secret = (Deno.env.get('BLING_BULK_SECRET') ?? '').trim()
  if (!secret || req.headers.get('x-bulk-secret') !== secret) return json({ error: 'forbidden' }, 403)

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  let body: { tenantId?: string; products?: Array<{ nome: string; preco: number }>; dryRun?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const tenantId = String(body.tenantId ?? 'tricopill')
  const products = Array.isArray(body.products) ? body.products : []
  const dryRun = body.dryRun !== false
  if (!products.length) return json({ error: 'no_products' }, 400)

  const token = await getValidBlingToken(admin, tenantId)
  if (!token) return json({ error: 'bling_no_token' }, 400)
  const auth = { Authorization: `Bearer ${token}` }

  // 1) Busca TODOS os produtos do Bling (paginado).
  const blingProds: Array<{ id: string; nome: string; codigo: string; preco: number }> = []
  for (let pagina = 1; pagina <= 30; pagina++) {
    const res = await fetch(`${BLING_API}/produtos?pagina=${pagina}&limite=100`, { headers: auth })
    if (!res.ok) {
      if (pagina === 1) return json({ error: 'bling_list_failed', status: res.status, body: (await res.text()).slice(0, 300) }, 502)
      break
    }
    const data = (await res.json())?.data as Array<Record<string, unknown>> | undefined
    if (!data || data.length === 0) break
    for (const p of data) {
      blingProds.push({
        id: String(p.id ?? ''),
        nome: String(p.nome ?? ''),
        codigo: String(p.codigo ?? ''),
        preco: Number(p.preco ?? 0),
      })
    }
    if (data.length < 100) break
    await sleep(350) // respeita rate limit do Bling (3 req/s)
  }

  // 2) Indexa por nome normalizado.
  const byNorm = new Map<string, typeof blingProds>()
  for (const bp of blingProds) {
    const k = norm(bp.nome)
    const arr = byNorm.get(k) ?? []
    arr.push(bp)
    byNorm.set(k, arr)
  }

  const matched: Array<Record<string, unknown>> = []
  const ambiguous: Array<Record<string, unknown>> = []
  const unmatched: string[] = []

  for (const inp of products) {
    const k = norm(inp.nome)
    let cands = byNorm.get(k) ?? []
    // fallback: contém (planilha dentro do nome do bling ou vice-versa)
    if (cands.length === 0) {
      cands = blingProds.filter((bp) => {
        const bn = norm(bp.nome)
        return bn === k || bn.includes(k) || k.includes(bn)
      })
    }
    if (cands.length === 1) {
      matched.push({ nome: inp.nome, preco_novo: inp.preco, bling_id: cands[0].id, bling_nome: cands[0].nome, bling_codigo: cands[0].codigo, preco_atual: cands[0].preco })
    } else if (cands.length > 1) {
      ambiguous.push({ nome: inp.nome, preco_novo: inp.preco, opcoes: cands.map((c) => ({ id: c.id, nome: c.nome, preco: c.preco })) })
    } else {
      unmatched.push(inp.nome)
    }
  }

  if (dryRun) {
    return json({ ok: true, dryRun: true, total_bling: blingProds.length, matched, ambiguous, unmatched })
  }

  // 3) Commit: atualiza o preço dos casados (GET produto completo + PUT com preco novo).
  const updated: Array<Record<string, unknown>> = []
  const failed: Array<Record<string, unknown>> = []
  for (const m of matched) {
    const id = String(m.bling_id)
    try {
      const gres = await fetch(`${BLING_API}/produtos/${id}`, { headers: auth })
      if (!gres.ok) { failed.push({ id, nome: m.nome, step: 'get', status: gres.status }); await sleep(350); continue }
      const full = (await gres.json())?.data as Record<string, unknown>
      full.preco = Number(m.preco_novo)
      const pres = await fetch(`${BLING_API}/produtos/${id}`, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(full),
      })
      if (pres.ok) updated.push({ id, nome: m.nome, preco_novo: m.preco_novo })
      else failed.push({ id, nome: m.nome, step: 'put', status: pres.status, body: (await pres.text()).slice(0, 200) })
    } catch (e) {
      failed.push({ id, nome: m.nome, step: 'exception', error: e instanceof Error ? e.message : String(e) })
    }
    await sleep(400) // rate limit
  }
  return json({ ok: true, dryRun: false, updated_count: updated.length, failed_count: failed.length, updated, failed, ambiguous, unmatched })
})
