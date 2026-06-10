/**
 * OCR / leitura de imagem provider-aware. Usa Z.ai (GLM-4V) por padrão — que é o
 * LLM do projeto — com fallback OpenAI. Compatível com a API chat/completions
 * (image_url com data URI). Substitui a chamada OpenAI-hardcoded p/ imagens.
 */

function normalizeApiRoot(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/$/, '')
  if (!trimmed || trimmed.includes('/coding/')) return 'https://api.z.ai/api/paas/v4'
  return trimmed
}

function visionConfig(): { apiKey: string; url: string; model: string } | null {
  const zaiKey = (Deno.env.get('ZAI_API_KEY') ?? '').trim()
  if (zaiKey) {
    const root = normalizeApiRoot(Deno.env.get('ZAI_API_BASE') ?? '')
    const model = (Deno.env.get('ZAI_VISION_MODEL') ?? '').trim() || 'glm-4.5v'
    return { apiKey: zaiKey, url: `${root}/chat/completions`, model }
  }
  const oaKey = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (oaKey) {
    const model = (Deno.env.get('OPENAI_VISION_MODEL') ?? '').trim() || 'gpt-4o-mini'
    return { apiKey: oaKey, url: 'https://api.openai.com/v1/chat/completions', model }
  }
  return null
}

function trunc(s: string, max: number): string {
  const t = String(s ?? '')
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

function parseChatContent(parsed: Record<string, unknown>): string {
  const choices = parsed.choices
  if (!Array.isArray(choices) || !choices.length) return ''
  const msg = (choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined
  const c = msg?.content
  if (typeof c === 'string') return c.trim()
  if (Array.isArray(c)) {
    return c
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .join('\n')
      .trim()
  }
  return ''
}

export function visionConfigured(): boolean {
  return visionConfig() !== null
}

/** OCR/descrição de imagem. Devolve texto (ou '' se não houver provider/erro). */
export async function ocrImage(params: { base64: string; mimeType?: string }): Promise<string> {
  const cfg = visionConfig()
  if (!cfg) return ''
  const mime = (params.mimeType ?? '').startsWith('image/') ? (params.mimeType as string) : 'image/jpeg'
  let res: Response
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extraia o texto legível (OCR) desta imagem. Se não houver texto, descreva em uma frase o que vê, em português. Saída só em texto corrido, sem markdown.',
              },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${params.base64}` } },
            ],
          },
        ],
      }),
    })
  } catch {
    return ''
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`vision_${res.status}:${trunc(t, 300)}`)
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return data ? trunc(parseChatContent(data), 8000) : ''
}
