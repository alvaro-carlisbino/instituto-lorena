import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Body = {
  email: string
  password: string
  displayName: string
  role: 'admin' | 'gestor' | 'sdr'
  appUserId?: string
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
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
      status: 500,
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
  const { data: profile, error: profErr } = await admin
    .from('app_profiles')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (profErr || profile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const email = String(body.email ?? '')
    .trim()
    .toLowerCase()
  if (!email.includes('@')) {
    return new Response(JSON.stringify({ error: 'invalid_email' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const password = String(body.password ?? '')
  if (password.length < 8) {
    return new Response(JSON.stringify({ error: 'password_min_8_chars' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const displayName = String(body.displayName ?? email.split('@')[0] ?? 'usuario').trim() || 'usuario'
  const role = (['admin', 'gestor', 'sdr'] as const).includes(body.role) ? body.role : 'sdr'
  const appUserId = body.appUserId?.trim() || null

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: displayName, app_role: role },
  })

  if (createErr) {
    return new Response(JSON.stringify({ error: createErr.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const authUserId = created.user?.id
  if (!authUserId) {
    return new Response(JSON.stringify({ error: 'auth_user_missing' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const now = new Date().toISOString()
  const { error: profUpsertErr } = await admin.from('app_profiles').upsert(
    {
      auth_user_id: authUserId,
      email,
      display_name: displayName,
      role,
      updated_at: now,
    },
    { onConflict: 'auth_user_id' },
  )

  if (profUpsertErr) {
    return new Response(JSON.stringify({ error: profUpsertErr.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (appUserId) {
    const { error: updErr } = await admin
      .from('app_users')
      .update({
        email,
        name: displayName,
        role,
        auth_user_id: authUserId,
      })
      .eq('id', appUserId)

    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
  } else {
    const slug = email.split('@')[0]?.replace(/[^a-z0-9-]/gi, '-') || `u-${crypto.randomUUID().slice(0, 8)}`
    const { error: insErr } = await admin.from('app_users').insert({
      id: slug.length > 2 ? slug : `user-${crypto.randomUUID().slice(0, 8)}`,
      name: displayName,
      email,
      role,
      active: true,
      auth_user_id: authUserId,
    })
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
  }

  return new Response(JSON.stringify({ ok: true, authUserId }), {
    status: 201,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
