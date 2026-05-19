import { toast } from 'sonner'

import { supabase } from '@/lib/supabaseClient'

export type SendWhatsappPayload = {
  leadId: string
  to: string
  text: string
  /** Base64 WebP (cru ou data URL). Só WhatsApp; Instagram/ManyChat devolve erro na Edge. */
  stickerWebpBase64?: string
  attachments?: Array<{
    name: string
    mimeType: string
    base64: string
  }>
}

export type SendWhatsappResult =
  | {
      ok: true
      provider: string
      status: string
      externalMessageId: string
    }
  | {
      ok: false
      error: string
      detail?: string
      /**
       * `true` quando o erro veio do ManyChat sendFlow batendo na janela de 24h do Meta
       * (sem mensagem do paciente nas últimas 24h, Meta bloqueia DM a menos que se use
       * tag HUMAN_AGENT). Permite ao consumer mostrar mensagem amigável em vez de "500".
       */
      outOfMessagingWindow?: boolean
      /** Atalho para "manychat_push_failed", "provider_not_configured" etc. */
      kind?:
        | 'manychat_push_failed'
        | 'manychat_not_configured'
        | 'provider_not_configured'
        | 'rate_limited'
        | 'cooldown'
        | 'lead_not_found'
        | 'missing_fields'
        | 'send_failed'
        | 'unknown'
    }

/**
 * Quando a Edge Function devolve um status não-2xx, `supabase.functions.invoke` põe
 * o corpo dentro de `error.context` (Response). Sem ler esse corpo, perdemos o motivo
 * útil (ex.: `manychat_push_failed` + hint para `MANYCHAT_SEND_FLOW_MESSAGE_TAG`).
 */
async function readEdgeFunctionErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  if (!error || typeof error !== 'object') return null
  const ctx = (error as { context?: unknown }).context
  if (!ctx) return null
  try {
    if (typeof (ctx as Response).json === 'function') {
      const cloned = typeof (ctx as Response).clone === 'function' ? (ctx as Response).clone() : (ctx as Response)
      return (await cloned.json()) as Record<string, unknown>
    }
    if (typeof (ctx as { text?: () => Promise<string> }).text === 'function') {
      const txt = await (ctx as { text: () => Promise<string> }).text()
      try {
        return JSON.parse(txt) as Record<string, unknown>
      } catch {
        return { message: txt }
      }
    }
  } catch {
    return null
  }
  return null
}

/** Reconhece a assinatura de "fora da janela 24h" no detail do erro. */
function detectOutOfMessagingWindow(error: string, detail?: string): boolean {
  const haystack = `${error} ${detail ?? ''}`.toLowerCase()
  if (!haystack.includes('manychat')) return false
  return /window|24|tag|messaging|policy|human_agent|outside/i.test(haystack)
}

const KNOWN_ERROR_KINDS = new Set([
  'manychat_push_failed',
  'manychat_not_configured',
  'provider_not_configured',
  'rate_limited',
  'cooldown',
  'lead_not_found',
  'missing_fields',
  'send_failed',
])

function classifyError(raw: string): SendWhatsappResult extends infer R
  ? R extends { ok: false; kind?: infer K }
    ? K
    : never
  : never {
  const k = raw.trim()
  return (KNOWN_ERROR_KINDS.has(k) ? k : 'unknown') as never
}

export async function sendWhatsappMessage(payload: SendWhatsappPayload): Promise<SendWhatsappResult> {
  if (!supabase) return { ok: false, error: 'Sistema não configurado.', kind: 'unknown' }

  const { data, error } = await supabase.functions.invoke('crm-send-message', {
    body: payload,
  })

  if (error) {
    const body = await readEdgeFunctionErrorBody(error)
    if (body && (body.error || body.message)) {
      const errStr = String(body.error ?? error.message ?? 'Falha ao enviar mensagem.')
      const detail = typeof body.message === 'string' ? body.message : undefined
      return {
        ok: false,
        error: errStr,
        detail,
        outOfMessagingWindow: detectOutOfMessagingWindow(errStr, detail),
        kind: classifyError(errStr),
      }
    }
    return { ok: false, error: error.message || 'Falha ao enviar mensagem.', kind: 'unknown' }
  }

  const parsed = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  if (parsed.ok === true) {
    return {
      ok: true,
      provider: String(parsed.provider ?? 'evolution'),
      status: String(parsed.status ?? 'queued'),
      externalMessageId: String(parsed.externalMessageId ?? ''),
    }
  }

  const errStr = String(parsed.error ?? 'Falha ao enviar mensagem.')
  const detail = typeof parsed.message === 'string' ? parsed.message : undefined
  return {
    ok: false,
    error: errStr,
    detail,
    outOfMessagingWindow: detectOutOfMessagingWindow(errStr, detail),
    kind: classifyError(errStr),
  }
}

/**
 * Mostra um toast adequado ao tipo de erro de envio. Usar nos consumers em vez de
 * `toast.error(result.error)` direto — assim janela 24h vira aviso amarelo claro
 * em vez de "500 Internal Server Error".
 */
export function notifySendError(
  result: Extract<SendWhatsappResult, { ok: false }>,
  context: 'manual' | 'sticker' | 'automation' = 'manual',
): void {
  if (result.outOfMessagingWindow) {
    toast.warning(
      'Paciente sem responder há mais de 24h.',
      {
        description:
          'O Instagram/WhatsApp da Meta bloqueia DM nessa situação. Configure o secret MANYCHAT_SEND_FLOW_MESSAGE_TAG=HUMAN_AGENT no Supabase para liberar resposta humana em até 7 dias.',
      },
    )
    return
  }
  if (result.kind === 'cooldown') {
    toast.info('Aguarde alguns segundos entre envios para o mesmo lead.', {
      description: result.detail,
    })
    return
  }
  if (result.kind === 'rate_limited') {
    toast.warning('Limite de envios atingido nesta hora.', { description: result.detail })
    return
  }
  const prefix =
    context === 'sticker' ? 'Falha no envio da figurinha'
    : context === 'automation' ? 'Falha na automação'
    : 'Falha no envio'
  toast.error(`${prefix}: ${result.error}${result.detail ? ` (${result.detail})` : ''}`)
}

