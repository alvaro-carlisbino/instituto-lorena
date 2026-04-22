import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

function temperatureForSource(
  source: 'meta_facebook' | 'meta_instagram' | 'whatsapp' | 'manual',
  override: string | undefined,
): 'cold' | 'warm' | 'hot' {
  if (override && ['cold', 'warm', 'hot'].includes(override)) {
    return override as 'cold' | 'warm' | 'hot'
  }
  if (source === 'meta_facebook' || source === 'meta_instagram') return 'hot'
  if (source === 'whatsapp') return 'warm'
  return 'cold'
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

  const secret = Deno.env.get('CRM_WEBHOOK_SECRET') ?? ''
  const hdr = req.headers.get('x-webhook-secret') ?? ''
  if (!secret || hdr !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const admin = createClient(supabaseUrl, serviceKey)

  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const mapping = (payload.field_mapping as Record<string, string> | undefined) ?? {
    patient_name: 'patient_name',
    phone: 'phone',
    summary: 'summary',
    source: 'source',
  }

  const pick = (key: string, fallback: string) => {
    const path = mapping[key] ?? key
    const v = getByPath(payload, path)
    return v !== undefined && v !== null ? String(v) : fallback
  }

  const phoneRaw = pick('phone', '')
  const normalizedPhone = digitsOnly(phoneRaw)
  if (normalizedPhone.length < 10) {
    return new Response(JSON.stringify({ error: 'invalid_phone', message: 'Telefone deve ter pelo menos 10 dígitos' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const patient_name = pick('patient_name', 'Lead webhook')
  const summary = pick('summary', '')
  const sourceRaw = pick('source', 'manual')
  const source = ['meta_facebook', 'meta_instagram', 'whatsapp', 'manual'].includes(sourceRaw)
    ? (sourceRaw as 'meta_facebook' | 'meta_instagram' | 'whatsapp' | 'manual')
    : 'manual'

  const tempOverride = pick('temperature', '')
  const temperature = temperatureForSource(
    source,
    tempOverride && tempOverride.length > 0 ? tempOverride : undefined,
  )

  const owner_id = pick('owner_id', 'sdr-1')
  const pipeline_id = pick('pipeline_id', 'pipeline-clinica')
  const stage_id = pick('stage_id', 'novo')
  const score = Number(pick('score', '50')) || 50
  const custom_fields = (payload.custom_fields as Record<string, unknown> | undefined) ?? {}

  let existingId: string | null = null
  const { data: fromRpc, error: findError } = await admin.rpc('find_lead_id_by_phone_digits', {
    p_digits: normalizedPhone,
  })
  if (!findError && fromRpc) {
    existingId = String(fromRpc)
  } else if (findError) {
    const { data: byEq } = await admin.from('leads').select('id').eq('phone', normalizedPhone).maybeSingle()
    existingId = byEq?.id ?? null
  }

  const row = {
    patient_name,
    phone: normalizedPhone,
    source,
    summary,
    owner_id,
    pipeline_id,
    stage_id,
    score,
    temperature,
    custom_fields,
  }

  if (existingId) {
    const { error: updateError } = await admin
      .from('leads')
      .update({
        ...row,
        // keep created_at
      })
      .eq('id', existingId)

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ leadId: existingId, status: 'updated' }), {
      status: 202,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const newId = pick('id', `lead-${crypto.randomUUID().slice(0, 12)}`)

  const { error: insertError } = await admin.from('leads').insert({
    id: newId,
    ...row,
    created_at: new Date().toISOString(),
    position: 1,
  })

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ leadId: newId, status: 'created' }), {
    status: 202,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
