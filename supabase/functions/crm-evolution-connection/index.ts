import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Action = 'snapshot' | 'status' | 'qrcode' | 'connect' | 'logout' | 'restart'

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function env(name: string): string {
  return (Deno.env.get(name) ?? '').trim()
}

function normalizedBaseUrl(raw: string): string {
  return raw.replace(/\/$/, '')
}

async function callEvolution(
  baseUrl: string,
  apiKey: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<{ ok: boolean; status: number; data: unknown; raw: string; url: string }> {
  const url = `${baseUrl}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
    },
  })

  const raw = await res.text()
  let parsed: unknown = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = { raw }
  }
  return { ok: res.ok, status: res.status, data: parsed, raw, url }
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = obj
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function stringVal(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function boolVal(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'true') return true
    if (v.toLowerCase() === 'false') return false
  }
  return null
}

function extractConnectionState(payload: unknown): {
  state: string
  connected: boolean | null
  instanceName: string
} {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const state =
    stringVal(getByPath(data, 'instance.state')) ||
    stringVal(getByPath(data, 'data.instance.state')) ||
    stringVal(getByPath(data, 'data.state')) ||
    stringVal(getByPath(data, 'state')) ||
    'unknown'
  const connected =
    boolVal(getByPath(data, 'instance.connected')) ??
    boolVal(getByPath(data, 'data.instance.connected')) ??
    boolVal(getByPath(data, 'data.connected')) ??
    boolVal(getByPath(data, 'connected'))
  const instanceName =
    stringVal(getByPath(data, 'instance.instanceName')) ||
    stringVal(getByPath(data, 'instance.name')) ||
    stringVal(getByPath(data, 'data.instance.instanceName')) ||
    stringVal(getByPath(data, 'data.instance.name')) ||
    ''
  return { state, connected, instanceName }
}

function extractQrCode(payload: unknown): string {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  return (
    stringVal(getByPath(data, 'base64')) ||
    stringVal(getByPath(data, 'qrcode.base64')) ||
    stringVal(getByPath(data, 'qrcode')) ||
    stringVal(getByPath(data, 'qr')) ||
    stringVal(getByPath(data, 'code')) ||
    stringVal(getByPath(data, 'data.base64')) ||
    stringVal(getByPath(data, 'data.qrcode.base64')) ||
    stringVal(getByPath(data, 'data.qrcode')) ||
    stringVal(getByPath(data, 'data.qr')) ||
    ''
  )
}

async function readStatus(baseUrl: string, apiKey: string, instance: string) {
  const attempts = [
    { path: `/instance/connectionState/${instance}`, method: 'GET' as const },
    { path: `/instance/connectionState?instanceName=${encodeURIComponent(instance)}`, method: 'GET' as const },
    { path: `/instance/fetchInstances`, method: 'GET' as const },
  ]

  const errors: string[] = []
  for (const attempt of attempts) {
    const res = await callEvolution(baseUrl, apiKey, attempt.path, attempt.method)
    if (!res.ok) {
      errors.push(`${attempt.path}:${res.status}`)
      continue
    }
    const parsed = extractConnectionState(res.data)
    return { ok: true, ...parsed, raw: res.data }
  }
  return { ok: false, state: 'unreachable', connected: null as boolean | null, instanceName: '', errors }
}

async function readQrCode(baseUrl: string, apiKey: string, instance: string) {
  const attempts = [
    { path: `/instance/connect/${instance}`, method: 'GET' as const },
    { path: `/instance/connect/${instance}`, method: 'POST' as const },
    { path: `/instance/qrcode/${instance}`, method: 'GET' as const },
  ]
  const errors: string[] = []
  for (const attempt of attempts) {
    const res = await callEvolution(baseUrl, apiKey, attempt.path, attempt.method)
    if (!res.ok) {
      errors.push(`${attempt.path}:${res.status}`)
      continue
    }
    const qrCode = extractQrCode(res.data)
    return { ok: true, qrCode, raw: res.data }
  }
  return { ok: false, qrCode: '', errors }
}

async function performAction(baseUrl: string, apiKey: string, instance: string, action: Action) {
  const actionMap: Record<'connect' | 'restart', { path: string; method: 'GET' | 'POST' }> = {
    connect: { path: `/instance/connect/${instance}`, method: 'GET' },
    restart: { path: `/instance/restart/${instance}`, method: 'POST' },
  }

  // logout can be GET or DELETE depending on installation.
  if (action === 'logout') {
    const first = await callEvolution(baseUrl, apiKey, `/instance/logout/${instance}`, 'POST')
    if (first.ok) return { ok: true, raw: first.data }
    const second = await callEvolution(baseUrl, apiKey, `/instance/logout/${instance}`, 'GET')
    if (second.ok) return { ok: true, raw: second.data }
    return { ok: false, error: `logout_failed_${first.status}_${second.status}` }
  }

  const selected = actionMap[action as 'connect' | 'restart']
  const res = await callEvolution(baseUrl, apiKey, selected.path, selected.method)
  if (!res.ok) return { ok: false, error: `${action}_failed_${res.status}` }
  return { ok: true, raw: res.data }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const supabaseUrl = env('SUPABASE_URL')
  const anonKey = env('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return json({ error: 'server_misconfigured' }, 500)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'unauthorized' }, 401)

  const base = env('EVOLUTION_API_BASE')
  const key = env('EVOLUTION_API_KEY')
  const instance = env('EVOLUTION_INSTANCE')
  if (!base || !key || !instance) {
    return json({ error: 'missing_env', message: 'Configure EVOLUTION_API_BASE, EVOLUTION_API_KEY e EVOLUTION_INSTANCE.' }, 500)
  }

  let body: { action?: Action }
  try {
    body = (await req.json()) as { action?: Action }
  } catch {
    body = {}
  }
  const action = body.action ?? 'snapshot'
  if (!['snapshot', 'status', 'qrcode', 'connect', 'logout', 'restart'].includes(action)) {
    return json({ error: 'invalid_action' }, 400)
  }

  const baseUrl = normalizedBaseUrl(base)

  if (action === 'status') {
    const status = await readStatus(baseUrl, key, instance)
    return json({ ok: status.ok, provider: 'evolution', instance, status: status.state, connected: status.connected, details: status })
  }

  if (action === 'qrcode') {
    const qr = await readQrCode(baseUrl, key, instance)
    return json({ ok: qr.ok, provider: 'evolution', instance, qrCode: qr.qrCode, details: qr })
  }

  if (action === 'snapshot') {
    const status = await readStatus(baseUrl, key, instance)
    const qr = await readQrCode(baseUrl, key, instance)
    return json({
      ok: status.ok || qr.ok,
      provider: 'evolution',
      instance,
      status: status.state,
      connected: status.connected,
      qrCode: qr.qrCode,
      statusDetails: status,
      qrDetails: qr,
    })
  }

  const executed = await performAction(baseUrl, key, instance, action)
  const snapshot = await readStatus(baseUrl, key, instance)
  return json({
    ok: executed.ok,
    provider: 'evolution',
    instance,
    action,
    actionResult: executed,
    status: snapshot.state,
    connected: snapshot.connected,
  }, executed.ok ? 200 : 502)
})
