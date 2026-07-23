import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { insertInteraction } from './crm.ts'
import { matchesInternalTerm } from './internalContacts.ts'
import { alertOwnerAiOutOfBalance } from './saleReceipt.ts'
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
 * WhatsApp no cliente (Evolution, Cloud API ou DM WhatsApp entregue via ManyChat): negrito é `*texto*`.
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

export type TriageOption = '1' | '2' | '3' | '4' | '5'

/** Rótulo humano de cada opção — usado no eco determinístico da escolha ao paciente. */
const SERVICE_LABEL_BY_OPTION: Record<TriageOption, string> = {
  '1': 'Transplante Capilar Masculino',
  '2': 'Transplante Capilar Feminino',
  '3': 'Consulta Clínica Masculina',
  '4': 'Consulta Clínica Feminina',
  '5': 'Transplante de Sobrancelha',
}

/** Detecta a OPÇÃO 1–5 em texto livre (número solto, "opção 3", ou o nome do serviço). */
export function inferTriageOptionFromText(raw: string): TriageOption | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const joined = lines.join(' ')
  const t = joined.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const opt = joined.match(/(?:^|\s)(?:opc[aã]o|op[cç][aã]o|numero|n[º°]?)\s*([1-5])(?:\s|$|[).:,])/i)
  if (opt?.[1] && TRIAGE_MAPPING[opt[1]]) return opt[1] as TriageOption
  const loneLine = lines.find((l) => /^[1-5]$/.test(l))
  if (loneLine && TRIAGE_MAPPING[loneLine]) return loneLine as TriageOption
  if (/transplante\s+capilar\s+masculin|transplate\s+capilar\s+masculin|capilar\s+masculino\b/.test(t)) return '1'
  if (/transplante\s+capilar\s+feminin|capilar\s+feminina\b|capilar\s+feminino\b/.test(t)) return '2'
  if (/consulta\s+cl[ií]nica\s+masculin/.test(t)) return '3'
  if (/consulta\s+cl[ií]nica\s+feminin/.test(t)) return '4'
  if (/\bsobrancelha/.test(t)) return '5'
  return null
}

/** Detecta opção 1–5 em texto livre (várias linhas, erros comuns de escrita). */
export function inferTriageTargetFromText(raw: string): { pipelineId: string; stageId: string } | null {
  const opt = inferTriageOptionFromText(raw)
  return opt ? TRIAGE_MAPPING[opt] : null
}

function resolveTriageOption(normalized: string): TriageOption | null {
  const n = normalized.trim()
  if (!n) return null
  if (TRIAGE_MAPPING[n]) return n as TriageOption
  return inferTriageOptionFromText(n)
}

function resolveTriageTarget(normalized: string): { pipelineId: string; stageId: string } | null {
  const opt = resolveTriageOption(normalized)
  return opt ? TRIAGE_MAPPING[opt] : null
}

/**
 * Move o lead para o pipeline/stage da opção escolhida. O erro é CONFERIDO de propósito: este
 * update mandava `updated_at`, coluna que não existe em `leads` — o PostgREST devolvia 400
 * (PGRST204) e descartava o payload inteiro, então o lead nunca saía de "Novo" e cada repetição da
 * opção re-disparava a mesma mensagem (caso Aline 22/jul). A coluna passou a existir na migration
 * 20260723140000; o log fica para a próxima divergência de schema não voltar a ser silenciosa.
 */
async function moveLeadToTriageStage(
  admin: SupabaseClient,
  leadId: string,
  target: { pipelineId: string; stageId: string },
): Promise<void> {
  const { error } = await admin
    .from('leads')
    .update({ pipeline_id: target.pipelineId, stage_id: target.stageId, updated_at: nowIso() })
    .eq('id', leadId)
  if (error) {
    console.error('[triagem] falha ao mover lead', {
      leadId,
      target,
      code: error.code,
      message: error.message,
    })
  }
}

/**
 * Paciente já indicou o MÉDICO na mesma mensagem da escolha (ex.: "1, com a Dra. Lorena")? Aí o
 * Passo 2 já está respondido e quem fecha é a IA, com o contexto completo. Cobre também o "tanto
 * faz", que o script manda direcionar para a Dra. Lorena.
 */
function mentionsDoctorPreference(raw: string): boolean {
  const t = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (/\b(lorena|visentainer|matheus|amaral|jaqueline|jaque)\b/.test(t)) return true
  return /\b(tanto faz|qualquer um|qualquer med|indiferente|voce escolhe|o que estiver disponivel|o que for melhor)\b/
    .test(t)
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
  // Default 0 desde a API oficial — sem motivo para simular digitação.
  // Para reativar, setar env WHATSAPP_AI_TYPING_DELAY_MS=200 (ou outro valor).
  const delay =
    opts.typingDelayMs !== undefined
      ? Math.max(0, opts.typingDelayMs)
      : delayFromEnv !== null
        ? delayFromEnv
        : 0
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
    // NÃO regravar owner_mode/ai_enabled aqui: este é um upsert de conclusão da
    // resposta da IA. Se a equipa trocou para "Humano" durante o processamento,
    // reescrever o valor capturado revertia para Misto. Em insert (lead novo) os
    // defaults da coluna (auto / true) aplicam-se.
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
  whatsappInstanceId?: string | null
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

// Lease da trava por-lead: > maior duração realista de UMA resposta (z.ai ~30-120s + retries,
// limitado pelo wall-clock da Edge). Se o detentor morrer, a trava expira e o burst-flush retoma.
const AI_REPLY_LOCK_LEASE_MS = 150_000

/**
 * Trava ATÔMICA por lead para a resposta da IA. Dois flushes concorrentes do mesmo lead (comum
 * quando o z.ai está lento e o cliente manda 2 msgs) geravam resposta/cobrança dupla (caso
 * Debora 18/jun: 2 Pix). Quem pega a trava responde; o outro desiste (o em curso já lê o
 * histórico completo). Retorna true se adquiriu.
 */
async function acquireAiReplyLock(admin: SupabaseClient, leadId: string): Promise<boolean> {
  const now = nowIso()
  const until = new Date(Date.now() + AI_REPLY_LOCK_LEASE_MS).toISOString()
  try {
    const { data: locked, error: updErr } = await admin
      .from('crm_conversation_states')
      .update({ ai_reply_lock_until: until, updated_at: now })
      .eq('lead_id', leadId)
      .or(`ai_reply_lock_until.is.null,ai_reply_lock_until.lt.${now}`)
      .select('lead_id')
    if (updErr) throw updErr
    if (locked && locked.length > 0) return true
    // 0 linhas: ou o lead ainda não tem linha de estado, ou a trava está ativa (outra resposta).
    const { data: exists } = await admin
      .from('crm_conversation_states').select('lead_id').eq('lead_id', leadId).maybeSingle()
    if (exists) return false // trava ativa → desiste
    const { error: insErr } = await admin
      .from('crm_conversation_states')
      .insert({ lead_id: leadId, ai_reply_lock_until: until, updated_at: now })
    return !insErr // corrida no insert (outro criou primeiro) → desiste
  } catch (e) {
    // FAIL-OPEN: qualquer erro na trava NÃO pode bloquear todas as respostas. Pior caso volta a
    // ser a dup rara (já mitigada pela idempotência de cobrança em asaas.ts).
    console.error('acquireAiReplyLock (fail-open):', e instanceof Error ? e.message : String(e))
    return true
  }
}

/** Libera a trava por-lead (não regrava outras colunas; upserts de conclusão preservam o resto). */
async function releaseAiReplyLock(admin: SupabaseClient, leadId: string): Promise<void> {
  await admin.from('crm_conversation_states')
    .update({ ai_reply_lock_until: null }).eq('lead_id', leadId)
}

/** Saudação contextual ("Bom dia" / "Boa tarde" / "Boa noite") no fuso de São Paulo. */
export function brasilGreetingNow(now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }).format(now),
  )
  if (hour < 5) return 'Boa noite'
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

/**
 * Passo 1 do script da Sofia (crm_ai_configs.system_prompt do instituto-lorena), palavra por palavra.
 * O texto antigo divergia em 4 pontos que a equipa cobrou: dizia "assistente *virtual*" (o script
 * proíbe em caixa alta se identificar como IA/assistente virtual), tratava toda paciente no
 * masculino ("ajudá-lo"), escrevia "equipa" (pt-PT) e listava "Consulta Clínica Masculino/Feminino"
 * sem concordância.
 */
function buildInitialTriageMessage(name: string): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? ''
  const vocative = first ? `, ${first}` : ''
  return `Olá${vocative}! 😊
Seja muito bem-vindo(a) ao Instituto Lorena Visentainer.
Será um prazer cuidar de você! ✨

Eu sou a *Sofia*, assistente do Instituto, e vou te auxiliar neste primeiro atendimento, identificando o melhor tipo de consulta para o seu caso.

Para começarmos, por favor escolha uma das opções abaixo:

1️⃣ Transplante Capilar Masculino
2️⃣ Transplante Capilar Feminino
3️⃣ Consulta Clínica Masculina
4️⃣ Consulta Clínica Feminina
5️⃣ Transplante de Sobrancelha`
}

/**
 * Eco DETERMINÍSTICO da escolha de triagem (opção 1–5). Substitui a geração pela IA logo após a
 * seleção: o GLM re-apresentava o MENU inteiro (mensagem duplicada — caso Carlos 22/07) em vez de
 * avançar.
 *
 * O texto é o Passo 2 do script (escolha do médico). A versão anterior perguntava "manhã ou tarde",
 * que é justamente o que o script proíbe a Sofia de fazer ("❌ Não confirma horários, dias ou
 * turnos" / "Você NUNCA informa dias da semana ou horários dos médicos" — quem fecha agenda é a
 * Dandara). `includeIntro` = a escolha veio já na 1ª mensagem (o menu nunca chegou a ser mostrado)
 * → apresenta a Sofia antes, como no Passo 1.
 */
function buildTriageOptionAckMessage(
  name: string,
  option: TriageOption,
  includeIntro: boolean,
): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? ''
  const vocative = first ? `, ${first}` : ''
  const service = SERVICE_LABEL_BY_OPTION[option]
  const intro = includeIntro
    ? `Olá${vocative}! 😊\nSeja muito bem-vindo(a) ao Instituto Lorena Visentainer.\nEu sou a *Sofia*, assistente do Instituto. ✨\n\n`
    : ''
  return `${intro}Perfeito${vocative}! Anotei aqui o seu interesse em *${service}*. 💚

Temos uma equipe médica especializada pronta para cuidar do seu caso com excelência e atenção individualizada.

Atualmente, você pode agendar seu atendimento com um dos profissionais abaixo:

👩‍⚕️ Dra. Lorena Visentainer
👨‍⚕️ Dr. Matheus Amaral
👩‍⚕️ Dra. Jaqueline Augusto

Com qual profissional você gostaria de realizar sua consulta?`
}

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
  const { data: leadRowGate } = await admin
    .from('leads')
    .select('opted_out_at, tenant_id, patient_name')
    .eq('id', leadId)
    .maybeSingle()
  const leadOptedOut = Boolean(
    (leadRowGate as { opted_out_at?: string | null } | null)?.opted_out_at,
  )
  // Contato INTERNO (clínica/financeiro/sócios, ex.: Kauan do Instituto Lorena fazendo
  // conciliação de caixa): o bot de vendas não responde. Mesma lista do reengajamento.
  const internalContact = matchesInternalTerm(
    (leadRowGate as { patient_name?: string | null } | null)?.patient_name,
  )
  // crm_ai_configs tem PK (tenant_id, id): escopar por tenant do lead, senão com >1 tenant
  // o .maybeSingle() falha e a config (default_owner_mode, enabled) vem nula.
  const gateTenantId = String((leadRowGate as { tenant_id?: string } | null)?.tenant_id ?? '').trim()
  const { data: config } = gateTenantId
    ? await admin.from('crm_ai_configs').select('*').eq('id', 'default').eq('tenant_id', gateTenantId).maybeSingle()
    : { data: null }

  const rawOwnerMode = String(state?.owner_mode ?? config?.default_owner_mode ?? 'auto').toLowerCase()
  const aiEnabled = Boolean((state?.ai_enabled ?? true) && (config?.enabled ?? true))

  // HANDOFF EXPIRA (16/jul). A conversa vira 'human' sempre que a equipe manda mensagem
  // manual (crm-send-message) — correto, a IA não pode atropelar a atendente no meio do
  // papo. O problema era não ter volta: atendente respondeu uma vez em maio e a IA ficava
  // muda pra aquele cliente PARA SEMPRE. Achamos 682 conversas assim na clínica.
  //
  // Agora o 'human' vale enquanto a conversa está quente. Passados N dias sem NENHUM humano
  // falar, o atendimento acabou e a IA reassume — o cliente que volta semanas depois é
  // atendido na hora em vez de esperar alguém notar.
  //
  // Só expira o handoff da EQUIPE (owner_mode=human COM ai_enabled=true). Escalonamento de
  // verdade (escalateLeadToHuman) desliga ai_enabled e continua respeitado pra sempre —
  // é a regra crítica do fluxo [[feedback_handoff_desliga_ia]] e não é tocada aqui.
  const handoffDays = Math.max(0, Number(config?.handoff_expires_days ?? 7))
  let ownerMode = rawOwnerMode
  let handoffExpired = false
  if (rawOwnerMode === 'human' && aiEnabled && handoffDays > 0) {
    const lastHumanAt = state?.last_human_reply_at ? new Date(String(state.last_human_reply_at)).getTime() : 0
    const daysSinceHuman = lastHumanAt ? (Date.now() - lastHumanAt) / 86400000 : Number.POSITIVE_INFINITY
    if (daysSinceHuman >= handoffDays) {
      ownerMode = 'auto'
      handoffExpired = true
      // Persiste, senão o painel seguiria mostrando "Humano" e a IA responderia — a tela
      // mentiria pra equipe sobre quem está atendendo.
      await admin.from('crm_conversation_states')
        .update({ owner_mode: 'auto', updated_at: new Date().toISOString() })
        .eq('lead_id', leadId)
        .then(() => {}, () => {})
      console.log(`[autoReply] handoff expirado (${Math.round(daysSinceHuman)}d sem humano) → IA reassume lead ${leadId}`)
    }
  }
  /** 0 = sem espera mínima (várias mensagens seguidas do mesmo cliente podem gerar resposta a cada uma). */
  const minSecondsBetween = Math.max(0, Number(config?.min_seconds_between_ai_replies ?? 0))
  const latestAiReplyAt = state?.last_ai_reply_at ? new Date(String(state.last_ai_reply_at)).getTime() : 0
  const elapsedSinceAi = latestAiReplyAt ? (Date.now() - latestAiReplyAt) / 1000 : Number.POSITIVE_INFINITY

  // owner_mode 'auto' e 'ai' → IA responde 24h. 'human' → só atendimento humano.
  // crm_ai_configs.business_hours_* não bloqueia mais o auto-reply; continua a ser
  // usado por find_first_appointment_slot para sugerir horários de consulta válidos.
  const shouldAiByMode = ownerMode === 'ai' || ownerMode === 'auto'

  const skipReasons: string[] = []
  if (leadOptedOut) skipReasons.push('lead_opted_out')
  if (internalContact) skipReasons.push('contato_interno')
  if (!aiEnabled) skipReasons.push('ai_disabled')
  if (!options.directionIsInbound) skipReasons.push('not_inbound')
  if (!shouldAiByMode) {
    if (ownerMode === 'human') skipReasons.push('owner_mode_human')
    else skipReasons.push(`owner_mode_${ownerMode || 'unknown'}`)
  }
  if (minSecondsBetween > 0 && elapsedSinceAi < minSecondsBetween) {
    skipReasons.push('min_seconds_between_ai_replies')
  }

  // max_ai_replies_per_hour em crm_ai_configs mantém-se para métricas/UI; não bloqueia mais o auto-reply
  // (limite global fazia a IA “parar” em conversas com várias mensagens).

  const canAutoReply =
    !leadOptedOut &&
    !internalContact &&
    aiEnabled &&
    shouldAiByMode &&
    options.directionIsInbound &&
    (minSecondsBetween === 0 || elapsedSinceAi >= minSecondsBetween)

  const hintParts: string[] = []
  if (skipReasons.includes('contato_interno')) {
    hintParts.push('Contato interno (clínica/financeiro/sócios): o bot de vendas não responde.')
  }
  if (skipReasons.includes('ai_disabled')) {
    hintParts.push('IA desligada em crm_ai_configs ou neste lead (crm_conversation_states.ai_enabled).')
  }
  if (skipReasons.includes('owner_mode_human')) {
    hintParts.push('Modo de atendimento = humano: só a equipa responde.')
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
  opts?: { maxAttempts?: number; whatsappInstanceId?: string | null },
): Promise<{ reply: string; pixQrUrl?: string; failKind?: 'transient' | 'balance' | 'other' }> {
  // Classifica a falha do z.ai p/ o caller decidir: 'transient' (1302 concorrência / 5xx /
  // timeout → o cron retenta sozinho, sem mandar desculpa), 'balance' (1113 sem saldo → alerta
  // o dono), 'other' (vazio persistente / erro não-retentável → mantém o fallback de sempre).
  let failKind: 'transient' | 'balance' | 'other' | undefined
  const aiMessages = [{ role: 'user', content: aiInboundUserText }]
  const aiCtx: Record<string, unknown> = { leadId, focus: 'lead' }
  const wid = opts?.whatsappInstanceId != null ? String(opts.whatsappInstanceId).trim() : ''
  if (wid) aiCtx.whatsapp_instance_id = wid
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
      // 'zai_unavailable': o assistant JÁ retentou o z.ai internamente com backoff 429-aware.
      // Re-invocar aqui só re-roda o snapshot e bate de novo no z.ai na MESMA janela de
      // rate-limit — amplifica o estouro (foi o que pinou 1 lead em ~10 chamadas/5min).
      // Para nesse erro; deixa o burst-flush retentar mais tarde, com a janela já limpa.
      if (aiObj.error === 'zai_unavailable') {
        const code = String(aiObj.code ?? '')
        const retry = aiObj.retryable === true
        failKind = code === '1113' ? 'balance'
          : code === 'empty' ? 'other' // vazio persistente: mantém fallback/handover (não é capacidade)
          : retry ? 'transient'
          : 'other'
        break
      }
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

    // QR do Pix (op rede_pix; `pagbank_pix` é alias legado) para enviar como IMAGEM, via crm_actions.
    const acts = Array.isArray(aiObj.crm_actions) ? (aiObj.crm_actions as Array<Record<string, unknown>>) : []
    const pixAct = acts.find(
      (a) => a && typeof a === 'object' && (String(a.type ?? '') === 'rede_pix' || String(a.type ?? '') === 'pagbank_pix') && a.ok === true && typeof a.imageUrl === 'string' && a.imageUrl,
    )
    const pixQrUrl = pixAct ? String(pixAct.imageUrl) : ''

    if (reply.trim()) return { reply, pixQrUrl: pixQrUrl || undefined }
    if (attempt < attempts - 1) await sleepMs(500 * (attempt + 1))
  }

  return { reply: '', failKind }
}

/**
 * Stage destino quando a IA finaliza a triagem (marker [PRONTO_PARA_CONSULTOR]):
 * o lead sai da triagem da Sofia e passa para a Dandara negociar/agendar manualmente.
 */
const HANDOFF_STAGE_BY_PIPELINE: Record<string, string> = {
  'pipeline-clinica': 'contato',
  'pipeline-tratamento-capilar': 'tc-avaliacao',
}

/** Mensagem de transição quando a IA falha 2x seguidas — chama humano sem assustar o paciente. */
const AI_FAILURE_HANDOVER_TEXT =
  'Só um momento — vou chamar a nossa equipa para continuar o teu atendimento por aqui. Em instantes responde-te um(a) consultor(a) do Instituto Lorena 🙏'

/** True se a última saída IA neste lead foi a mensagem de fallback "Peço desculpa…". */
export async function wasLastAiReplyFallback(
  admin: SupabaseClient,
  leadId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('interactions')
    .select('content, author')
    .eq('lead_id', leadId)
    .eq('direction', 'out')
    .eq('author', 'Assistente IA')
    .order('happened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return false
  const content = String((data as { content?: string }).content ?? '')
  return /Peço desculpa.*não consegui responder/i.test(content)
}

/**
 * Chamada quando a IA produz o marker [PRONTO_PARA_CONSULTOR]: desliga a IA neste lead
 * (ai_enabled=false + owner_mode=human) e move para o stage da Dandara. Idempotente —
 * só atualiza o que ainda não está no estado final, e silencia erros para não bloquear o reply.
 */
export async function disableAiOnHandoff(
  admin: SupabaseClient,
  leadId: string,
): Promise<void> {
  try {
    const { data: lead } = await admin
      .from('leads')
      .select('pipeline_id, stage_id, patient_name')
      .eq('id', leadId)
      .maybeSingle()
    const pipelineId = String(lead?.pipeline_id ?? '').trim()
    const currentStage = String(lead?.stage_id ?? '').trim()
    const patientName = String(lead?.patient_name ?? '').trim()
    const targetStage = HANDOFF_STAGE_BY_PIPELINE[pipelineId]

    if (targetStage && currentStage !== targetStage) {
      await admin
        .from('leads')
        .update({ stage_id: targetStage, updated_at: nowIso() })
        .eq('id', leadId)
    }

    await admin
      .from('crm_conversation_states')
      .upsert({
        lead_id: leadId,
        ai_enabled: false,
        owner_mode: 'human',
        updated_at: nowIso(),
      })

    await insertInteraction(admin, {
      leadId,
      patientName,
      channel: 'system',
      direction: 'system',
      author: 'CRM',
      content: 'IA desligada automaticamente: triagem finalizada, lead pronto para o atendente humano finalizar manualmente.',
      happenedAt: nowIso(),
    })
  } catch (e) {
    console.warn('disableAiOnHandoff:', e instanceof Error ? e.message : String(e))
  }
}

export async function upsertConversationStateInboundOnly(
  admin: SupabaseClient,
  options: {
    leadId: string
    ownerMode: string
    aiEnabled: boolean
    inboundHappenedAt: string
    /** Se true, reseta o contador de follow-ups (paciente respondeu). Default: true. */
    resetFollowups?: boolean
  },
): Promise<void> {
  const resetFollowups = options.resetFollowups !== false
  await admin.from('crm_conversation_states').upsert({
    lead_id: options.leadId,
    // NÃO regravar owner_mode/ai_enabled: a equipa é dona do modo. Regravar o valor
    // capturado aqui revertia "Humano" para Misto a cada mensagem do paciente.
    last_inbound_at: options.inboundHappenedAt,
    updated_at: nowIso(),
    // Reseta a janela de follow-ups quando o lead responde
    ...(resetFollowups
      ? {
          followup_count: 0,
          followup_window_start: null,
          last_followup_at: null,
        }
      : {}),
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
    /** Omisso: usa `leads.whatsapp_instance_id` para prompt por linha. */
    whatsappInstanceId?: string | null
    /** True (bot de vendas): NUNCA desliga a IA no handover de falha — mantém atendendo. */
    keepAiOn?: boolean
    /**
     * Mensagem veio com mídia (foto/áudio): segura a resposta por N ms pra dar tempo
     * do OCR/transcrição (background) gravar em crm_media_items ANTES de a IA rodar.
     * Sem isso a IA respondia no escuro e chutava o produto da foto (caso shampoo
     * R$179 cobrado como R$119).
     */
    deferForMediaMs?: number
  },
): Promise<{ replied: boolean; replyText?: string; burstPending?: boolean; handoffSuggested?: boolean }> {
  // crm_ai_configs tem PK (tenant_id, id): escopar por tenant do lead.
  const { data: burstLeadRow } = await admin
    .from('leads')
    .select('tenant_id')
    .eq('id', options.leadId)
    .maybeSingle()
  const burstTenantId = String((burstLeadRow as { tenant_id?: string } | null)?.tenant_id ?? '').trim()
  const { data: burstCfg } = burstTenantId
    ? await admin
        .from('crm_ai_configs')
        .select('inbound_burst_debounce_ms')
        .eq('id', 'default')
        .eq('tenant_id', burstTenantId)
        .maybeSingle()
    : { data: null }
  const burstMs = Math.max(0, Number(burstCfg?.inbound_burst_debounce_ms ?? 0))

  const { data: existingBurst } = await admin
    .from('crm_conversation_states')
    .select('ai_inbound_burst_text')
    .eq('lead_id', options.leadId)
    .maybeSingle()
  const hasPendingBurst = String(existingBurst?.ai_inbound_burst_text ?? '').trim().length > 0

  const mediaDeferMs = Math.max(0, Math.floor(options.deferForMediaMs ?? 0))
  const effectiveDebounceMs = Math.max(burstMs, mediaDeferMs)

  if (
    !options.burstFlush &&
    effectiveDebounceMs > 0 &&
    (hasPendingBurst || mediaDeferMs > 0 || shouldDeferReplyForBurstMerge(options.aiInboundUserText))
  ) {
    await appendInboundBurstBuffer(
      admin,
      options.leadId,
      options.aiInboundUserText,
      options.inboundHappenedAt,
    )
    scheduleWhatsappInboundBurstFlush(admin, effectiveDebounceMs, {
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
      whatsappInstanceId: options.whatsappInstanceId,
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
        await moveLeadToTriageStage(admin, options.leadId, target)

        // ECO DETERMINÍSTICO DA ESCOLHA (não delegar à IA): o paciente escolheu uma opção válida
        // (1–5). Antes caíamos na geração do GLM, que re-apresentava o MENU inteiro — mensagem
        // duplicada (caso Carlos 22/07). Respondemos aqui o próximo passo FIXO da triagem
        // (Passo 2 do script: escolha do médico), a menos que o médico já tenha vindo na mesma
        // mensagem — aí a IA fecha a triagem com o contexto completo (opção + médico).
        const option = resolveTriageOption(normalized)
        if (option && !mentionsDoctorPreference(normalized)) {
          const { data: ackState } = await admin
            .from('crm_conversation_states')
            .select('last_ai_reply_at')
            .eq('lead_id', options.leadId)
            .maybeSingle()
          const ack = buildTriageOptionAckMessage(options.patientName, option, !ackState?.last_ai_reply_at)

          const sentAck = await options.sendProvider.sendMessage({
            to: options.fromPhone,
            text: ack,
            leadId: options.leadId,
          })

          await insertInteraction(admin, {
            leadId: options.leadId,
            patientName: options.patientName,
            channel: 'whatsapp',
            direction: 'out',
            author: 'Assistente IA',
            content: ack,
            happenedAt: nowIso(),
            externalMessageId: sentAck.externalMessageId,
          })

          await admin.from('crm_conversation_states').upsert({
            lead_id: options.leadId,
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
            followup_count: 0,
            followup_window_start: null,
            last_followup_at: null,
          })

          return { replied: true, replyText: ack }
        }
        // Paciente mandou opção + período juntos: deixa a IA finalizar a triagem (tem tudo).
      } else {
        // Not a valid option yet. Check if we should send the initial question.
        const { data: state } = await admin
          .from('crm_conversation_states')
          .select('last_ai_reply_at')
          .eq('lead_id', options.leadId)
          .maybeSingle()

        if (!state?.last_ai_reply_at) {
          const welcome = buildInitialTriageMessage(options.patientName)

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
            // NÃO regravar owner_mode/ai_enabled (upsert de conclusão da IA): preserva
            // o modo escolhido pela equipa; defaults da coluna cobrem o lead novo.
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
            followup_count: 0,
            followup_window_start: null,
            last_followup_at: null,
          })

          return { replied: true, replyText: welcome }
        }
      }
    }
  }
  // --- End Triage Logic ---

  // TRAVA POR-LEAD: serializa a geração+envio da resposta da IA (a triagem acima fica de fora).
  // Quem não adquire desiste — o flush em curso já responde com o histórico completo. Evita
  // resposta/cobrança dupla quando 2 flushes do mesmo lead correm em paralelo (z.ai lento).
  // Liberada no finally que fecha a função.
  if (!(await acquireAiReplyLock(admin, options.leadId))) {
    return { replied: false }
  }
  try {
  let aiReplyRaw = ''
  let pixQrUrl = ''
  let aiFailKind: 'transient' | 'balance' | 'other' | undefined
  try {
    let resolvedWaInst = options.whatsappInstanceId != null ? String(options.whatsappInstanceId).trim() : ''
    if (!resolvedWaInst) {
      const { data: lr } = await admin.from('leads').select('whatsapp_instance_id').eq('id', options.leadId).maybeSingle()
      const wid = lr?.whatsapp_instance_id
      if (wid) resolvedWaInst = String(wid)
    }
    const invokeOpts: { maxAttempts?: number; whatsappInstanceId?: string | null } = {}
    if (options.invokeMaxAttempts !== undefined) invokeOpts.maxAttempts = options.invokeMaxAttempts
    if (resolvedWaInst) invokeOpts.whatsappInstanceId = resolvedWaInst

    const invokeRes = await invokeCrmAiAssistantForLead(
      admin,
      options.leadId,
      options.aiInboundUserText,
      options.statePrompt,
      Object.keys(invokeOpts).length ? invokeOpts : undefined,
    )
    aiReplyRaw = invokeRes.reply
    pixQrUrl = invokeRes.pixQrUrl ?? ''
    aiFailKind = invokeRes.failKind
  } catch (e) {
    console.error('runWhatsappAiAutoReply invoke:', e)
  }

  const { clean: aiReplySanitized, handoffSuggested } = sanitizeCrmAiPatientReply(aiReplyRaw)
  const aiReply = aiReplySanitized.trim()

  // ANTI-ATROPELO: o z.ai leva ~30-120s. Se durante esse tempo o HUMANO assumiu a conversa
  // (owner_mode=human ou ai_enabled=false), NÃO enviamos mais nada — a equipa é dona do
  // atendimento agora. Re-checa o gate imediatamente antes de QUALQUER envio.
  const postGate = await evaluateCrmAiAutoReplyGate(admin, options.leadId, { directionIsInbound: true })
  if (!postGate.canAutoReply) {
    console.warn('runWhatsappAiAutoReply: humano assumiu durante a geração — envio abortado', {
      leadId: options.leadId,
      skipReasons: postGate.skipReasons,
    })
    return { replied: false }
  }

  if (!aiReply) {
    // FALHA DO Z.AI POR CAPACIDADE/SALDO (não por conteúdo): NÃO manda a desculpa "não consegui
    // responder" — ela viraria a última interação e faria a rede de segurança do cron (que só
    // retenta quando a última msg é do cliente) desistir da conversa. Em vez disso, deixa a
    // conversa "presa" (só regrava o inbound) para o cron (a cada 2 min) retentar quando o z.ai
    // desafogar. 'balance' (sem saldo) também alerta o dono, pois não limpa sozinho.
    if (aiFailKind === 'transient' || aiFailKind === 'balance') {
      if (aiFailKind === 'balance') {
        const { data: lr } = await admin.from('leads').select('tenant_id').eq('id', options.leadId).maybeSingle()
        const tId = String((lr as { tenant_id?: string } | null)?.tenant_id ?? '').trim()
        if (tId) await alertOwnerAiOutOfBalance(admin, tId).catch(() => {})
      }
      await upsertConversationStateInboundOnly(admin, {
        leadId: options.leadId,
        ownerMode: options.ownerMode,
        aiEnabled: options.aiEnabled,
        inboundHappenedAt: options.inboundHappenedAt,
      })
      console.warn('runWhatsappAiAutoReply: z.ai indisponível — sem desculpa, cron retenta', {
        leadId: options.leadId,
        failKind: aiFailKind,
      })
      return { replied: false }
    }
    // Falha consecutiva no WhatsApp também: 2º fallback seguido → handover defensivo (desliga a
    // IA, manda mensagem útil e sinaliza handoff). Agora vale TAMBÉM p/ o bot de vendas: quando
    // a IA trava de verdade (2x seguidas), o consultor é chamado em vez de a IA seguir patinando.
    const prevAlsoFallback = await wasLastAiReplyFallback(admin, options.leadId)
    if (prevAlsoFallback) {
      try {
        const handoverText = normalizeWhatsappPatientFormatting(AI_FAILURE_HANDOVER_TEXT)
        const envTyping = (Deno.env.get('WHATSAPP_AI_TYPING_DELAY_MS') ?? '').trim()
        const envTypingN = envTyping ? Number.parseInt(envTyping, 10) : Number.NaN
        const delay = options.typingDelayMs !== undefined
          ? Math.max(0, options.typingDelayMs)
          : Number.isFinite(envTypingN) ? Math.max(0, envTypingN) : 200
        if (delay > 0) await sleepMs(delay)
        const sent = await options.sendProvider.sendMessage({
          to: options.fromPhone,
          text: handoverText,
          leadId: options.leadId,
        })
        await insertInteraction(admin, {
          leadId: options.leadId,
          patientName: options.patientName,
          channel: 'whatsapp',
          direction: 'out',
          author: 'Assistente IA',
          content: handoverText,
          happenedAt: nowIso(),
          externalMessageId: sent.externalMessageId,
        })
        await disableAiOnHandoff(admin, options.leadId)
        return { replied: true, replyText: handoverText, handoffSuggested: true }
      } catch (e) {
        console.error('runWhatsappAiAutoReply handover send:', e)
      }
    }
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
    // Default 0 desde a API oficial — sem motivo para simular digitação.
    // Para reativar, setar env WHATSAPP_AI_TYPING_DELAY_MS=500 (ou outro valor).
    const delay =
      options.typingDelayMs !== undefined
        ? Math.max(0, options.typingDelayMs)
        : delayFromEnv !== null
          ? delayFromEnv
          : 0
    if (delay > 0) await sleepMs(delay)

    const sent = await options.sendProvider.sendMessage({
      to: options.fromPhone,
      text: aiReply,
      leadId: options.leadId,
    })
    // QR do Pix como IMAGEM (best-effort): o copia-e-cola já foi no texto, então se o
    // envio da imagem falhar a venda não trava. Só onde o provider suporta (W-API).
    if (pixQrUrl && typeof options.sendProvider.sendImageMessage === 'function') {
      try {
        await options.sendProvider.sendImageMessage({
          to: options.fromPhone,
          imageUrl: pixQrUrl,
          caption: 'QR Code Pix 💸',
          leadId: options.leadId,
        })
      } catch (e) {
        console.warn('runWhatsappAiAutoReply pix qr image:', e instanceof Error ? e.message : e)
      }
    }
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
      // NÃO regravar owner_mode/ai_enabled (upsert de conclusão da IA): preserva
      // o modo escolhido pela equipa; defaults da coluna cobrem o lead novo.
      last_inbound_at: options.inboundHappenedAt,
      last_ai_reply_at: nowIso(),
      context_summary: `${options.aiInboundUserText.slice(0, 280)}\nIA: ${aiReply.slice(0, 220)}`.slice(0, 1200),
      updated_at: nowIso(),
      followup_count: 0,
      followup_window_start: null,
      last_followup_at: null,
    })
    await admin.from('webhook_jobs').insert({
      source: options.aiJobSource,
      status: 'done',
      note: `ai_auto_reply:${sent.provider}:${options.leadId}:${sent.externalMessageId}`.slice(0, 500),
    })
    return { replied: true, replyText: aiReply, handoffSuggested }
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
  } finally {
    await releaseAiReplyLock(admin, options.leadId)
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
    whatsappInstanceId?: string | null
  },
): Promise<{ replied: boolean; replyText?: string; handoffSuggested?: boolean }> {
  // --- Triage Logic ---
  const { data: lead } = await admin
    .from('leads')
    .select('pipeline_id, stage_id, source')
    .eq('id', options.leadId)
    .maybeSingle()

  // Canal real do lead p/ logar a resposta: meta_whatsapp/whatsapp => whatsapp;
  // meta_instagram => meta. Antes era 'meta' cravado, marcando resposta de
  // WhatsApp como Instagram no chat (888 interações erradas).
  const replyChannel: 'whatsapp' | 'meta' = String((lead as { source?: string } | null)?.source ?? '')
    .includes('instagram')
    ? 'meta'
    : 'whatsapp'

  if (lead) {
    const isEntry = lead.stage_id === 'novo' || lead.stage_id === 'tc-novo'
    if (isEntry) {
      const normalized = options.aiInboundUserText.trim()
      const target = resolveTriageTarget(normalized)

      if (target) {
        await moveLeadToTriageStage(admin, options.leadId, target)

        // ECO DETERMINÍSTICO DA ESCOLHA (mesmo motivo do caminho WhatsApp): não delegar à IA, que
        // re-apresentava o menu inteiro (mensagem duplicada). Confirma o serviço + faz o Passo 2
        // (escolha do médico); se o médico já veio junto com a opção, deixa a IA fechar a triagem.
        const option = resolveTriageOption(normalized)
        if (option && !mentionsDoctorPreference(normalized)) {
          const { data: ackState } = await admin
            .from('crm_conversation_states')
            .select('last_ai_reply_at')
            .eq('lead_id', options.leadId)
            .maybeSingle()
          const ack = buildTriageOptionAckMessage(options.patientName, option, !ackState?.last_ai_reply_at)

          await insertInteraction(admin, {
            leadId: options.leadId,
            patientName: options.patientName,
            channel: replyChannel,
            direction: 'out',
            author: 'Assistente IA',
            content: ack,
            happenedAt: nowIso(),
          })

          await admin.from('crm_conversation_states').upsert({
            lead_id: options.leadId,
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
            followup_count: 0,
            followup_window_start: null,
            last_followup_at: null,
          })

          return { replied: true, replyText: ack }
        }
      } else {
        // Not a valid option yet. Check if we should send the initial question.
        const { data: state } = await admin
          .from('crm_conversation_states')
          .select('last_ai_reply_at')
          .eq('lead_id', options.leadId)
          .maybeSingle()

        if (!state?.last_ai_reply_at) {
          const welcome = buildInitialTriageMessage(options.patientName)

          await insertInteraction(admin, {
            leadId: options.leadId,
            patientName: options.patientName,
            channel: replyChannel,
            direction: 'out',
            author: 'Assistente IA',
            content: welcome,
            happenedAt: nowIso(),
          })

          await admin.from('crm_conversation_states').upsert({
            lead_id: options.leadId,
            // NÃO regravar owner_mode/ai_enabled (upsert de conclusão da IA): preserva
            // o modo escolhido pela equipa; defaults da coluna cobrem o lead novo.
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
            followup_count: 0,
            followup_window_start: null,
            last_followup_at: null,
          })

          return { replied: true, replyText: welcome }
        }
      }
    }
  }
  // --- End Triage Logic ---

  // TRAVA POR-LEAD (mesma proteção do caminho WhatsApp em runWhatsappAiAutoReply): serializa
  // a geração+envio da resposta da IA. Sem ela, 2 mensagens seguidas do paciente enquanto o
  // z.ai ainda gera (~50-60s) disparavam 2 gerações independentes — resposta DUPLICADA e/ou
  // atropelada (caso Jamile 18/jun: parágrafo da Unimed enviado 2x). Quem não adquire a trava
  // desiste; a geração em curso já responde com o histórico do lead. Liberada no finally.
  // OBS.: o merge de mensagens em rajada (inbound_burst_debounce_ms) exige entrega assíncrona
  // via push ManyChat — pendente de configurar push p/ este tenant; aqui só a trava.
  if (!(await acquireAiReplyLock(admin, options.leadId))) {
    return { replied: false }
  }
  try {
  let aiReplyRaw = ''
  try {
    const invokeOpts =
      options.invokeMaxAttempts !== undefined || options.whatsappInstanceId != null
        ? {
            ...(options.invokeMaxAttempts !== undefined ? { maxAttempts: options.invokeMaxAttempts } : {}),
            ...(options.whatsappInstanceId != null && String(options.whatsappInstanceId).trim()
              ? { whatsappInstanceId: String(options.whatsappInstanceId).trim() }
              : {}),
          }
        : undefined
    aiReplyRaw = (await invokeCrmAiAssistantForLead(
      admin,
      options.leadId,
      options.aiInboundUserText,
      options.statePrompt,
      invokeOpts,
    )).reply
  } catch (e) {
    console.error('runManychatAiAutoReply invoke:', e)
  }

  const sanitizedManychat = sanitizeCrmAiPatientReply(aiReplyRaw)
  const aiReply = sanitizedManychat.clean.trim()
  const handoffSuggested = sanitizedManychat.handoffSuggested

  // ANTI-ATROPELO (igual ao WhatsApp): se o humano assumiu durante a geração do z.ai,
  // não envia mais nada. Re-checa o gate antes de qualquer commit/envio ao ManyChat.
  const postGateMc = await evaluateCrmAiAutoReplyGate(admin, options.leadId, { directionIsInbound: true })
  if (!postGateMc.canAutoReply) {
    console.warn('runManychatAiAutoReply: humano assumiu durante a geração — envio abortado', {
      leadId: options.leadId,
      skipReasons: postGateMc.skipReasons,
    })
    return { replied: false }
  }

  const commitManychatReply = async (text: string, noteMid: string): Promise<void> => {
    await insertInteraction(admin, {
      leadId: options.leadId,
      patientName: options.patientName,
      channel: replyChannel,
      direction: 'out',
      author: 'Assistente IA',
      content: text,
      happenedAt: nowIso(),
    })
    await admin.from('crm_conversation_states').upsert({
      lead_id: options.leadId,
      // NÃO regravar owner_mode/ai_enabled (upsert de conclusão da IA): preserva
      // o modo escolhido pela equipa; defaults da coluna cobrem o lead novo.
      last_inbound_at: options.inboundHappenedAt,
      last_ai_reply_at: nowIso(),
      context_summary: `${options.aiInboundUserText.slice(0, 280)}\nIA: ${text.slice(0, 220)}`.slice(0, 1200),
      updated_at: nowIso(),
      followup_count: 0,
      followup_window_start: null,
      last_followup_at: null,
    })
    await admin.from('webhook_jobs').insert({
      source: options.aiJobSource,
      status: 'done',
      note: `ai_auto_reply:manychat:${noteMid}:${options.leadId}`.slice(0, 500),
    })
  }

  if (!aiReply) {
    // Falha consecutiva — última saída IA já foi fallback → faz handover defensivo
    // (desliga IA, move stage, envia mensagem útil) em vez de cuspir mais um "Peço desculpa".
    const prevAlsoFallback = await wasLastAiReplyFallback(admin, options.leadId)
    if (prevAlsoFallback) {
      try {
        await commitManychatReply(AI_FAILURE_HANDOVER_TEXT, 'handover_after_consecutive_failures')
        await disableAiOnHandoff(admin, options.leadId)
        return { replied: true, replyText: AI_FAILURE_HANDOVER_TEXT, handoffSuggested: true }
      } catch (e) {
        console.error('runManychatAiAutoReply handover commit:', e)
      }
    }
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
  } finally {
    await releaseAiReplyLock(admin, options.leadId)
  }
}
