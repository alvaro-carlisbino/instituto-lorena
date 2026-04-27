import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { evolutionFetchMediaBase64FromWebhook } from './evolutionMediaDownload.ts'
import {
  base64ToUint8Array,
  getOpenAiApiKey,
  getOpenAiDocumentModel,
  getOpenAiVisionModel,
  openaiExtractDocument,
  openaiOcrImage,
  openaiTranscribeAudio,
} from './openaiMediaIntel.ts'

function trunc(s: string, max: number): string {
  const t = String(s ?? '')
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function buildIntelBlockFromRows(rows: Array<Record<string, unknown>>): string {
  const lines: string[] = []
  for (const r of rows) {
    const t = String(r.transcribed_text ?? '').trim()
    const x = String(r.extracted_text ?? '').trim()
    if (t) lines.push(`[Áudio — transcrição]\n${t}`)
    if (x) lines.push(`[Documento/imagem — texto extraído]\n${x}`)
  }
  return lines.filter(Boolean).join('\n\n')
}

type MediaRow = {
  id: string
  media_type: string
  mime_type: string | null
  transcribed_text: string | null
  extracted_text: string | null
}

/**
 * Descarrega mídia via Evolution, corre Whisper / visão / Responses (OpenAI) e grava em `crm_media_items`.
 * Devolve texto a acrescentar ao pedido do utilizador para a IA automática (webhook).
 */
export async function enrichInboundWhatsappMediaAndAppendContext(options: {
  admin: SupabaseClient
  providerName: string
  webhookRaw: Record<string, unknown>
  mediaRowIds: string[]
}): Promise<string> {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return ''

  if (options.providerName !== 'evolution') return ''
  if (options.mediaRowIds.length === 0) return ''

  const { data: rows, error } = await admin
    .from('crm_media_items')
    .select('id, media_type, mime_type, transcribed_text, extracted_text')
    .in('id', options.mediaRowIds)

  if (error || !rows?.length) return ''

  const typed = rows as MediaRow[]
  const anyFilled = typed.some((r) => String(r.transcribed_text ?? '').trim() || String(r.extracted_text ?? '').trim())
  if (anyFilled) {
    return buildIntelBlockFromRows(typed as unknown as Record<string, unknown>[])
  }

  if (typed.length > 1) {
    const note =
      '[Várias peças de mídia na mesma mensagem — nesta versão só é processada automaticamente uma mídia por mensagem.]'
    await admin.from('crm_media_items').update({ extracted_text: note }).in('id', options.mediaRowIds)
    return note
  }

  const row = typed[0]

  let payload: { base64: string; mimeType?: string } | null = null
  try {
    payload = await evolutionFetchMediaBase64FromWebhook(options.webhookRaw)
  } catch {
    payload = null
  }

  if (!payload?.base64) {
    await admin
      .from('crm_media_items')
      .update({
        extracted_text:
          '[Download da mídia indisponível na Evolution (mensagem não encontrada ou base64 vazio). Confirme DATABASE_SAVE_DATA_NEW_MESSAGE e persistência de mensagens.]',
      })
      .eq('id', row.id)
    return ''
  }

  const bytes = base64ToUint8Array(payload.base64)
  const maxBytes = 24 * 1024 * 1024
  const slice = bytes.length > maxBytes ? bytes.slice(0, maxBytes) : bytes

  const mime = row.mime_type || payload.mimeType || 'application/octet-stream'
  const mt = String(row.media_type).toLowerCase()

  let transcribed: string | null = null
  let extracted: string | null = null

  try {
    if (mt === 'audio') {
      const ext = mime.includes('ogg')
        ? 'ogg'
        : mime.includes('webm')
          ? 'webm'
          : mime.includes('mpeg') || mime.includes('mp3')
            ? 'mp3'
            : 'ogg'
      const text = await openaiTranscribeAudio({
        apiKey,
        bytes: slice,
        filename: `wa-audio.${ext}`,
        mimeType: mime,
      })
      transcribed = trunc(text, 12000)
    } else if (mt === 'image') {
      const imgMime = mime.startsWith('image/') ? mime : 'image/jpeg'
      extracted = await openaiOcrImage({
        apiKey,
        model: getOpenAiVisionModel(),
        base64: payload.base64,
        mimeType: imgMime,
      })
    } else if (mt === 'video') {
      extracted =
        '[Vídeo recebido; transcrição automática de vídeo não está ativa nesta versão. Solicite revisão humana se necessário.]'
    } else if (mt === 'document' || mt === 'other') {
      const isPdf = mime.includes('pdf') || mime === 'application/pdf'
      const isWord =
        mime.includes('wordprocessingml') ||
        mime.includes('msword') ||
        mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')

      if (isPdf || isWord) {
        const docMime = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        const fname = isPdf ? 'documento.pdf' : 'documento.docx'
        extracted = await openaiExtractDocument({
          apiKey,
          model: getOpenAiDocumentModel(),
          base64: payload.base64,
          mimeType: docMime,
          filename: fname,
        })
      } else if (mime.startsWith('image/')) {
        extracted = await openaiOcrImage({
          apiKey,
          model: getOpenAiVisionModel(),
          base64: payload.base64,
          mimeType: mime,
        })
      } else {
        extracted = await openaiExtractDocument({
          apiKey,
          model: getOpenAiDocumentModel(),
          base64: payload.base64,
          mimeType: mime || 'application/octet-stream',
          filename: 'anexo',
        })
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin
      .from('crm_media_items')
      .update({ extracted_text: trunc(`[Falha no processamento automático: ${msg}]`, 2000) })
      .eq('id', row.id)
    return ''
  }

  await admin
    .from('crm_media_items')
    .update({
      transcribed_text: transcribed,
      extracted_text: extracted,
    })
    .eq('id', row.id)

  const { data: refreshed } = await admin
    .from('crm_media_items')
    .select('id, media_type, transcribed_text, extracted_text')
    .eq('id', row.id)
    .maybeSingle()

  return buildIntelBlockFromRows(refreshed ? [refreshed as Record<string, unknown>] : [])
}
