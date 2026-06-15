/**
 * Assistente CRM (GLM / Z.ai) — leituras com JWT do utilizador (RLS).
 *
 * Secrets: ZAI_API_KEY (obrigatório).
 * Opcionais: ZAI_MODEL (código oficial, ex. glm-4.7, glm-5.1),
 *   ZAI_API_BASE — URL base sem trailing slash:
 *   - pay-as-you-go (saldo): https://api.z.ai/api/paas/v4 (comportamento antigo)
 *   - Coding Plan (subscrição): https://api.z.ai/api/coding/paas/v4
 *     A doc Z.ai indica que este URL é para integrações listadas (IDEs, agentes de código);
 *     um CRM customizado pode precisar de /paas/v4 + saldo.
 *   O código do modelo é o mesmo nos dois; não use prefixo zai-coding-plan/ nesta API.
 * Deploy: supabase functions deploy crm-ai-assistant
 *
 * Chamadas **internas** (ManyChat / WhatsApp auto-reply): header `x-crm-ai-internal-secret`
 * igual ao secret `CRM_AI_INTERNAL_SECRET` (≥16 caracteres) nas Edge Functions; usa
 * service role para o snapshot (sem JWT de utilizador).
 *
 * Nota: respostas de negócio usam HTTP 200 + `{ ok: false, ... }` para o cliente
 * `functions.invoke` conseguir ler sempre o corpo (evita 502 opaco no browser).
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { normalizeWhatsappPatientFormatting, sanitizeCrmAiPatientReply } from '../_shared/crmAiAutoReply.ts'
import {
  executeCrmAiOpsFromModel,
  executeListLeadsFilteredOps,
  isListLeadsFilteredOp,
  peelCrmOpsFromModelReply,
  type CrmAiActionResult,
  type ListedLeadRow,
} from '../_shared/crmAiOpsExecutor.ts'
import { readZaiConfigForTenant } from '../_shared/tenantLlmConfig.ts'
import { buildShospAiContext } from '../_shared/shospAiContext.ts'
import { buildBlingCatalog } from '../_shared/bling.ts'
import { readPagBankConfig } from '../_shared/pagbank.ts'

const MIN_INTERNAL_SECRET_LEN = 16

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-crm-ai-internal-secret',
}

/** Limite aproximado do system prompt (caracteres) para evitar rejeição / timeout na Z.ai. */
const MAX_SYSTEM_CHARS = 95_000

export type CepInfo = { cep: string; localidade: string; uf: string; bairro: string }

/** Acha o CEP mais recente (8 dígitos) num conjunto de textos do cliente. */
export function extractLatestCep(texts: string[]): string {
  for (let i = texts.length - 1; i >= 0; i--) {
    const m = String(texts[i] ?? '').match(/\b(\d{5})-?\s?(\d{3})\b/)
    if (m) return `${m[1]}${m[2]}`
  }
  return ''
}

/**
 * Resolve CEP -> cidade/UF no servidor (ViaCEP). A IA NUNCA deve adivinhar a cidade
 * pelo número do CEP (errava — ex.: tratou 87030-090/Maringá como Cascavel).
 */
export async function resolveCepBrasil(rawCep: string): Promise<CepInfo | null> {
  const digits = String(rawCep ?? '').replace(/\D/g, '')
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const data = (await res.json()) as { localidade?: string; uf?: string; bairro?: string; erro?: boolean }
    if (data.erro || !data.localidade) return null
    return {
      cep: `${digits.slice(0, 5)}-${digits.slice(5)}`,
      localidade: String(data.localidade),
      uf: String(data.uf ?? ''),
      bairro: String(data.bairro ?? ''),
    }
  } catch {
    return null
  }
}

/** Alinhado à enum da API Z.ai (chat completions); códigos sem prefixo. */
const GLM_MODEL_IDS = [
  'glm-5.1',
  'glm-5',
  'glm-5-turbo',
  'glm-4.7',
  'glm-4.7-flash',
  'glm-4.7-flashx',
  'glm-4.6',
  'glm-4.5',
  'glm-4.5-air',
  'glm-4.5-x',
  'glm-4.5-airx',
  'glm-4.5-flash',
  'glm-4-32b-0414-128k',
  /** Legado no UI do CRM; mantidos por compatibilidade se a API ainda aceitar */
  'glm-4-flash',
  'glm-4-plus',
] as const

const ALLOWED_MODELS = new Set<string>([...GLM_MODEL_IDS])

function zaiApiRootFromEnv(): string {
  const envBase = (Deno.env.get('ZAI_API_BASE') ?? '').trim().replace(/\/$/, '')
  // Se o usuário quer usar o saldo (pay-as-you-go), o endpoint deve ser /paas/v4.
  // Se o secret estiver vazio ou ainda apontar para /coding/, forçamos o endpoint de saldo.
  if (!envBase || envBase.includes('/coding/')) {
    return 'https://api.z.ai/api/paas/v4'
  }
  return envBase
}

/** Alguns clientes usam zai-coding-plan/glm-*; a REST Z.ai espera só glm-*. */
function normalizeZaiModelCode(model: string): string {
  const m = model.trim()
  if (m.startsWith('zai-coding-plan/')) return m.slice('zai-coding-plan/'.length)
  return m
}

function isCodingPlanApiRoot(apiRoot: string): boolean {
  return apiRoot.includes('/coding/')
}

/** Doc Z.ai: GLM-5.x usa temperature por omissão ~1.0; evitar valores muito baixos. */
function temperatureForModel(model: string): number {
  if (model.startsWith('glm-5')) return 1.0
  return 0.7
}

/**
 * Com /coding/, alguns gateways falham com `role: system` + contexto grande;
 * fundir na primeira mensagem `user` alinha-se a exemplos só com `user`.
 */
function buildMessagesForZaiRequest(
  systemContent: string,
  clientMessages: ChatMsg[],
  codingEndpoint: boolean,
): ChatMsg[] {
  if (!codingEndpoint) {
    return [{ role: 'system', content: systemContent }, ...clientMessages]
  }
  if (clientMessages.length === 0) {
    return [{ role: 'user', content: systemContent }]
  }
  const first = clientMessages[0]
  if (first.role === 'user') {
    return [{ role: 'user', content: `${systemContent}\n\n---\n\n${first.content}` }, ...clientMessages.slice(1)]
  }
  return [{ role: 'user', content: systemContent }, ...clientMessages]
}

type ChatMsg = { role: string; content: string }

type AiContext = {
  leadId?: string
  weekStartIso?: string
  focus?: 'analytics' | 'lead' | 'general'
  /** Liga o prompt IA à linha em `whatsapp_channel_instances` (Evolution ou ManyChat). */
  whatsappInstanceId?: string
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
  const rawLeadId = typeof o.leadId === 'string' ? o.leadId.trim() : ''
  const leadId =
    rawLeadId.length > 0 && rawLeadId.length <= 128 && !/[\s<>"']/.test(rawLeadId) ? rawLeadId : undefined
  const weekStartIso =
    typeof o.weekStartIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.weekStartIso.trim()) ? o.weekStartIso.trim() : undefined
  const f = typeof o.focus === 'string' ? o.focus.trim().toLowerCase() : ''
  const focus = f === 'analytics' || f === 'lead' || f === 'general' ? (f as AiContext['focus']) : undefined
  const wiRaw = typeof o.whatsapp_instance_id === 'string' ? o.whatsapp_instance_id.trim() : ''
  const whatsappInstanceId =
    wiRaw.length > 0 && wiRaw.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(wiRaw) ? wiRaw : undefined
  return { leadId, weekStartIso, focus, whatsappInstanceId }
}

async function buildCrmSnapshot(
  userClient: SupabaseClient,
  ctx: AiContext,
  opts?: { skipAppProfile?: boolean; tenantId?: string },
): Promise<Record<string, unknown>> {
  const interactionSince = ctx.weekStartIso
    ? `${ctx.weekStartIso}T00:00:00.000Z`
    : (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - 14)
        return d.toISOString()
      })()

  const profilePromise = opts?.skipAppProfile
    ? Promise.resolve({ data: null, error: null })
    : userClient.from('app_profiles').select('email, display_name, role').maybeSingle()

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
    aiConfigRes,
  ] = await Promise.all([
    profilePromise,
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
    // crm_ai_configs tem PK (tenant_id, id): com mais de um tenant, filtrar por id='default'
    // sozinho devolve várias linhas e o .maybeSingle() falha → config (e o script) somem.
    // No caminho interno (service-role, sem RLS) o tenant vem do lead; na sessão do utilizador
    // a RLS já isola, mas escopar por tenant é inócuo e mantém tudo correto.
    opts?.tenantId
      ? userClient.from('crm_ai_configs').select('*').eq('id', 'default').eq('tenant_id', opts.tenantId).maybeSingle()
      : userClient.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle(),
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
    ['crm_ai_configs', aiConfigRes],
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
    const nowIso = new Date().toISOString()
    const [leadRes, mediaRes, apptRes, roomsRes, threadRes] = await Promise.all([
      userClient
        .from('leads')
        .select('id, patient_name, phone, source, score, temperature, stage_id, pipeline_id, summary, created_at, custom_fields')
        .eq('id', ctx.leadId)
        .maybeSingle(),
      userClient
        .from('crm_media_items')
        .select('id, media_type, direction, transcribed_text, extracted_text, created_at')
        .eq('lead_id', ctx.leadId)
        .order('created_at', { ascending: false })
        .limit(24),
      userClient
        .from('appointments')
        .select('id, starts_at, ends_at, status, room_id, notes')
        .eq('lead_id', ctx.leadId)
        .gte('starts_at', nowIso)
        .order('starts_at', { ascending: true })
        .limit(12),
      userClient.from('rooms').select('id, name, active').eq('active', true).order('name', { ascending: true }).limit(24),
      userClient
        .from('interactions')
        .select('id, channel, direction, author, content, happened_at')
        .eq('lead_id', ctx.leadId)
        .order('happened_at', { ascending: false })
        .limit(36),
    ])
    if (leadRes.error) queryWarnings.push(`lead_focus: ${leadRes.error.message}`)
    if (mediaRes.error) queryWarnings.push(`crm_media_items: ${mediaRes.error.message}`)
    if (apptRes.error) queryWarnings.push(`appointments_lead: ${apptRes.error.message}`)
    if (roomsRes.error) queryWarnings.push(`rooms: ${roomsRes.error.message}`)
    if (threadRes.error) queryWarnings.push(`lead_thread: ${threadRes.error.message}`)
    if (leadRes.data && typeof leadRes.data === 'object') {
      const d = leadRes.data as Record<string, unknown>
      let cf: string | null = null
      if (d.custom_fields != null) {
        try {
          cf = trunc(JSON.stringify(d.custom_fields), 600)
        } catch {
          cf = null
        }
      }
      const mediaRows = (mediaRes.data ?? []) as Record<string, unknown>[]
      const recent_media_intel = mediaRows.map((row) => ({
        id: row.id,
        media_type: row.media_type,
        direction: row.direction,
        created_at: row.created_at,
        audio_transcript: row.transcribed_text ? trunc(String(row.transcribed_text), 3500) : null,
        document_or_image_text: row.extracted_text ? trunc(String(row.extracted_text), 3500) : null,
      }))
      const upcomingAppointments = (apptRes.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        status: row.status,
        room_id: row.room_id,
        notes: row.notes ? trunc(String(row.notes), 200) : null,
      }))
      const rooms_catalog = (roomsRes.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        name: row.name,
      }))
      const threadRows = [...((threadRes.data ?? []) as Record<string, unknown>[])].reverse()
      const recent_conversation = threadRows.map((row) => ({
        channel: row.channel,
        direction: row.direction,
        author: row.author,
        happened_at: row.happened_at,
        content: trunc(String(row.content ?? ''), 420),
      }))
      leadFocus = {
        ...d,
        summary: trunc(String(d.summary ?? ''), 500),
        custom_fields: cf,
        recent_media_intel,
        upcoming_appointments: upcomingAppointments,
        rooms_catalog,
        recent_conversation,
      }
    }
  }

  const baseAiCfg = (aiConfigRes.data ?? null) as Record<string, unknown> | null
  let crm_ai_configs: Record<string, unknown> | null = baseAiCfg ? { ...baseAiCfg } : null
  // bot_kind define a PERSONA da linha: 'clinic' (Sofia/Instituto Lorena, agenda Shosp)
  // ou 'sales' (atendente de vendas — ex.: Tricopill). Default 'clinic' preserva a clínica.
  let botKind: 'clinic' | 'sales' = 'clinic'
  if (ctx.whatsappInstanceId) {
    const instRes = await userClient
      .from('whatsapp_channel_instances')
      .select('ai_system_prompt, bot_kind')
      .eq('id', ctx.whatsappInstanceId)
      .maybeSingle()
    const inst = instRes.data as { ai_system_prompt?: string; bot_kind?: string } | null
    const linePrompt = String(inst?.ai_system_prompt ?? '').trim()
    if (linePrompt) {
      crm_ai_configs = { ...(crm_ai_configs ?? {}), system_prompt: linePrompt }
    }
    if (String(inst?.bot_kind ?? '').toLowerCase() === 'sales') botKind = 'sales'
  }

  return {
    generatedAt: new Date().toISOString(),
    requestContext: ctx,
    botKind,
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
    crm_ai_configs,
    queryWarnings: queryWarnings.length ? queryWarnings : undefined,
    queryNotes: {
      leadsAggregate: 'Até 200 leads (amostra) para distribuição por etapa/temperatura.',
      recentLeads: 'Últimos 30 leads por data de criação.',
      interactions: ctx.weekStartIso
        ? `Interações desde ${ctx.weekStartIso} (pedido do cliente).`
        : 'Interações dos últimos 14 dias.',
      ...(opts?.skipAppProfile
        ? {
            internalService:
              'Snapshot via service role (auto-reply ManyChat/WhatsApp). Sem perfil de utilizador.',
          }
        : {}),
    },
  }
}

/**
 * Só `message.content` é texto destinado ao utilizador/paciente.
 * `reasoning_content` (modelos com "thinking") é raciocínio interno — nunca enviar ao WhatsApp.
 */
function extractReplyFromZai(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const p = parsed as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
  }
  const msg = p.choices?.[0]?.message
  const c = msg?.content
  if (typeof c === 'string' && c.trim()) return c.trim()
  return ''
}

const PATIENT_REPLY_MARKER = '<<<PACIENTE>>>'

/**
 * Modelos GLM por vezes devolvem monólogos em inglês ("Analyze the User's Input…") em `content`.
 * Tenta recuperar só a parte em português (saudação + corpo) ou o bloco após o marcador.
 */
function stripInternalPatientReply(raw: string): string {
  const t = raw.trim()
  if (!t) return t

  const marked = t.indexOf(PATIENT_REPLY_MARKER)
  if (marked >= 0) {
    const after = t.slice(marked + PATIENT_REPLY_MARKER.length).trim()
    if (after) return after
  }

  // GLM-4.5/4.6 em modo reasoning costuma devolver <thinking>...</thinking> e depois a resposta.
  // O bloco <thinking> é apagado por sanitizeCrmAiPatientReply; se a saída só tiver thinking
  // e nada depois, o paciente recebia o fallback. Aqui extraímos o que vier depois do último
  // fecho de thinking/think — incluindo, se existir, o marcador <<<PACIENTE>>>.
  const closeTagRe = /<\/think(?:ing)?>/gi
  let lastCloseEnd = -1
  for (const m of t.matchAll(closeTagRe)) {
    if (m.index != null) lastCloseEnd = m.index + m[0].length
  }
  if (lastCloseEnd >= 0) {
    const afterThink = t.slice(lastCloseEnd).trim()
    if (afterThink.length >= 4) {
      const m2 = afterThink.indexOf(PATIENT_REPLY_MARKER)
      if (m2 >= 0) {
        const after2 = afterThink.slice(m2 + PATIENT_REPLY_MARKER.length).trim()
        if (after2) return after2
      }
      return afterThink
    }
  }

  const cotSignature = /Analyze the User'?s?\s+Input|Interpretation:\s*\*\*|Constraint Check:/i
  if (!cotSignature.test(t)) return t

  let lastGreeting: string | undefined
  for (const m of t.matchAll(/\n\n((?:Bom dia|Boa tarde|Boa noite|Olá|Oi)\b[\s\S]+)/gi)) {
    lastGreeting = m[1].trim()
  }
  if (lastGreeting && lastGreeting.length >= 12 && !/^(\d+\.|Analyze)/i.test(lastGreeting)) {
    return lastGreeting
  }

  const blocks = t.split(/\n{2,}/)
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i].trim()
    if (b.length < 16) continue
    if (/Analyze|Interpretation|Constraint Check|leadFocus|`channel`|^\d+\.\s+\*{0,2}Analyze/i.test(b)) continue
    if (/^(Olá|Oi|Bom dia|Boa tarde|Boa noite|Seja)/i.test(b)) return b
  }
  return t
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

    if (!supabaseUrl || !anonKey) {
      return jsonResponse({ ok: false, error: 'server_misconfigured', message: 'SUPABASE_URL ou ANON_KEY em falta.' }, 500)
    }

    // Z.ai key/root/model serão resolvidos por tenant após `dbClient` estar pronto e o context ter sido parseado.
    let zaiKey = ''
    let zaiApiRoot = zaiApiRootFromEnv()
    let zaiChatUrl = `${zaiApiRoot}/chat/completions`
    let defaultModel = normalizeZaiModelCode(Deno.env.get('ZAI_MODEL')?.trim() || 'glm-4.7')

    const rawBody = await req.text()
    let body: { messages?: unknown; model?: string; context?: unknown; promptOverride?: unknown }
    try {
      body = JSON.parse(rawBody) as {
        messages?: unknown
        model?: string
        context?: unknown
        promptOverride?: unknown
      }
    } catch {
      return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
    }

    const internalHdr = (req.headers.get('x-crm-ai-internal-secret') ?? '').trim()
    const internalEnv = (Deno.env.get('CRM_AI_INTERNAL_SECRET') ?? '').trim()
    const isInternal = internalEnv.length >= MIN_INTERNAL_SECRET_LEN && internalHdr === internalEnv

    let dbClient: SupabaseClient
    if (isInternal) {
      const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      if (!serviceRole) {
        return jsonResponse(
          {
            ok: false,
            error: 'server_misconfigured',
            message: 'SUPABASE_SERVICE_ROLE_KEY em falta para chamada interna.',
          },
          500,
        )
      }
      dbClient = createClient(supabaseUrl, serviceRole)
    } else {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
      }

      dbClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const {
        data: { user },
        error: userErr,
      } = await dbClient.auth.getUser()
      if (userErr || !user) {
        return jsonResponse({ ok: false, error: 'unauthorized', message: userErr?.message ?? 'Sessão inválida.' }, 401)
      }
    }

    const clientMessages = sanitizeMessages(body.messages)
    if (clientMessages.length === 0) {
      return jsonResponse({ ok: false, error: 'empty_messages' }, 400)
    }

    const requestedRaw = String(body.model ?? '').trim()
    const requested = normalizeZaiModelCode(requestedRaw)
    const context = parseContext(body.context)
    const promptOverride = typeof body.promptOverride === 'string' ? body.promptOverride.trim() : ''

    // ===== Resolução de tenant + carga da config Z.ai por tenant =====
    // Internal (auto-reply): tenant_id vem do lead (context.leadId).
    // User session: tenant_id vem de current_tenant_id() RPC.
    // Fallback: env globais (Instituto Lorena hoje).
    let tenantId = ''
    try {
      if (isInternal && context.leadId) {
        const { data: leadRow } = await dbClient
          .from('leads')
          .select('tenant_id')
          .eq('id', context.leadId)
          .maybeSingle()
        tenantId = String((leadRow as { tenant_id?: string } | null)?.tenant_id ?? '').trim()
      } else if (!isInternal) {
        const { data: tid } = await dbClient.rpc('current_tenant_id')
        tenantId = typeof tid === 'string' ? tid.trim() : ''
      }
    } catch (e) {
      console.warn('crm-ai-assistant: tenant resolution failed, using global env:', e instanceof Error ? e.message : e)
    }

    const zaiCfg = await readZaiConfigForTenant(dbClient, tenantId)
    if (!zaiCfg) {
      return jsonResponse({
        ok: false,
        error: 'zai_not_configured',
        message: 'Defina o secret ZAI_API_KEY (global) ou configure tenant_integrations.llm.zai.api_key.',
      })
    }
    zaiKey = zaiCfg.apiKey
    zaiApiRoot = zaiCfg.apiRoot
    zaiChatUrl = `${zaiApiRoot}/chat/completions`
    defaultModel = normalizeZaiModelCode(zaiCfg.model)

    const model = ALLOWED_MODELS.has(requested)
      ? requested
      : ALLOWED_MODELS.has(defaultModel)
        ? defaultModel
        : 'glm-4.7'

    let snapshot: Record<string, unknown>
    try {
      snapshot = await buildCrmSnapshot(dbClient, context, { skipAppProfile: isInternal, tenantId })
    } catch (e) {
      return jsonResponse({
        ok: false,
        error: 'snapshot_failed',
        message: e instanceof Error ? e.message : String(e),
      })
    }

    // Persona da linha: linhas de VENDAS (ex.: Tricopill) não usam Sofia/clínica/Shosp.
    const isSalesBot = (snapshot as { botKind?: string }).botKind === 'sales'

    // Agendamento autônomo da Sofia (kill-switch por tenant). false = "meio-termo":
    // a Dandara conduz a marcação; a Sofia só auxilia. true = a Sofia agenda sozinha.
    let autoBookOn = false
    if (isInternal && !isSalesBot) {
      try {
        const { data: cfgFlag } = await dbClient
          .from('crm_ai_configs')
          .select('auto_scheduling_enabled')
          .eq('id', 'default')
          .eq('tenant_id', tenantId)
          .maybeSingle()
        autoBookOn = Boolean((cfgFlag as { auto_scheduling_enabled?: boolean } | null)?.auto_scheduling_enabled)
      } catch {
        autoBookOn = false
      }
    }

    // Shosp = fonte da verdade da agenda. Injeta os agendamentos REAIS do paciente
    // (sempre) e a disponibilidade real (SÓ no modo auto — no meio-termo a Dandara
    // conduz, então não tentamos a IA com horários livres).
    if (isInternal && !isSalesBot && context.leadId) {
      try {
        const lastUser = [...clientMessages].reverse().find((m) => (m as { role?: string }).role === 'user')
        const lastText = typeof (lastUser as { content?: unknown })?.content === 'string'
          ? ((lastUser as { content: string }).content)
          : ''
        const shospCtx = await buildShospAiContext(dbClient, context.leadId, lastText, { includeAvailability: autoBookOn })
        if (shospCtx) (snapshot as Record<string, unknown>).shosp = shospCtx
      } catch {
        // best-effort
      }
    }

    // Catálogo Bling para os bots de VENDAS — APENAS nome/estoque. O `preco` do Bling
    // costuma ser o CUSTO (não o preço de venda), então é REMOVIDO aqui para a IA NUNCA
    // cotar custo ao cliente. Preço de venda vem só do PROMPT ADICIONAL.
    if (isSalesBot && tenantId) {
      try {
        const cat = await buildBlingCatalog(dbClient, tenantId)
        // Só produtos com PREÇO DE VENDA (preco > 0) E sem estoque NEGATIVO.
        // estoque null = não controlado (mantém); 0 mantém; < 0 oculta (indisponível/oversold).
        const sellable = cat.items.filter((i) => i.preco > 0 && (i.estoque === null || i.estoque >= 0))
        if (sellable.length) {
          (snapshot as Record<string, unknown>).bling_catalog = sellable.map((i) => ({
            nome: i.nome,
            codigo: i.codigo,
            preco: i.preco,
            estoque: i.estoque,
          }))
        }
      } catch {
        // best-effort
      }
    }

    // Pix só é oferecido pelo bot quando o PagBank está em PRODUÇÃO. Em sandbox o código
    // não é pagável, então a IA NÃO gera Pix (faz handoff). Casado com a trava em pagbank.ts.
    let pixEnabled = false
    if (isSalesBot && tenantId) {
      try {
        const pbCfg = await readPagBankConfig(dbClient, tenantId)
        pixEnabled = pbCfg?.env === 'prod'
      } catch {
        pixEnabled = false
      }
    }

    // Vendas: se o cliente mandou um CEP, resolve a cidade REAL no servidor (ViaCEP) e
    // injeta no snapshot. A IA NÃO deve adivinhar a cidade pelo número do CEP (errava o
    // frete). Varre as mensagens do cliente nesta chamada pegando o CEP mais recente.
    if (isSalesBot) {
      try {
        const userTexts: string[] = []
        // Histórico do CRM primeiro (mais antigo), só mensagens DO CLIENTE (direction 'in').
        const lf = snapshot.leadFocus as { recent_conversation?: Array<Record<string, unknown>> } | null | undefined
        for (const row of lf?.recent_conversation ?? []) {
          if (String(row.direction ?? '').toLowerCase() === 'in') userTexts.push(String(row.content ?? ''))
        }
        // Mensagens desta chamada por último (mais recentes) — têm prioridade.
        for (const m of clientMessages) {
          if ((m as { role?: string }).role === 'user' && typeof (m as { content?: unknown }).content === 'string') {
            userTexts.push((m as { content: string }).content)
          }
        }
        const cep = extractLatestCep(userTexts)
        if (cep) {
          const info = await resolveCepBrasil(cep)
          if (info) (snapshot as Record<string, unknown>).cep_info = info
        }
      } catch {
        // best-effort
      }
    }

    const focusHint =
      context.focus === 'analytics'
        ? 'O utilizador pediu ênfase em analytics, tendências da semana e números.'
        : context.focus === 'lead'
          ? 'O utilizador pediu ênfase num lead específico (ver leadFocus se existir).'
          : 'Responda de forma equilibrada entre operação, leads e métricas.'

    // Contexto temporal em Maringá/Brasília para saudações apropriadas e janela de atendimento humano.
    const brasilNow = new Date()
    const brasilHourBR = Number(
      new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(brasilNow),
    )
    const brasilWeekday = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'long',
    }).format(brasilNow)
    const brasilDateTime = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(brasilNow)
    const brasilPeriod =
      brasilHourBR < 5 ? 'madrugada'
      : brasilHourBR < 12 ? 'manhã'
      : brasilHourBR < 18 ? 'tarde'
      : 'noite'
    const brasilGreeting =
      brasilHourBR < 5 ? 'Boa noite'
      : brasilHourBR < 12 ? 'Bom dia'
      : brasilHourBR < 18 ? 'Boa tarde'
      : 'Boa noite'
    const isWeekday = /^(segunda|terça|quarta|quinta|sexta)/i.test(brasilWeekday)
    const isBusinessHours = isWeekday && brasilHourBR >= 8 && brasilHourBR < 18

    const shospBookingLines = autoBookOn
      ? [
          'Quando o paciente quiser agendar/remarcar e houver `shosp.disponibilidade`, OFEREÇA 2 ou 3 horários REAIS dessa lista (horarios_livres traz data+hora de verdade) e pergunte qual ele prefere. NUNCA invente horário fora da lista.',
          'AGENDAR (você pode agendar sozinha): quando o paciente CONFIRMAR um horário de `shosp.disponibilidade`, inclua na MESMA resposta <<<CRM_OPS>>>{"version":1,"ops":[{"type":"shosp_book","codigoPrestador":N,"codigoServico":N,"data":"AAAA-MM-DD","horario":"HH:MM","codigoHorario":N}]}',
          '- codigoPrestador/data/horario/codigoHorario vêm EXATAMENTE do item escolhido; codigoServico vem de `shosp.servicos_consulta` (médico + gênero certos).',
          'O servidor confirma o horário na MESMA mensagem — escreva como já agendado. Se faltar dado (missing_patient_data) peça ao paciente; se slot_taken ofereça outro. A tag <<<CRM_OPS>>> NUNCA aparece para o paciente.',
          'Se NÃO houver `shosp.disponibilidade`, diga que a Dandara confirma o melhor horário.',
        ]
      : [
          'MEIO-TERMO — a MARCAÇÃO do horário é conduzida pela DANDARA (consultora humana), NÃO por você. Seu papel é AUXILIAR: identifique o tipo de atendimento e a preferência de período (manhã/tarde), tire dúvidas, e diga que a Dandara vai confirmar o melhor horário e passar os detalhes em seguida.',
          'NÃO fique oferecendo horários específicos, NÃO use ferramentas de agendamento, NÃO diga "já agendei" nem invente protocolo. (Sobre consultas JÁ marcadas, PODE responder usando `shosp.agendamentos`.)',
        ]

    // Persona de VENDAS (ex.: Tricopill). Mantém os tokens/regras agnósticos que o
    // pipeline exige (marcador <<<PACIENTE>>>, anti-raciocínio, formatação WhatsApp,
    // saudação contextual) e troca todo o miolo de triagem/agenda da clínica por
    // condução de venda. O conhecimento do produto (kits, preços) vem do PROMPT
    // ADICIONAL (ai_system_prompt da linha), editável no DB sem redeploy.
    const SALES_MODE_BLOCK = [
      '--- MODO RESPOSTA DIRETA AO CLIENTE (VENDAS) ---',
      'Sua resposta será enviada IMEDIATAMENTE ao cliente pelo WhatsApp. Você é a atendente comercial da loja — atenda de forma calorosa, consultiva e objetiva, com foco em ajudar e vender.',
      'MANDATORY: Não inclua análises, explicações internas, raciocínios, etapas (ex: "1. Analisar...") nem qualquer texto que não seja para o cliente.',
      'MANDATORY: Não escreva planeamento em inglês ("Analyze the User", "Decision", "Strategy") nem listas numeradas de raciocínio.',
      'MANDATORY: Não escreva nomes de ferramentas, JSON de chamadas de API nem texto técnico para o cliente.',
      'MANDATORY: A primeira linha da sua resposta DEVE ser exactamente: <<<PACIENTE>>>',
      'MANDATORY: Na linha seguinte, escreva APENAS a mensagem WhatsApp em português (cordial, vendedora, humana). Nada antes de <<<PACIENTE>>>.',
      'PROIBIDO ABSOLUTAMENTE: blocos <thinking>, <think>, <reasoning>, <reflection> ou qualquer marcação XML de raciocínio. Raciocine SILENCIOSAMENTE e produza APENAS a linha <<<PACIENTE>>> seguida da mensagem. Respostas só com raciocínio (sem texto após <<<PACIENTE>>>) são DESCARTADAS — o cliente fica sem resposta.',
      'Formatação WhatsApp: para destacar use **negrito assim** (dois asteriscos). Não use quatro asteriscos (****) nem um único asterisco *assim*.',
      `MANDATORY (saudações): use saudação contextual APENAS na primeira mensagem de uma nova conversa. A saudação OBRIGATÓRIA agora é "${brasilGreeting}" (horário de Brasília — NÃO use outra). Em mensagens seguintes da mesma conversa NÃO repita "Olá / Bom dia / Boa tarde / Boa noite".`,
      '',
      '--- OBJETIVO DE VENDAS ---',
      'Objetivo: entender a necessidade do cliente (queixa capilar, há quanto tempo, se já usou algo), apresentar o produto e os kits/preços (use SEMPRE os valores do PROMPT ADICIONAL — NUNCA invente preço, prazo, composição ou promessa de resultado), tirar dúvidas e conduzir à compra.',
      'Seja consultiva, não robótica: faça no máximo 1–2 perguntas por mensagem, conecte o benefício à queixa do cliente e crie um próximo passo claro.',
      'Use APENAS informações do PROMPT ADICIONAL e do snapshot. Se não souber algo (ex.: contraindicação médica específica), seja honesta e ofereça encaminhar para um especialista — não invente.',
      'snapshot.bling_catalog é o catálogo REAL do Bling JÁ FILTRADO (só produtos COM preço de venda): cada item tem nome, código, **preco** (preço de VENDA em reais) e estoque. É a fonte da verdade de produtos, preços e disponibilidade. Se o estoque for 0 ou negativo (ou null = não controlado), não prometa pronta-entrega — diga que confirma o prazo. Não ofereça item que não esteja no catálogo.',
      'PREÇO: para os produtos do catálogo, você PODE e DEVE informar o "preco" (preço de venda) que está no bling_catalog. EXCEÇÃO IMPORTANTE — os KITS do Tricopill (1 mês, 3+1, 5 meses) seguem SEMPRE os valores e promoções do PROMPT ADICIONAL (ex.: Pix com 5% off), NUNCA o preço de linha do catálogo (que pode divergir). Se o cliente perguntar o valor de algo que NÃO está nem no bling_catalog nem no PROMPT ADICIONAL, NÃO invente — diga que confirma com a atendente. Cotar preço inventado é PROIBIDO; o frete é sempre cobrado à parte.',
      'NUNCA faça promessa de cura nem garanta resultado; fale em benefícios e uso contínuo conforme a posologia informada.',
      'VALORES, PAGAMENTO E FRETE: apresente os valores, as formas de pagamento/parcelas e o FRETE EXATAMENTE como definido no PROMPT ADICIONAL — nunca invente preço, parcela ou desconto. Ao passar QUALQUER preço, informe SEMPRE que o frete é cobrado à parte (não está incluso no valor do produto) e pergunte a cidade/CEP do cliente para calcular — principalmente clientes de fora de Maringá.',
      'FECHAMENTO NO CARTÃO (você gera o link sozinha): quando o cliente decidir comprar no CARTÃO — já escolheu o kit, quer cartão e JÁ informou a cidade (para o frete) — gere o link você mesma. Na MESMA resposta, DEPOIS da mensagem ao cliente, acrescente exatamente: <<<CRM_OPS>>>{"version":1,"ops":[{"type":"rede_link","kit":"3_meses","installments":12,"freight_cents":1500,"coupon":"CODIGO_SE_HOUVER"}]}. O servidor cria o link de cartão (em até 12x) e ANEXA sozinho na sua mensagem — então escreva de forma calorosa que o link está logo abaixo (ex.: "Prontinho! 💳 Seu link de pagamento no cartão tá aqui embaixo, é só preencher os dados 💚"). NUNCA escreva uma URL nem invente o link: só o servidor gera. NÃO use [PRONTO_PARA_CONSULTOR] ao gerar o link — CONTINUE atendendo para tirar dúvidas e ajudar a concluir o pagamento.',
      'KIT no op: passe "kit" com a chave do kit escolhido — "1_mes", "3_meses" ou "5_meses" — exatamente como descrito no PROMPT ADICIONAL. O servidor já aplica o PREÇO CHEIO de cartão desse kit; você NÃO calcula o valor do produto, só informa o frete.',
      'FRETE NO LINK: "freight_cents" é o frete em CENTAVOS (ex.: R$ 15,00 = 1500), conforme a cidade no PROMPT ADICIONAL. CIDADE — NUNCA adivinhe a cidade pelo número do CEP (você erra). Se existir snapshot.cep_info, a cidade REAL do cliente é cep_info.localidade/cep_info.uf — use SOMENTE essa, jamais outra. Se o cliente só mandou o CEP e NÃO existir cep_info, NÃO afirme nenhuma cidade — peça a cidade. Se a cidade for MARINGÁ, você JÁ sabe o frete (R$15 = 1500) — GERE o link na hora. Frete grátis/incluso = 0 ou omita.',
      'CUPOM: se o cliente informar um cupom, passe em "coupon":"CODIGO" no op — o servidor valida e aplica o desconto sozinho (cupom inválido = valor cheio). NÃO confirme valor com desconto por conta própria; o link já sai com o preço certo.',
      ...(pixEnabled
        ? [
            'FECHAMENTO NO PIX (você gera o Pix sozinha — copia-e-cola + QR): quando o cliente decidir comprar no PIX (escolheu o kit, quer Pix e a cidade do frete já está resolvida), gere o Pix. Na MESMA resposta, DEPOIS da mensagem, acrescente: <<<CRM_OPS>>>{"version":1,"ops":[{"type":"pagbank_pix","kit":"3_meses","freight_cents":1500,"coupon":"CODIGO_SE_HOUVER"}]}. O servidor gera o Pix e ANEXA o copia-e-cola no texto + envia o QR Code como imagem — então escreva de forma calorosa que o Pix está logo abaixo (ex.: "Prontinho! 💸 Te mandei o Pix copia e cola e o QR Code aqui embaixo, é só pagar no app do seu banco 💚"). NUNCA escreva/invente um código Pix você mesma: só o servidor gera. NÃO use [PRONTO_PARA_CONSULTOR] ao gerar o Pix — CONTINUE atendendo.',
            'OBSERVAÇÃO PIX: o "kit"/"freight_cents"/"coupon" do op pagbank_pix seguem as MESMAS regras do cartão (kit do PROMPT ADICIONAL, frete em centavos pela cidade do cep_info, cupom validado pelo servidor). O Pix do PagBank já aplica o desconto de 5% próprio dos kits.',
          ]
        : [
            'PIX → SEMPRE HUMANO (NÃO gere Pix): o pagamento por PIX está temporariamente INDISPONÍVEL no atendimento automático. Se o cliente quiser pagar no PIX, você NUNCA gera código/QR nem promete um Pix — diga com cordialidade que um atendente já vai te enviar o Pix certinho e termine a resposta com [PRONTO_PARA_CONSULTOR] na última linha. (Apenas o CARTÃO/Rede você gera sozinha; o Pix é só pelo atendente por enquanto.)',
          ]),
      'EXCEÇÕES → HUMANO: passe pro humano com [PRONTO_PARA_CONSULTOR] APENAS se o cliente pedir um atendente humano, ou a cidade tiver frete que você REALMENTE não conhece pelo PROMPT ADICIONAL. NUNCA transfira só para "calcular o frete" de uma cidade cujo valor você já sabe (ex.: Maringá, R$15) — gere o link/Pix você mesma. (O sistema remove o marcador; o cliente não vê.)',
      'VÁRIAS MENSAGENS: se leadFocus.recent_conversation mostrar vários "in" seguidos do cliente, trate como um único contexto — responda de forma completa sem pedir de novo o que já foi dito.',
    ].join('\n')

    let systemContent = [
      isInternal
        ? (isSalesBot
            ? 'Você é a *atendente virtual de vendas da Tricopill* (suplemento capilar). Ao falar com clientes pelo WhatsApp, apresente-se de forma calorosa na primeira mensagem da conversa (ex.: "Oi! Aqui é da Tricopill 💚"). Em mensagens seguintes da mesma conversa, NÃO repita a apresentação.'
            : 'Você é a *Sofia*, a assistente virtual do Instituto Lorena Visentainer. Ao falar com pacientes pelo WhatsApp, apresente-se como Sofia na primeira mensagem da conversa (ex.: "Olá! Eu sou a Sofia, do Instituto Lorena Visentainer"). Em mensagens seguintes da mesma conversa, NÃO repita a apresentação.')
        : 'Você é o assistente de IA do CRM Instituto Lorena (operação comercial / clínica).',
      'Use APENAS o snapshot JSON abaixo; não invente números, leads ou interações que não apareçam.',
      `Contexto temporal (Maringá/Brasília): agora são ${brasilDateTime} — ${brasilWeekday}, período da ${brasilPeriod}. Saudação apropriada para a primeira mensagem ao paciente: "${brasilGreeting}". Atendimento humano (Dandara): segunda a sexta, 08h às 18h — neste momento ${isBusinessHours ? 'estamos DENTRO' : 'estamos FORA'} do horário comercial.`,
      'Quando existir leadFocus.recent_media_intel, use audio_transcript e document_or_image_text como parte do contexto da conversa (transcrições e OCR/extração de documentos).',
      'Quando existir leadFocus.recent_conversation, é o histórico cronológico deste paciente no CRM — use-o sempre: o cliente pode enviar o mesmo pedido em várias mensagens seguidas; una o sentido e não peça de novo o que já está nas linhas anteriores.',
      isInternal
        ? (isSalesBot
          ? SALES_MODE_BLOCK
          : [
            '--- MODO RESPOSTA DIRETA AO PACIENTE ---',
            'Sua resposta será enviada IMEDIATAMENTE ao paciente. Você deve agir como o assistente virtual da clínica.',
            'MANDATORY: Não inclua análises, explicações internas, raciocínios, etapas (ex: "1. Analisar...") ou qualquer texto que não seja para o paciente.',
            'MANDATORY: Não escreva em inglês planeamento do tipo "Analyze the User", "Interpretation", "Decision", "Strategy" nem listas numeradas de raciocínio.',
            'MANDATORY: Não escreva nomes de ferramentas, JSON de chamadas de API nem texto técnico para o paciente.',
            'PROIBIDO ao paciente: mencionar CRM, plataforma interna, "ferramentas", "visualize você mesmo / visualize na plataforma", agenda ou sistemas que só a equipa usa. O paciente só fala por WhatsApp — não tem login nem app para ver vagas.',
            'MANDATORY: A primeira linha da sua resposta DEVE ser exactamente: <<<PACIENTE>>>',
            'MANDATORY: Na linha seguinte, escreva APENAS a mensagem WhatsApp em português (cordial, profissional). Nada antes de <<<PACIENTE>>>.',
            'PROIBIDO ABSOLUTAMENTE: blocos <thinking>, <think>, <reasoning>, <reflection> ou qualquer marcação XML de raciocínio. Se sentir necessidade de raciocinar, faça-o SILENCIOSAMENTE e produza APENAS a linha <<<PACIENTE>>> seguida da mensagem em português. Respostas que contenham apenas raciocínio (sem texto para o paciente após <<<PACIENTE>>>) são DESCARTADAS automaticamente pelo sistema — o paciente fica sem resposta.',
            'Formatação WhatsApp: para destacar nomes ou palavras importantes use **negrito assim** (dois asteriscos antes e depois). Não use quatro asteriscos seguidos (****). Não use um único asterisco *assim* para ênfase — no WhatsApp isso é ambíguo; prefira sempre **duplo**.',
            'Se usar <<<CRM_OPS>>> com shosp_book na mesma resposta, NÃO escreva "estou verificando a agenda agora", "aguarde um instante" nem prometa confirmação futura como se o horário ainda não existisse — o servidor confirma o horário na mesma mensagem. Mantenha um tom direto (horário escolhido e segue a confirmação automática).',
            'Não use rascunhos ou comentários internos.',
            `MANDATORY (saudações): use saudação contextual APENAS na primeira mensagem de uma nova conversa. A saudação OBRIGATÓRIA agora é "${brasilGreeting}" (calculada a partir do horário de Brasília — NÃO use outra). PROIBIDO escrever "Boa tarde" de manhã ou de noite; PROIBIDO escrever "Bom dia" à tarde/noite. Em mensagens seguintes da mesma conversa NÃO repita "Olá / Bom dia / Boa tarde / Boa noite" — aja como numa conversa contínua.`,
            `MANDATORY (apresentação): na primeira mensagem ao paciente, apresente-se como *Sofia* (ex.: "Eu sou a Sofia, do Instituto Lorena Visentainer"). Nas mensagens seguintes da mesma conversa, NÃO repita o nome nem a apresentação.`,
            '',
            '--- TRIAGEM E ENCAMINHAMENTO ---',
            'Objetivo principal: identificar o tipo de atendimento desejado (1 a 5) e entender a preferência de período (manhã/tarde).',
            'Se o paciente enviar apenas o número da opção (ex: "1", "2"), agradeça a escolha e pergunte IMEDIATAMENTE a sua preferência de período (manhã ou tarde).',
            '--- AGENDA SHOSP (fonte da verdade) ---',
            'Quando o snapshot tiver `shosp.agendamentos`, são as consultas REAIS deste paciente na clínica. Se ele perguntar "que horário tô marcado / quando é minha consulta", responda direto com os dados de lá (data, horário, médico, status). Ex.: "Sua consulta é quinta-feira, 14h, com a Dra. Jaqueline 😊".',
            ...shospBookingLines,
            'Após identificar o serviço e a preferência de período, ou se o paciente fizer perguntas sobre valores/detalhes clínicos, use a tag [PRONTO_PARA_CONSULTOR] para sinalizar o fim da triagem inicial.',
            'VÁRIAS MENSAGENS: se leadFocus.recent_conversation mostrar vários "in" seguidos do paciente antes da sua resposta, trate como um único contexto — responda de forma completa, citando o essencial que já disseram.',
            '',
            '--- INFORMAÇÕES DE AGENDA DOS MÉDICOS ---',
            '- Dra. Lorena: Só tem agenda para o ano que vem (informar que não tem agenda no momento). Seus horários são terças, quartas e quintas, das 11h30 às 14h15. Após esse horário, é somente retorno.',
            '- Dr. Matheus Amaral: Realiza atendimentos SOMENTE no período da tarde (14h00 às 17h00) às segundas, quartas e sextas-feiras devido à agenda cirúrgica.',
            '- Dra. Jaqueline: Possui horários mais flexíveis, atendendo todos os dias no período da manhã (exceto sextas-feiras). Terças e quintas também atende à tarde (14h00 às 18h00).',
          ].join('\n'))
        : 'Os dados respeitam as permissões (RLS) da conta do utilizador — pode ser uma amostra parcial.',
      'Responda em português de Portugal ou Brasil, de forma clara e profissional.',
      'Não peça nem repita senhas. Não confirme envio de mensagens a pacientes: pode sugerir RASCUNHOS; o humano envia.',
      'Para "churn" ou risco sem dados explícitos no snapshot, diga que faltam dados e sugira que métricas ou campos registar.',
      'Integrações futuras (Meta Graph API, WhatsApp Cloud, Evolution API) podem enriquecer canais — mencione só se relevante.',
      ...(!isInternal
        ? [
            '',
            '--- Consola CRM (sessão autenticada; RLS aplica-se às consultas) ---',
            'Pode usar <<<CRM_OPS>>> com list_leads_filtered para obter uma lista filtrada de leads (o servidor devolve os dados em list_leads no JSON da API).',
            'Exemplo: {"version":1,"ops":[{"type":"list_leads_filtered","search":"Maria","temperature":"hot","limit":20}]}',
            'Campos opcionais: stage_id, pipeline_id, temperature (cold|warm|hot), search (nome, resumo ou telefone), limit entre 5 e 50.',
            'Resuma os resultados em linguagem natural para o utilizador; não exponha este JSON na mensagem ao paciente (em modo WhatsApp isto não está disponível).',
          ]
        : []),
      '',
      focusHint,
      '',
      '# REGRAS E VALORES DINÂMICOS (Configurado no CRM)',
      JSON.stringify(snapshot.crm_ai_configs?.business_rules || {}, null, 2),
      '',
      '# PROMPT ADICIONAL (SISTEMA)',
      snapshot.crm_ai_configs?.system_prompt || '',
      '',
      '# CONTEXTO DO CRM (SNAPSHOT)',
      JSON.stringify(snapshot, null, 2),
    ].join('\n')

    if (promptOverride) {
      systemContent = `${promptOverride}\n\n---\n\n${systemContent}`
    }

    if (systemContent.length > MAX_SYSTEM_CHARS) {
      systemContent = systemContent.slice(0, MAX_SYSTEM_CHARS) + '\n…[snapshot truncado por tamanho máximo]'
    }

    const useCodingMerge = isCodingPlanApiRoot(zaiApiRoot)
    const messages = buildMessagesForZaiRequest(systemContent, clientMessages, useCodingMerge)

    const zaiRes = await fetch(zaiChatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US,en',
        Authorization: `Bearer ${zaiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: temperatureForModel(model),
        max_tokens: 2048,
      }),
    })

    const zaiText = await zaiRes.text()
    if (!zaiRes.ok) {
      const bodyText = trunc(zaiText, 1200)
      const looksLikeGenericFail =
        /Operation failed|"code"\s*:\s*"500"/i.test(zaiText) || (zaiRes.status === 500 && bodyText.length < 500)
      const hint =
        useCodingMerge && looksLikeGenericFail
          ? 'O endpoint …/coding/paas/v4 (GLM Coding Plan) na documentação Z.ai destina-se a integrações listadas (IDEs, agentes de código). Um assistente CRM no Supabase pode não ser suportado e devolver 500 genérico. Para uso geral na app, use https://api.z.ai/api/paas/v4 com saldo pay-as-you-go (ajuste o secret ZAI_API_BASE).'
          : undefined
      return jsonResponse({
        ok: false,
        error: 'zai_upstream',
        message: bodyText,
        ...(hint ? { hint } : {}),
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

    let reply = extractReplyFromZai(parsed)
    if (!reply) {
      const debugNote = `crm-ai-debug:zai_empty_reply:lead=${context.leadId ?? 'unknown'}:model=${model}:raw=${trunc(zaiText, 400).replace(/[\r\n]+/g, ' ')}`
      console.warn('crm-ai-assistant zai_empty_reply', {
        model,
        leadId: context.leadId ?? null,
        raw_excerpt: trunc(zaiText, 600),
      })
      try {
        await dbClient.from('webhook_jobs').insert({
          source: 'crm-ai-assistant',
          status: 'done',
          note: debugNote.slice(0, 500),
        })
      } catch { /* ignore */ }
      return jsonResponse({
        ok: false,
        error: 'zai_empty_reply',
        message: trunc(zaiText, 800),
      })
    }
    const rawZaiReply = reply

    const peeled = peelCrmOpsFromModelReply(reply)
    reply = peeled.remainder

    const leadScopedOps = peeled.ops.filter((o) => !isListLeadsFilteredOp(o))
    const listQueries = peeled.ops.filter(isListLeadsFilteredOp)

    const actionChunks: CrmAiActionResult[] = []
    let list_leads: ListedLeadRow[] | undefined

    if (context.leadId && leadScopedOps.length > 0) {
      const lf = snapshot.leadFocus as Record<string, unknown> | null | undefined
      const leadResults = await executeCrmAiOpsFromModel(dbClient, {
        allowedLeadId: context.leadId,
        ops: leadScopedOps,
        patientLabel: typeof lf?.patient_name === 'string' ? lf.patient_name : 'Paciente',
        logToInteractions: true,
      })
      actionChunks.push(...leadResults)
    } else if (!context.leadId && leadScopedOps.length > 0) {
      actionChunks.push({
        type: 'lead_scoped_ops',
        ok: false,
        detail: 'missing_lead_id_in_context',
      })
    }

    if (!isInternal && listQueries.length > 0) {
      const listRun = await executeListLeadsFilteredOps(dbClient, listQueries)
      actionChunks.push(...listRun.results)
      if (listRun.rows && listRun.rows.length > 0) list_leads = listRun.rows
    } else if (isInternal && listQueries.length > 0) {
      actionChunks.push({
        type: 'list_leads_filtered',
        ok: false,
        detail: 'only_available_in_console_session',
      })
    }

    const crm_actions = actionChunks.length > 0 ? actionChunks : undefined

    if (isInternal) {
      reply = stripInternalPatientReply(reply)
    }
    reply = sanitizeCrmAiPatientReply(reply).clean
    if (isInternal) {
      reply = normalizeWhatsappPatientFormatting(reply)
    }

    // Z.ai (GLM) por vezes devolve só monólogo CoT em inglês ou só blocos `<thinking>` /
    // function_call. Depois da sanitização não sobra texto visível ao paciente. Em vez de
    // responder ok:true com reply:"" (silenciado pelo caller como fallback), devolve ok:false
    // para forçar retry no caller e deixar pista nos logs do que o modelo escreveu.
    if (!reply.trim()) {
      const debugNote = `crm-ai-debug:sanitized_to_empty:lead=${context.leadId ?? 'unknown'}:model=${model}:raw=${trunc(rawZaiReply, 400).replace(/[\r\n]+/g, ' ')}`
      console.warn('crm-ai-assistant sanitized_to_empty', {
        model,
        leadId: context.leadId ?? null,
        isInternal,
        raw_excerpt: trunc(rawZaiReply, 600),
      })
      try {
        await dbClient.from('webhook_jobs').insert({
          source: 'crm-ai-assistant',
          status: 'done',
          note: debugNote.slice(0, 500),
        })
      } catch { /* ignore */ }
      return jsonResponse({
        ok: false,
        error: 'sanitized_to_empty',
        message: 'O modelo respondeu mas o texto foi removido pela sanitização (provavelmente só CoT/thinking).',
        raw_excerpt: trunc(rawZaiReply, 600),
      })
    }

    if (isInternal && context.leadId && actionChunks.length > 0 && reply.trim()) {
      // shosp_book: o detail já vem formatado "DD/MM/AAAA HH:MM" (não re-parsear como Date).
      const shospBooked = actionChunks.find(
        (c) => c.type === 'shosp_book' && c.ok && typeof c.detail === 'string' && c.detail.length >= 8,
      )
      if (shospBooked?.detail && !reply.includes(shospBooked.detail)) {
        reply = `${reply.trim()}\n\n✅ Consulta agendada na agenda da clínica: ${shospBooked.detail} (horário de Brasília/Maringá).`
      }
      // pagbank_checkout: o detail é a URL do link (rel PAY). Anexa ao final para o
      // cliente abrir e pagar (Pix com 5% off ou cartão). O modelo NÃO inventa o link.
      const pagbankLink = actionChunks.find(
        (c) => c.type === 'pagbank_checkout' && c.ok && typeof c.detail === 'string' && c.detail.startsWith('http'),
      )
      if (pagbankLink?.detail && !reply.includes(pagbankLink.detail)) {
        const note = pagbankLink.customerNote ? `\n${pagbankLink.customerNote}` : ''
        reply = `${reply.trim()}\n\n💚 Pague no Pix (5% de desconto) ou cartão por aqui:\n${pagbankLink.detail}${note}`
      }
      // rede_link: checkout de CARTÃO próprio (/pagar/:id), parcelado em até 12x.
      const redeLink = actionChunks.find(
        (c) => c.type === 'rede_link' && c.ok && typeof c.detail === 'string' && c.detail.startsWith('http'),
      )
      if (redeLink?.detail && !reply.includes(redeLink.detail)) {
        const note = redeLink.customerNote ? `\n${redeLink.customerNote}` : ''
        reply = `${reply.trim()}\n\n💳 Pague no cartão (em até 12x) por aqui:\n${redeLink.detail}${note}`
      }
      // Se a IA prometeu o link mas a geração FALHOU (recusa/erro da Rede), não deixa o
      // cliente esperando um link que não veio — manda um aviso gentil de fallback.
      const redeFailed = actionChunks.find((c) => c.type === 'rede_link' && !c.ok)
      if (!redeLink && redeFailed && !reply.includes('probleminha técnico')) {
        reply = `${reply.trim()}\n\n💚 Tive um probleminha técnico para gerar seu link de cartão agora. Já vou pedir para um atendente finalizar com você em instantes, tá? 🙏`
      }
      // pagbank_pix: Pix DIRETO — copia-e-cola no texto (o QR vai como imagem à parte, via auto-reply).
      const pixQr = actionChunks.find(
        (c) => c.type === 'pagbank_pix' && c.ok && typeof c.detail === 'string' && c.detail.length > 20,
      )
      if (pixQr?.detail && !reply.includes(pixQr.detail)) {
        const note = pixQr.customerNote ? `\n${pixQr.customerNote}` : ''
        reply = `${reply.trim()}\n\n💸 *Pix copia e cola* — toque para copiar e pague no app do seu banco:\n${pixQr.detail}${note}\n\nAssim que o pagamento cair eu confirmo aqui, viu? 💚`
      }
      const pixFailed = actionChunks.find((c) => c.type === 'pagbank_pix' && !c.ok)
      if (!pixQr && pixFailed && !reply.includes('probleminha técnico')) {
        reply = `${reply.trim()}\n\n💚 Tive um probleminha técnico para gerar o Pix agora. Já vou chamar um atendente pra finalizar com você, tá? 🙏`
      }
      const booked = actionChunks.find(
        (c) =>
          (c.type === 'book_appointment' || c.type === 'schedule_appointment') &&
          c.ok &&
          typeof c.detail === 'string' &&
          c.detail.length >= 12,
      )
      if (booked?.detail) {
        try {
          const d = new Date(booked.detail)
          if (!Number.isNaN(d.getTime())) {
            const nice = d.toLocaleString('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: 'America/Sao_Paulo',
            })
            if (!reply.includes(nice)) {
              reply = `${reply.trim()}\n\n✅ Horário reservado automaticamente na nossa agenda: ${nice} (horário de Brasília/Maringá).`
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    return jsonResponse({
      ok: true,
      reply,
      model,
      ...(crm_actions ? { crm_actions } : {}),
      ...(list_leads && list_leads.length > 0 ? { list_leads } : {}),
    })
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
