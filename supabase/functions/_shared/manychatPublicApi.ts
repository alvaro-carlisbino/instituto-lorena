/** ManyChat Page Public API — envio de DM após resposta da IA no CRM. */

const MANYCHAT_API_ROOT = 'https://api.manychat.com'

const MAX_DM_FIELD_CHARS = 18_000

function manychatSuccess(json: Record<string, unknown>): boolean {
  return String(json.status ?? '').toLowerCase() === 'success'
}

async function manychatPost(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown>; raw: string }> {
  const res = await fetch(`${MANYCHAT_API_ROOT}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(raw) as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, json, raw: raw.slice(0, 1500) }
}

function normalizeSubscriberId(subscriberId: string): string | number {
  const s = subscriberId.trim()
  const n = Number(s)
  if (s && Number.isFinite(n) && Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER) {
    return n
  }
  return s
}

/**
 * Grava o texto no custom field do subscriber e dispara o flow de entrega (Instagram).
 * Ordem: `setCustomField` → `sendFlow` (recomendação ManyChat).
 */
export async function pushManychatInstagramDmAfterReply(input: {
  apiKey: string
  subscriberId: string
  replyText: string
  fieldId: number
  flowNs: string
  /** Ex.: CONFIRMED_EVENT_UPDATE — só enviado se definido */
  messageTag?: string
}): Promise<{ ok: boolean; error?: string; set_field_status?: string; send_flow_status?: string }> {
  const value = input.replyText.trim().slice(0, MAX_DM_FIELD_CHARS)
  if (!value) {
    return { ok: false, error: 'empty_reply_text' }
  }

  const sid = normalizeSubscriberId(input.subscriberId)

  const setBody: Record<string, unknown> = {
    subscriber_id: sid,
    field_id: input.fieldId,
    field_value: value,
  }

  const setRes = await manychatPost('/fb/subscriber/setCustomField', setBody, input.apiKey)
  if (!setRes.ok || !manychatSuccess(setRes.json)) {
    const msg =
      typeof setRes.json.message === 'string'
        ? setRes.json.message
        : `setCustomField_http_${setRes.status}`
    return {
      ok: false,
      error: `manychat_set_custom_field:${msg}`,
      set_field_status: String(setRes.json.status ?? ''),
    }
  }

  const flowBody: Record<string, unknown> = {
    subscriber_id: sid,
    flow_ns: input.flowNs.trim(),
  }
  if (input.messageTag?.trim()) {
    flowBody.message_tag = input.messageTag.trim()
  }

  const flowRes = await manychatPost('/fb/sending/sendFlow', flowBody, input.apiKey)
  if (!flowRes.ok || !manychatSuccess(flowRes.json)) {
    const msg =
      typeof flowRes.json.message === 'string'
        ? flowRes.json.message
        : `sendFlow_http_${flowRes.status}`
    return {
      ok: false,
      error: `manychat_send_flow:${msg}`,
      set_field_status: 'success',
      send_flow_status: String(flowRes.json.status ?? ''),
    }
  }

  return { ok: true, set_field_status: 'success', send_flow_status: 'success' }
}

export function readManychatPushConfigFromEnv(): {
  apiKey: string
  fieldId: number
  flowNs: string
  messageTag: string
} | null {
  const apiKey = (Deno.env.get('MANYCHAT_API_KEY') ?? '').trim()
  if (!apiKey) return null

  const fieldIdRaw = (Deno.env.get('MANYCHAT_DM_FIELD_ID') ?? '14539456').trim()
  const fieldId = Number.parseInt(fieldIdRaw, 10)
  if (!Number.isFinite(fieldId) || fieldId <= 0) {
    console.warn('manychatPublicApi: MANYCHAT_DM_FIELD_ID inválido, uso 14539456')
  }

  const flowNs = (Deno.env.get('MANYCHAT_DM_FLOW_NS') ?? 'content20260430143025_638461').trim()
  if (!flowNs) {
    console.warn('manychatPublicApi: MANYCHAT_DM_FLOW_NS vazio')
    return null
  }

  const messageTag = (Deno.env.get('MANYCHAT_SEND_FLOW_MESSAGE_TAG') ?? '').trim()

  return {
    apiKey,
    fieldId: Number.isFinite(fieldId) && fieldId > 0 ? fieldId : 14539456,
    flowNs,
    messageTag,
  }
}
