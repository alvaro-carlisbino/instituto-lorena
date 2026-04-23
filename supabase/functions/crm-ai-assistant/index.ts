/**
 * Assistente CRM (GLM / Z.ai) — leituras com JWT do utilizador (RLS).
 *
 * Secrets: ZAI_API_KEY (obrigatório), ZAI_MODEL (opcional, ex. glm-4.7).
 * Deploy: supabase functions deploy crm-ai-assistant
 *
 * Nota: respostas de negócio usam HTTP 200 + `{ ok: false, ... }` para o cliente
 * `functions.invoke` conseguir ler sempre o corpo (evita 502 opaco no browser).
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ZAI_BASE = 'https://api.z.ai/api/paas/v4/chat/completions'
/** Limite aproximado do system prompt (caracteres) para evitar rejeição / timeout na Z.ai. */
const MAX_SYSTEM_CHARS = 95_000

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

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
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

async function buildCrmSnapshot(userClient: SupabaseClient, ctx: AiContext): Promise<Record<string, unknown>> {
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
    userClient.from('leads').select('id, stage_id, temperature, score, created_at').limit(200),
    userClient
      .from('leads')
      .select('id, patient_name, phone, source, score, temperature, stage_id, pipeline_id, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    userClient
      .from('interactions')
      .select('id, lead_id, channel, direction, author, content, happened_at')
      .gte('happened_at', interactionSince)
      .order('happened_at', { ascending: false })
      .limit(40),
    userClient.from('app_users').select('id, name, role, active').order('name', { ascending: true }).limit(80),
  ])

  const queryWarnings: string[] = []
  for (const [name, res] of [
    ['app_profiles', profileRes],
    ['metric_configs', metricsRes],
    ['channel_configs', channelsRes],
    ['pipelines', pipelinesRes],
    ['pipeline_stages', stagesRes],
    ['leads_agg', leadsAggRes],
    ['leads_sample', leadsSampleRes],
    ['interactions', interactionsRes],
    ['app_users', usersRes],
  ] as const) {
    if (res.error) queryWarnings.push(`${name}: ${res.error.message}`)
  }

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
    summary: trunc(String(r.summary ?? ''), 280),
  }))

  const interactions = (interactionsRes.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    lead_id: r.lead_id,
    channel: r.channel,
    direction: r.direction,
    author: r.author,
    happened_at: r.happened_at,
    content: trunc(String(r.content ?? ''), 350),
  }))

  let leadFocus: Record<string, unknown> | null = null
  if (ctx.leadId) {
    const { data, error } = await userClient
      .from('leads')
      .select('id, patient_name, phone, source, score, temperature, stage_id, pipeline_id, summary, created_at, custom_fields')
      .eq('id', ctx.leadId)
      .maybeSingle()
    if (error) queryWarnings.push(`lead_focus: ${error.message}`)
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      let cf: string | null = null
      if (d.custom_fields != null) {
        try {
          cf = trunc(JSON.stringify(d.custom_fields), 600)
        } catch {
          cf = null
        }
      }
      leadFocus = {
        ...d,
        summary: trunc(String(d.summary ?? ''), 500),
        custom_fields: cf,
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
    queryWarnings: queryWarnings.length ? queryWarnings : undefined,
    queryNotes: {
      leadsAggregate: 'Até 200 leads (amostra) para distribuição por etapa/temperatura.',
      recentLeads: 'Últimos 30 leads por data de criação.',
      interactions: ctx.weekStartIso
        ? `Interações desde ${ctx.weekStartIso} (pedido do cliente).`
        : 'Interações dos últimos 14 dias.',
    },
  }
}

function extractReplyFromZai(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const p = parsed as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  }
  const msg = p.choices?.[0]?.message
  const c = msg?.content
  if (typeof c === 'string' && c.trim()) return c.trim()
  const r = msg?.reasoning_content
  if (typeof r === 'string' && r.trim()) return r.trim()
  return ''
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: cors })
    }

    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const zaiKey = Deno.env.get('ZAI_API_KEY') ?? ''
    const defaultModel = (Deno.env.get('ZAI_MODEL') ?? 'glm-4.7').trim()

    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ ok: false, error: 'server_misconfigured', message: 'SUPABASE_URL ou ANON_KEY em falta.' }, 500)
    }

    if (!zaiKey) {
      return jsonResponse({
        ok: false,
        error: 'zai_not_configured',
        message: 'Defina o secret ZAI_API_KEY em Project Settings → Edge Functions → Secrets.',
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser()
    if (userErr || !user) {
      return jsonResponse({ ok: false, error: 'unauthorized', message: userErr?.message ?? 'Sessão inválida.' }, 401)
    }

    let body: { messages?: unknown; model?: string; context?: unknown }
    try {
      body = (await req.json()) as { messages?: unknown; model?: string; context?: unknown }
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
    }

    const clientMessages = sanitizeMessages(body.messages)
    if (clientMessages.length === 0) {
      return jsonResponse({ ok: false, error: 'empty_messages' }, 400)
    }

    const requested = String(body.model ?? '').trim()
    const model = ALLOWED_MODELS.has(requested) ? requested : defaultModel
    const context = parseContext(body.context)

    let snapshot: Record<string, unknown>
    try {
      snapshot = await buildCrmSnapshot(userClient, context)
    } catch (e) {
      return jsonResponse({
        ok: false,
        error: 'snapshot_failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }

    const focusHint =
      context.focus === 'analytics'
        ? 'O utilizador pediu ênfase em analytics, tendências da semana e números.'
        : context.focus === 'lead'
          ? 'O utilizador pediu ênfase num lead específico (ver leadFocus se existir).'
          : 'Responda de forma equilibrada entre operação, leads e métricas.'

    let systemContent = [
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

    if (systemContent.length > MAX_SYSTEM_CHARS) {
      systemContent = systemContent.slice(0, MAX_SYSTEM_CHARS) + '\n…[snapshot truncado por tamanho máximo]'
    }

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
      return jsonResponse({
        ok: false,
        error: 'zai_upstream',
        message: trunc(zaiText, 1200),
        status: zaiRes.status,
      })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(zaiText)
    } catch {
      return jsonResponse({
        ok: false,
        error: 'zai_invalid_json',
        message: trunc(zaiText, 800),
      })
    }

    const reply = extractReplyFromZai(parsed)
    if (!reply) {
      return jsonResponse({
        ok: false,
        error: 'zai_empty_reply',
        message: trunc(zaiText, 800),
      })
    }

    return jsonResponse({ ok: true, reply, model })
  } catch (e) {
    return jsonResponse(
      {
        ok: false,
        error: 'unhandled',
        message: e instanceof Error ? e.message : String(e),
      },
      500,
    )
  }
})
