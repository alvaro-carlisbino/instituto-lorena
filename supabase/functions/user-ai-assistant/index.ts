import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ZAI_BASE = 'https://api.z.ai/api/paas/v4/chat/completions'

/** Modelos GLM comuns no plano Z.ai; override por secret ZAI_MODEL. */
const ALLOWED_MODELS = new Set([
  'glm-5.1',
  'glm-4.7',
  'glm-4.6',
  'glm-4.5',
  'glm-4.5-air',
  'glm-4-flash',
  'glm-4-plus',
])

type ChatMsg = { role: string; content: string }

async function callerCanManageUsers(
  admin: ReturnType<typeof createClient>,
  authUserId: string,
): Promise<boolean> {
  const { data: profile, error } = await admin.from('app_profiles').select('role').eq('auth_user_id', authUserId).maybeSingle()
  if (error || !profile?.role) return false
  const r = String(profile.role).trim().toLowerCase()
  if (r === 'admin') return true
  const { data: perm } = await admin
    .from('permission_profiles')
    .select('can_manage_users')
    .eq('role', r)
    .limit(1)
    .maybeSingle()
  return Boolean(perm?.can_manage_users)
}

function sanitizeMessages(raw: unknown): ChatMsg[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMsg[] = []
  for (const m of raw) {
    if (out.length >= 24) break
    if (!m || typeof m !== 'object') continue
    const role = String((m as ChatMsg).role ?? '').toLowerCase()
    if (role !== 'user' && role !== 'assistant') continue
    const content = String((m as ChatMsg).content ?? '').slice(0, 12000)
    if (!content.trim()) continue
    out.push({ role, content })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const zaiKey = Deno.env.get('ZAI_API_KEY') ?? ''
  const defaultModel = (Deno.env.get('ZAI_MODEL') ?? 'glm-4.7').trim()

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (!zaiKey) {
    return new Response(JSON.stringify({ error: 'zai_not_configured', message: 'Defina o secret ZAI_API_KEY no projeto Supabase.' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const allowed = await callerCanManageUsers(admin, user.id)
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  let body: { messages?: unknown; model?: string }
  try {
    body = (await req.json()) as { messages?: unknown; model?: string }
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const clientMessages = sanitizeMessages(body.messages)
  if (clientMessages.length === 0) {
    return new Response(JSON.stringify({ error: 'empty_messages' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const requested = String(body.model ?? '').trim()
  const model = ALLOWED_MODELS.has(requested) ? requested : defaultModel

  const { data: rows, error: usersErr } = await admin
    .from('app_users')
    .select('name, email, role, active')
    .order('name', { ascending: true })

  if (usersErr) {
    return new Response(JSON.stringify({ error: 'team_fetch_failed', message: usersErr.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const roster = (rows ?? []).map((r) => ({
    name: r.name,
    email: r.email,
    role: r.role,
    active: r.active,
  }))

  const systemContent = [
    'Você é um assistente de IA para administradores do CRM Instituto Lorena.',
    'Use apenas os dados da equipe fornecidos abaixo; não invente usuários, e-mails ou permissões.',
    'Responda sempre em português do Brasil. Seja objetivo e profissional.',
    'Não solicite nem repita senhas. Não armazene dados sensíveis na conversa.',
    '',
    'Equipe atual (JSON):',
    JSON.stringify(roster, null, 0),
  ].join('\n')

  const messages: ChatMsg[] = [{ role: 'system', content: systemContent }, ...clientMessages]

  const zaiRes = await fetch(ZAI_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${zaiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.35,
      max_tokens: 2048,
    }),
  })

  const zaiText = await zaiRes.text()
  if (!zaiRes.ok) {
    return new Response(
      JSON.stringify({
        error: 'zai_upstream',
        status: zaiRes.status,
        message: zaiText.slice(0, 500),
      }),
      {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    )
  }

  let parsed: { choices?: { message?: { content?: string } }[] }
  try {
    parsed = JSON.parse(zaiText) as typeof parsed
  } catch {
    return new Response(JSON.stringify({ error: 'zai_invalid_json' }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const reply = String(parsed.choices?.[0]?.message?.content ?? '').trim()
  if (!reply) {
    return new Response(JSON.stringify({ error: 'zai_empty_reply' }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ reply, model }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
