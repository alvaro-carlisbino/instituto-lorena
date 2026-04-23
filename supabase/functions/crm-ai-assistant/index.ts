/**
 * Assistente CRM (GLM / Z.ai) — leituras com JWT do utilizador (RLS).
 *
 * Secrets: ZAI_API_KEY (obrigatório), ZAI_MODEL (opcional, ex. glm-4.7).
 * Deploy: supabase functions deploy crm-ai-assistant
 *
 * Extensão futura: Meta / WhatsApp / Evolution — enriquecer snapshot com interações
 * por canal quando os webhooks e políticas RLS estiverem estáveis.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ZAI_BASE = 'https://api.z.ai/api/paas/v4/chat/completions'

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

type AiContext = {
  leadId?: string
  weekStartIso?: string
  focus?: 'analytics' | 'lead' | 'general'
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

function trunc(s: string, max: number): string {
  const t = String(s ?? '')
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function parseContext(raw: unknown): AiContext {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const leadId = typeof o.leadId === 'string' && /^[0-9a-f-]{36}$/i.test(o.leadId.trim()) ? o.leadId.trim() : undefined
  const weekStartIso =
    typeof o.weekStartIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.weekStartIso.trim()) ? o.weekStartIso.trim() : undefined
  const f = typeof o.focus === 'string' ? o.focus.trim().toLowerCase() : ''
  const focus = f === 'analytics' || f === 'lead' || f === 'general' ? (f as AiContext['focus']) : undefined
  return { leadId, weekStartIso, focus }
}

async function buildCrmSnapshot(userClient: ReturnType<typeof createClient>, ctx: AiContext): Promise<Record<string, unknown>> {
  const interactionSince = ctx.weekStartIso
    ? `${ctx.weekStartIso}T00:00:00.000Z`
    : (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 14)
        return d.toISOString()
      })()

  const [
    profileRes,
    metricsRes,
    channelsRes,
    pipelinesRes,
    stagesRes,
    leadsAggRes,
    leadsSampleRes,
    interactionsRes,
    usersRes,
  ] = await Promise.all([
    userClient.from('app_profiles').select('email, display_name, role').maybeSingle(),
    userClient.from('metric_configs').select('id, label, value, target, unit').order('label', { ascending: true }).limit(40),
    userClient
      .from('channel_configs')
      .select('id, name, enabled, driver, priority, sla_minutes')
      .order('priority', { ascending: true })
      .limit(30),
    userClient.from('pipelines').select('id, name').order('name', { ascending: true }).limit(24),
    userClient.from('pipeline_stages').select('id, pipeline_id, name, position').order('position', { ascending: true }).limit(80),
    userClient.from('leads').select('id, stage_id, temperature, score, created_at').limit(500),
    userClient
      .from('leads')
      .select('id, patient_name, phone, source, score, temperature, stage_id, pipeline_id, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(35),
    userClient
      .from('interactions')
      .select('id, lead_id, channel, direction, author, content, happened_at')
      .gte('happened_at', interactionSince)
      .order('happened_at', { ascending: false })
      .limit(55),
    userClient.from('app_users').select('id, name, role, active').order('name', { ascending: true }).limit(80),
  ])

  const byStage: Record<string, number> = {}
  const byTemp: Record<string, number> = {}
  for (const row of leadsAggRes.data ?? []) {
    const sid = String((row as { stage_id?: string }).stage_id ?? '')
    if (sid) byStage[sid] = (byStage[sid] ?? 0) + 1
    const te = String((row as { temperature?: string }).temperature ?? '')
    if (te) byTemp[te] = (byTemp[te] ?? 0) + 1
  }

  const recentLeads = (leadsSampleRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    patient_name: r.patient_name,
    phone: r.phone,
    source: r.source,
    score: r.score,
    temperature: r.temperature,
    stage_id: r.stage_id,
    pipeline_id: r.pipeline_id,
    created_at: r.created_at,
    summary: trunc(String(r.summary ?? ''), 320),
  }))

  const interactions = (interactionsRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    lead_id: r.lead_id,
    channel: r.channel,
    direction: r.direction,
    author: r.author,
    happened_at: r.happened_at,
    content: trunc(String(r.content ?? ''), 400),
  }))

  let leadFocus: Record<string, unknown> | null = null
  if (ctx.leadId) {
    const { data } = await userClient
      .from('leads')
      .select('id, patient_name, phone, source, score, temperature, stage_id, pipeline_id, summary, created_at, custom_fields')
      .eq('id', ctx.leadId)
      .maybeSingle()
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      leadFocus = {
        ...d,
        summary: trunc(String(d.summary ?? ''), 600),
        custom_fields:
          d.custom_fields && typeof d.custom_fields === 'object'
            ? trunc(JSON.stringify(d.custom_fields), 800)
            : null,
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    requestContext: ctx,
    interactionWindowSince: interactionSince,
    viewerProfile: profileRes.data ?? null,
    metrics: metricsRes.data ?? [],
    channels: channelsRes.data ?? [],
    pipelines: pipelinesRes.data ?? [],
    pipelineStages: stagesRes.data ?? [],
    leadsAggregateSampleSize: (leadsAggRes.data ?? []).length,
    leadCountsByStageId: byStage,
    leadCountsByTemperature: byTemp,
    recentLeads,
    recentInteractions: interactions,
    teamUsers: usersRes.data ?? [],
    leadFocus,
    queryNotes: {
      leadsAggregate: 'Até 500 leads (amostra) para distribuição por etapa/temperatura.',
      recentLeads: 'Últimos 35 leads por data de criação.',
      interactions: ctx.weekStartIso
        ? `Interações desde ${ctx.weekStartIso} (pedido do cliente).`
        : 'Interações dos últimos 14 dias.',
    },
  }
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
  const zaiKey = Deno.env.get('ZAI_API_KEY') ?? ''
  const defaultModel = (Deno.env.get('ZAI_MODEL') ?? 'glm-4.7').trim()

  if (!supabaseUrl || !anonKey) {
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

  let body: { messages?: unknown; model?: string; context?: unknown }
  try {
    body = (await req.json()) as { messages?: unknown; model?: string; context?: unknown }
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
  const context = parseContext(body.context)

  let snapshot: Record<string, unknown>
  try {
    snapshot = await buildCrmSnapshot(userClient, context)
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: 'snapshot_failed',
        message: e instanceof Error ? e.message : String(e),
      }),
      {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    )
  }

  const focusHint =
    context.focus === 'analytics'
      ? 'O utilizador pediu ênfase em analytics, tendências da semana e números.'
      : context.focus === 'lead'
        ? 'O utilizador pediu ênfase num lead específico (ver leadFocus se existir).'
        : 'Responda de forma equilibrada entre operação, leads e métricas.'

  const systemContent = [
    'Você é o assistente de IA do CRM Instituto Lorena (operação comercial / clínica).',
    'Use APENAS o snapshot JSON abaixo; não invente números, leads ou interações que não apareçam.',
    'Os dados respeitam as permissões (RLS) da conta do utilizador — pode ser uma amostra parcial.',
    'Responda em português de Portugal ou Brasil, de forma clara e profissional.',
    'Não peça nem repita senhas. Não confirme envio de mensagens a pacientes: pode sugerir RASCUNHOS; o humano envia.',
    'Para "churn" ou risco sem dados explícitos no snapshot, diga que faltam dados e sugira que métricas ou campos registar.',
    'Integrações futuras (Meta Graph API, WhatsApp Cloud, Evolution API) podem enriquecer canais — mencione só se relevante.',
    '',
    focusHint,
    '',
    'Snapshot CRM (JSON):',
    JSON.stringify(snapshot),
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
