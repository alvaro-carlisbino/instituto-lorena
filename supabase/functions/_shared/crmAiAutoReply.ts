import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { insertInteraction } from './crm.ts'
import type { WhatsappProvider } from './whatsapp/types.ts'

/** Mesma convenção do fluxo n8n ManyChat (triagem → consultor humano). */
export const MANYCHAT_HANDOFF_MARKER = '[PRONTO_PARA_CONSULTOR]'

export function stripManychatHandoffMarker(reply: string): { clean: string; handoffSuggested: boolean } {
  const has = reply.includes(MANYCHAT_HANDOFF_MARKER)
  const clean = reply.split(MANYCHAT_HANDOFF_MARKER).join('').trim()
  return { clean, handoffSuggested: has }
}

/**
 * Texto visível ao paciente / ManyChat: remove marca de handoff e vazamentos comuns de "tools"
 * (blocos fenced, XML de function_call, etc.). Não substitui o system prompt — só a saída.
 */
export function sanitizeCrmAiPatientReply(reply: string): { clean: string; handoffSuggested: boolean } {
  let stripped = reply.replace(/\r\n/g, '\n').replace(/<<<CRM_OPS>>>[\s\S]*$/m, '').trim()
  const { clean: afterHandoff, handoffSuggested } = stripManychatHandoffMarker(stripped)
  let t = afterHandoff.replace(/\r\n/g, '\n')

  t = t.replace(/```(?:tool|json|typescript|javascript|xml|yaml)\s*[\s\S]*?```/gi, '')
  t = t.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
  t = t.replace(/<function_call[\s\S]*?<\/function_call>/gi, '')
  t = t.replace(/<invoke[\s\S]*?<\/invoke>/gi, '')
  t = t.replace(/<tool_call[\s\S]*?<\/tool_call>/gi, '')
  t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  return { clean: t, handoffSuggested }
}

/**
 * WhatsApp (Evolution / Cloud): negrito no telefone é `*texto*` (um par de asteriscos).
 * Modelos costumam escrever `**markdown**` ou `****erro****`. Normaliza para um único par,
 * sem asteriscos duplicados visíveis.
 */
export function normalizeWhatsappPatientFormatting(text: string): string {
  let s = text.replace(/\r\n/g, '\n')
  s = s.replace(/\*{4}([^*\n]{1,400}?)\*{4}/g, '*$1*')
  s = s.replace(/\*{4}/g, '')
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/\*\*([^*\n]{1,400}?)\*\*/g, '*$1*')
  }
  return s
}

const TRIAGE_MAPPING: Record<string, { pipelineId: string; stageId: string }> = {
  '1': { pipelineId: 'pipeline-tratamento-capilar', stageId: 'tc-triagem' },
  '2': { pipelineId: 'pipeline-tratamento-capilar', stageId: 'tc-triagem' },
  '3': { pipelineId: 'pipeline-clinica', stageId: 'triagem' },
  '4': { pipelineId: 'pipeline-clinica', stageId: 'triagem' },
  '5': { pipelineId: 'pipeline-tratamento-capilar', stageId: 'tc-triagem' },
}

/** Detecta opção 1–5 em texto livre (várias linhas, erros comuns de escrita). */
export function inferTriageTargetFromText(raw: string): { pipelineId: string; stageId: string } | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const joined = lines.join(' ')
  const t = joined.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const opt = joined.match(/(?:^|\s)(?:opc[aã]o|op[cç][aã]o|numero|n[º°]?)\s*([1-5])(?:\s|$|[).:,])/i)
  if (opt?.[1] && TRIAGE_MAPPING[opt[1]]) return TRIAGE_MAPPING[opt[1]]
  const loneLine = lines.find((l) => /^[1-5]$/.test(l))
  if (loneLine && TRIAGE_MAPPING[loneLine]) return TRIAGE_MAPPING[loneLine]
  if (/transplante\s+capilar\s+masculin|transplate\s+capilar\s+masculin|capilar\s+masculino\b/.test(t)) {
    return TRIAGE_MAPPING['1']
  }
  if (/transplante\s+capilar\s+feminin|capilar\s+feminina\b|capilar\s+feminino\b/.test(t)) {
    return TRIAGE_MAPPING['2']
  }
  if (/consulta\s+cl[ií]nica\s+masculin/.test(t)) return TRIAGE_MAPPING['3']
  if (/consulta\s+cl[ií]nica\s+feminin/.test(t)) return TRIAGE_MAPPING['4']
  if (/\bsobrancelha/.test(t)) return TRIAGE_MAPPING['5']
  return null
}

function resolveTriageTarget(normalized: string): { pipelineId: string; stageId: string } | null {
  const n = normalized.trim()
  if (!n) return null
  if (TRIAGE_MAPPING[n]) return TRIAGE_MAPPING[n]
  return inferTriageTargetFromText(n)
}

/** Só junta rajada quando o texto parece cumprimento curto / incompleto — evita atrasar quem já pediu o serviço numa linha. */
function shouldDeferReplyForBurstMerge(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (resolveTriageTarget(t)) return false
  if (/transplante|consulta|sobrancelh|marcar|agendar|implante\s+capilar|\bop[cç][aã]o\s*[1-5]\b/i.test(t)) {
    return false
  }
  return t.length <= 96
}

function scheduleEdgeBackground(task: Promise<void>): void {
  try {
    const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil
    if (typeof wu === 'function') {
      wu(task)
      return
    }
  } catch {
    /* ignore */
  }
  void task
}

async function appendInboundBurstBuffer(
  admin: SupabaseClient,
  leadId: string,
  line: string,
  inboundHappenedAt: string,
): Promise<void> {
  const chunk = line.trim()
  if (!chunk) return
  const { data: row } = await admin
    .from('crm_conversation_states')
    .select('ai_inbound_burst_text')
    .eq('lead_id', leadId)
    .maybeSingle()
  const prev = String(row?.ai_inbound_burst_text ?? '').trim()
  const next = prev ? `${prev}\n${chunk}` : chunk
  const up = await admin
    .from('crm_conversation_states')
    .update({
      ai_inbound_burst_text: next,
      ai_inbound_burst_updated_at: nowIso(),
      last_inbound_at: inboundHappenedAt,
      updated_at: nowIso(),
    })
    .eq('lead_id', leadId)
    .select('lead_id')
  const rows = up.data as unknown[] | null
  if (rows && rows.length > 0) return
  await admin.from('crm_conversation_states').insert({
    lead_id: leadId,
    owner_mode: 'auto',
    ai_enabled: true,
    ai_inbound_burst_text: chunk,
    ai_inbound_burst_updated_at: nowIso(),
    last_inbound_at: inboundHappenedAt,
    updated_at: nowIso(),
  })
}

/** Hora local 0–23 no fuso IANA (Edge corre em UTC; não usar `Date#getHours()` para regra de negócio). */
export function hourInTimeZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d)
  const raw = parts.find((p) => p.type === 'hour')?.value ?? ''
  let h = Number(raw)
  if (!Number.isFinite(h)) return -1
  if (h === 24) h = 0
  return h
}

export function isWithinQuietHours(
  date: Date,
  startHour = 8,
  endHour = 20,
  timeZone = 'America/Sao_Paulo',
): boolean {
  const h = hourInTimeZone(date, timeZone)
  if (h < 0) return true
  return h >= startHour && h < endHour
}

function patientAiFallbackMessagePt(): string {
  const t = (Deno.env.get('CRM_AI_FALLBACK_MESSAGE_PT') ?? '').trim()
  const fallback =
    'Peço desculpa — não consegui responder agora. Por favor, volte a enviar a sua mensagem dentro de alguns segundos. 🙏'
  return t.length >= 8 ? t : fallback
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function sendWhatsappPatientFallbackReply(
  admin: SupabaseClient,
  opts: {
    leadId: string
    patientName: string
    fromPhone: string
    inboundHappenedAt: string
    ownerMode: string
    aiEnabled: boolean
    sendProvider: WhatsappProvider
    aiJobSource: string
    typingDelayMs?: number
    contextSnippet: string
    noteSuffix: string
  },
): Promise<void> {
  const text = normalizeWhatsappPatientFormatting(patientAiFallbackMessagePt())
  const envTyping = (Deno.env.get('WHATSAPP_AI_TYPING_DELAY_MS') ?? '').trim()
  const envTypingN = envTyping ? Number.parseInt(envTyping, 10) : Number.NaN
  const delayFromEnv = Number.isFinite(envTypingN) ? Math.max(0, envTypingN) : null
  const delay =
    opts.typingDelayMs !== undefined
      ? Math.max(0, opts.typingDelayMs)
      : delayFromEnv !== null
        ? delayFromEnv
        : 200
  if (delay > 0) await sleepMs(delay)

  const sent = await opts.sendProvider.sendMessage({
    to: opts.fromPhone,
    text,
    leadId: opts.leadId,
  })
  await insertInteraction(admin, {
    leadId: opts.leadId,
    patientName: opts.patientName,
    channel: 'whatsapp',
    direction: 'out',
    author: 'Assistente IA',
    content: text,
    happenedAt: nowIso(),
    externalMessageId: sent.externalMessageId,
  })
  await admin.from('crm_conversation_states').upsert({
    lead_id: opts.leadId,
    owner_mode: opts.ownerMode,
    ai_enabled: opts.aiEnabled,
    last_inbound_at: opts.inboundHappenedAt,
    last_ai_reply_at: nowIso(),
    context_summary: `${opts.contextSnippet}\nIA (fallback): ${text.slice(0, 120)}`.slice(0, 1200),
    updated_at: nowIso(),
  })
  await admin.from('webhook_jobs').insert({
    source: opts.aiJobSource,
    status: 'done',
    note: `ai_fallback_reply:${opts.noteSuffix}:${sent.provider}:${opts.leadId}:${sent.externalMessageId}`.slice(
      0,
      500,
    ),
  })
}

type WhatsappBurstFlushOpts = {
  leadId: string
  patientName: string
  fromPhone: string
  inboundHappenedAt: string
  ownerMode: string
  aiEnabled: boolean
  statePrompt: string
  aiJobSource: string
  sendProvider: WhatsappProvider
  typingDelayMs?: number
  /** Omisso: CRM_AI_INVOKE_ATTEMPTS / 3. Menor evita 504 em chamadas síncronas (ex.: force_ai_reply). */
  invokeMaxAttempts?: number
}

function scheduleWhatsappInboundBurstFlush(
  admin: SupabaseClient,
  debounceMs: number,
  opts: WhatsappBurstFlushOpts,
): void {
  scheduleEdgeBackground((async () => {
    const maxRounds = 24
    for (let r = 0; r < maxRounds; r++) {
      await new Promise((res) => setTimeout(res, debounceMs))
      const { data: st } = await admin
        .from('crm_conversation_states')
        .select('ai_inbound_burst_text, ai_inbound_burst_updated_at')
        .eq('lead_id', opts.leadId)
        .maybeSingle()
      const buf = String(st?.ai_inbound_burst_text ?? '').trim()
      if (!buf) return
      const updRaw = st?.ai_inbound_burst_updated_at
      const upd = updRaw ? new Date(String(updRaw)).getTime() : 0
      if (Date.now() - upd < debounceMs) continue
      const { data: claimed } = await admin
        .from('crm_conversation_states')
        .update({
          ai_inbound_burst_text: null,
          ai_inbound_burst_updated_at: null,
          updated_at: nowIso(),
        })
        .eq('lead_id', opts.leadId)
        .not('ai_inbound_burst_text', 'is', null)
        .select('ai_inbound_burst_text')
        .maybeSingle()
      const combined = String(claimed?.ai_inbound_burst_text ?? '').trim()
      if (!combined) return
      try {
        await runWhatsappAiAutoReply(admin, {
          ...opts,
          aiInboundUserText: combined,
          burstFlush: true,
        })
      } catch (e) {
        console.error('scheduleWhatsappInboundBurstFlush:', e)
        try {
          await sendWhatsappPatientFallbackReply(admin, {
            leadId: opts.leadId,
            patientName: opts.patientName,
            fromPhone: opts.fromPhone,
            inboundHappenedAt: opts.inboundHappenedAt,
            ownerMode: opts.ownerMode,
            aiEnabled: opts.aiEnabled,
            sendProvider: opts.sendProvider,
            aiJobSource: opts.aiJobSource,
            typingDelayMs: opts.typingDelayMs,
            contextSnippet: combined.slice(0, 280),
            noteSuffix: 'burst_flush_error',
          })
        } catch (e2) {
          console.error('scheduleWhatsappInboundBurstFlush fallback:', e2)
        }
      }
      return
    }
  })())
}

const INITIAL_TRIAGE_MESSAGE_TEMPLATE = `Olá, {name}! Boa tarde, tudo bem? Seja muito bem-vindo ao Instituto Lorena Visentainer. 💆

Eu sou o assistente virtual da clínica. Posso ajudá-lo a escolher o tipo de atendimento e a reunir as informações para o agendamento — a nossa equipa confirma depois o melhor horário na agenda.

Para começarmos, digite o número da opção desejada:

1. Transplante Capilar Masculino
2. Transplante Capilar Feminino
3. Consulta Clínica Masculino
4. Consulta Clínica Feminino
5. Transplante de Sobrancelha`

export function nowIso(): string {
  return new Date().toISOString()
}

export async function countAiAutoRepliesLastHour(
  admin: SupabaseClient,
  sources: string[],
): Promise<number> {
  if (sources.length === 0) return 0
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('webhook_jobs')
    .select('id', { count: 'exact', head: true })
    .in('source', sources)
    .like('note', 'ai_auto_reply:%')
    .gte('created_at', oneHourAgoIso)
  return count ?? 0
}

export type CrmAiAutoReplyGate = {
  canAutoReply: boolean
  ownerMode: string
  aiEnabled: boolean
  /** Preenchido quando `canAutoReply` é false — códigos estáveis para suporte e automações. */
  skipReasons: string[]
  /** Dica curta para humanos (ManyChat / logs). */
  skipHint?: string
}

export async function evaluateCrmAiAutoReplyGate(
  admin: SupabaseClient,
  leadId: string,
  options: {
    directionIsInbound: boolean
  },
): Promise<CrmAiAutoReplyGate> {
  const { data: state } = await admin
    .from('crm_conversation_states')
    .select('*')
    .eq('lead_id', leadId)
    .maybeSingle()
  const { data: config } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()
  const { data: orgRow } = await admin.from('org_settings').select('timezone').eq('id', 'default').maybeSingle()
  const orgTz = String(orgRow?.timezone ?? 'America/Sao_Paulo').trim() || 'America/Sao_Paulo'

  const ownerMode = String(state?.owner_mode ?? config?.default_owner_mode ?? 'auto').toLowerCase()
  const aiEnabled = Boolean((state?.ai_enabled ?? true) && (config?.enabled ?? true))
  /** 0 = sem espera mínima (várias mensagens seguidas do mesmo cliente podem gerar resposta a cada uma). */
  const minSecondsBetween = Math.max(0, Number(config?.min_seconds_between_ai_replies ?? 0))
  const latestAiReplyAt = state?.last_ai_reply_at ? new Date(String(state.last_ai_reply_at)).getTime() : 0
  const elapsedSinceAi = latestAiReplyAt ? (Date.now() - latestAiReplyAt) / 1000 : Number.POSITIVE_INFINITY

  // Parse business hours from config (format "HH:mm:ss")
  const startH = Number.parseInt(String(config?.business_hours_start ?? '08').split(':')[0], 10) || 8
  const endH = Number.parseInt(String(config?.business_hours_end ?? '20').split(':')[0], 10) || 20

  const withinWindow = isWithinQuietHours(new Date(), startH, endH, orgTz)
  const shouldAiByMode = ownerMode === 'ai' || (ownerMode === 'auto' && withinWindow)

  const skipReasons: string[] = []
  if (!aiEnabled) skipReasons.push('ai_disabled')
  if (!options.directionIsInbound) skipReasons.push('not_inbound')
  if (!shouldAiByMode) {
    if (ownerMode === 'human') skipReasons.push('owner_mode_human')
    else if (ownerMode === 'auto' && !withinWindow) skipReasons.push('outside_quiet_hours')
    else skipReasons.push(`owner_mode_${ownerMode || 'unknown'}`)
  }
  if (minSecondsBetween > 0 && elapsedSinceAi < minSecondsBetween) {
    skipReasons.push('min_seconds_between_ai_replies')
  }

  // max_ai_replies_per_hour em crm_ai_configs mantém-se para métricas/UI; não bloqueia mais o auto-reply
  // (limite global fazia a IA “parar” em conversas com várias mensagens).

  const canAutoReply =
    aiEnabled &&
    shouldAiByMode &&
    options.directionIsInbound &&
    (minSecondsBetween === 0 || elapsedSinceAi >= minSecondsBetween)

  const hintParts: string[] = []
  if (skipReasons.includes('ai_disabled')) {
    hintParts.push('IA desligada em crm_ai_configs ou neste lead (crm_conversation_states.ai_enabled).')
  }
  if (skipReasons.includes('owner_mode_human')) {
    hintParts.push('Modo de atendimento = humano: só a equipa responde.')
  }
  if (skipReasons.includes('outside_quiet_hours')) {
    hintParts.push(
      `Modo auto fora da janela ${startH}h–${endH}h no fuso ${orgTz} (crm_ai_configs.business_hours_*). Para responder 24h em auto, alargue o intervalo ou use owner_mode "ai".`,
    )
  }
  if (skipReasons.includes('min_seconds_between_ai_replies')) {
    hintParts.push(
      `Aguarda ${Math.ceil(minSecondsBetween - elapsedSinceAi)}s ou reduz min_seconds_between_ai_replies em crm_ai_configs (atual ${minSecondsBetween}s; 0 = sem espera).`,
    )
  }

  return {
    canAutoReply,
    ownerMode,
    aiEnabled,
    skipReasons: canAutoReply ? [] : skipReasons,
    skipHint: canAutoReply ? undefined : hintParts.join(' '),
  }
}

export async function invokeCrmAiAssistantForLead(
  admin: SupabaseClient,
  leadId: string,
  aiInboundUserText: string,
  promptOverride: string,
  opts?: { maxAttempts?: number },
): Promise<string> {
  const aiMessages = [{ role: 'user', content: aiInboundUserText }]
  const aiCtx = { leadId, focus: 'lead' }
  const internalSecret = (Deno.env.get('CRM_AI_INTERNAL_SECRET') ?? '').trim()
  const headers =
    internalSecret.length >= 16 ? { 'x-crm-ai-internal-secret': internalSecret } : undefined

  const envAttempts = Math.max(1, Math.min(5, Number.parseInt(Deno.env.get('CRM_AI_INVOKE_ATTEMPTS') ?? '3', 10) || 3))
  const attempts =
    opts?.maxAttempts !== undefined
      ? Math.max(1, Math.min(5, opts.maxAttempts))
      : envAttempts

  for (let attempt = 0; attempt < attempts; attempt++) {
    const { data: aiResult, error: invokeErr } = await admin.functions.invoke('crm-ai-assistant', {
      body: {
        messages: aiMessages,
        context: aiCtx,
        promptOverride: promptOverride || undefined,
      },
      ...(headers ? { headers } : {}),
    })

    if (invokeErr) {
      console.warn(`invokeCrmAiAssistantForLead attempt ${attempt + 1}/${attempts}:`, invokeErr.message)
      if (attempt < attempts - 1) await sleepMs(700 * (attempt + 1))
      continue
    }

    const aiObj = (aiResult && typeof aiResult === 'object' ? aiResult : {}) as Record<string, unknown>
    if (aiObj.ok === false) {
      console.warn(
        `invokeCrmAiAssistantForLead ok:false`,
        aiObj.error,
        aiObj.message ?? aiObj.detail ?? '',
      )
      if (attempt < attempts - 1) await sleepMs(700 * (attempt + 1))
      continue
    }

    let reply = typeof aiObj.reply === 'string' ? aiObj.reply.trim() : ''

    const patientMarker = '<<<PACIENTE>>>'
    const mi = reply.indexOf(patientMarker)
    if (mi >= 0) reply = reply.slice(mi + patientMarker.length).trim()

    reply = reply
      .replace(/^(?:\d+\.\s+\*{0,2}Analyze the User[\s\S]*?)(?=\n\n(?:Bom dia|Boa tarde|Boa noite|Olá|Oi)\b)/gi, '')
      .trim()
    reply = reply.replace(/^(?:\d+\.\s+\*?Analyze[\s\S]*?)(?:\n\n|\n[A-Z\xC0-\xDF]|$)/gi, '').trim()
    reply = reply.replace(/<(thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').trim()
    reply = reply.replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, '').trim()

    if (reply.trim()) return reply
    if (attempt < attempts - 1) await sleepMs(500 * (attempt + 1))
  }

  return ''
}

export async function upsertConversationStateInboundOnly(
  admin: SupabaseClient,
  options: {
    leadId: string
    ownerMode: string
    aiEnabled: boolean
    inboundHappenedAt: string
  },
): Promise<void> {
  await admin.from('crm_conversation_states').upsert({
    lead_id: options.leadId,
    owner_mode: options.ownerMode,
    ai_enabled: options.aiEnabled,
    last_inbound_at: options.inboundHappenedAt,
    updated_at: nowIso(),
  })
}

export async function runWhatsappAiAutoReply(
  admin: SupabaseClient,
  options: {
    leadId: string
    patientName: string
    fromPhone: string
    aiInboundUserText: string
    inboundHappenedAt: string
    ownerMode: string
    aiEnabled: boolean
    statePrompt: string
    aiJobSource: string
    sendProvider: WhatsappProvider
    /** Omisso: atraso curto (ou secret WHATSAPP_AI_TYPING_DELAY_MS em ms, ou 0 = sem espera). */
    typingDelayMs?: number
    /** True: executar já o texto acumulado (flush da rajada); não voltar a enfileirar. */
    burstFlush?: boolean
    /** Omisso: env CRM_AI_INVOKE_ATTEMPTS. Reduzir em fluxos síncronos evita 504 no gateway. */
    invokeMaxAttempts?: number
  },
): Promise<{ replied: boolean; replyText?: string; burstPending?: boolean }> {
  const { data: burstCfg } = await admin
    .from('crm_ai_configs')
    .select('inbound_burst_debounce_ms')
    .eq('id', 'default')
    .maybeSingle()
  const burstMs = Math.max(0, Number(burstCfg?.inbound_burst_debounce_ms ?? 0))

  const { data: existingBurst } = await admin
    .from('crm_conversation_states')
    .select('ai_inbound_burst_text')
    .eq('lead_id', options.leadId)
    .maybeSingle()
  const hasPendingBurst = String(existingBurst?.ai_inbound_burst_text ?? '').trim().length > 0

  if (
    !options.burstFlush &&
    burstMs > 0 &&
    (hasPendingBurst || shouldDeferReplyForBurstMerge(options.aiInboundUserText))
  ) {
    await appendInboundBurstBuffer(
      admin,
      options.leadId,
      options.aiInboundUserText,
      options.inboundHappenedAt,
    )
    scheduleWhatsappInboundBurstFlush(admin, burstMs, {
      leadId: options.leadId,
      patientName: options.patientName,
      fromPhone: options.fromPhone,
      inboundHappenedAt: options.inboundHappenedAt,
      ownerMode: options.ownerMode,
      aiEnabled: options.aiEnabled,
      statePrompt: options.statePrompt,
      aiJobSource: options.aiJobSource,
      sendProvider: options.sendProvider,
      typingDelayMs: options.typingDelayMs,
      invokeMaxAttempts: options.invokeMaxAttempts,
    })
    return { replied: false, burstPending: true }
  }

  // --- Triage Logic ---
  const { data: lead } = await admin
    .from('leads')
    .select('pipeline_id, stage_id')
    .eq('id', options.leadId)
    .maybeSingle()

  if (lead) {
    const isEntry = lead.stage_id === 'novo' || lead.stage_id === 'tc-novo'
    if (isEntry) {
      const normalized = options.aiInboundUserText.trim()
      const target = resolveTriageTarget(normalized)

      if (target) {
        await admin
          .from('leads')
          .update({
            pipeline_id: target.pipelineId,
            stage_id: target.stageId,
            updated_at: nowIso(),
          })
          .eq('id', options.leadId)
        
        // Lead moved. AI will now generate a response based on the NEW stage in the snapshot.
      } else {
        // Not a valid option yet. Check if we should send the initial question.
        const { data: state } = await admin
          .from('crm_conversation_states')
          .select('last_ai_reply_at')
          .eq('lead_id', options.leadId)
          .maybeSingle()

        if (!state?.last_ai_reply_at) {
          const welcome = INITIAL_TRIAGE_MESSAGE_TEMPLATE.replace('{name}', options.patientName)
          
          const sent = await options.sendProvider.sendMessage({
            to: options.fromPhone,
            text: welcome,
            leadId: options.leadId,
          })
          
          await insertInteraction(admin, {
            leadId: options.leadId,
            patientName: options.patientName,
            channel: 'whatsapp',
            direction: 'out',
            author: 'Assistente IA',
            content: welcome,
            happenedAt: nowIso(),
            externalMessageId: sent.externalMessageId,
          })

          await admin.from('crm_conversation_states').upsert({
            lead_id: options.leadId,
            owner_mode: options.ownerMode,
            ai_enabled: options.aiEnabled,
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
          })

          return { replied: true, replyText: welcome }
        }
      }
    }
  }
  // --- End Triage Logic ---

  let aiReplyRaw = ''
  try {
    aiReplyRaw = await invokeCrmAiAssistantForLead(
      admin,
      options.leadId,
      options.aiInboundUserText,
      options.statePrompt,
      options.invokeMaxAttempts !== undefined ? { maxAttempts: options.invokeMaxAttempts } : undefined,
    )
  } catch (e) {
    console.error('runWhatsappAiAutoReply invoke:', e)
  }

  const { clean: aiReplySanitized } = sanitizeCrmAiPatientReply(aiReplyRaw)
  const aiReply = aiReplySanitized.trim()

  if (!aiReply) {
    try {
      await sendWhatsappPatientFallbackReply(admin, {
        leadId: options.leadId,
        patientName: options.patientName,
        fromPhone: options.fromPhone,
        inboundHappenedAt: options.inboundHappenedAt,
        ownerMode: options.ownerMode,
        aiEnabled: options.aiEnabled,
        sendProvider: options.sendProvider,
        aiJobSource: options.aiJobSource,
        typingDelayMs: options.typingDelayMs,
        contextSnippet: options.aiInboundUserText.slice(0, 280),
        noteSuffix: 'empty_ai_reply',
      })
      return {
        replied: true,
        replyText: normalizeWhatsappPatientFormatting(patientAiFallbackMessagePt()),
      }
    } catch (e) {
      console.error('runWhatsappAiAutoReply fallback:', e)
      await upsertConversationStateInboundOnly(admin, {
        leadId: options.leadId,
        ownerMode: options.ownerMode,
        aiEnabled: options.aiEnabled,
        inboundHappenedAt: options.inboundHappenedAt,
      })
      return { replied: false }
    }
  }

  try {
    const envTyping = (Deno.env.get('WHATSAPP_AI_TYPING_DELAY_MS') ?? '').trim()
    const envTypingN = envTyping ? Number.parseInt(envTyping, 10) : Number.NaN
    const delayFromEnv = Number.isFinite(envTypingN) ? Math.max(0, envTypingN) : null
    const delay =
      options.typingDelayMs !== undefined
        ? Math.max(0, options.typingDelayMs)
        : delayFromEnv !== null
          ? delayFromEnv
          : 400 + Math.floor(Math.random() * 500)
    if (delay > 0) await sleepMs(delay)

    const sent = await options.sendProvider.sendMessage({
      to: options.fromPhone,
      text: aiReply,
      leadId: options.leadId,
    })
    await insertInteraction(admin, {
      leadId: options.leadId,
      patientName: options.patientName,
      channel: 'whatsapp',
      direction: 'out',
      author: 'Assistente IA',
      content: aiReply,
      happenedAt: nowIso(),
      externalMessageId: sent.externalMessageId,
    })
    await admin.from('crm_conversation_states').upsert({
      lead_id: options.leadId,
      owner_mode: options.ownerMode,
      ai_enabled: options.aiEnabled,
      last_inbound_at: options.inboundHappenedAt,
      last_ai_reply_at: nowIso(),
      context_summary: `${options.aiInboundUserText.slice(0, 280)}\nIA: ${aiReply.slice(0, 220)}`.slice(0, 1200),
      updated_at: nowIso(),
    })
    await admin.from('webhook_jobs').insert({
      source: options.aiJobSource,
      status: 'done',
      note: `ai_auto_reply:${sent.provider}:${options.leadId}:${sent.externalMessageId}`.slice(0, 500),
    })
    return { replied: true, replyText: aiReply }
  } catch (e) {
    console.error('runWhatsappAiAutoReply send:', e)
    try {
      await sendWhatsappPatientFallbackReply(admin, {
        leadId: options.leadId,
        patientName: options.patientName,
        fromPhone: options.fromPhone,
        inboundHappenedAt: options.inboundHappenedAt,
        ownerMode: options.ownerMode,
        aiEnabled: options.aiEnabled,
        sendProvider: options.sendProvider,
        aiJobSource: options.aiJobSource,
        typingDelayMs: options.typingDelayMs,
        contextSnippet: options.aiInboundUserText.slice(0, 280),
        noteSuffix: 'primary_send_failed',
      })
      return {
        replied: true,
        replyText: normalizeWhatsappPatientFormatting(patientAiFallbackMessagePt()),
      }
    } catch (e2) {
      console.error('runWhatsappAiAutoReply fallback after send error:', e2)
      await upsertConversationStateInboundOnly(admin, {
        leadId: options.leadId,
        ownerMode: options.ownerMode,
        aiEnabled: options.aiEnabled,
        inboundHappenedAt: options.inboundHappenedAt,
      })
      return { replied: false }
    }
  }
}

export async function runManychatAiAutoReply(
  admin: SupabaseClient,
  options: {
    leadId: string
    patientName: string
    aiInboundUserText: string
    inboundHappenedAt: string
    ownerMode: string
    aiEnabled: boolean
    statePrompt: string
    aiJobSource: string
    invokeMaxAttempts?: number
  },
): Promise<{ replied: boolean; replyText?: string; handoffSuggested?: boolean }> {
  // --- Triage Logic ---
  const { data: lead } = await admin
    .from('leads')
    .select('pipeline_id, stage_id')
    .eq('id', options.leadId)
    .maybeSingle()

  if (lead) {
    const isEntry = lead.stage_id === 'novo' || lead.stage_id === 'tc-novo'
    if (isEntry) {
      const normalized = options.aiInboundUserText.trim()
      const target = resolveTriageTarget(normalized)

      if (target) {
        await admin
          .from('leads')
          .update({
            pipeline_id: target.pipelineId,
            stage_id: target.stageId,
            updated_at: nowIso(),
          })
          .eq('id', options.leadId)
        
        // Lead moved. AI will now generate a response based on the NEW stage in the snapshot.
      } else {
        // Not a valid option yet. Check if we should send the initial question.
        const { data: state } = await admin
          .from('crm_conversation_states')
          .select('last_ai_reply_at')
          .eq('lead_id', options.leadId)
          .maybeSingle()

        if (!state?.last_ai_reply_at) {
          const welcome = INITIAL_TRIAGE_MESSAGE_TEMPLATE.replace('{name}', options.patientName)
          
          await insertInteraction(admin, {
            leadId: options.leadId,
            patientName: options.patientName,
            channel: 'meta',
            direction: 'out',
            author: 'Assistente IA',
            content: welcome,
            happenedAt: nowIso(),
          })

          await admin.from('crm_conversation_states').upsert({
            lead_id: options.leadId,
            owner_mode: options.ownerMode,
            ai_enabled: options.aiEnabled,
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
          })

          return { replied: true, replyText: welcome }
        }
      }
    }
  }
  // --- End Triage Logic ---

  let aiReplyRaw = ''
  try {
    aiReplyRaw = await invokeCrmAiAssistantForLead(
      admin,
      options.leadId,
      options.aiInboundUserText,
      options.statePrompt,
      options.invokeMaxAttempts !== undefined ? { maxAttempts: options.invokeMaxAttempts } : undefined,
    )
  } catch (e) {
    console.error('runManychatAiAutoReply invoke:', e)
  }

  const sanitizedManychat = sanitizeCrmAiPatientReply(aiReplyRaw)
  const aiReply = sanitizedManychat.clean.trim()
  const handoffSuggested = sanitizedManychat.handoffSuggested

  const commitManychatReply = async (text: string, noteMid: string): Promise<void> => {
    await insertInteraction(admin, {
      leadId: options.leadId,
      patientName: options.patientName,
      channel: 'meta',
      direction: 'out',
      author: 'Assistente IA',
      content: text,
      happenedAt: nowIso(),
    })
    await admin.from('crm_conversation_states').upsert({
      lead_id: options.leadId,
      owner_mode: options.ownerMode,
      ai_enabled: options.aiEnabled,
      last_inbound_at: options.inboundHappenedAt,
      last_ai_reply_at: nowIso(),
      context_summary: `${options.aiInboundUserText.slice(0, 280)}\nIA: ${text.slice(0, 220)}`.slice(0, 1200),
      updated_at: nowIso(),
    })
    await admin.from('webhook_jobs').insert({
      source: options.aiJobSource,
      status: 'done',
      note: `ai_auto_reply:manychat:${noteMid}:${options.leadId}`.slice(0, 500),
    })
  }

  if (!aiReply) {
    const fb = patientAiFallbackMessagePt()
    try {
      await commitManychatReply(fb, 'fallback_empty')
      return { replied: true, replyText: fb, handoffSuggested: false }
    } catch (e) {
      console.error('runManychatAiAutoReply fallback commit:', e)
      await upsertConversationStateInboundOnly(admin, {
        leadId: options.leadId,
        ownerMode: options.ownerMode,
        aiEnabled: options.aiEnabled,
        inboundHappenedAt: options.inboundHappenedAt,
      })
      return { replied: false, handoffSuggested: false }
    }
  }

  try {
    await commitManychatReply(aiReply, 'reply')
    return { replied: true, replyText: aiReply, handoffSuggested }
  } catch (e) {
    console.error('runManychatAiAutoReply commit:', e)
    const fb = patientAiFallbackMessagePt()
    try {
      await commitManychatReply(fb, 'fallback_send')
      return { replied: true, replyText: fb, handoffSuggested: false }
    } catch (e2) {
      console.error('runManychatAiAutoReply fallback_send:', e2)
      await upsertConversationStateInboundOnly(admin, {
        leadId: options.leadId,
        ownerMode: options.ownerMode,
        aiEnabled: options.aiEnabled,
        inboundHappenedAt: options.inboundHappenedAt,
      })
      return { replied: false, handoffSuggested: false }
    }
  }
}
