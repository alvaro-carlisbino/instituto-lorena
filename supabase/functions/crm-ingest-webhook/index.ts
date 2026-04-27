import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { upsertLeadByPhone } from '../_shared/crm.ts'

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

  const phone = pick('phone', '')
  if (phone.replace(/[^0-9]/g, '').length < 10) {
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
  const score = Number(pick('score', '50')) || 50
  const customFields = (payload.custom_fields as Record<string, unknown> | undefined) ?? {}
  const preferredLeadId = pick('id', '')

  try {
    const result = await upsertLeadByPhone(admin, {
      patientName: patient_name,
      phone,
      summary,
      source,
      ownerId: pick('owner_id', ''),
      pipelineId: pick('pipeline_id', ''),
      stageId: pick('stage_id', ''),
      score,
      temperature: tempOverride && tempOverride.length > 0 ? (tempOverride as 'cold' | 'warm' | 'hot') : undefined,
      customFields,
      preferredLeadId: preferredLeadId || undefined,
    })
    return new Response(JSON.stringify(result), {
      status: 202,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
