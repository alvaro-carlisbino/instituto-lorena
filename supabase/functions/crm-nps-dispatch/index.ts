import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { getEvolutionProviderForLead, getOfficialProviderForLead } from '../_shared/whatsapp/evolutionConfig.ts'
import type { WhatsappProvider } from '../_shared/whatsapp/types.ts'
import {
  pushManychatInstagramDmAfterReply,
  pushManychatWhatsappDmAfterReply,
  readManychatPushConfigForTenantChannel,
} from '../_shared/manychatPublicApi.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

const NPS_TEMPLATE_ID_BY_PIPELINE: Record<string, string> = {
  'pipeline-clinica': 'nps-clinica',
  'pipeline-tratamento-capilar': 'nps-capilar',
  'pipeline-processo-cirurgico': 'nps-cirurgico',
}

type LeadRow = {
  id: string
  patient_name: string
  phone: string
  pipeline_id: string | null
  whatsapp_instance_id: string | null
  custom_fields: Record<string, unknown> | null
  source: string | null
  tenant_id: string
}

async function pickTemplate(admin: SupabaseClient, lead: LeadRow, requestedId: string) {
  if (requestedId) {
    const { data } = await admin
      .from('survey_templates')
      .select('id, name, nps_question, enabled')
      .eq('id', requestedId)
      .maybeSingle()
    if (data && data.enabled) return data
  }
  const preferredId = lead.pipeline_id ? NPS_TEMPLATE_ID_BY_PIPELINE[lead.pipeline_id] : null
  if (preferredId) {
    const { data } = await admin
      .from('survey_templates')
      .select('id, name, nps_question, enabled')
      .eq('id', preferredId)
      .eq('enabled', true)
      .maybeSingle()
    if (data) return data
  }
  const { data } = await admin
    .from('survey_templates')
    .select('id, name, nps_question, enabled')
    .eq('enabled', true)
    .limit(1)
    .maybeSingle()
  return data
}

function buildNpsMessage(question: string, patientName: string): string {
  const first = String(patientName ?? '').trim().split(/\s+/)[0] || ''
  const greeting = first ? `Olá, ${first}! ` : 'Olá! '
  return `${greeting}Aqui é a *Sofia*, do Instituto Lorena Visentainer. 💆

${question}

Responda apenas com um número de *0 a 10*. A sua opinião nos ajuda a melhorar! 🙏`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  // Aceita chamada autenticada (JWT do utilizador) OU service role direta (x-internal-key)
  const authHeader = req.headers.get('Authorization') ?? ''
  const internalKey = (req.headers.get('x-internal-key') ?? '').trim()
  const expectedInternal = (Deno.env.get('CRM_INTERNAL_KEY') ?? '').trim()
  const calledInternally = expectedInternal && internalKey === expectedInternal

  if (!calledInternally) {
    if (!authHeader) return json({ error: 'unauthorized' }, 401)
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'unauthorized' }, 401)
  }

  let body: { leadId?: string; templateId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const leadId = String(body.leadId ?? '').trim()
  const requestedTemplate = String(body.templateId ?? '').trim()
  if (!leadId) return json({ error: 'missing_fields', message: 'leadId obrigatório' }, 400)

  const { data: leadRaw, error: leadErr } = await admin
    .from('leads')
    .select('id, patient_name, phone, pipeline_id, whatsapp_instance_id, custom_fields, source, tenant_id')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr || !leadRaw) return json({ error: 'lead_not_found' }, 404)
  const lead = leadRaw as LeadRow

  // Não envia NPS de novo se há um dispatch pendente sem resposta nas últimas 24h
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: pending } = await admin
    .from('survey_dispatches')
    .select('id, sent_at, survey_responses(id)')
    .eq('lead_id', leadId)
    .gte('sent_at', last24h)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (pending && (!(pending as { survey_responses?: unknown[] }).survey_responses?.length)) {
    return json({ ok: true, status: 'already_pending', dispatchId: (pending as { id: string }).id })
  }

  const template = await pickTemplate(admin, lead, requestedTemplate)
  if (!template) return json({ error: 'no_template', message: 'Nenhum template NPS ativo' }, 400)

  const npsText = buildNpsMessage(String(template.nps_question), String(lead.patient_name ?? ''))

  // Detecta canal de envio (mesma heurística do crm-send-message)
  const phoneDigits = String(lead.phone ?? '').replace(/[^0-9]/g, '')
  const isSyntheticPhone = phoneDigits.startsWith('888001')
  const subscriberId = String(lead.custom_fields?.manychat_subscriber_id ?? '').trim()
  const customChannel = String(lead.custom_fields?.channel ?? '').toLowerCase()
  const sourceIsMeta = lead.source === 'meta_instagram' || lead.source === 'meta_whatsapp'

  const isManychat =
    isSyntheticPhone || customChannel === 'instagram' || customChannel === 'whatsapp' || sourceIsMeta

  let dispatchChannel: 'whatsapp' | 'meta' = 'whatsapp'
  let sentVia = ''

  if (isManychat && subscriberId) {
    const pushChannel: 'whatsapp' | 'instagram' =
      customChannel === 'whatsapp' || lead.source === 'meta_whatsapp' ? 'whatsapp' : 'instagram'
    const mcCfg = await readManychatPushConfigForTenantChannel(admin, lead.tenant_id, pushChannel)
    if (!mcCfg) return json({ error: 'manychat_not_configured' }, 500)
    const args = {
      apiKey: mcCfg.apiKey,
      subscriberId,
      replyText: npsText,
      fieldId: mcCfg.fieldId,
      flowNs: mcCfg.flowNs,
      messageTag: mcCfg.messageTag || undefined,
    }
    const pushResult =
      pushChannel === 'whatsapp'
        ? await pushManychatWhatsappDmAfterReply(args)
        : await pushManychatInstagramDmAfterReply(args)
    if (!pushResult.ok) {
      return json(
        { error: 'manychat_push_failed', message: pushResult.error ?? '', push_channel: pushChannel },
        500,
      )
    }
    dispatchChannel = pushChannel === 'whatsapp' ? 'whatsapp' : 'meta'
    sentVia = `manychat_${pushChannel}`
  } else {
    if (!phoneDigits || phoneDigits.length < 10) {
      return json({ error: 'no_channel', message: 'Lead sem WhatsApp e sem subscriber ManyChat' }, 400)
    }
    // WhatsApp direto: Evolution ou Official, conforme env do tenant/lead
    let provider: WhatsappProvider | null = null
    try {
      provider = await getOfficialProviderForLead(admin, lead.id)
    } catch { /* tenta evolution */ }
    if (!provider) {
      try {
        provider = await getEvolutionProviderForLead(admin, lead.id)
      } catch (e) {
        return json({ error: 'no_provider', message: e instanceof Error ? e.message : String(e) }, 500)
      }
    }
    if (!provider) return json({ error: 'no_provider' }, 500)
    const sent = await provider.sendMessage({ to: phoneDigits, text: npsText, leadId: lead.id })
    dispatchChannel = 'whatsapp'
    sentVia = `whatsapp_${sent.provider}`
  }

  // Registra interação na ficha do paciente
  await insertInteraction(admin, {
    leadId: lead.id,
    patientName: String(lead.patient_name ?? 'Lead'),
    channel: dispatchChannel,
    direction: 'out',
    author: 'NPS (Sofia)',
    content: npsText,
    tenantId: lead.tenant_id,
  })

  // Cria o survey_dispatch real
  const dispatchId = `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { error: dispErr } = await admin.from('survey_dispatches').insert({
    id: dispatchId,
    template_id: template.id,
    lead_id: lead.id,
    sent_at: new Date().toISOString(),
    channel: dispatchChannel,
    tenant_id: lead.tenant_id,
  })
  if (dispErr) {
    return json({ error: 'dispatch_persist_failed', message: dispErr.message }, 500)
  }

  return json({
    ok: true,
    dispatchId,
    templateId: template.id,
    channel: dispatchChannel,
    sent_via: sentVia,
  })
})
