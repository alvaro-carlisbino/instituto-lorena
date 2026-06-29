import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Catálogo de produtos cadastrados no Bling (cache em tenant_integrations.bling.catalog_cache),
// servido autenticado para o carrinho da venda manual. Produtos do Tricopill vivem no tenant
// 'tricopill'; se o tenant do operador não tiver catálogo, cai no 'tricopill'.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }
function json(b: Record<string, unknown>, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } }) }

type CatalogItem = { id: string; nome: string; preco: number; codigo?: string; imagem?: string; estoque?: number }

async function readCatalog(admin: ReturnType<typeof createClient>, tenantId: string): Promise<CatalogItem[]> {
  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const cc = ((data as { bling?: { catalog_cache?: unknown } } | null)?.bling?.catalog_cache)
  return Array.isArray(cc) ? (cc as CatalogItem[]) : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL') ?? ''; const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !sr) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, sr)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: uErr } = await userClient.auth.getUser()
  if (uErr || !user) return json({ error: 'unauthorized' }, 401)
  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  let items = await readCatalog(admin, tenantId)
  if (!items.length && tenantId !== 'tricopill') items = await readCatalog(admin, 'tricopill')

  // Só produtos cadastrados (com id + nome). Ordena por nome.
  const produtos = items
    .filter((p) => p && p.id && p.nome)
    .map((p) => ({ id: String(p.id), nome: String(p.nome), precoCents: Math.round(Number(p.preco ?? 0) * 100), imagem: p.imagem ? String(p.imagem) : null, estoque: Number(p.estoque ?? 0) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  return json({ ok: true, produtos })
})
