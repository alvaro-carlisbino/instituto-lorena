import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  getOpenAiApiKey,
  getOpenAiDocumentModel,
  openaiExtractDocument,
} from './openaiMediaIntel.ts'
import { ocrImage, visionConfigured } from './visionOcr.ts'
import { zaiAsrConfigured, zaiTranscribeAudio } from './zaiAudioAsr.ts'

/**
 * Enriquecimento de mídia para canais que entregam a mídia como URL (ManyChat,
 * W-API), e não como base64 inline (Evolution).
 *
 * O que faz, por linha de `crm_media_items` recém-inserida:
 *   1. Baixa os bytes da URL (`storage_path`) — SÓ de hosts de mídia conhecidos do
 *      ecossistema Meta/ManyChat. Links externos arbitrários do paciente (ex.:
 *      share.google, portais de exame) NÃO são baixados: continuam como link.
 *   2. Grava os bytes em `media_base64` (+ `mime_type`). Assim o chat renderiza a
 *      mídia inline e ela nunca expira — ao contrário da URL assinada da Meta, que
 *      "abre uma vez e depois dá 403". base64 fica protegido por RLS (dado médico).
 *   3. Roda transcrição (áudio) / OCR (imagem) / extração (documento) e grava em
 *      `transcribed_text` / `extracted_text`.
 *
 * É best-effort e idempotente: nunca lança para fora (o webhook não pode quebrar a
 * ingestão por causa de mídia), e pula linhas que já têm base64.
 */

// Hosts conhecidos de mídia do ecossistema Meta/ManyChat. Mesma lista de
// manychatMedia.ts — só baixamos destes (evita SSRF e baixar páginas de login).
const KNOWN_MEDIA_HOST_RX =
  /(?:manybot-files\.s3|manychatcdn\.com|mcdn\.manychat\.com|files\.manychat\.com|media\.manychat\.com|lookaside\.fbsbx\.com|mmg\.whatsapp\.net|\.cdninstagram\.com|\.fbcdn\.net|cdn\.fbsbx\.com|\.s3-accelerate\.amazonaws\.com|\.s3\.amazonaws\.com)/i

// Extensão de mídia conhecida no path da URL (sinal alternativo ao host).
const MEDIA_EXT_RX =
  /\.(jpe?g|png|gif|webp|bmp|heic|heif|mp3|ogg|opus|wav|m4a|aac|amr|mp4|mov|webm|mkv|avi|m4v|3gp|pdf|docx?|xlsx?|pptx?|csv|txt)(\?|#|$)/i

const MAX_DOWNLOAD_BYTES = 24 * 1024 * 1024

function isDownloadableMediaUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  if (KNOWN_MEDIA_HOST_RX.test(url)) return true
  if (MEDIA_EXT_RX.test(url)) return true
  return false
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

type DownloadedMedia = { base64: string; mimeType: string }

async function downloadKnownMedia(url: string): Promise<DownloadedMedia | null> {
  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch {
    return null
  }
  if (!res.ok) return null
  const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  // Se o host respondeu HTML/texto, é página (login, erro, redirect) e não um
  // arquivo — não adianta guardar. Só seguimos com content-type de mídia real.
  const isMediaCt =
    /^(image|audio|video)\//.test(ct) ||
    ct === 'application/pdf' ||
    ct.startsWith('application/vnd') ||
    ct === 'application/msword' ||
    ct === 'application/octet-stream' ||
    ct === ''
  if (!isMediaCt) return null
  let buf: Uint8Array
  try {
    buf = new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
  if (buf.length === 0 || buf.length > MAX_DOWNLOAD_BYTES) return null
  return { base64: uint8ToBase64(buf), mimeType: ct || 'application/octet-stream' }
}

type MediaRow = {
  id: string
  media_type: string | null
  mime_type: string | null
  storage_path: string | null
  media_base64: string | null
  transcribed_text: string | null
  extracted_text: string | null
}

function trunc(s: string, max: number): string {
  const t = String(s ?? '')
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

async function runMediaIntel(
  apiKey: string | null,
  mediaType: string,
  mime: string,
  base64: string,
): Promise<{ transcribed: string | null; extracted: string | null }> {
  const mt = mediaType.toLowerCase()
  if (mt === 'audio') {
    // Transcrição 100% via z.ai glm-asr (ogg/opus do WhatsApp é decodificado e
    // cortado em blocos <=25s). Sem dependência de OpenAI.
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const text = await zaiTranscribeAudio(bytes, mime, { maxChars: 12000 })
    return { transcribed: text || null, extracted: null }
  }
  if (mt === 'image') {
    const text = await ocrImage({ base64, mimeType: mime }) // Z.ai/GLM-4V (fallback OpenAI)
    return { transcribed: null, extracted: trunc(text, 8000) || null }
  }
  if (mt === 'document' || mt === 'other') {
    const isPdf = mime.includes('pdf')
    const isWord = mime.includes('wordprocessingml') || mime.includes('msword')
    if (mime.startsWith('image/')) {
      const text = await ocrImage({ base64, mimeType: mime })
      return { transcribed: null, extracted: trunc(text, 8000) || null }
    }
    if (!apiKey) return { transcribed: null, extracted: null } // PDF/doc depende de OpenAI Responses
    const docMime = isPdf
      ? 'application/pdf'
      : isWord
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : mime || 'application/octet-stream'
    const fname = isPdf ? 'documento.pdf' : isWord ? 'documento.docx' : 'anexo'
    const text = await openaiExtractDocument({ apiKey, model: getOpenAiDocumentModel(), base64, mimeType: docMime, filename: fname })
    return { transcribed: null, extracted: trunc(text, 12000) || null }
  }
  return { transcribed: null, extracted: null }
}

/**
 * Baixa + arquiva + transcreve as linhas de mídia indicadas. Devolve um bloco de
 * texto com a inteligência extraída (transcrição/OCR) para anexar ao contexto da IA.
 * Nunca lança: erros viram nota em `extracted_text` e seguem.
 */
export async function enrichManychatMediaRows(
  admin: SupabaseClient,
  options: { rowIds: string[] },
): Promise<string> {
  if (options.rowIds.length === 0) return ''

  const { data, error } = await admin
    .from('crm_media_items')
    .select('id, media_type, mime_type, storage_path, media_base64, transcribed_text, extracted_text')
    .in('id', options.rowIds)
  if (error || !data?.length) return ''

  const apiKey = getOpenAiApiKey()
  const intelLines: string[] = []

  for (const row of data as MediaRow[]) {
    // Idempotente: já arquivado anteriormente.
    if (row.media_base64 && row.media_base64.trim()) {
      const t = String(row.transcribed_text ?? '').trim()
      const x = String(row.extracted_text ?? '').trim()
      if (t) intelLines.push(`[Áudio — transcrição]\n${t}`)
      if (x) intelLines.push(`[Documento/imagem — texto extraído]\n${x}`)
      continue
    }

    const url = String(row.storage_path ?? '').trim()
    if (!isDownloadableMediaUrl(url)) continue

    const dl = await downloadKnownMedia(url)
    if (!dl) continue

    const mime = row.mime_type || dl.mimeType || 'application/octet-stream'

    // 1) Arquiva os bytes (sempre que baixou) — garante render durável no chat.
    await admin
      .from('crm_media_items')
      .update({ media_base64: dl.base64, mime_type: mime })
      .eq('id', row.id)

    // 2) Inteligência (best-effort). Imagem usa ZAI (vision); áudio usa ZAI (glm-asr);
    //    PDF/doc usa OpenAI (se configurado).
    if (!apiKey && !visionConfigured() && !zaiAsrConfigured()) continue
    try {
      const { transcribed, extracted } = await runMediaIntel(apiKey, String(row.media_type ?? 'other'), mime, dl.base64)
      if (transcribed || extracted) {
        await admin
          .from('crm_media_items')
          .update({ transcribed_text: transcribed, extracted_text: extracted })
          .eq('id', row.id)
      }
      if (transcribed) intelLines.push(`[Áudio — transcrição]\n${transcribed}`)
      if (extracted) intelLines.push(`[Documento/imagem — texto extraído]\n${extracted}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await admin
        .from('crm_media_items')
        .update({ extracted_text: trunc(`[Falha no processamento automático: ${msg}]`, 2000) })
        .eq('id', row.id)
    }
  }

  return intelLines.filter(Boolean).join('\n\n')
}
