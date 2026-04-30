import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVOLUTION_FETCH_TIMEOUT_MS = 25_000

type Action =
  | 'snapshot'
  | 'status'
  | 'qrcode'
  | 'connect'
  | 'logout'
  | 'restart'
  | 'create_instance'
  | 'delete_instance'
  | 'configure_webhook'

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
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  jsonBody?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown; raw: string; url: string }> {
  const url = `${baseUrl}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' && jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
      signal: AbortSignal.timeout(EVOLUTION_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    const isAbort = name === 'TimeoutError' || name === 'AbortError'
    return {
      ok: false,
      status: isAbort ? 408 : 0,
      data: { _fetchError: isAbort ? 'timeout' : (e instanceof Error ? e.message : String(e)) },
      raw: '',
      url,
    }
  }

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

async function performAction(
  baseUrl: string,
  apiKey: string,
  instance: string,
  action: 'connect' | 'logout' | 'restart',
) {
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

function normalizeInstanceNameForApi(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return s.slice(0, 60)
}

function extractCreatedInstanceNameFromPayload(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  const inst = d['instance']
  if (inst && typeof inst === 'object') {
    const ir = inst as Record<string, unknown>
    return stringVal(ir['instanceName']) || stringVal(ir['name'])
  }
  return stringVal(d['instanceName'])
}

async function callerCanManageUsers(
  admin: SupabaseClient,
  authUserId: string,
): Promise<boolean> {
  const { data: profile, error } = await admin.from('app_profiles').select('role').eq('auth_user_id', authUserId).maybeSingle()
  if (error || !profile || typeof (profile as { role?: string }).role !== 'string') return false
  const r = String((profile as { role: string }).role).trim().toLowerCase()
  if (r === 'admin') return true
  const { data: perm } = await admin
    .from('permission_profiles')
    .select('can_manage_users')
    .eq('role', r)
    .limit(1)
    .maybeSingle()
  return Boolean((perm as { can_manage_users?: boolean } | null)?.can_manage_users)
}

Deno.serve(async (req) => {
  try {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const supabaseUrl = env('SUPABASE_URL')
  const anonKey = env('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return json(
      {
        ok: false,
        error: 'server_misconfigured',
        message: 'Função sem SUPABASE_URL ou SUPABASE_ANON_KEY. Confirme as secrets e faça deploy de crm-evolution-connection.',
        provider: 'evolution',
        instance: '',
        status: 'error',
        connected: null,
      },
      200,
    )
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'unauthorized' }, 401)

  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const admin = serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null

  const base = env('EVOLUTION_API_BASE')
  const key = env('EVOLUTION_API_KEY')
  const defaultInstance = env('EVOLUTION_INSTANCE')
  if (!base || !key) {
    return json(
      {
        ok: false,
        error: 'missing_env',
        message: 'Falta configurar o gateway de WhatsApp. Peça a quem cuida do sistema para preencher EVOLUTION_API_BASE e EVOLUTION_API_KEY no painel Supabase (Edge Functions, secrets).',
        provider: 'evolution',
        instance: '',
        status: 'unconfigured',
        connected: null,
      },
      200,
    )
  }

  type BodyShape = { action?: Action; instanceId?: string; instanceName?: string }
  let body: BodyShape
  try {
    body = (await req.json()) as BodyShape
  } catch {
    body = {}
  }
  const action: Action = body.action ?? 'snapshot'
  const baseUrl = normalizedBaseUrl(base)

  if (action === 'create_instance') {
    if (!admin || !serviceKey) {
      return json(
        {
          ok: false,
          error: 'server_misconfigured',
          message:
            'Para criar ou apagar contas de WhatsApp no servidor, adicione SUPABASE_SERVICE_ROLE_KEY nas secrets desta função (Dashboard). QR e estado da linha funcionam sem isto.',
        },
        200,
      )
    }
    if (!(await callerCanManageUsers(admin, authData.user.id))) {
      return json({ error: 'forbidden' }, 403)
    }
    const raw = String(body.instanceName ?? '').trim()
    if (!raw) {
      return json(
        {
          ok: false,
          error: 'instance_name_required',
          message: 'Indique o nome interno do telefone (letras, números e hífen) ou o rótulo a partir do qual o CRM gera o nome.',
        },
        200,
      )
    }
    const instanceName = normalizeInstanceNameForApi(raw) || `il-${Date.now().toString(36)}`
    const createBodies: Record<string, unknown>[] = [
      { instanceName, integration: 'WHATSAPP-BAILEYS' },
      { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
    ]
    for (const createBody of createBodies) {
      const res = await callEvolution(baseUrl, key, '/instance/create', 'POST', createBody)
      if (res.ok) {
        const name = extractCreatedInstanceNameFromPayload(res.data) || instanceName
        return json(
          { ok: true, provider: 'evolution', instance: name, created: res.data },
          201,
        )
      }
    }
    const last = await callEvolution(baseUrl, key, '/instance/create', 'POST', createBodies[0]!)
    return json(
      {
        ok: false,
        error: 'evolution_create_failed',
        status: last.status,
        details: last.data,
        message: 'Não foi possível criar no servidor. O nome pode já existir, ou a API de WhatsApp recusou o pedido.',
      },
      200,
    )
  }

  if (action === 'delete_instance') {
    if (!admin || !serviceKey) {
      return json(
        {
          ok: false,
          error: 'server_misconfigured',
          message: 'Defina SUPABASE_SERVICE_ROLE_KEY nas secrets desta função para apagar a conta de WhatsApp no servidor.',
        },
        200,
      )
    }
    if (!(await callerCanManageUsers(admin, authData.user.id))) {
      return json({ error: 'forbidden' }, 403)
    }
    const id = String(body.instanceId ?? '').trim()
    if (!id) {
      return json({ error: 'instance_id_required' }, 400)
    }
    const { data: row } = await userClient
      .from('whatsapp_channel_instances')
      .select('evolution_instance_name')
      .eq('id', id)
      .maybeSingle()
    const ename = String((row as { evolution_instance_name?: string } | null)?.evolution_instance_name ?? '').trim()
    if (!ename) {
      return json(
        {
          ok: false,
          error: 'not_found',
          message: 'Não foi encontrada esta linha no CRM. Atualize a lista ou escolha outro telefone.',
        },
        200,
      )
    }
    const del = await callEvolution(baseUrl, key, `/instance/delete/${encodeURIComponent(ename)}`, 'DELETE')
    if (!del.ok && del.status !== 404) {
      return json(
        {
          ok: false,
          error: 'evolution_delete_failed',
          status: del.status,
          details: del.data,
          message: 'Não foi possível apagar no servidor de WhatsApp. Tente de novo ou apague no painel do fornecedor.',
        },
        200,
      )
    }
    return json({ ok: true, provider: 'evolution', instance: ename, evolutionDelete: del.data })
  }

  if (action === 'configure_webhook') {
    if (!(await callerCanManageUsers(admin!, authData.user.id))) {
      return json({ error: 'forbidden' }, 403)
    }
    // Resolve which evolution instance to configure
    let targetInstance = defaultInstance
    if (body.instanceId) {
      const { data: row } = await userClient
        .from('whatsapp_channel_instances')
        .select('evolution_instance_name')
        .eq('id', String(body.instanceId).trim())
        .maybeSingle()
      const n = String((row as { evolution_instance_name?: string } | null)?.evolution_instance_name ?? '').trim()
      if (n) targetInstance = n
    }
    if (!targetInstance) {
      return json({ ok: false, error: 'missing_instance', message: 'Nenhuma instância identificada.' }, 200)
    }
    const webhookUrl = `${env('SUPABASE_URL')}/functions/v1/crm-whatsapp-webhook`
    const webhookBody = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'SEND_MESSAGE',
        ],
      },
    }
    const res = await callEvolution(baseUrl, key, `/webhook/set/${encodeURIComponent(targetInstance)}`, 'POST', webhookBody)
    return json({
      ok: res.ok,
      provider: 'evolution',
      instance: targetInstance,
      webhook_url: webhookUrl,
      evolution_status: res.status,
      evolution_response: res.data,
      message: res.ok
        ? `Webhook configurado com sucesso na instância «${targetInstance}».`
        : `Evolution devolveu ${res.status}. Verifique se a instância existe e a API key está correcta.`,
    })
  }

  let instance = defaultInstance
  if (body.instanceId) {
    const { data: row } = await userClient
      .from('whatsapp_channel_instances')
      .select('evolution_instance_name, active')
      .eq('id', String(body.instanceId).trim())
      .maybeSingle()
    if (row && (row as { active?: boolean }).active !== false) {
      const n = String((row as { evolution_instance_name?: string }).evolution_instance_name ?? '').trim()
      if (n) instance = n
    }
  }
  if (!instance) {
    return json({
      ok: false,
      error: 'missing_instance',
      message: 'Crie um telefone/linha em baixo, ou defina a variável EVOLUTION_INSTANCE no painel (fallback).',
      provider: 'evolution',
      instance: '',
      status: 'unconfigured',
      connected: null,
    }, 200)
  }
  if (!['snapshot', 'status', 'qrcode', 'connect', 'logout', 'restart'].includes(action)) {
    return json({ error: 'invalid_action' }, 400)
  }

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
    error: executed.ok ? undefined : 'action_failed',
    message: executed.ok
      ? undefined
      : 'Não foi possível ligar este número ao WhatsApp. Confirme se o serviço está a correr, a linha e a rede, e tente de novo.',
  }, 200)
  } catch (e) {
    console.error('crm-evolution-connection', e)
    return json(
      {
        ok: false,
        error: 'internal_error',
        message: 'Ocorreu um erro inesperado. Tente de novo; se continuar, confira o deploy da função e os logs no Supabase.',
        provider: 'evolution',
        instance: '',
        status: 'error',
        connected: null,
      },
      200,
    )
  }
})
