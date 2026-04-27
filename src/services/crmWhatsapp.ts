import { supabase } from '@/lib/supabaseClient'

export type SendWhatsappPayload = {
  leadId: string
  to: string
  text: string
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

export async function sendWhatsappMessage(payload: SendWhatsappPayload): Promise<SendWhatsappResult> {
  if (!supabase) return { ok: false, error: 'Sistema não configurado.' }

  const { data, error } = await supabase.functions.invoke('crm-send-message', {
    body: payload,
  })

  if (error) {
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

