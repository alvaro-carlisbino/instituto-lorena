/**
 * Transcrição de áudio 100% via z.ai (glm-asr) — sem OpenAI, sem serviço externo.
 *
 * O glm-asr só aceita .wav/.mp3 e <=30s. O WhatsApp entrega ogg/opus, normalmente
 * com mais de 30s. Então, para ogg/opus:
 *   1. demux do container Ogg (JS puro) -> pacotes Opus
 *   2. decode Opus -> PCM16 (WASM @evan/wasm/target/opus/deno.js — roda na Edge,
 *      sem web-worker/node:vm, ao contrário de ogg-opus-decoder/opusscript)
 *   3. corta o PCM em blocos <=25s, embrulha cada um em WAV e manda ao glm-asr
 *   4. concatena as transcrições
 *
 * Para áudio que já seja wav/mp3 (<=30s), manda direto. É best-effort: qualquer
 * falha devolve '' (o chamador trata).
 */

const SAMPLE_RATE = 48000 // o decode Opus do @evan sai sempre a 48 kHz mono
const CHUNK_SECONDS = 25 // margem sob o limite de 30s do glm-asr
const BYTES_PER_SECOND = SAMPLE_RATE * 2 // PCM16 mono

function asrModel(): string {
  return (Deno.env.get('ZAI_ASR_MODEL') ?? '').trim() || 'glm-asr-2512'
}

function asrConfig(): { key: string; url: string } | null {
  const key = (Deno.env.get('ZAI_API_KEY') ?? '').trim()
  if (!key) return null
  const raw = (Deno.env.get('ZAI_API_BASE') ?? '').trim().replace(/\/$/, '')
  const root = !raw || raw.includes('/coding/') ? 'https://api.z.ai/api/paas/v4' : raw
  return { key, url: `${root}/audio/transcriptions` }
}

export function zaiAsrConfigured(): boolean {
  return asrConfig() !== null
}

function trunc(s: string, max: number): string {
  const t = String(s ?? '')
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

/** Extrai pacotes Opus de um container Ogg (reconstrói pacotes que cruzam páginas). */
function* oggPackets(data: Uint8Array): Generator<Uint8Array> {
  let i = 0
  let partial: Uint8Array[] = []
  while (i + 27 <= data.length) {
    // capture pattern "OggS"
    if (data[i] !== 0x4f || data[i + 1] !== 0x67 || data[i + 2] !== 0x67 || data[i + 3] !== 0x53) {
      i++
      continue
    }
    const pageSegments = data[i + 26]
    const segTable = data.subarray(i + 27, i + 27 + pageSegments)
    let off = i + 27 + pageSegments
    for (let s = 0; s < pageSegments; s++) {
      const lace = segTable[s]
      partial.push(data.subarray(off, off + lace))
      off += lace
      if (lace < 255) {
        let total = 0
        for (const a of partial) total += a.length
        const pkt = new Uint8Array(total)
        let p = 0
        for (const a of partial) {
          pkt.set(a, p)
          p += a.length
        }
        partial = []
        if (pkt.length > 0) yield pkt
      }
    }
    i = off
  }
}

function wavFromPcm16(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const dataLen = pcmBytes.length
  const out = new Uint8Array(44 + dataLen)
  const dv = new DataView(out.buffer)
  let p = 0
  const wstr = (s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i))
  }
  wstr('RIFF'); dv.setUint32(p, 36 + dataLen, true); p += 4
  wstr('WAVE'); wstr('fmt '); dv.setUint32(p, 16, true); p += 4
  dv.setUint16(p, 1, true); p += 2 // PCM
  dv.setUint16(p, 1, true); p += 2 // mono
  dv.setUint32(p, sampleRate, true); p += 4
  dv.setUint32(p, sampleRate * 2, true); p += 4 // byte rate
  dv.setUint16(p, 2, true); p += 2 // block align
  dv.setUint16(p, 16, true); p += 2 // bits
  wstr('data'); dv.setUint32(p, dataLen, true); p += 4
  out.set(pcmBytes, 44)
  return out
}

async function decodeOggOpusToPcm16(ogg: Uint8Array): Promise<Uint8Array> {
  // WASM target específico do Deno: WASM inline, sem web-worker (bundla e roda na Edge).
  const mod = await import('npm:@evan/wasm@0.0.95/target/opus/deno.js')
  // deno-lint-ignore no-explicit-any
  const decoder = new ((mod as any).Decoder)({ channels: 1, sample_rate: SAMPLE_RATE })
  const parts: Uint8Array[] = []
  let len = 0
  try {
    for (const pkt of oggPackets(ogg)) {
      if (pkt.length >= 8) {
        const h = String.fromCharCode(pkt[0], pkt[1], pkt[2], pkt[3], pkt[4], pkt[5], pkt[6], pkt[7])
        if (h === 'OpusHead' || h === 'OpusTags') continue // pacotes de cabeçalho
      }
      try {
        const pcm = decoder.decode(pkt) as Uint8Array // PCM16 LE (bytes)
        parts.push(pcm)
        len += pcm.length
      } catch {
        // pacote inválido — ignora
      }
    }
  } finally {
    // deno-lint-ignore no-explicit-any
    try { (decoder as any).free?.() } catch { /* ignore */ }
  }
  const out = new Uint8Array(len)
  let p = 0
  for (const a of parts) {
    out.set(a, p)
    p += a.length
  }
  return out
}

async function postToGlmAsr(
  file: Uint8Array,
  filename: string,
  contentType: string,
  cfg: { key: string; url: string },
  language?: string,
): Promise<string> {
  const form = new FormData()
  form.append('model', asrModel())
  form.append('stream', 'false')
  if (language) form.append('language', language)
  form.append('file', new Blob([file], { type: contentType }), filename)
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}` },
    body: form,
  })
  if (!res.ok) return '' // formato não suportado / >30s etc. — best-effort
  const body = await res.text().catch(() => '')
  try {
    return String((JSON.parse(body) as { text?: string }).text ?? '').trim()
  } catch {
    return ''
  }
}

/** ogg/opus -> texto (decode + chunk <=25s + glm-asr por bloco). */
async function transcribeOggOpus(ogg: Uint8Array, cfg: { key: string; url: string }, language?: string): Promise<string> {
  const pcm = await decodeOggOpusToPcm16(ogg)
  if (pcm.length === 0) return ''
  const bytesPerChunk = CHUNK_SECONDS * BYTES_PER_SECOND
  const texts: string[] = []
  for (let off = 0; off < pcm.length; off += bytesPerChunk) {
    let end = Math.min(off + bytesPerChunk, pcm.length)
    if (end % 2 !== 0) end -= 1 // mantém alinhamento de amostra de 16 bits
    const slice = pcm.subarray(off, end)
    const wav = wavFromPcm16(slice, SAMPLE_RATE)
    texts.push(await postToGlmAsr(wav, 'audio.wav', 'audio/wav', cfg, language))
  }
  return texts.filter(Boolean).join(' ').trim()
}

/**
 * Transcreve áudio via z.ai glm-asr. ogg/opus é decodificado+chunkado; wav/mp3 vão
 * direto. Outros formatos (m4a/aac/amr) são tentados direto (provável falha → '').
 * Devolve '' se o z.ai não estiver configurado ou em qualquer falha (best-effort).
 */
export async function zaiTranscribeAudio(
  bytes: Uint8Array,
  mimeType: string,
  opts?: { language?: string; maxChars?: number },
): Promise<string> {
  const cfg = asrConfig()
  if (!cfg) return ''
  const mime = (mimeType ?? '').toLowerCase()
  const language = opts?.language ?? 'pt'
  let text = ''
  try {
    if (mime.includes('ogg') || mime.includes('opus')) {
      text = await transcribeOggOpus(bytes, cfg, language)
    } else if (mime.includes('mpeg') || mime.includes('mp3')) {
      text = await postToGlmAsr(bytes, 'audio.mp3', 'audio/mpeg', cfg, language)
    } else if (mime.includes('wav')) {
      text = await postToGlmAsr(bytes, 'audio.wav', 'audio/wav', cfg, language)
    } else {
      // m4a/aac/amr/etc.: tenta direto (glm-asr só aceita wav/mp3, costuma falhar → '')
      text = await postToGlmAsr(bytes, 'audio', mimeType || 'application/octet-stream', cfg, language)
    }
  } catch {
    return ''
  }
  return trunc(text, opts?.maxChars ?? 12000)
}
