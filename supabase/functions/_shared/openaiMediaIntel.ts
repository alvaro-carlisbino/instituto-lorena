const OPENAI_BASE = 'https://api.openai.com/v1'

function trunc(s: string, max: number): string {
  const t = String(s ?? '')
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function collectOutputText(node: unknown, out: string[]): void {
  if (node == null) return
  if (typeof node === 'string') {
    if (node.trim()) out.push(node.trim())
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectOutputText(item, out)
    return
  }
  if (typeof node !== 'object') return
  const o = node as Record<string, unknown>
  if (o.type === 'message' && o.content !== undefined) {
    collectOutputText(o.content, out)
    return
  }
  if (typeof o.text === 'string' && (o.type === 'output_text' || o.type === 'input_text' || !o.type)) {
    if (o.text.trim()) out.push(o.text.trim())
  }
  for (const k of ['output', 'content', 'message', 'choices', 'delta']) {
    if (o[k] !== undefined) collectOutputText(o[k], out)
  }
}

function parseResponsesOutputText(parsed: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof parsed.output_text === 'string' && parsed.output_text.trim()) {
    return parsed.output_text.trim()
  }
  collectOutputText(parsed.output, parts)
  if (parts.length) return parts.join('\n').trim()
  collectOutputText(parsed, parts)
  return parts.join('\n').trim()
}

function parseChatCompletionText(parsed: Record<string, unknown>): string {
  const choices = parsed.choices
  if (!Array.isArray(choices) || !choices.length) return ''
  const msg = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined
  const c = msg?.content
  if (typeof c === 'string') return c.trim()
  if (Array.isArray(c)) {
    const texts: string[] = []
    for (const block of c) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (typeof b.text === 'string') texts.push(b.text)
    }
    return texts.join('\n').trim()
  }
  return ''
}

export async function openaiTranscribeAudio(params: {
  apiKey: string
  bytes: Uint8Array
  filename: string
  mimeType?: string
}): Promise<string> {
  const blob = new Blob([params.bytes], { type: params.mimeType || 'application/octet-stream' })
  const form = new FormData()
  form.append('file', blob, params.filename)
  form.append('model', 'whisper-1')
  form.append('language', 'pt')

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.apiKey}` },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`whisper_${res.status}:${trunc(text, 400)}`)
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new Error(`whisper_bad_json:${trunc(text, 200)}`)
  }
  const t = typeof parsed.text === 'string' ? parsed.text.trim() : ''
  return t
}

export async function openaiOcrImage(params: {
  apiKey: string
  model: string
  base64: string
  mimeType: string
}): Promise<string> {
  const mime = params.mimeType.startsWith('image/') ? params.mimeType : 'image/jpeg'
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 2000,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Extraia o texto legível (OCR) desta imagem ou captura de ecrã. Se não houver texto relevante, descreva numa frase o que vê, em português. Saída só em texto corrido, sem markdown.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${params.base64}` },
            },
          ],
        },
      ],
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`vision_${res.status}:${trunc(text, 400)}`)
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new Error(`vision_bad_json:${trunc(text, 200)}`)
  }
  return trunc(parseChatCompletionText(parsed), 8000)
}

export async function openaiExtractDocument(params: {
  apiKey: string
  model: string
  base64: string
  mimeType: string
  filename: string
}): Promise<string> {
  const dataUrl = `data:${params.mimeType};base64,${params.base64}`
  const res = await fetch(`${OPENAI_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Extraia o texto principal e um resumo muito curto (2–4 frases) em português, focado em informação útil para atendimento comercial ou clínico (datas, valores, pedidos, queixas). Se for só metadados, diga-o.',
            },
            {
              type: 'input_file',
              filename: params.filename || 'documento',
              file_data: dataUrl,
            },
          ],
        },
      ],
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`responses_${res.status}:${trunc(text, 400)}`)
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new Error(`responses_bad_json:${trunc(text, 200)}`)
  }
  return trunc(parseResponsesOutputText(parsed), 12000)
}

export function getOpenAiApiKey(): string | null {
  const k = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  return k.length > 0 ? k : null
}

export function getOpenAiVisionModel(): string {
  return (Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini'
}

export function getOpenAiDocumentModel(): string {
  return (Deno.env.get('OPENAI_DOCUMENT_MODEL') ?? 'gpt-4o').trim() || 'gpt-4o'
}

export { base64ToUint8Array }
