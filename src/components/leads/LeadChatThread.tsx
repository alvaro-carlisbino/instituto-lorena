import { Fragment, useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, isSameDay } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatDaySeparator } from '@/lib/chatDates'
import {
  CalendarPlus,
  Video as VideoIcon,
  Music as MusicIcon,
  File as FileIcon,
  Image as ImageIcon,
  RefreshCw,
  MoreVertical,
  Pencil,
  Trash2,
  Smile,
  Sticker,
  CreditCard,
  CheckCircle2,
  Truck,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScheduleAppointmentDialog } from '@/components/leads/ScheduleAppointmentDialog'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { PAGBANK_KIT_LABELS, type PagbankKit } from '@/services/crmPagbank'
import { generateAsaasCardLink } from '@/services/crmAsaas'
import {
  isWaInstagramMergeNotice,
  tryConsumeWaInstagramMergeToast,
} from '@/lib/waInstagramMergeNotice'
import { isAiReplyLikelyPending, type AiConversationGate } from '@/lib/aiTypingIndicator'
import { getChannelShortLabel, getChannelStyle } from '@/lib/channelStyles'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'
import type { Interaction } from '@/mocks/crmMock'
import { forceAiReply, type ConversationOwnerMode } from '@/services/conversationControl'

/** Emojis frequentes para inserir no rascunho (UTF-8). */
// Valor cheio do cartão por kit Tricopill (mesma tabela do PaymentLinksPage). Gera link Asaas /pagar.
const ASAAS_KIT_AMOUNTS: Record<PagbankKit, number> = { '1_mes': 19900, '3_meses': 59700, '5_meses': 99900 }

const CHAT_QUICK_EMOJIS = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😅',
  '😂',
  '🤣',
  '😊',
  '🙂',
  '😉',
  '😍',
  '🥰',
  '😘',
  '😇',
  '🤔',
  '😮',
  '😢',
  '😭',
  '🙏',
  '👍',
  '👎',
  '👏',
  '🙌',
  '💪',
  '❤️',
  '💙',
  '✨',
  '🔥',
  '⭐',
  '✅',
  '❌',
  '⚠️',
  '📅',
  '⏰',
  '💬',
  '📞',
  '🏥',
  '💊',
  '🦷',
  '✍️',
]

type ChatFilter = 'all' | 'whatsapp' | 'meta'

type Props = {
  leadId: string
  history: Interaction[]
  whatsappOnly?: boolean
  canCompose?: boolean
  readOnlyInstagramHint?: boolean
  /** Modo + IA activa + horário (Supabase). Sem isto o indicador de “IA a responder” não aparece. */
  aiConversationBase?: {
    ownerMode: ConversationOwnerMode
    aiEnabled: boolean
    businessHoursStartHour: number
    businessHoursEndHour: number
  } | null
}

// --- Mídia inline (áudio/vídeo) ---------------------------------------------
// Converte o base64 inline (WhatsApp/W-API) num Blob URL em vez de data: URI.
// Motivo: o Chrome NÃO toca <audio>/<video> Opus de nota de voz (PTT, sem
// metadados de duração) a partir de data: URI — o player aparece mudo. Via Blob
// URL ele trata como recurso real e resolve duração/seek. Imagens seguem em
// data: URI (funcionam). Prefere a URL externa (ManyChat S3) quando existe.
function base64ToBlobUrl(base64: string, mime: string): string | null {
  try {
    const clean = (mime || '').split(';')[0].trim() || 'application/octet-stream'
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: clean }))
  } catch {
    return null
  }
}

/**
 * Abre uma mídia (documento/imagem) numa nova aba. O Chrome BLOQUEIA navegação top-level para
 * data: URIs — então PDF/foto da W-API (que vêm em base64, sem storage_path) "não abrem nada"
 * ao clicar. Convertendo o base64 num Blob URL o navegador trata como recurso real e abre.
 * URL externa (ManyChat S3) abre direto. Revoga o Blob depois pra não vazar memória.
 */
function openMedia(item: { url?: string; base64?: string; mimeType?: string | null }, fallbackMime: string): void {
  if (item.url && item.url.trim()) {
    window.open(item.url, '_blank', 'noopener')
    return
  }
  if (item.base64 && item.base64.trim()) {
    const blobUrl = base64ToBlobUrl(item.base64, item.mimeType || fallbackMime)
    if (!blobUrl) return
    window.open(blobUrl, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  }
}

function useBlobMediaSrc(
  url: string | null | undefined,
  base64: string | null | undefined,
  fallbackMime: string,
  mime: string | null | undefined,
): string | null {
  const resolved = useMemo(() => {
    if (url && url.trim()) return { value: url, isBlob: false }
    if (base64 && base64.trim()) return { value: base64ToBlobUrl(base64, mime || fallbackMime), isBlob: true }
    return { value: null, isBlob: false }
  }, [url, base64, mime, fallbackMime])
  // Revoga o Blob URL ao trocar/desmontar pra não vazar memória.
  useEffect(() => {
    if (resolved.isBlob && resolved.value) {
      const v = resolved.value
      return () => URL.revokeObjectURL(v)
    }
  }, [resolved])
  return resolved.value
}

type InlineMediaItem = { url?: string | null; base64?: string | null; mimeType?: string | null; caption?: string | null }

// O áudio do WhatsApp é OGG/Opus — o Chrome toca inline, mas QuickTime (macOS) e
// players nativos não abrem .ogg ("vem vazio"). Pra o botão "baixar" entregar um
// arquivo que abre em QUALQUER lugar, decodificamos no navegador (Web Audio) e
// reembalamos em WAV. Se a decodificação falhar, cai pro .ogg original.
function encodeWav(audioBuffer: AudioBuffer): Blob {
  const numCh = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const numFrames = audioBuffer.length
  const blockAlign = numCh * 2
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  const channels: Float32Array[] = []
  for (let c = 0; c < numCh; c += 1) channels.push(audioBuffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < numFrames; i += 1) {
    for (let c = 0; c < numCh; c += 1) {
      const clamped = Math.max(-1, Math.min(1, channels[c]![i]!))
      view.setInt16(off, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

async function downloadAudioAsWav(srcUrl: string, baseName: string): Promise<void> {
  try {
    const ab = await (await fetch(srcUrl)).arrayBuffer()
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ac = new AC()
    const audioBuf = await ac.decodeAudioData(ab)
    void ac.close()
    const wavUrl = URL.createObjectURL(encodeWav(audioBuf))
    triggerDownload(wavUrl, `${baseName}.wav`)
    setTimeout(() => URL.revokeObjectURL(wavUrl), 10_000)
  } catch {
    // navegador não decodificou o Opus → baixa o .ogg original
    triggerDownload(srcUrl, `${baseName}.ogg`)
  }
}

function InlineAudio({ item }: { item: InlineMediaItem }) {
  const src = useBlobMediaSrc(item.url, item.base64, 'audio/ogg', item.mimeType)
  if (!src) return null
  return (
    <div className="flex flex-col gap-1">
      <audio controls preload="metadata" src={src} className="h-8 w-full min-w-[200px]">
        Seu navegador não suporta áudio.
      </audio>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] opacity-60">Áudio recebido</span>
        <button
          type="button"
          onClick={() => void downloadAudioAsWav(src, 'audio')}
          className="text-[10px] underline opacity-60 hover:opacity-100"
        >
          baixar (.wav)
        </button>
      </div>
    </div>
  )
}

function InlineVideo({ item }: { item: InlineMediaItem }) {
  const src = useBlobMediaSrc(item.url, item.base64, 'video/mp4', item.mimeType)
  if (!src) return null
  return (
    <div className="overflow-hidden rounded-lg border border-border/20">
      <video controls preload="metadata" src={src} className="max-h-72 w-full">
        Seu navegador não suporta vídeo.
      </video>
      {item.caption && <p className="mt-1 px-2 pb-1 text-xs opacity-80">{item.caption}</p>}
    </div>
  )
}

export function LeadChatThread({
  leadId,
  history,
  whatsappOnly,
  canCompose,
  readOnlyInstagramHint,
  aiConversationBase,
}: Props) {
  const crm = useCrm()
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const handleGenerateAsaas = async (kit: PagbankKit) => {
    if (pagbankLoading) return
    setPagbankLoading(true)
    try {
      const amountCents = ASAAS_KIT_AMOUNTS[kit]
      const maxInstallments = kit === '1_mes' ? 1 : 3
      const res = await generateAsaasCardLink({
        amountCents,
        description: `Tricopill ${kit.replace('_', ' ')}`,
        leadId,
        installments: maxInstallments,
      })
      crm.setDraftMessage((prev) => {
        const base = prev.trim()
        const linkLine = `💳 Aqui está seu link de pagamento no cartão:\n${res.payLink}`
        return base ? `${base}\n\n${linkLine}` : linkLine
      })
      toast.success('Link de cartão (Asaas) gerado — revise e envie.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link de pagamento')
    } finally {
      setPagbankLoading(false)
    }
  }
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  const stickerInputRef = useRef<HTMLInputElement>(null)
  const isActiveLead = crm.selectedLeadId === leadId
  const [filter, setFilter] = useState<ChatFilter>(whatsappOnly ? 'whatsapp' : 'all')
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [pagbankLoading, setPagbankLoading] = useState(false)
  const [retryingBling, setRetryingBling] = useState(false)

  const handleRetryBling = async () => {
    if (retryingBling) return
    setRetryingBling(true)
    try {
      const { retryBlingOrder } = await import('@/services/crmBling')
      const res = await retryBlingOrder(leadId)
      toast.success(`Pedido lançado no Bling (#${res.orderId ?? '?'}, ${res.bottles} frascos).`)
      void crm.refreshChatFromSupabase?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reenviar pro Bling')
    } finally {
      setRetryingBling(false)
    }
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  // Controle de auto-scroll: só descer pro fim se o usuário JÁ estava no fim.
  const isAtBottomRef = useRef(true)
  const prevLeadIdRef = useRef(leadId)
  const [aiUiTick, setAiUiTick] = useState(0)
  const [forceAiLoading, setForceAiLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [editTarget, setEditTarget] = useState<Interaction | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteMsgOpen, setDeleteMsgOpen] = useState(false)
  const [deleteMsgTarget, setDeleteMsgTarget] = useState<Interaction | null>(null)

  // Quick Messages
  const [quickMessages, setQuickMessages] = useState<Array<{ id: string; title: string; content: string }>>([])
  const [showQuickMenu, setShowQuickMenu] = useState(false)
  const [quickFilter, setQuickFilter] = useState('')
  const [selectedQuickIdx, setSelectedQuickIdx] = useState(0)

  useEffect(() => {
    if (!aiConversationBase) return
    const id = window.setInterval(() => setAiUiTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [aiConversationBase, leadId])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    void (async () => {
      const { data, error } = await supabase
        .from('crm_quick_messages')
        .select('id, shortcut, content')
        .order('sort_order', { ascending: true })
      if (error || !data) return
      setQuickMessages(
        (data as { id: string; shortcut: string; content: string }[]).map((row) => ({
          id: row.id,
          title: row.shortcut,
          content: row.content,
        })),
      )
    })()
  }, [])

  const filteredQuick = useMemo(() => {
    if (!quickFilter) return quickMessages
    return quickMessages.filter(m => 
      m.title.toLowerCase().includes(quickFilter.toLowerCase()) || 
      m.content.toLowerCase().includes(quickFilter.toLowerCase())
    )
  }, [quickMessages, quickFilter])

  const aiGate: AiConversationGate | null = useMemo(() => {
    if (!aiConversationBase) return null
    return {
      ownerMode: aiConversationBase.ownerMode,
      aiEnabled: aiConversationBase.aiEnabled,
      businessHoursStartHour: aiConversationBase.businessHoursStartHour,
      businessHoursEndHour: aiConversationBase.businessHoursEndHour,
    }
  }, [aiConversationBase])

  const showAiResponding = useMemo(() => {
    void aiUiTick
    if (!aiGate) return false
    return isAiReplyLikelyPending({ history, gate: aiGate })
  }, [history, aiGate, aiUiTick])

  const showForceAiButton =
    Boolean(aiConversationBase) &&
    isSupabaseConfigured &&
    canCompose &&
    isActiveLead &&
    aiConversationBase!.aiEnabled &&
    aiConversationBase!.ownerMode !== 'human'

  const handleForceAiReply = async () => {
    if (!showForceAiButton || forceAiLoading) return
    setForceAiLoading(true)
    try {
      const r = await forceAiReply(leadId)
      if (r.replied) {
        toast.success('Resposta da IA enviada.')
        const mc = r.manychat_push as
          | {
              attempted?: boolean
              ok?: boolean
              error?: string
              set_field_ok?: boolean
              send_flow_ok?: boolean
              skipped_send_flow?: boolean
            }
          | undefined
        if ((r.channel === 'meta' || r.channel === 'whatsapp') && mc?.attempted && mc.skipped_send_flow) {
          toast.message('ManyChat: só foi gravado o campo ENVIAR-DM (sendFlow pela API desativado). Dispara o flow no ManyChat por automation.', {
            description: 'MANYCHAT_PUSH_SKIP_SEND_FLOW=true',
          })
        } else if ((r.channel === 'meta' || r.channel === 'whatsapp') && mc?.attempted && mc.ok === false && mc.set_field_ok && mc.send_flow_ok === false) {
          toast.message('ManyChat: campo ENVIAR-DM atualizado, mas sendFlow falhou — o cliente pode não receber DM.', {
            description: String(mc.error ?? 'Veja MANYCHAT_DM_FLOW_NS, MANYCHAT_SEND_FLOW_MESSAGE_TAG (ex.: HUMAN_AGENT) e logs da Edge Function.'),
          })
        } else if ((r.channel === 'meta' || r.channel === 'whatsapp') && mc?.attempted && mc.ok === false) {
          toast.message('ManyChat: mensagem gravada no CRM; o envio ao Instagram pode ter falhado.', {
            description: String(mc.error ?? ''),
          })
        }
      } else {
        toast.message(r.message ?? 'A IA não enviou mensagem.', {
          description: r.error ? `Código: ${r.error}` : undefined,
        })
      }
      await crm.refreshChatFromSupabase()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao pedir resposta da IA.')
    } finally {
      setForceAiLoading(false)
    }
  }

  const canEditOutboundText = (msg: Interaction) => msg.direction === 'out'

  const openEditDialog = (msg: Interaction) => {
    setEditTarget(msg)
    setEditDraft(msg.content)
    setEditOpen(true)
  }

  const saveEditedMessage = async () => {
    if (!editTarget) return
    setEditSaving(true)
    try {
      await crm.updateInteractionMessage(editTarget.id, editDraft)
      toast.success('Mensagem atualizada no CRM.')
      setEditOpen(false)
      setEditTarget(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível guardar.')
    } finally {
      setEditSaving(false)
    }
  }

  const runDeleteMessage = async () => {
    if (!deleteMsgTarget) return
    try {
      await crm.deleteInteractionMessage(deleteMsgTarget.id)
      toast.success('Mensagem removida do histórico do CRM.')
      setDeleteMsgOpen(false)
      setDeleteMsgTarget(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível apagar.')
    }
  }

  const items = useMemo(() => {
    const list = [...history].sort(
      (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
    )
    const withoutMergeNoise = list.filter((m) => !isWaInstagramMergeNotice(m))
    if (filter === 'whatsapp') return withoutMergeNoise.filter((m) => m.channel === 'whatsapp')
    if (filter === 'meta') return withoutMergeNoise.filter((m) => m.channel === 'meta')
    return withoutMergeNoise
  }, [history, filter])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Trocou de conversa: vai pro fim (mostra a última msg) e marca como "no fim".
    if (prevLeadIdRef.current !== leadId) {
      prevLeadIdRef.current = leadId
      el.scrollTop = el.scrollHeight
      isAtBottomRef.current = true
      return
    }
    // Mesma conversa (nova msg ou refresh do polling): só desce pro fim se o usuário
    // JÁ estava no fim. Se ele rolou pra cima pra ler o histórico, NÃO o puxa de volta.
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [items, leadId])

  const hasWaInstagramMerge = useMemo(() => history.some(isWaInstagramMergeNotice), [history])

  useEffect(() => {
    for (const row of history) {
      if (!isWaInstagramMergeNotice(row)) continue
      if (!tryConsumeWaInstagramMergeToast(row)) continue
      toast.success('WhatsApp ligado ao Instagram: número real guardado. Já pode responder pelo CRM.')
    }
  }, [history])

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const next: Array<{ name: string; mimeType: string; base64: string }> = []
    for (const file of Array.from(files)) {
      const raw = await file.arrayBuffer()
      const bytes = new Uint8Array(raw)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number)
      const base64 = btoa(binary)
      next.push({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64,
      })
    }
    crm.setDraftAttachments([...(crm.draftAttachments ?? []), ...next])
  }

  const insertEmojiIntoDraft = (emoji: string) => {
    if (showAiResponding) return
    const el = draftTextareaRef.current
    if (!el) {
      crm.setDraftMessage((prev) => prev + emoji)
      return
    }
    const start = el.selectionStart ?? crm.draftMessage.length
    const end = el.selectionEnd ?? start
    const before = crm.draftMessage.slice(0, start)
    const after = crm.draftMessage.slice(end)
    crm.setDraftMessage(before + emoji + after)
    window.requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
    })
  }

  const handleStickerFile = async (files: FileList | null) => {
    const input = stickerInputRef.current
    if (input) input.value = ''
    if (!files?.length || showAiResponding) return
    const file = files[0]
    const okType = file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp')
    if (!okType) {
      toast.error('Figurinha tem de ser WebP (.webp), formato usado pelo WhatsApp.')
      return
    }
    if (file.size > 350 * 1024) {
      toast.error('Ficheiro demasiado grande. Experimente uma figurinha até ~350 KB.')
      return
    }
    try {
      const raw = await file.arrayBuffer()
      const bytes = new Uint8Array(raw)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number)
      const base64 = btoa(binary)
      await crm.sendStickerMessage(base64)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível ler a figurinha.')
    }
  }

  // Group messages by author and timestamp (within 10 seconds)
  const groupedItems = useMemo(() => {
    const groups: Interaction[][] = []
    let currentGroup: Interaction[] = []

    // Deduplicate items with same externalMessageId (frontend safety layer)
    const seenExternalIds = new Set<string>()
    const dedupedItems = items.filter(item => {
      if (item.externalMessageId) {
        if (seenExternalIds.has(item.externalMessageId)) return false
        seenExternalIds.add(item.externalMessageId)
      }
      return true
    })

    dedupedItems.forEach((item, index) => {
      if (index === 0) {
        currentGroup.push(item)
      } else {
        const prev = dedupedItems[index - 1]
        const timeDiff = Math.abs(new Date(item.happenedAt).getTime() - new Date(prev.happenedAt).getTime())
        
        if (item.author === prev.author && item.direction === prev.direction && timeDiff < 10000) {
          currentGroup.push(item)
        } else {
          groups.push(currentGroup)
          currentGroup = [item]
        }
      }
      
      if (index === dedupedItems.length - 1) {
        groups.push(currentGroup)
      }
    })

    return groups
  }, [items])

  const renderContent = (msg: Interaction) => {
    const { content, media } = msg
    
    // If we have actual media objects attached
    if (media && media.length > 0) {
      // ManyChat traz URL S3 (item.url). WhatsApp Evolution traz inline base64.
      // resolveSrc usa qualquer um — assim o mesmo renderer atende os dois canais.
      const resolveSrc = (item: NonNullable<Interaction['media']>[number], fallbackMime: string): string | null => {
        if (item.url && item.url.trim()) return item.url
        if (item.base64 && item.base64.trim()) return `data:${item.mimeType || fallbackMime};base64,${item.base64}`
        return null
      }
      return (
        <div className="flex flex-col gap-2 py-1">
          {media.map((item) => {
            if (item.type === 'image') {
              const src = resolveSrc(item, 'image/jpeg')
              if (!src) return null
              return (
                <div key={item.id} className="overflow-hidden rounded-lg border border-border/20">
                  <img
                    src={src}
                    alt={item.caption || 'Foto'}
                    className="max-h-64 w-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => openMedia(item, 'image/jpeg')}
                  />
                  {item.caption && <p className="mt-1 px-2 pb-1 text-xs opacity-80">{item.caption}</p>}
                </div>
              )
            }
            if (item.type === 'audio') {
              return <InlineAudio key={item.id} item={item} />
            }
            if (item.type === 'video') {
              return <InlineVideo key={item.id} item={item} />
            }
            if (item.type === 'document') {
              const src = resolveSrc(item, 'application/octet-stream')
              if (!src) return null
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openMedia(item, 'application/octet-stream')}
                  className="flex w-full items-center gap-3 rounded-lg bg-black/5 p-2 text-left transition-colors hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-500">
                    <FileIcon className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate text-sm font-semibold">{item.caption || 'Documento'}</span>
                    <span className="text-[10px] uppercase opacity-60">Clique para abrir</span>
                  </div>
                </button>
              )
            }
            return null
          })}
          {content && !content.includes('[mídia recebida:') && (
            <p className="m-0 whitespace-pre-wrap break-words">{content}</p>
          )}
        </div>
      )
    }

    // Legacy fallback for string-based media markers
    const mediaMatch = content.match(/\[mídia recebida: (.*)\]/)
    if (mediaMatch) {
      const type = mediaMatch[1]
      let Icon = FileIcon
      let label = 'Documento'
      let color = 'bg-blue-500/10 text-blue-500'

      if (type === 'image') {
        Icon = ImageIcon
        label = 'Foto'
        color = 'bg-emerald-500/10 text-emerald-500'
      } else if (type === 'video') {
        Icon = VideoIcon
        label = 'Vídeo'
        color = 'bg-orange-500/10 text-orange-500'
      } else if (type === 'audio') {
        Icon = MusicIcon
        label = 'Áudio'
        color = 'bg-amber-500/10 text-amber-500'
      }

      return (
        <div className="flex items-center gap-3 py-1">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", color)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold uppercase tracking-wider opacity-60">Mídia Recebida</span>
            <span className="text-sm font-semibold">{label}</span>
          </div>
        </div>
      )
    }
    return <p className="m-0 whitespace-pre-wrap break-words">{content}</p>
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header / Filters */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1 py-2 sm:gap-2">
        {hasWaInstagramMerge ? (
          <Badge variant="secondary" className="max-w-full shrink truncate rounded-lg px-2 py-0.5 text-[10px] font-normal sm:text-xs">
            IG → WhatsApp vinculado
          </Badge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={filter === 'whatsapp' ? 'default' : 'outline'}
          className="h-7 rounded-lg px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs"
          onClick={() => setFilter('whatsapp')}
        >
          WhatsApp
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'meta' ? 'default' : 'outline'}
          className="h-7 rounded-lg px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs"
          onClick={() => setFilter('meta')}
        >
          Instagram
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          className="h-7 rounded-lg px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs"
          onClick={() => setFilter('all')}
        >
          Tudo
        </Button>
        {showForceAiButton ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="ml-auto h-7 gap-1 rounded-lg px-2 text-[10px] sm:h-8 sm:px-2.5 sm:text-xs"
            disabled={forceAiLoading}
            title="Gera e envia outra resposta com base na última mensagem do paciente (ignora limites de ritmo da IA)."
            onClick={() => void handleForceAiReply()}
          >
            <RefreshCw className={cn('h-3 w-3 shrink-0', forceAiLoading && 'animate-spin')} aria-hidden />
            <span className="hidden sm:inline">Pedir IA de novo</span>
            <span className="sm:hidden">IA</span>
          </Button>
        ) : null}
      </div>

      {/* Message History */}
      <div
        ref={scrollRef}
        role="log"
        onScroll={() => {
          const el = scrollRef.current
          if (el) isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overscroll-contain rounded-xl border border-border/20 bg-muted/10 p-3 scrollbar-thin scrollbar-thumb-border/30 dark:bg-[#0b141a]/50 sm:p-4"
      >
        <ul className="m-0 flex list-none flex-col gap-6 p-0">
          {groupedItems.length === 0 ? (
            <li className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center opacity-40">
                <span className="text-xl">📥</span>
              </div>
              <p className="text-xs text-muted-foreground font-medium">Nenhuma mensagem encontrada</p>
            </li>
          ) : (
            groupedItems.map((group, gIdx) => {
              const first = group[0]
              const out = first.direction === 'out'
              
              return (
                <Fragment key={`group-${gIdx}`}>
                  {(gIdx === 0 || !isSameDay(new Date(first.happenedAt), new Date(groupedItems[gIdx - 1][0].happenedAt))) ? (
                    <li className="flex items-center justify-center py-1">
                      <span className="rounded-full bg-muted/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80 dark:bg-white/5">
                        {formatDaySeparator(first.happenedAt)}
                      </span>
                    </li>
                  ) : null}
                  <li
                    className={cn(
                      'flex w-full flex-col gap-1',
                      out ? 'items-end' : 'items-start',
                    )}
                  >
                  <div className="flex w-full max-w-[min(92%,28rem)] flex-col gap-1.5 sm:max-w-[min(85%,32rem)] lg:max-w-[75%]">
                    {group.map((msg, mIdx) => (
                      <div
                        key={msg.id}
                        className={cn(
                          'group/msg relative rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm transition-all',
                          out
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card text-foreground border border-border/50 dark:bg-[#202c33] dark:text-white/95 dark:border-white/5',
                          out ? (mIdx === 0 ? 'rounded-tr-none' : '') : (mIdx === 0 ? 'rounded-tl-none' : ''),
                          canCompose && out && 'pr-9',
                          canCompose && !out && 'pl-9',
                        )}
                      >
                        {canCompose ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              type="button"
                              className={cn(
                                'absolute top-1 z-10 flex h-7 w-7 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                out
                                  ? 'right-1 text-primary-foreground/80 hover:bg-primary-foreground/15'
                                  : 'left-1 text-muted-foreground hover:bg-muted/80 dark:hover:bg-white/10',
                                'opacity-70 sm:opacity-0 sm:group-hover/msg:opacity-100',
                              )}
                              aria-label="Opções da mensagem"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={out ? 'end' : 'start'} className="min-w-44">
                              {canEditOutboundText(msg) ? (
                                <DropdownMenuItem
                                  onClick={() => {
                                    openEditDialog(msg)
                                  }}
                                >
                                  <Pencil className="size-4" />
                                  Editar texto
                                </DropdownMenuItem>
                              ) : null}
                              {canEditOutboundText(msg) ? <DropdownMenuSeparator /> : null}
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => {
                                  setDeleteMsgTarget(msg)
                                  setDeleteMsgOpen(true)
                                }}
                              >
                                <Trash2 className="size-4" />
                                Apagar do CRM
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        {renderContent(msg)}
                      </div>
                    ))}
                  </div>
                  
                  <div className={cn(
                    "flex items-center gap-2 px-1 mt-1 text-[10px] font-medium tracking-tight",
                    out ? "flex-row-reverse text-muted-foreground/80" : "text-muted-foreground/60"
                  )}>
                    <span className="truncate max-w-[100px]">{first.author}</span>
                    <span className="opacity-30">•</span>
                    <time dateTime={first.happenedAt}>{format(new Date(first.happenedAt), 'HH:mm', { locale: ptBR })}</time>
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[9px] uppercase tracking-wider',
                        getChannelStyle(first.channel).pill,
                      )}
                      title={getChannelStyle(first.channel).label}
                    >
                      {getChannelShortLabel(first.channel)}
                    </span>
                  </div>
                  </li>
                </Fragment>
              )
            })
          )}
        </ul>
      </div>

      {showAiResponding ? (
        <div
          className="shrink-0 space-y-1.5 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 dark:bg-primary/10"
          role="status"
          aria-live="polite"
          aria-label="Assistente de IA a gerar resposta"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              IA a responder…
            </span>
            <span className="text-[10px] text-muted-foreground">Aguarde antes de enviar</span>
          </div>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
            <div className="crm-ai-progress-strip absolute inset-y-0 left-0 w-[38%] rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)]" />
          </div>
        </div>
      ) : null}

      {/* Input Area */}
      <div className="flex shrink-0 flex-col gap-2 pt-3">
        {readOnlyInstagramHint && isActiveLead ? (
          <div className="shrink-0 flex flex-col gap-1.5 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5">
            <p className="m-0 text-sm font-medium text-foreground">Lead do Instagram</p>
            <p className="m-0 text-xs leading-snug text-muted-foreground">
              Envio pelo CRM = WhatsApp. Com número ManyChat, responda lá. Com número WA real, o campo volta aqui.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-0.5 w-fit rounded-xl"
              onClick={() => setIsScheduleOpen(true)}
            >
              <CalendarPlus className="mr-2 h-4 w-4" />
              Agendar consulta
            </Button>
          </div>
        ) : null}

        {canCompose && isActiveLead ? (
          <div className="flex shrink-0 flex-col gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            <Textarea
              id={`lead-chat-draft-${leadId}`}
              ref={draftTextareaRef}
              rows={1}
              value={crm.draftMessage}
              readOnly={showAiResponding}
              onChange={(e) => {
                const val = e.target.value
                crm.setDraftMessage(val)
                
                // Detecta atalho de mensagens rápidas
                const lastSlashIdx = val.lastIndexOf('/')
                if (lastSlashIdx !== -1 && (lastSlashIdx === 0 || val[lastSlashIdx - 1] === ' ' || val[lastSlashIdx - 1] === '\n')) {
                  const filter = val.slice(lastSlashIdx + 1)
                  if (!filter.includes(' ')) {
                    setQuickFilter(filter)
                    setShowQuickMenu(true)
                    setSelectedQuickIdx(0)
                  } else {
                    setShowQuickMenu(false)
                  }
                } else {
                  setShowQuickMenu(false)
                }

                if (val.endsWith('/agendar ')) {
                  crm.setDraftMessage(val.replace('/agendar ', ''))
                  setIsScheduleOpen(true)
                }
              }}
              onKeyDown={(e) => {
                if (showQuickMenu) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSelectedQuickIdx(prev => (prev + 1) % filteredQuick.length)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSelectedQuickIdx(prev => (prev - 1 + filteredQuick.length) % filteredQuick.length)
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    const msg = filteredQuick[selectedQuickIdx]
                    if (msg) {
                      const lastSlashIdx = crm.draftMessage.lastIndexOf('/')
                      const before = crm.draftMessage.slice(0, lastSlashIdx)
                      crm.setDraftMessage(before + msg.content)
                    }
                    setShowQuickMenu(false)
                  } else if (e.key === 'Escape') {
                    setShowQuickMenu(false)
                  }
                  return
                }
                // Enter envia a mensagem; Shift+Enter quebra linha (padrão WhatsApp/Slack).
                // e.nativeEvent.isComposing evita envio acidental durante IME (chinês/japonês);
                // e.repeat evita disparo duplicado ao segurar a tecla.
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  !e.repeat
                ) {
                  e.preventDefault()
                  if (showAiResponding) return
                  if (!crm.draftMessage.trim() && crm.draftAttachments.length === 0) return
                  void crm.sendMessage()
                }
              }}
              placeholder={
                showAiResponding ? 'A IA está a preparar resposta ao paciente…' : 'Digite sua mensagem...'
              }
              className={cn(
                'min-h-[2.5rem] max-h-[8rem] resize-none rounded-xl border-border/70 bg-background text-sm [field-sizing:content] sm:text-base',
                showAiResponding && 'cursor-not-allowed opacity-80',
              )}
            />

            {/* Menu de Mensagens Rápidas */}
            {showQuickMenu && filteredQuick.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 w-full max-w-sm z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-border bg-muted/30">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Mensagens Rápidas</span>
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {filteredQuick.map((m, idx) => (
                    <button
                      key={m.id}
                      className={cn(
                        "w-full flex flex-col items-start px-3 py-2 rounded-lg text-left transition-colors",
                        idx === selectedQuickIdx ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      )}
                      onClick={() => {
                        const lastSlashIdx = crm.draftMessage.lastIndexOf('/')
                        const before = crm.draftMessage.slice(0, lastSlashIdx)
                        crm.setDraftMessage(before + m.content)
                        setShowQuickMenu(false)
                        draftTextareaRef.current?.focus()
                      }}
                    >
                      <span className={cn("text-xs font-bold", idx === selectedQuickIdx ? "text-white" : "text-foreground")}>{m.title}</span>
                      <span className={cn("text-[10px] line-clamp-1", idx === selectedQuickIdx ? "text-white/80" : "text-muted-foreground")}>{m.content}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
                  <input
                    type="file"
                    multiple
                    accept="audio/*,image/*,.pdf,.doc,.docx,.txt"
                    className="sr-only"
                    onChange={(e) => void handleAttachFiles(e.target.files)}
                  />
                  📎 {crm.draftAttachments.length > 0 ? `${crm.draftAttachments.length} arquivos` : 'Anexar'}
                </label>
                <input
                  ref={stickerInputRef}
                  type="file"
                  accept=".webp,image/webp"
                  className="sr-only"
                  onChange={(e) => void handleStickerFile(e.target.files)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-[10px]"
                  disabled={showAiResponding}
                  title="Figurinha WebP (WhatsApp)"
                  onClick={() => stickerInputRef.current?.click()}
                >
                  <Sticker className="h-4 w-4" />
                  <span className="sr-only">Enviar figurinha WebP</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    type="button"
                    disabled={showAiResponding}
                    title="Inserir emoji"
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'sm' }),
                      'h-8 rounded-lg px-2 text-[10px]',
                    )}
                  >
                    <Smile className="h-4 w-4" />
                    <span className="sr-only">Emojis</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-56 w-[min(100vw-2rem,15rem)] overflow-y-auto p-2">
                    <div className="grid grid-cols-8 gap-0.5">
                      {CHAT_QUICK_EMOJIS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-md text-base leading-none hover:bg-muted"
                          onClick={() => insertEmojiIntoDraft(em)}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    type="button"
                    disabled={showAiResponding || quickMessages.length === 0}
                    title={quickMessages.length === 0 ? 'Sem mensagens rápidas (Configurações)' : 'Mensagens rápidas (atalho: /)'}
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'sm' }),
                      'h-8 rounded-lg px-2 text-[10px]',
                    )}
                  >
                    <span className="font-mono font-bold text-primary">/</span>
                    <span className="sr-only">Mensagens rápidas</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-60 w-[min(100vw-2rem,22rem)] overflow-y-auto p-1">
                    <div className="px-2 py-1.5 border-b border-border/40 mb-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        Mensagens Rápidas
                      </span>
                    </div>
                    {quickMessages.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        Nenhuma cadastrada. Crie em Configurações → Mensagens Rápidas.
                      </div>
                    ) : (
                      quickMessages.map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          className="flex cursor-pointer flex-col items-start gap-0.5 whitespace-normal px-3 py-2"
                          onSelect={() => {
                            const current = crm.draftMessage
                            const next = current ? `${current}${current.endsWith(' ') ? '' : ' '}${m.content}` : m.content
                            crm.setDraftMessage(next)
                          }}
                        >
                          <span className="text-xs font-bold text-primary">/{m.title}</span>
                          <span className="line-clamp-2 text-xs text-muted-foreground">{m.content}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {isSalesPolo ? (
                  <>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      type="button"
                      disabled={pagbankLoading}
                      title="Gerar link de pagamento no cartão (Asaas)"
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'sm' }),
                        'h-8 rounded-lg px-2 text-[10px]',
                      )}
                    >
                      <CreditCard className="mr-1.5 h-3.5 w-3.5 text-primary" />
                      {pagbankLoading ? 'Gerando…' : 'Link cartão'}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(Object.keys(PAGBANK_KIT_LABELS) as PagbankKit[]).map((kit) => (
                        <DropdownMenuItem key={kit} onClick={() => void handleGenerateAsaas(kit)}>
                          {PAGBANK_KIT_LABELS[kit]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Confirmar venda fechada (marca pago + Bling)"
                    className="h-8 rounded-lg px-2 text-[10px]"
                    onClick={() => navigate(`/leads/${leadId}/venda`)}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Confirmar venda
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Gerar envio no Melhor Envio (carrinho ou etiqueta)"
                    className="h-8 rounded-lg px-2 text-[10px]"
                    onClick={() => navigate(`/leads/${leadId}/envio`)}
                  >
                    <Truck className="mr-1.5 h-3.5 w-3.5 text-primary" />
                    Gerar envio
                  </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg text-[10px]"
                    onClick={() => setIsScheduleOpen(true)}
                  >
                    <CalendarPlus className="mr-1.5 h-3.5 w-3.5 text-primary" />
                    Agendar
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="Relançar no Bling uma venda paga que não entrou"
                  className="h-8 rounded-lg px-2 text-[10px]"
                  disabled={retryingBling}
                  onClick={() => void handleRetryBling()}
                >
                  <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5 text-primary', retryingBling && 'animate-spin')} />
                  {retryingBling ? 'Enviando…' : 'Reenviar Bling'}
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-xl px-5"
                disabled={
                  showAiResponding || (!crm.draftMessage.trim() && crm.draftAttachments.length === 0)
                }
                onClick={() => void crm.sendMessage()}
              >
                Enviar
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o)
          if (!o) {
            setEditTarget(null)
            setEditDraft('')
          }
        }}
      >
        <DialogContent showCloseButton className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar mensagem</DialogTitle>
            <DialogDescription>
              A alteração fica apenas no histórico do CRM; não altera texto já entregue no WhatsApp ou Instagram do
              cliente.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={6}
            className="min-h-[8rem] rounded-lg border-border text-sm"
          />
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void saveEditedMessage()} disabled={editSaving || !editDraft.trim()}>
              {editSaving ? 'A guardar…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteMsgOpen}
        onOpenChange={(o) => {
          setDeleteMsgOpen(o)
          if (!o) setDeleteMsgTarget(null)
        }}
        title="Apagar mensagem do CRM?"
        description={
          deleteMsgTarget?.direction === 'in'
            ? 'Esta linha deixa de aparecer no CRM. A mensagem continua no telemóvel ou na app do cliente.'
            : 'Esta linha deixa de aparecer no CRM. Se a mensagem já tiver sido entregue, o cliente mantém a cópia no dispositivo.'
        }
        confirmLabel="Apagar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => void runDeleteMessage()}
      />

      <ScheduleAppointmentDialog
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        leadId={leadId}
      />
    </div>
  )
}
