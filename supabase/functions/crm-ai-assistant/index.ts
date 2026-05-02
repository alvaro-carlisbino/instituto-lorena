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

import { sanitizeCrmAiPatientReply } from '../_shared/crmAiAutoReply.ts'
import {
  executeCrmAiOpsFromModel,
  executeListLeadsFilteredOps,
  isListLeadsFilteredOp,
  peelCrmOpsFromModelReply,
  type CrmAiActionResult,
  type ListedLeadRow,
} from '../_shared/crmAiOpsExecutor.ts'

const MIN_INTERNAL_SECRET_LEN = 16

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-crm-ai-internal-secret',
}

/** Limite aproximado do system prompt (caracteres) para evitar rejeição / timeout na Z.ai. */
const MAX_SYSTEM_CHARS = 95_000

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
  return { leadId, weekStartIso, focus }
}

async function buildCrmSnapshot(
  userClient: SupabaseClient,
  ctx: AiContext,
  opts?: { skipAppProfile?: boolean },
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
    const nowIso = new Date().toISOString()
    const [leadRes, mediaRes, apptRes, roomsRes] = await Promise.all([
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
    ])
    if (leadRes.error) queryWarnings.push(`lead_focus: ${leadRes.error.message}`)
    if (mediaRes.error) queryWarnings.push(`crm_media_items: ${mediaRes.error.message}`)
    if (apptRes.error) queryWarnings.push(`appointments_lead: ${apptRes.error.message}`)
    if (roomsRes.error) queryWarnings.push(`rooms: ${roomsRes.error.message}`)
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
      leadFocus = {
        ...d,
        summary: trunc(String(d.summary ?? ''), 500),
        custom_fields: cf,
        recent_media_intel,
        upcoming_appointments: upcomingAppointments,
        rooms_catalog,
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
    const zaiKey = Deno.env.get('ZAI_API_KEY') ?? ''
    const zaiApiRoot = zaiApiRootFromEnv()
    const zaiChatUrl = `${zaiApiRoot}/chat/completions`
    const defaultModel = normalizeZaiModelCode(Deno.env.get('ZAI_MODEL')?.trim() || 'glm-4.7')

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
    const model = ALLOWED_MODELS.has(requested)
      ? requested
      : ALLOWED_MODELS.has(defaultModel)
        ? defaultModel
        : 'glm-4.7'
    const context = parseContext(body.context)
    const promptOverride = typeof body.promptOverride === 'string' ? body.promptOverride.trim() : ''

    let snapshot: Record<string, unknown>
    try {
      snapshot = await buildCrmSnapshot(dbClient, context, isInternal ? { skipAppProfile: true } : undefined)
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
      'Quando existir leadFocus.recent_media_intel, use audio_transcript e document_or_image_text como parte do contexto da conversa (transcrições e OCR/extração de documentos).',
      isInternal
        ? [
            '--- MODO RESPOSTA DIRETA AO PACIENTE ---',
            'Sua resposta será enviada IMEDIATAMENTE ao paciente. Você deve agir como o assistente virtual da clínica.',
            'MANDATORY: Não inclua análises, explicações internas, raciocínios, etapas (ex: "1. Analisar...") ou qualquer texto que não seja para o paciente.',
            'MANDATORY: Não escreva em inglês planeamento do tipo "Analyze the User", "Interpretation", "Decision", "Strategy" nem listas numeradas de raciocínio.',
            'MANDATORY: Não escreva nomes de ferramentas, JSON de chamadas de API nem texto técnico para o paciente.',
            'MANDATORY: A primeira linha da sua resposta DEVE ser exactamente: <<<PACIENTE>>>',
            'MANDATORY: Na linha seguinte, escreva APENAS a mensagem WhatsApp em português (cordial, profissional). Nada antes de <<<PACIENTE>>>.',
            'Não use rascunhos ou comentários internos.',
            '',
            '--- AGENDAMENTO (OBRIGATÓRIO NESTE CANAL) ---',
            'Objetivo principal: conduzir o agendamento com naturalidade — perguntas curtas e uma ou duas dúvidas por mensagem — sem encaminhar para humano de forma prematura.',
            'Antes de usar a tag [PRONTO_PARA_CONSULTOR], quando fizer sentido deve ficar claro: tipo de atendimento (menu 1–5 ou equivalente); preferência de médico ou "primeira vaga disponível"; período do dia (manhã/tarde) e dias da semana preferidos; se é primeira consulta ou retorno; e um resumo explícito do pedido (ex.: consulta clínica feminina, prefere manhã, terça ou quinta).',
            'Use [PRONTO_PARA_CONSULTOR] só quando: o paciente pedir explicitamente falar com uma pessoa; já tiver o pacote acima e precise que a equipa confirme e feche o horário na agenda (diga que vai pedir confirmação); ou quando pedirem preços, valores, parecer médico, antes/depois ou pormenores clínicos que não constem do contexto — nesse caso explique que a equipa enviará esses detalhes e coloque a tag no fim dessa mensagem.',
            'Não encerre com mensagens vagas ("já vão falar consigo") logo após a escolha do médico se ainda faltam dados de disponibilidade. Horário de referência da clínica no contexto do negócio: segunda a sexta, 08:00–18:00 (Maringá) — sugira janelas plausíveis sem garantir vagas que não possa confirmar.',
            ...(context.leadId
              ? [
                  '',
                  '--- ACÇÕES CRM AUTOMÁTICAS (invisíveis ao paciente; só este lead) ---',
                  `lead_id em foco: ${context.leadId}. Use apenas ids de pipelineStages e pipelines do snapshot.`,
                  'Depois da mensagem ao paciente, pode opcionalmente acrescentar por último:',
                  '<<<CRM_OPS>>>',
                  '{"version":1,"ops":[{"type":"move_lead","stage_id":"<id>"}]}',
                  'Tipos: move_lead (opcional pipeline_id), set_temperature (value: cold|warm|hot), update_summary (text), book_appointment (duration_minutes, notes).',
                  'Consulte leadFocus.upcoming_appointments antes de marcar de novo. Omita <<<CRM_OPS>>> se não houver acção.',
                  'Não use list_leads_filtered neste modo (só na consola CRM autenticada).',
                ]
              : []),
          ].join('\n')
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
      'Snapshot CRM (JSON):',
      JSON.stringify(snapshot),
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
      return jsonResponse({
        ok: false,
        error: 'zai_empty_reply',
        message: trunc(zaiText, 800),
      })
    }

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
