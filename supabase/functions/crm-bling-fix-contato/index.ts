import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { getValidBlingToken } from '../_shared/bling.ts'

// Rede de segurança: varre as vendas pagas recentes e, se o pedido no Bling caiu no contato
// GENÉRICO ("Cliente Loja Tricopill (site)"), cria/acha o contato REAL do cliente (por CPF/
// telefone, com cadastro+endereço do lead) e troca no pedido. Cobre as falhas transitórias
// (rate-limit do Bling) que escapam do create inline no fechamento. Idempotente.
// Auth: pg_cron com anon Bearer.

const TENANT_ID = 'tricopill'
const BLING_API = 'https://api.bling.com.br/Api/v3'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
function json(b: Record<string, unknown>, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } }) }
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
function ddmmaaaaToYmd(s: string): string { const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '' }

async function bfetch(token: string, path: string, init?: RequestInit, attempts = 4): Promise<Response> {
  let res = await fetch(BLING_API + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) } })
  for (let i = 1; i < attempts && (res.status === 429 || res.status >= 500); i++) {
    const ra = Number(res.headers.get('retry-after') ?? ''); const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : 700 * 2 ** (i - 1)
    await new Promise((r) => setTimeout(r, wait))
    res = await fetch(BLING_API + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) } })
  }
  return res
}
async function viacep(cep: string): Promise<Record<string, unknown>> { try { const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`); return r.ok ? await r.json() : {} } catch { return {} } }

async function findOrCreateContato(token: string, a: { nome: string; cpf?: string; phone?: string; email?: string; nasc?: string; ent: Record<string, unknown> }): Promise<string | null> {
  const nome = a.nome.trim().slice(0, 120); if (!nome) return null
  const cpf = digits(a.cpf); const phone = digits(a.phone); const tail8 = phone.length >= 8 ? phone.slice(-8) : ''
  for (const term of [cpf.length === 11 ? cpf : '', tail8 ? phone.slice(-11) : ''].filter(Boolean)) {
    try { const r = await bfetch(token, `/contatos?pesquisa=${encodeURIComponent(term)}&limite=20`); if (r.ok) { const d = (JSON.parse((await r.text()) || '{}')?.data ?? []) as Array<Record<string, unknown>>; const hit = d.find((c) => { const doc = digits(c.numeroDocumento); const t = digits(c.telefone), cel = digits(c.celular); return (cpf.length === 11 && doc === cpf) || (!!tail8 && (t.endsWith(tail8) || cel.endsWith(tail8))) }); if (hit?.id != null) return String(hit.id) } } catch { /* segue */ }
  }
  let tel = phone
  if (tel.length >= 12 && tel.startsWith('55')) tel = tel.slice(2) // tira DDI 55 (senão Bling recusa o fone)
  const base: Record<string, unknown> = { nome, tipo: 'F', situacao: 'A' }; if (tel.length >= 10) { base.telefone = tel; if (tel.length === 11) base.celular = tel }
  const withDoc: Record<string, unknown> = { ...base }; if (cpf.length === 11) withDoc.numeroDocumento = cpf; if (a.email) withDoc.email = String(a.email).slice(0, 120)
  const e = a.ent || {}; const cep = digits(e.cep); const withEnd: Record<string, unknown> = { ...withDoc }
  if (cep.length === 8 && e.logradouro) { const v = (!e.cidade || !e.uf) ? await viacep(cep) : {}; withEnd.endereco = { geral: { endereco: String(e.logradouro).slice(0, 90), numero: String(e.numero ?? 'S/N').slice(0, 20), complemento: String(e.complemento ?? '').slice(0, 60), bairro: String(e.bairro ?? (v as Record<string, unknown>).bairro ?? '').slice(0, 60), cep, municipio: String(e.cidade ?? (v as Record<string, unknown>).localidade ?? '').slice(0, 60), uf: String(e.uf ?? (v as Record<string, unknown>).uf ?? '').toUpperCase().slice(0, 2) } } }
  const nasc = ddmmaaaaToYmd(a.nasc ?? ''); const full: Record<string, unknown> = nasc ? { ...withEnd, dadosAdicionais: { dataNascimento: nasc } } : { ...withEnd }
  const minimal: Record<string, unknown> = { nome, tipo: 'F', situacao: 'A' }; if (cpf.length === 11) minimal.numeroDocumento = cpf // fallback sem telefone
  const seen = new Set<string>(); const bodies = [full, withEnd, withDoc, base, minimal].map((b) => JSON.stringify(b)).filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
  for (const body of bodies) { try { const r = await bfetch(token, '/contatos', { method: 'POST', body }); if (r.ok) { const id = (JSON.parse((await r.text()) || '{}')?.data as { id?: unknown })?.id; if (id != null) return String(id) } } catch { /* tenta próximo */ } }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL') ?? ''; const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !sr) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, sr)

  const { data: ti } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', TENANT_ID).maybeSingle()
  const cfg = ((ti as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  const genericId = cfg.default_contato_id != null ? String(cfg.default_contato_id).trim() : ''
  const token = await getValidBlingToken(admin, TENANT_ID)
  if (!token || !genericId) return json({ ok: false, error: 'bling_indisponivel' })

  const cutoff = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString()
  const { data: pays } = await admin.from('rede_payments')
    .select('id, bling_order_id, customer_name, customer_doc, phone, lead_id')
    .eq('tenant_id', TENANT_ID).eq('status', 'paid').not('bling_order_id', 'is', null)
    .gte('created_at', cutoff).order('created_at', { ascending: false }).limit(60)

  let checked = 0, fixed = 0; const errors: Array<{ order: string; error: string }> = []
  for (const p of (pays ?? []) as Array<Record<string, unknown>>) {
    const orderId = String(p.bling_order_id ?? ''); if (!orderId) continue
    checked += 1
    try {
      const gr = await bfetch(token, `/pedidos/vendas/${orderId}`); if (!gr.ok) continue
      const o = (JSON.parse((await gr.text()) || '{}')?.data ?? {}) as Record<string, unknown>
      const cont = (o.contato ?? {}) as Record<string, unknown>
      if (String(cont.id ?? '') !== genericId) continue // já está num contato real
      // cadastro/entrega do lead
      let cad: Record<string, unknown> = {}; let ent: Record<string, unknown> = {}
      if (p.lead_id) { const { data: l } = await admin.from('leads').select('custom_fields').eq('id', String(p.lead_id)).maybeSingle(); const cf = ((l as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>; cad = (cf.cadastro as Record<string, unknown>) ?? {}; ent = (cf.entrega as Record<string, unknown>) ?? {} }
      const nome = String(cad.nomeCompleto ?? p.customer_name ?? '').trim()
      if (!nome) continue // sem nome não dá pra criar contato real (caso "Luciano")
      const realId = await findOrCreateContato(token, { nome, cpf: String(p.customer_doc ?? cad.cpf ?? ''), phone: String(p.phone ?? cad.telefone ?? ''), email: cad.email ? String(cad.email) : undefined, nasc: cad.dataNascimento ? String(cad.dataNascimento) : undefined, ent })
      if (!realId || realId === genericId) continue
      const itens = (Array.isArray(o.itens) ? o.itens : []).map((i: Record<string, unknown>) => ({ produto: { id: ((i.produto ?? {}) as Record<string, unknown>).id }, descricao: i.descricao, quantidade: i.quantidade, valor: i.valor }))
      const payload: Record<string, unknown> = { contato: { id: Number(realId) || realId }, data: o.data, itens }
      if (o.observacoes) payload.observacoes = o.observacoes
      const tr = (o.transporte ?? {}) as Record<string, unknown>
      if (Number(tr.frete) > 0) payload.transporte = { frete: tr.frete, fretePorConta: tr.fretePorConta ?? 1 }
      const pr = await bfetch(token, `/pedidos/vendas/${orderId}`, { method: 'PUT', body: JSON.stringify(payload) })
      if (pr.ok) fixed += 1
      else errors.push({ order: orderId, error: `put_${pr.status}` })
    } catch (e) { errors.push({ order: orderId, error: e instanceof Error ? e.message : String(e) }) }
  }
  return json({ ok: true, checked, fixed, errors })
})
