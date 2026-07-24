// Sonda de diagnóstico do banco.mcp (MCP via Streamable HTTP, NÃO é REST).
// Handshake JSON-RPC: initialize → notifications/initialized → tools/list, e opcional tools/call.
// Lê BANCOMCP_TOKEN do secret (nunca sai daqui). Descartável.
//
// Corpo (POST, tudo opcional):
//   {"url":"https://api.mcp.ai/banco"}                         → mira nessa URL
//   {"call":{"name":"list_accounts","arguments":{}}}          → chama uma tool
//   {"discover":true}                                         → varre caminhos comuns

const DEFAULT_URL = Deno.env.get('BANCOMCP_URL') ?? 'https://api.mcp.ai/banco'
const TOKEN = Deno.env.get('BANCOMCP_TOKEN') ?? ''
// Access token do login no navegador (app.mcp.ai/agent-auth). Sem ele, só initialize/tools/list;
// as tools de dado bancário respondem "authenticate first".
const ACCESS = Deno.env.get('BANCOMCP_ACCESS_TOKEN') ?? ''
const PROTO = '2025-06-18'
const CANDIDATE_PATHS = ['/banco', '/mcp', '/sse', '/api/mcp', '/message', '/messages', '/v1/mcp', '/rpc', '/']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// A resposta do Streamable HTTP pode vir como JSON puro OU como SSE (text/event-stream).
async function readMcp(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? ''
  const text = await res.text()
  if (ct.includes('text/event-stream')) {
    const events: unknown[] = []
    for (const line of text.split('\n')) {
      const l = line.trim()
      if (l.startsWith('data:')) {
        const payload = l.slice(5).trim()
        if (payload && payload !== '[DONE]') {
          try {
            events.push(JSON.parse(payload))
          } catch {
            events.push({ unparsed: payload })
          }
        }
      }
    }
    return events.length === 1 ? events[0] : events
  }
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 400) }
  }
}

function looksMcp(ct: string | null, body: unknown): boolean {
  const c = ct ?? ''
  if (c.includes('text/html')) return false
  if (c.includes('event-stream')) return true
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>
    if ('jsonrpc' in b || 'result' in b || 'error' in b) return true
  }
  return false
}

async function rpc(
  url: string,
  method: string,
  params: Record<string, unknown>,
  sessionId: string | null,
  id: number | null,
  bearer: string = TOKEN,
): Promise<{ status: number; sessionId: string | null; contentType: string | null; body: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${bearer}`,
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  if (method !== 'initialize') headers['MCP-Protocol-Version'] = PROTO
  const payload =
    id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id'),
    contentType: res.headers.get('content-type'),
    body: await readMcp(res),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const diag: Record<string, unknown> = { tokenPresent: !!TOKEN, tokenLen: TOKEN.length }
  if (!TOKEN) {
    diag.error = 'BANCOMCP_TOKEN ausente no ambiente da função'
    return json(diag, 500)
  }

  let opts: {
    discover?: boolean
    url?: string
    authToken?: string
    bearer?: 'access' | 'sk_live'
    call?: { name?: string; arguments?: Record<string, unknown> }
    rest?: { path: string; body?: Record<string, unknown>; bearer?: 'access' | 'sk_live' }
  } = {}
  try {
    opts = (await req.json()) ?? {}
  } catch {
    // sem corpo
  }

  // Modo REST: bate direto na API REST (api.mcp.ai/api/openfinance) — sem MCP/SSE, só POST + JSON.
  // É o caminho pra produção (fetch puro, igual ao código atual do Pluggy).
  if (opts.rest?.path) {
    const base = 'https://api.mcp.ai/api/openfinance'
    const which = opts.rest.bearer === 'access' ? ACCESS : TOKEN
    try {
      const res = await fetch(base + opts.rest.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${which}` },
        body: JSON.stringify(opts.rest.body ?? {}),
      })
      const text = await res.text()
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        body = { raw: text.slice(0, 500) }
      }
      diag.rest = { path: opts.rest.path, bearer: opts.rest.bearer ?? 'sk_live', status: res.status, contentType: res.headers.get('content-type'), body }
    } catch (e) {
      diag.rest = { path: opts.rest.path, error: e instanceof Error ? e.message : String(e) }
    }
    return json(diag)
  }

  // Modo descoberta: acha em qual caminho vive o endpoint MCP.
  if (opts.discover) {
    const origin = new URL(opts.url || DEFAULT_URL).origin
    const results: Record<string, unknown> = {}
    for (const p of CANDIDATE_PATHS) {
      try {
        const r = await rpc(origin + p, 'initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'probe', version: '0.1.0' } }, null, 1)
        const snip =
          typeof r.body === 'object' && r.body !== null && 'raw' in (r.body as Record<string, unknown>)
            ? String((r.body as { raw: string }).raw).slice(0, 80)
            : JSON.stringify(r.body).slice(0, 200)
        results[p] = { status: r.status, ct: r.contentType, sessionId: r.sessionId, looksMcp: looksMcp(r.contentType, r.body), snip }
      } catch (e) {
        results[p] = { error: e instanceof Error ? e.message : String(e) }
      }
    }
    diag.discover = { origin, results }
    return json(diag)
  }

  const target = opts.url || DEFAULT_URL
  diag.target = target
  // bearer='access' → manda o access token direto no header (modo permanente, não expira, sem paste).
  // bearer='sk_live' (default) → header sk_live + authenticate(token) por sessão.
  const useAccessBearer = opts.bearer === 'access'
  const bearer = useAccessBearer ? ACCESS : TOKEN
  diag.bearerMode = useAccessBearer ? 'access-token-no-header (permanente)' : 'sk_live + paste-auth'
  try {
    // 1) initialize
    const init = await rpc(target, 'initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'instituto-lorena-probe', version: '0.1.0' } }, null, 1, bearer)
    diag.initialize = init
    const sid = init.sessionId

    // 2) initialized (notification)
    await rpc(target, 'notifications/initialized', {}, sid, null, bearer).catch(() => {})

    // 2.5) authenticate — só no modo paste. No modo access-bearer o header já autentica.
    if (useAccessBearer) {
      diag.authenticate = 'pulei — access token vai direto no header Authorization (modo permanente)'
    } else {
      const authToken = opts.authToken || ACCESS
      diag.authenticate = authToken
        ? await rpc(target, 'tools/call', { name: 'authenticate', arguments: { token: authToken } }, sid, 10, bearer)
        : 'sem BANCOMCP_ACCESS_TOKEN — pulei (só initialize/tools/list vão funcionar)'
    }

    // 3) tools/list — descoberta, não consome cota de dado bancário
    diag.tools = await rpc(target, 'tools/list', {}, sid, 2, bearer)

    // 4) opcional: chamar uma tool
    if (opts.call?.name) {
      diag.call = await rpc(target, 'tools/call', { name: opts.call.name, arguments: opts.call.arguments ?? {} }, sid, 3, bearer)
    }

    return json(diag)
  } catch (e) {
    diag.error = e instanceof Error ? e.message : String(e)
    return json(diag, 500)
  }
})
