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

export async function sendWhatsappMessage(payload: SendWhatsappPayload): Promise<SendWhatsappResult> {
  if (!supabase) return { ok: false, error: 'Sistema não configurado.' }

  const { data, error } = await supabase.functions.invoke('crm-send-message', {
    body: payload,
  })

  if (error) {
    const body = await readEdgeFunctionErrorBody(error)
    if (body && (body.error || body.message)) {
      return {
        ok: false,
        error: String(body.error ?? error.message ?? 'Falha ao enviar mensagem.'),
        detail: typeof body.message === 'string' ? body.message : undefined,
      }
    }
    return { ok: false, error: error.message || 'Falha ao enviar mensagem.' }
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

  return {
    ok: false,
    error: String(parsed.error ?? 'Falha ao enviar mensagem.'),
    detail: typeof parsed.message === 'string' ? parsed.message : undefined,
  }
}

