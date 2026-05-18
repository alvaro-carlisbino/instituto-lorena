/** ManyChat Page Public API — envio de DM após resposta da IA no CRM. */

const MANYCHAT_API_ROOT = 'https://api.manychat.com'

const MAX_DM_FIELD_CHARS = 18_000

export type ManychatPushDmResult = {
  ok: boolean
  error?: string
  set_field_status?: string
  send_flow_status?: string
  /** true quando setCustomField ManyChat devolveu success */
  set_field_ok?: boolean
  /** true quando sendFlow devolveu success */
  send_flow_ok?: boolean
  /** true quando MANYCHAT_PUSH_SKIP_SEND_FLOW=true (só campo; dispara flow no ManyChat por automation) */
  skipped_send_flow?: boolean
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseEnvInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function describeManychatFailure(
  label: string,
  res: { ok: boolean; status: number; json: Record<string, unknown>; raw: string },
): string {
  const j = res.json
  const msg = typeof j.message === 'string' ? j.message.trim() : ''
  if (msg) return `${label}:${msg}`
  if (!res.ok) return `${label}:http_${res.status}`
  const st = String(j.status ?? '').trim()
  if (st && st.toLowerCase() !== 'success') return `${label}:status_${st}`
  return `${label}:unexpected_${res.raw.slice(0, 280)}`
}

async function pushManychatDmAfterReplyCore(input: {
  apiKey: string
  subscriberId: string
  replyText: string
  fieldId: number
  flowNs: string
  messageTag?: string
  setFieldErrorLabel: string
  sendFlowErrorLabel: string
}): Promise<ManychatPushDmResult> {
  const value = input.replyText.trim().slice(0, MAX_DM_FIELD_CHARS)
  if (!value) {
    return { ok: false, error: 'empty_reply_text', set_field_ok: false, send_flow_ok: false }
  }

  const sid = normalizeSubscriberId(input.subscriberId)

  const setBody: Record<string, unknown> = {
    subscriber_id: sid,
    field_id: input.fieldId,
    field_value: value,
  }

  const setRes = await manychatPost('/fb/subscriber/setCustomField', setBody, input.apiKey)
  if (!setRes.ok || !manychatSuccess(setRes.json)) {
    return {
      ok: false,
      error: describeManychatFailure(input.setFieldErrorLabel, setRes),
      set_field_status: String(setRes.json.status ?? ''),
      set_field_ok: false,
      send_flow_ok: false,
    }
  }

  const skipFlow =
    (Deno.env.get('MANYCHAT_PUSH_SKIP_SEND_FLOW') ?? '').trim().toLowerCase() === 'true'
  if (skipFlow) {
    return {
      ok: true,
      set_field_status: 'success',
      set_field_ok: true,
      send_flow_ok: false,
      skipped_send_flow: true,
    }
  }

  const delayMs = parseEnvInt(Deno.env.get('MANYCHAT_PUSH_BEFORE_FLOW_DELAY_MS'), 200, 0, 10_000)
  const maxAttempts = parseEnvInt(Deno.env.get('MANYCHAT_SEND_FLOW_MAX_ATTEMPTS'), 2, 1, 5)

  const flowBody: Record<string, unknown> = {
    subscriber_id: sid,
    flow_ns: input.flowNs.trim(),
  }
  if (input.messageTag?.trim()) {
    flowBody.message_tag = input.messageTag.trim()
  }

  if (delayMs > 0) await sleep(delayMs)

  let lastFlowErr = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const flowRes = await manychatPost('/fb/sending/sendFlow', flowBody, input.apiKey)
    if (flowRes.ok && manychatSuccess(flowRes.json)) {
      return {
        ok: true,
        set_field_status: 'success',
        send_flow_status: 'success',
        set_field_ok: true,
        send_flow_ok: true,
      }
    }
    lastFlowErr = describeManychatFailure(input.sendFlowErrorLabel, flowRes)
    if (attempt < maxAttempts) {
      const backoff = Math.min(2500, delayMs + 200 * attempt)
      if (backoff > 0) await sleep(backoff)
    }
  }

  const hint =
    /24|window|tag|messaging|policy|human_agent|HUMAN_AGENT/i.test(lastFlowErr)
      ? ' Sugestão Meta/ManyChat: defina o secret MANYCHAT_SEND_FLOW_MESSAGE_TAG=HUMAN_AGENT (ou o valor indicado pelo ManyChat) se estiver fora da janela de mensagens.'
      : ''

  return {
    ok: false,
    error: `${lastFlowErr}${hint}`,
    set_field_status: 'success',
    send_flow_status: 'failed',
    set_field_ok: true,
    send_flow_ok: false,
  }
}

/**
 * Grava o texto no custom field do subscriber e dispara o flow de entrega (Instagram).
 * Ordem: `setCustomField` → (opcional espera) → `sendFlow` (recomendação ManyChat).
 */
export async function pushManychatInstagramDmAfterReply(input: {
  apiKey: string
  subscriberId: string
  replyText: string
  fieldId: number
  flowNs: string
  /** Ex.: CONFIRMED_EVENT_UPDATE — só enviado se definido */
  messageTag?: string
}): Promise<ManychatPushDmResult> {
  return pushManychatDmAfterReplyCore({
    ...input,
    setFieldErrorLabel: 'manychat_set_custom_field',
    sendFlowErrorLabel: 'manychat_send_flow',
  })
}

/**
 * Grava o texto no custom field do subscriber e dispara o flow de entrega (WhatsApp).
 * Usa as rotas fb/ que o ManyChat utiliza globalmente para custom fields e flows.
 */
export async function pushManychatWhatsappDmAfterReply(input: {
  apiKey: string
  subscriberId: string
  replyText: string
  fieldId: number
  flowNs: string
  /** Ex.: CONFIRMED_EVENT_UPDATE — só enviado se definido */
  messageTag?: string
}): Promise<ManychatPushDmResult> {
  return pushManychatDmAfterReplyCore({
    ...input,
    setFieldErrorLabel: 'manychat_wa_set_custom_field',
    sendFlowErrorLabel: 'manychat_wa_send_flow',
  })
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

export function readManychatWaPushConfigFromEnv(): {
  apiKey: string
  fieldId: number
  flowNs: string
  messageTag: string
} | null {
  const apiKey = (Deno.env.get('MANYCHAT_API_KEY') ?? '').trim()
  if (!apiKey) return null

  const fieldIdRaw = (
    Deno.env.get('MANYCHAT_WA_DM_FIELD_ID') ??
    Deno.env.get('MANYCHAT_DM_FIELD_ID') ??
    '14539456'
  ).trim()
  const fieldId = Number.parseInt(fieldIdRaw, 10)
  if (!Number.isFinite(fieldId) || fieldId <= 0) {
    console.warn('manychatPublicApi: MANYCHAT_WA_DM_FIELD_ID / MANYCHAT_DM_FIELD_ID inválido')
    return null
  }

  const flowNs = (
    Deno.env.get('MANYCHAT_WA_DM_FLOW_NS') ??
    Deno.env.get('MANYCHAT_DM_FLOW_NS') ??
    'content20260430143025_638461'
  ).trim()
  if (!flowNs) {
    console.warn('manychatPublicApi: MANYCHAT_WA_DM_FLOW_NS / MANYCHAT_DM_FLOW_NS vazio')
    return null
  }

  const messageTag = (
    Deno.env.get('MANYCHAT_WA_SEND_FLOW_MESSAGE_TAG') ??
    Deno.env.get('MANYCHAT_SEND_FLOW_MESSAGE_TAG') ??
    ''
  ).trim()

  return {
    apiKey,
    fieldId,
    flowNs,
    messageTag,
  }
}

/** Config de push ManyChat (custom field + flow) conforme o canal do pedido. */
export function readManychatPushConfigForChannel(channelRaw: string): {
  apiKey: string
  fieldId: number
  flowNs: string
  messageTag: string
} | null {
  const c = channelRaw.trim().toLowerCase()
  const isWa = c === 'whatsapp' || c === 'wa'
  return isWa ? readManychatWaPushConfigFromEnv() : readManychatPushConfigFromEnv()
}

type SupabaseClientLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>
      }
    }
  }
}

type ManychatChannelConfig = {
  field_id?: number | string
  flow_ns?: string
  message_tag?: string
}

type ManychatTenantConfig = {
  api_key?: string
  instagram?: ManychatChannelConfig
  whatsapp?: ManychatChannelConfig
}

/**
 * Config ManyChat por tenant: lê de `tenant_integrations.manychat` primeiro,
 * caindo para os secrets globais (env) caso o tenant não tenha config própria.
 *
 * Permite que cada clínica use sua própria conta ManyChat sem reciclar secrets globais.
 * O Instituto Lorena continua funcionando porque seu tenant_integrations.manychat está vazio
 * e os env vars (MANYCHAT_API_KEY etc.) seguem como fallback.
 */
export async function readManychatPushConfigForTenantChannel(
  admin: SupabaseClientLike,
  tenantId: string,
  channelRaw: string,
): Promise<{
  apiKey: string
  fieldId: number
  flowNs: string
  messageTag: string
} | null> {
  const envConfig = readManychatPushConfigForChannel(channelRaw)
  if (!tenantId) return envConfig

  let tenantConfig: ManychatTenantConfig = {}
  try {
    const { data } = await admin
      .from('tenant_integrations')
      .select('manychat')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const raw = (data as { manychat?: unknown } | null)?.manychat
    if (raw && typeof raw === 'object') tenantConfig = raw as ManychatTenantConfig
  } catch {
    /* ignore — caímos para env */
  }

  const c = channelRaw.trim().toLowerCase()
  const isWa = c === 'whatsapp' || c === 'wa'
  const channelKey = isWa ? 'whatsapp' : 'instagram'
  const channelConfig: ManychatChannelConfig = tenantConfig[channelKey] ?? {}

  const apiKey = String(tenantConfig.api_key ?? envConfig?.apiKey ?? '').trim()
  if (!apiKey) return null

  const fieldIdRaw = channelConfig.field_id ?? envConfig?.fieldId
  const fieldIdNum = Number(fieldIdRaw)
  const fieldId = Number.isFinite(fieldIdNum) && fieldIdNum > 0 ? fieldIdNum : (envConfig?.fieldId ?? 14539456)

  const flowNs = String(channelConfig.flow_ns ?? envConfig?.flowNs ?? '').trim()
  if (!flowNs) return null

  const messageTag = String(channelConfig.message_tag ?? envConfig?.messageTag ?? '').trim()

  return { apiKey, fieldId, flowNs, messageTag }
}
