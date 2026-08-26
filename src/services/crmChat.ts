import { supabase } from '@/lib/supabaseClient'
import { prepararAudioParaWhatsApp } from '@/lib/audioOpus'
import { kindFromMime, nomeSeguroDeArquivo } from '@/lib/chatMedia'

export { kindFromMime } from '@/lib/chatMedia'

/**
 * O que o chat sabe fazer numa mensagem depois de ela existir: reagir, apagar, editar,
 * marcar lida — e o que ele precisa para MANDAR mídia: subir o ficheiro e devolver o
 * caminho no bucket.
 *
 * Por que o ficheiro sobe primeiro para o Storage, em vez de ir em base64 dentro do envio:
 * base64 engorda 33%, e um vídeo de 12 MB vira 16 MB de string dentro de um JSON que ainda
 * tem de caber na memória da Edge Function. Subindo primeiro, o que viaja é um caminho de
 * 60 caracteres, e a W-API vai buscar o ficheiro direto pelo link assinado.
 */

const BUCKET = 'crm-lead-attachments'

export type UploadedChatMedia = {
  storagePath: string
  fileName: string
  mimeType: string
  kind: 'image' | 'video' | 'audio' | 'document'
  /** Pré-visualização local (blob URL) enquanto a mensagem ainda não saiu. */
  previewUrl: string
  sizeBytes: number
}

/** Tetos do WhatsApp. Bater neles do lado de cá evita um erro cru da API lá na frente. */
const LIMITES: Record<UploadedChatMedia['kind'], number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 50 * 1024 * 1024,
}


export async function uploadChatMedia(leadId: string, file: File): Promise<UploadedChatMedia> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const kind = kindFromMime(file.type, file.name)
  const teto = LIMITES[kind]
  if (file.size > teto) {
    throw new Error(
      `O WhatsApp não aceita ${kind === 'document' ? 'documento' : kind === 'image' ? 'imagem' : kind} acima de ${Math.round(teto / 1024 / 1024)} MB (este tem ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
    )
  }
  // O que SOBE tem de ser o formato do WhatsApp (.ogg/opus): a W-API recusa .webm na porta
  // ("A URL do áudio deve ser nos formatos .mp3 ou .ogg") e o áudio nunca chega. A
  // pré-visualização continua no ficheiro ORIGINAL, que é o que este browser sabe tocar.
  const paraSubir = kind === 'audio' ? await prepararAudioParaWhatsApp(file) : file
  const path = `whatsapp/${leadId}/${crypto.randomUUID()}-${nomeSeguroDeArquivo(paraSubir.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, paraSubir, {
    contentType: paraSubir.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error(`Falha ao subir "${file.name}": ${error.message}`)
  return {
    storagePath: path,
    fileName: paraSubir.name,
    mimeType: paraSubir.type || 'application/octet-stream',
    kind,
    previewUrl: URL.createObjectURL(file),
    sizeBytes: paraSubir.size,
  }
}

/** Remove um ficheiro que foi subido e o operador desistiu de enviar. */
export async function discardChatMedia(storagePath: string): Promise<void> {
  if (!supabase || !storagePath) return
  await supabase.storage.from(BUCKET).remove([storagePath])
}

/**
 * Link assinado para VER a mídia na bolha. O bucket é privado: sem assinar, a imagem
 * aparece quebrada. Guardamos em cache no módulo porque a mesma bolha é re-renderizada
 * muitas vezes enquanto a conversa rola, e cada assinatura é um round-trip.
 */
const cacheDeLinks = new Map<string, { url: string; expiraEm: number }>()

export async function signedMediaUrl(storagePath: string): Promise<string | null> {
  if (!supabase || !storagePath) return null
  const cache = cacheDeLinks.get(storagePath)
  if (cache && cache.expiraEm > Date.now()) return cache.url
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600)
  if (error || !data?.signedUrl) return null
  // Expira o cache 5 min antes do link, para nunca devolver um link já morto.
  cacheDeLinks.set(storagePath, { url: data.signedUrl, expiraEm: Date.now() + 55 * 60_000 })
  return data.signedUrl
}

// ── Ações sobre mensagens ────────────────────────────────────────────────────

export type MessageActionResult = { ok: true } | { ok: false; error: string; kind?: string }

async function chamarAcao(payload: Record<string, unknown>): Promise<MessageActionResult> {
  if (!supabase) return { ok: false, error: 'Sistema não configurado.' }
  const { data, error } = await supabase.functions.invoke('crm-message-action', { body: payload })
  if (error) {
    // Erro não-2xx traz o corpo dentro de `error.context`; sem ler, perde-se o motivo real
    // ("fora da janela de 15 minutos" vira "500 Internal Server Error").
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const corpo = (await ctx.clone().json()) as Record<string, unknown>
        return {
          ok: false,
          error: String(corpo.message ?? corpo.error ?? error.message),
          kind: typeof corpo.error === 'string' ? corpo.error : undefined,
        }
      } catch {
        /* cai no genérico */
      }
    }
    return { ok: false, error: error.message || 'Falha na ação.' }
  }
  const parsed = (data ?? {}) as Record<string, unknown>
  if (parsed.ok === true) return { ok: true }
  return {
    ok: false,
    error: String(parsed.message ?? parsed.error ?? 'Falha na ação.'),
    kind: typeof parsed.error === 'string' ? parsed.error : undefined,
  }
}

export function reactToMessage(interactionId: string, emoji: string): Promise<MessageActionResult> {
  return chamarAcao({ action: 'react', interactionId, emoji })
}

export function removeMessageReaction(interactionId: string): Promise<MessageActionResult> {
  return chamarAcao({ action: 'unreact', interactionId })
}

/**
 * `everyone` apaga NO WHATSAPP (some do telemóvel da pessoa); `crm` só some da nossa tela.
 * São ações diferentes e a tela tem de deixar isso claro — o botão único "Apagar" fazia
 * sempre a segunda, e a equipe achava que tinha desfeito o envio.
 */
export function deleteMessage(
  interactionId: string,
  scope: 'crm' | 'everyone',
): Promise<MessageActionResult> {
  return chamarAcao({ action: 'delete', interactionId, scope })
}

export function editSentMessage(interactionId: string, text: string): Promise<MessageActionResult> {
  return chamarAcao({ action: 'edit', interactionId, text })
}

export function markMessageRead(interactionId: string): Promise<MessageActionResult> {
  return chamarAcao({ action: 'read', interactionId })
}

// ── Reações guardadas ────────────────────────────────────────────────────────

export type ReactionRow = {
  interactionId: string | null
  externalMessageId: string
  emoji: string
  direction: 'in' | 'out'
  author: string
}

/**
 * As reações da conversa aberta. Ficam fora das consultas de interações de propósito: são
 * poucas linhas, mudam sozinhas (a pessoa troca o emoji) e carregá-las junto do boot faria
 * a tela inteira depender delas.
 */
export async function loadReactionsForLead(leadId: string): Promise<ReactionRow[]> {
  if (!supabase || !leadId) return []
  const { data, error } = await supabase
    .from('crm_message_reactions')
    .select('interaction_id, external_message_id, emoji, direction, author')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return (data as Array<Record<string, unknown>>).map((row) => ({
    interactionId: row.interaction_id ? String(row.interaction_id) : null,
    externalMessageId: String(row.external_message_id ?? ''),
    emoji: String(row.emoji ?? ''),
    direction: row.direction === 'in' ? 'in' : 'out',
    author: String(row.author ?? ''),
  }))
}
