function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

export type EvolutionMediaPayload = {
  base64: string
  mimeType?: string
}

/**
 * Obtém o ficheiro em Base64 via Evolution API v2 (requer mensagem persistida na instância).
 * @see https://doc.evolution-api.com/v2/api-reference/chat-controller/get-base64
 */
export async function evolutionFetchMediaBase64FromWebhook(
  rawPayload: Record<string, unknown>,
): Promise<EvolutionMediaPayload | null> {
  const baseUrl = (Deno.env.get('EVOLUTION_API_BASE') ?? '').trim().replace(/\/$/, '')
  const apiKey = (Deno.env.get('EVOLUTION_API_KEY') ?? '').trim()
  const instance = (Deno.env.get('EVOLUTION_INSTANCE') ?? '').trim()
  if (!baseUrl || !apiKey || !instance) return null

  const messageId = safeString(getByPath(rawPayload, 'data.key.id'))
  const remoteJid = safeString(getByPath(rawPayload, 'data.key.remoteJid'))
  if (!messageId || !remoteJid) return null
  const fromMe = Boolean(getByPath(rawPayload, 'data.key.fromMe'))

  const url = `${baseUrl}/chat/getBase64FromMediaMessage/${instance}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify({
      message: { key: { id: messageId, remoteJid, fromMe } },
      convertToMp4: false,
    }),
  })

  const rawText = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {}
  } catch {
    return null
  }

  const pickBase64 = (o: Record<string, unknown>): string | null => {
    const b = o.base64
    if (typeof b === 'string' && b.length > 20) return b
    const data = o.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const inner = (data as Record<string, unknown>).base64
      if (typeof inner === 'string' && inner.length > 20) return inner
    }
    const response = o.response
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      const inner = (response as Record<string, unknown>).base64
      if (typeof inner === 'string' && inner.length > 20) return inner
    }
    return null
  }

  const base64 = pickBase64(parsed)
  if (!base64) return null

  const mimeType =
    safeString(parsed.mimetype) ||
    safeString(parsed.mimeType) ||
    safeString(
      parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>).mimetype
        : '',
    ) ||
    undefined

  return { base64, mimeType: mimeType || undefined }
}
