import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Body = { email: string; displayName: string; role: 'admin' | 'gestor' | 'sdr' }

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
  const allowed = await callerCanManageUsers(admin, user.id)
  if (!allowed) {
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

  const displayName = String(body.displayName ?? email.split('@')[0] ?? 'usuario').trim() || 'usuario'
  const role = (['admin', 'gestor', 'sdr'] as const).includes(body.role) ? body.role : 'sdr'

  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { name: displayName, app_role: role },
  })
  if (invErr) {
    return new Response(JSON.stringify({ error: invErr.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  let authUserId = invited.user?.id ?? null
  if (!authUserId) {
    const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    authUserId = listData?.users?.find((u) => u.email?.toLowerCase() === email)?.id ?? null
  }

  if (authUserId) {
    await admin.from('app_profiles').upsert(
      {
        auth_user_id: authUserId,
        email,
        display_name: displayName,
        role,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'auth_user_id' },
    )
    await admin.from('app_users').update({ auth_user_id: authUserId }).eq('email', email)
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
