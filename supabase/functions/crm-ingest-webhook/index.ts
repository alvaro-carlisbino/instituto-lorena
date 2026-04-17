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

  const id = pick('id', `lead-${crypto.randomUUID().slice(0, 12)}`)
  const patient_name = pick('patient_name', 'Lead webhook')
  const phone = pick('phone', '')
  const summary = pick('summary', '')
  const sourceRaw = pick('source', 'manual')
  const source = ['meta_facebook', 'meta_instagram', 'whatsapp', 'manual'].includes(sourceRaw)
    ? sourceRaw
    : 'manual'
  const owner_id = pick('owner_id', 'sdr-1')
  const pipeline_id = pick('pipeline_id', 'pipeline-clinica')
  const stage_id = pick('stage_id', 'novo')
  const score = Number(pick('score', '50')) || 50
  const temperatureRaw = pick('temperature', 'warm')
  const temperature = ['cold', 'warm', 'hot'].includes(temperatureRaw) ? temperatureRaw : 'warm'
  const custom_fields = (payload.custom_fields as Record<string, unknown> | undefined) ?? {}

  const { error } = await admin.from('leads').insert({
    id,
    patient_name,
    phone,
    source,
    summary,
    owner_id,
    pipeline_id,
    stage_id,
    score,
    temperature,
    created_at: new Date().toISOString(),
    position: 1,
    custom_fields,
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 201,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
