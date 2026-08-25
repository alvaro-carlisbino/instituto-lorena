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
  MessageCircle,
  RefreshCw,
  MoreVertical,
  MapPin,
  Contact,
  BarChart3,
  Link2,
  QrCode,
  Plus,
  Pencil,
  Trash2,
  Paperclip,
  Smile,
  Sticker,
  CreditCard,
  CheckCircle2,
  Truck,
  Download,
  FileText,
  FileSpreadsheet,
  FileType,
  Reply,
  Forward,
  Copy,
  SmilePlus,
  CheckSquare,
  X,
  Ban,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
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
import { EmojiPicker } from '@/components/leads/chat/EmojiPicker'
import { AttachmentTray, type PendingMedia } from '@/components/leads/chat/AttachmentTray'
import { AudioRecorder } from '@/components/leads/chat/AudioRecorder'
import { ForwardDialog, type ForwardTarget } from '@/components/leads/chat/ForwardDialog'
import { SpecialMessageDialog, type SpecialKind } from '@/components/leads/chat/SpecialMessageDialog'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { PAGBANK_KIT_LABELS, type PagbankKit } from '@/services/crmPagbank'
import { generateRedeLink } from '@/services/crmRede'
import {
  isWaInstagramMergeNotice,
  tryConsumeWaInstagramMergeToast,
} from '@/lib/waInstagramMergeNotice'
import { resolveAuthorLabel } from '@/lib/chatAuthor'
import { exportChatToCsv, exportChatToPdf, exportChatToTxt } from '@/lib/chatExport'
import { isAiReplyLikelyPending, type AiConversationGate } from '@/lib/aiTypingIndicator'
import { getChannelShortLabel, getChannelStyle } from '@/lib/channelStyles'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'
import { isMediaOnlyLabel } from '@/lib/chatMedia'
import type { Interaction } from '@/mocks/crmMock'
import { forceAiReply } from '@/services/conversationControl'
import {
  deleteMessage as apagarMensagem,
  discardChatMedia,
  loadReactionsForLead,
  reactToMessage,
  removeMessageReaction,
  signedMediaUrl,
  uploadChatMedia,
  type ReactionRow,
} from '@/services/crmChat'
import { sendWhatsappMessage, notifySendError } from '@/services/crmWhatsapp'

// Valor cheio do cartão por kit Tricopill (mesma tabela do PaymentLinksPage). Cartão+Pix = e.Rede
// (Asaas é SÓ assinatura); o link /pagar deixa o cliente escolher Pix (5% off) ou cartão até 3x.
const REDE_KIT_AMOUNTS: Record<PagbankKit, number> = { '1_mes': 19900, '3_meses': 59700, '5_meses': 99500 }


type ChatFilter = 'all' | 'whatsapp' | 'meta'

type Props = {
  leadId: string
  history: Interaction[]
  whatsappOnly?: boolean
  canCompose?: boolean
  readOnlyInstagramHint?: boolean
  /** Modo + IA activa + turno da equipe (Supabase). Sem isto o indicador de “IA a responder” não aparece. */
  aiConversationBase?: AiConversationGate | null
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

/** Fila de reação rápida do menu da bolha — as mesmas seis do WhatsApp. */
const REACOES_RAPIDAS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

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
        <Button
          type="button"
          variant="link"
          onClick={() => void downloadAudioAsWav(src, 'audio')}
          className="h-auto p-0 text-[10px] font-normal text-current underline opacity-60 hover:opacity-100"
        >
          baixar (.wav)
        </Button>
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

  // Rascunho do compositor = estado LOCAL (antes vivia no context global e cada tecla
  // re-renderizava o app inteiro). Só este componente re-renderiza ao digitar.
  const [draftMessage, setDraftMessage] = useState<string>('')
  const [draftAttachments, setDraftAttachments] = useState<
    Array<{ name: string; mimeType: string; base64: string }>
  >([])
  /** Mídia já subida ao Storage, à espera do envio (com legenda por peça). */
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
  /** A mensagem que o compositor está a RESPONDER (citação), se houver. */
  const [replyTarget, setReplyTarget] = useState<Interaction | null>(null)
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (sending) return
    const prontas = pendingMedia.filter((m) => !m.uploading)
    if (!draftMessage.trim() && prontas.length === 0) return
    if (pendingMedia.some((m) => m.uploading)) {
      toast.info('Aguarde os anexos terminarem de subir.')
      return
    }
    const text = draftMessage
    const atts = draftAttachments
    const midia = prontas.map((m) => ({
      kind: m.kind,
      storagePath: m.storagePath,
      fileName: m.fileName,
      mimeType: m.mimeType,
      caption: m.caption || undefined,
    }))
    const citada = replyTarget?.externalMessageId
    setDraftMessage('')
    setDraftAttachments([])
    setPendingMedia([])
    setReplyTarget(null)
    setSending(true)
    try {
      const res = await crm.sendMessage(text, atts, {
        media: midia.length ? midia : undefined,
        replyToMessageId: citada,
      })
      if (res?.restore) {
        // O operador cancelou o envio a um opt-out: devolve o rascunho INTEIRO, inclusive
        // os anexos. Perder três fotos já subidas por causa de um "cancelar" é o tipo de
        // coisa que faz a pessoa desistir da tela e ir para o telemóvel.
        setDraftMessage(text)
        setDraftAttachments(atts)
        setPendingMedia(prontas)
        setReplyTarget(replyTarget)
      }
    } finally {
      setSending(false)
    }
  }

  const handleGenerateRede = async (kit: PagbankKit) => {
    if (pagbankLoading) return
    setPagbankLoading(true)
    try {
      const amountCents = REDE_KIT_AMOUNTS[kit]
      const maxInstallments = kit === '1_mes' ? 1 : 3
      const res = await generateRedeLink({
        amountCents,
        description: `Tricopill ${kit.replace('_', ' ')}`,
        leadId,
        installments: maxInstallments,
      })
      setDraftMessage((prev) => {
        const base = prev.trim()
        const linkLine = `💳 Aqui está seu link de pagamento (Pix ou cartão):\n${res.payLink}`
        return base ? `${base}\n\n${linkLine}` : linkLine
      })
      toast.success('Link de pagamento (Rede) gerado. Revise e envie.')
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
      toast.success(`Pedido lançado no Bling (${res.label}).`)
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
  /** 'everyone' apaga no WhatsApp da pessoa; 'crm' só some da nossa tela. */
  const [deleteMsgScope, setDeleteMsgScope] = useState<'crm' | 'everyone'>('everyone')

  // ── Seleção de mensagens (o "selecionar" do WhatsApp) ─────────────────────
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [forwardOpen, setForwardOpen] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  /** Encaminhar UMA mensagem sem entrar no modo de seleção. */
  const [forwardTarget, setForwardTarget] = useState<Interaction | null>(null)
  /** Qual mensagem especial está a ser montada (localização, contato, enquete, Pix, link). */
  const [specialKind, setSpecialKind] = useState<SpecialKind | null>(null)
  /**
   * Links assinados da mídia guardada no bucket privado, por id do item. Sem isto, a foto
   * que NÓS enviámos aparecia quebrada na bolha: o que está gravado é o caminho no bucket,
   * e caminho de bucket dentro de um `<img src>` não é imagem nenhuma.
   */
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  /** Reações (emoji na bolha) da conversa aberta, indexadas pelo id externo. */
  const [reactions, setReactions] = useState<ReactionRow[]>([])
  const [reactingId, setReactingId] = useState<string | null>(null)

  /** As mensagens marcadas no modo de seleção, na ordem em que estão no histórico. */
  const mensagensSelecionadas = useMemo(
    () => history.filter((m) => selectedIds.includes(m.id)),
    [history, selectedIds],
  )

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

  const aiGate: AiConversationGate | null = aiConversationBase ?? null

  const showAiResponding = useMemo(() => {
    void aiUiTick
    if (!aiGate) return false
    return isAiReplyLikelyPending({ history, gate: aiGate })
  }, [history, aiGate, aiUiTick])

  const aiForceBaseReady =
    Boolean(aiConversationBase) &&
    isSupabaseConfigured &&
    canCompose &&
    isActiveLead &&
    aiConversationBase!.aiEnabled

  // Conversa em modo Humano: mostramos o botão mesmo assim, mas ele apenas
  // orienta a trocar para Misto — antes ele sumia e o clique morria sem aviso.
  const forceAiHumanBlocked = aiForceBaseReady && aiConversationBase!.ownerMode === 'human'
  const showForceAiButton = aiForceBaseReady && aiConversationBase!.ownerMode !== 'human'

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
          toast.message('ManyChat: campo ENVIAR-DM atualizado, mas sendFlow falhou. O cliente pode não receber DM.', {
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

  const pedirApagar = (msg: Interaction, scope: 'crm' | 'everyone') => {
    setDeleteMsgTarget(msg)
    setDeleteMsgScope(scope)
    setDeleteMsgOpen(true)
  }

  /**
   * Duas ações com o mesmo botão seriam mentira, então são duas.
   *  • `everyone` chama a W-API: a mensagem some do telemóvel da pessoa. O WhatsApp só
   *    permite por um tempo depois do envio; passado isso, a recusa vem com o motivo.
   *  • `crm` marca a linha como apagada AQUI. A bolha vira lápide em vez de sumir: apagar
   *    a linha faria o histórico mentir por omissão para quem auditasse a conversa depois.
   */
  const runDeleteMessage = async () => {
    if (!deleteMsgTarget) return
    const alvo = deleteMsgTarget
    try {
      const res = await apagarMensagem(alvo.id, deleteMsgScope)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(
        deleteMsgScope === 'everyone'
          ? 'Mensagem apagada no WhatsApp.'
          : 'Mensagem escondida do histórico do CRM.',
      )
      setDeleteMsgOpen(false)
      setDeleteMsgTarget(null)
      await crm.refreshChatFromSupabase?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível apagar.')
    }
  }

  const apagarSelecionadas = async () => {
    if (mensagensSelecionadas.length === 0) return
    let feitas = 0
    for (const msg of mensagensSelecionadas) {
      const res = await apagarMensagem(msg.id, 'crm')
      if (res.ok) feitas += 1
    }
    toast.success(
      feitas === 1 ? 'Mensagem escondida do CRM.' : `${feitas} mensagens escondidas do CRM.`,
      { description: 'Apagar no WhatsApp da pessoa é uma mensagem de cada vez, pelo menu da bolha.' },
    )
    sairDaSelecao()
    await crm.refreshChatFromSupabase?.()
  }

  /**
   * Índice id-do-WhatsApp → mensagem, para achar a CITADA em O(1). Sem isto, cada bolha
   * varreria o histórico inteiro à procura da que ela responde — numa conversa de 800
   * mensagens isso é 800 varreduras por render.
   */
  const porIdExterno = useMemo(() => {
    const mapa = new Map<string, Interaction>()
    for (const m of history) {
      if (m.externalMessageId) mapa.set(m.externalMessageId, m)
    }
    return mapa
  }, [history])

  /**
   * Para onde dá para encaminhar. Fora: a conversa atual (encaminhar para si próprio) e
   * quem não tem WhatsApp real — o telefone sintético 888001… é de quem só falou por DM e
   * nunca teve número, então a mensagem morreria com erro do outro lado.
   */
  const destinosDeEncaminhamento = useMemo<ForwardTarget[]>(
    () =>
      crm.leads
        .filter((l) => l.id !== leadId)
        .filter((l) => l.phone && !l.phone.replace(/\D/g, '').startsWith('888001'))
        .map((l) => ({ id: l.id, name: l.patientName, phone: l.phone }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [crm.leads, leadId],
  )

  const items = useMemo(() => {
    const list = [...history].sort(
      (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
    )
    const withoutMergeNoise = list.filter((m) => !isWaInstagramMergeNotice(m))
    if (filter === 'whatsapp') return withoutMergeNoise.filter((m) => m.channel === 'whatsapp')
    if (filter === 'meta') return withoutMergeNoise.filter((m) => m.channel === 'meta')
    return withoutMergeNoise
  }, [history, filter])

  // Exportar o histórico: leva o que está NA TELA (respeita o filtro de canal), com a ficha
  // de cadastro no cabeçalho. Serve pro prontuário, pra passar caso adiante e pra LGPD
  // (paciente pode pedir a própria conversa).
  const leadDoChat = useMemo(() => crm.leads.find((l) => l.id === leadId) ?? null, [crm.leads, leadId])

  const handleExport = (formato: 'pdf' | 'csv' | 'txt') => {
    if (!leadDoChat) {
      toast.error('Lead não encontrado para exportar.')
      return
    }
    if (!items.length) {
      toast.message('Não há mensagens para exportar.')
      return
    }
    if (formato === 'csv') {
      exportChatToCsv(leadDoChat, items, crm.users)
      toast.success(`CSV gerado com ${items.length} mensagens.`)
      return
    }
    if (formato === 'txt') {
      exportChatToTxt(leadDoChat, items, crm.users)
      toast.success(`Arquivo de texto gerado com ${items.length} mensagens.`)
      return
    }
    const abriu = exportChatToPdf(leadDoChat, items, { clinica: tenant.name, users: crm.users })
    if (!abriu) {
      toast.error('O navegador bloqueou a janela.', {
        description: 'Libere pop-ups para este site e clique em Exportar de novo.',
      })
      return
    }
    toast.success('Escolha "Salvar como PDF" no destino da impressão.')
  }

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

  // Filtrar por canal só faz sentido quando a conversa TEM mais de um canal. A esmagadora
  // maioria é só WhatsApp, e mesmo assim os três botões apareciam sempre — ocupando uma
  // faixa da tela para uma escolha que não existe.
  const hasMultipleChannels = useMemo(() => {
    let whatsapp = false
    let meta = false
    for (const row of history) {
      if (row.channel === 'whatsapp') whatsapp = true
      else if (row.channel === 'meta') meta = true
      if (whatsapp && meta) return true
    }
    return false
  }, [history])

  useEffect(() => {
    for (const row of history) {
      if (!isWaInstagramMergeNotice(row)) continue
      if (!tryConsumeWaInstagramMergeToast(row)) continue
      toast.success('WhatsApp ligado ao Instagram: número real guardado. Já pode responder pelo CRM.')
    }
  }, [history])

  /**
   * Anexar = SUBIR agora, enviar depois. O ficheiro vai para o bucket assim que é escolhido
   * e o compositor guarda só o caminho; na hora de enviar, a edge assina um link e a W-API
   * vai lá buscar. Fazer o contrário (guardar base64 e mandar tudo no envio) estoura a
   * memória da função num vídeo de 12 MB — e era por isso que o anexo "enviava" e não saía.
   */
  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const escolhidos = Array.from(files)
    // Cada ficheiro entra na bandeja imediatamente, marcado como "enviando", para a pessoa
    // ver que ele foi aceite enquanto sobe.
    for (const file of escolhidos) {
      const provisorio: PendingMedia = {
        storagePath: `subindo:${crypto.randomUUID()}`,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        kind: 'document',
        previewUrl: URL.createObjectURL(file),
        sizeBytes: file.size,
        caption: '',
        uploading: true,
      }
      setPendingMedia((atuais) => [...atuais, provisorio])
      try {
        const subido = await uploadChatMedia(leadId, file)
        setPendingMedia((atuais) =>
          atuais.map((m) =>
            m.storagePath === provisorio.storagePath ? { ...subido, caption: '', uploading: false } : m,
          ),
        )
        URL.revokeObjectURL(provisorio.previewUrl)
      } catch (e) {
        setPendingMedia((atuais) => atuais.filter((m) => m.storagePath !== provisorio.storagePath))
        URL.revokeObjectURL(provisorio.previewUrl)
        toast.error(e instanceof Error ? e.message : `Falha ao anexar ${file.name}.`)
      }
    }
  }

  const removerAnexo = (storagePath: string) => {
    setPendingMedia((atuais) => atuais.filter((m) => m.storagePath !== storagePath))
    // Ficheiro que não vai ser enviado não fica ocupando o bucket.
    if (!storagePath.startsWith('subindo:')) void discardChatMedia(storagePath)
  }

  const definirLegenda = (storagePath: string, caption: string) => {
    setPendingMedia((atuais) =>
      atuais.map((m) => (m.storagePath === storagePath ? { ...m, caption } : m)),
    )
  }

  /**
   * Localização, contato, enquete, Pix e link com prévia. Vão sozinhas: cada uma é uma
   * mensagem inteira no WhatsApp, e misturá-las com o rascunho de texto faria a bolha
   * chegar com um comentário grudado que a pessoa não pediu.
   */
  const enviarEspecial = async (mensagem: NonNullable<Parameters<typeof crm.sendMessage>[2]>['special']) => {
    if (sending) return
    setSending(true)
    try {
      const res = await crm.sendMessage('', [], { special: mensagem })
      if (res?.ok) {
        setSpecialKind(null)
        toast.success('Enviado.')
      }
    } finally {
      setSending(false)
    }
  }

  /** Áudio gravado no próprio CRM entra na bandeja como qualquer outro anexo. */
  const anexarAudioGravado = async (file: File) => {
    try {
      const subido = await uploadChatMedia(leadId, file)
      setPendingMedia((atuais) => [...atuais, { ...subido, kind: 'audio', caption: '', uploading: false }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao anexar o áudio gravado.')
    }
  }

  // ── Reações ────────────────────────────────────────────────────────────────
  const recarregarReacoes = async () => {
    if (!isSupabaseConfigured) return
    setReactions(await loadReactionsForLead(leadId))
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !leadId) return
    let vivo = true
    void loadReactionsForLead(leadId).then((linhas) => {
      if (vivo) setReactions(linhas)
    })
    return () => {
      vivo = false
    }
  }, [leadId, history.length])

  useEffect(() => {
    const pendentes = history
      .flatMap((m) => m.media ?? [])
      .filter((m) => m.storagePath && !m.url && !signedUrls[m.id])
    if (pendentes.length === 0) return
    let vivo = true
    void (async () => {
      const novos: Record<string, string> = {}
      for (const item of pendentes) {
        const url = await signedMediaUrl(item.storagePath as string)
        if (url) novos[item.id] = url
      }
      if (vivo && Object.keys(novos).length) setSignedUrls((atuais) => ({ ...atuais, ...novos }))
    })()
    return () => {
      vivo = false
    }
  }, [history, signedUrls])

  /** As reações de UMA mensagem, agrupadas por emoji (como no WhatsApp). */
  const reacoesDe = (msg: Interaction) => {
    const chave = msg.externalMessageId
    if (!chave) return []
    // Duas fontes: as que vieram junto com a interaction e as carregadas à parte. Ler só
    // uma delas fazia a reação aparecer numa tela e não noutra.
    const lista = [
      ...reactions.filter((r) => r.externalMessageId === chave),
      ...(msg.reactions ?? []).map((r) => ({
        externalMessageId: chave,
        emoji: r.emoji,
        direction: r.direction,
        author: r.author,
        interactionId: msg.id,
      })),
    ]
    const porEmoji = new Map<string, { emoji: string; total: number; minha: boolean }>()
    const vistos = new Set<string>()
    for (const r of lista) {
      // Mesma pessoa + mesmo emoji conta uma vez, venha de onde vier.
      const id = `${r.direction}:${r.author}:${r.emoji}`
      if (vistos.has(id)) continue
      vistos.add(id)
      const atual = porEmoji.get(r.emoji) ?? { emoji: r.emoji, total: 0, minha: false }
      atual.total += 1
      if (r.direction === 'out') atual.minha = true
      porEmoji.set(r.emoji, atual)
    }
    return [...porEmoji.values()]
  }

  const alternarReacao = async (msg: Interaction, emoji: string) => {
    if (!msg.externalMessageId) {
      toast.error('Esta mensagem não tem id do WhatsApp — não dá para reagir a ela.')
      return
    }
    const jaMinha = reacoesDe(msg).find((r) => r.minha && r.emoji === emoji)
    setReactingId(msg.id)
    try {
      const res = jaMinha ? await removeMessageReaction(msg.id) : await reactToMessage(msg.id, emoji)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      await recarregarReacoes()
    } finally {
      setReactingId(null)
    }
  }

  // ── Seleção de várias mensagens ────────────────────────────────────────────
  const alternarSelecao = (id: string) => {
    setSelectedIds((atuais) =>
      atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id],
    )
  }

  const sairDaSelecao = () => {
    setSelectionMode(false)
    setSelectedIds([])
  }

  const entrarNaSelecao = (msg: Interaction) => {
    setSelectionMode(true)
    setSelectedIds([msg.id])
  }

  const copiarSelecionadas = async () => {
    const texto = (mensagensSelecionadas.length ? mensagensSelecionadas : [])
      .slice()
      .sort((a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime())
      .map((m) => {
        const quem = resolveAuthorLabel(m.author, crm.users).nome
        const hora = format(new Date(m.happenedAt), 'dd/MM HH:mm', { locale: ptBR })
        return `[${hora}] ${quem}: ${m.content}`
      })
      .join('\n')
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(
        mensagensSelecionadas.length === 1 ? 'Mensagem copiada.' : `${mensagensSelecionadas.length} mensagens copiadas.`,
      )
    } catch {
      toast.error('O navegador não deixou copiar. Selecione o texto à mão.')
    }
  }

  const copiarUma = async (msg: Interaction) => {
    try {
      await navigator.clipboard.writeText(msg.content)
      toast.success('Mensagem copiada.')
    } catch {
      toast.error('O navegador não deixou copiar.')
    }
  }

  // ── Encaminhar ─────────────────────────────────────────────────────────────
  /**
   * Reenvia o conteúdo para outras conversas. A W-API não tem rota de encaminhar, então o
   * que sai é uma mensagem nova com o mesmo conteúdo — mídia pelo `mediaItemId`, para os
   * bytes não irem e voltarem pelo browser.
   */
  const encaminhar = async (destinos: string[]) => {
    if (destinos.length === 0) return
    const mensagens = mensagensSelecionadas.length
      ? mensagensSelecionadas
      : forwardTarget
        ? [forwardTarget]
        : []
    if (mensagens.length === 0) return
    setForwarding(true)
    let enviadas = 0
    let falhas = 0
    try {
      for (const destinoId of destinos) {
        const destino = crm.leads.find((l) => l.id === destinoId)
        if (!destino) continue
        // Ordem cronológica: encaminhar três mensagens fora de ordem conta outra história.
        const ordenadas = mensagens
          .slice()
          .sort((a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime())
        for (const msg of ordenadas) {
          const midia = (msg.media ?? []).map((m) => ({ mediaItemId: m.id, caption: m.caption || undefined }))
          // Texto de bolha que era só marcador de mídia ("📷 Foto") não se reenvia como
          // texto — a mídia já vai, e o marcador viraria uma mensagem estranha sozinha.
          const soMarcador = midia.length > 0 && isMediaOnlyLabel(msg.content)
          const res = await sendWhatsappMessage({
            leadId: destino.id,
            to: destino.phone,
            text: soMarcador ? '' : msg.content,
            media: midia.length ? midia : undefined,
            forwardedFromId: msg.id,
          })
          if (res.ok) enviadas += 1
          else {
            falhas += 1
            notifySendError(res, 'manual')
          }
        }
      }
      if (enviadas > 0) {
        toast.success(
          enviadas === 1 ? 'Mensagem encaminhada.' : `${enviadas} mensagens encaminhadas.`,
          falhas > 0 ? { description: `${falhas} não saíram.` } : undefined,
        )
      }
      setForwardOpen(false)
      setForwardTarget(null)
      sairDaSelecao()
      await crm.refreshChatFromSupabase?.()
    } finally {
      setForwarding(false)
    }
  }

  const insertEmojiIntoDraft = (emoji: string) => {
    if (showAiResponding) return
    const el = draftTextareaRef.current
    if (!el) {
      setDraftMessage((prev) => prev + emoji)
      return
    }
    const start = el.selectionStart ?? draftMessage.length
    const end = el.selectionEnd ?? start
    const before = draftMessage.slice(0, start)
    const after = draftMessage.slice(end)
    setDraftMessage(before + emoji + after)
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
      toast.error('Arquivo muito grande. Use uma figurinha até ~350 KB.')
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
        // Mídia que saiu pelo CRM vive no bucket privado: o link assinado é resolvido no
        // efeito acima e chega aqui pelo id.
        if (item.storagePath && signedUrls[item.id]) return signedUrls[item.id]
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
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => openMedia({ ...item, url: src }, 'image/jpeg')}
                    aria-label={item.caption ? `Abrir imagem: ${item.caption}` : 'Abrir imagem em nova aba'}
                    className="block h-auto w-full rounded-none border-0 p-0 hover:bg-transparent"
                  >
                    <img
                      src={src}
                      alt={item.caption || 'Foto'}
                      className="max-h-64 w-full object-cover transition-opacity hover:opacity-90"
                    />
                  </Button>
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
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  onClick={() => openMedia({ ...item, url: src }, 'application/octet-stream')}
                  className="h-auto w-full justify-start gap-3 whitespace-normal rounded-lg bg-black/5 p-2 text-left font-normal transition-colors hover:bg-black/10 hover:text-inherit dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-500">
                    <FileIcon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate text-sm font-semibold">{item.caption || 'Documento'}</span>
                    <span className="text-[10px] uppercase opacity-60">Clique para abrir</span>
                  </div>
                </Button>
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
            <Icon className="h-5 w-5" aria-hidden />
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
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1 py-0.5 sm:gap-2 sm:py-2">
        {hasWaInstagramMerge ? (
          <Badge variant="secondary" className="max-w-full shrink truncate rounded-lg px-2 py-0.5 text-[10px] font-normal sm:text-xs">
            IG → WhatsApp vinculado
          </Badge>
        ) : null}
        {hasMultipleChannels ? (
          <div className="inline-flex shrink-0 items-center rounded-lg bg-muted/60 p-0.5" role="group" aria-label="Filtrar por canal">
            {([
              { id: 'all', label: 'Tudo' },
              { id: 'whatsapp', label: 'WhatsApp' },
              { id: 'meta', label: 'Instagram' },
            ] as const).map((channel) => (
              <Button
                key={channel.id}
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={filter === channel.id}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium',
                  filter === channel.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
                onClick={() => setFilter(channel.id)}
              >
                {channel.label}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {showForceAiButton || forceAiHumanBlocked ? (
          <Button
            type="button"
            size="sm"
            variant={forceAiHumanBlocked ? 'outline' : 'secondary'}
            className="h-7 gap-1 rounded-lg px-2 text-[10px] sm:h-8 sm:px-2.5 sm:text-xs"
            disabled={forceAiLoading}
            title={
              forceAiHumanBlocked
                ? 'Conversa em modo Humano. Mude o atendimento para Misto para a IA responder.'
                : 'Gera e envia outra resposta com base na última mensagem do paciente (ignora limites de ritmo da IA).'
            }
            onClick={() => {
              if (forceAiHumanBlocked) {
                toast.message('Conversa em modo Humano.', {
                  description: 'Mude o atendimento para Misto (ou IA) para a IA dar continuidade.',
                })
                return
              }
              void handleForceAiReply()
            }}
          >
            <RefreshCw className={cn('h-3 w-3 shrink-0', forceAiLoading && 'animate-spin')} aria-hidden />
            <span className="hidden sm:inline">Pedir IA de novo</span>
            <span className="sm:hidden">IA</span>
          </Button>
        ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'h-7 gap-1 rounded-lg px-2 text-[10px] sm:h-8 sm:px-2.5 sm:text-xs',
              )}
              title="Exportar o histórico desta conversa (PDF, CSV ou texto)"
            >
              <Download className="h-3 w-3 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Exportar</span>
              <span className="sr-only sm:hidden">Exportar conversa</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => handleExport('pdf')}>
                <FileText className="mr-2 h-3.5 w-3.5" aria-hidden />
                PDF (imprimir/salvar)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <FileSpreadsheet className="mr-2 h-3.5 w-3.5" aria-hidden />
                CSV (Excel)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('txt')}>
                <FileType className="mr-2 h-3.5 w-3.5" aria-hidden />
                Texto (.txt)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                {items.length} mensagem{items.length === 1 ? '' : 's'}
                {filter === 'all' ? '' : ' (só o canal filtrado)'} · inclui a ficha de cadastro
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Barra do modo de seleção: substitui a régua de ações enquanto há mensagens
          marcadas, como no WhatsApp. Fora do modo, não ocupa espaço nenhum. */}
      {selectionMode ? (
        <div className="flex shrink-0 items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={sairDaSelecao}
              title="Sair da seleção"
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">Sair da seleção</span>
            </Button>
            <span className="text-xs font-medium tabular-nums">
              {selectedIds.length} selecionada{selectedIds.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={selectedIds.length === 0}
              onClick={() => void copiarSelecionadas()}
            >
              <Copy className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Copiar</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setForwardTarget(null)
                setForwardOpen(true)
              }}
            >
              <Forward className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Encaminhar</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
              disabled={selectedIds.length === 0}
              onClick={() => void apagarSelecionadas()}
            >
              <Trash2 className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Esconder do CRM</span>
            </Button>
          </div>
        </div>
      ) : null}

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
            <li>
              <EmptyState icon={MessageCircle} title="Nenhuma mensagem encontrada" />
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
                  <div className="flex w-full max-w-[min(92%,28rem)] flex-col gap-2.5 sm:max-w-[min(85%,32rem)] lg:max-w-[75%]">
                    {group.map((msg, mIdx) => {
                      const apagada = Boolean(msg.deletedAt)
                      const citada = msg.replyToExternalId ? porIdExterno.get(msg.replyToExternalId) : undefined
                      const minhasReacoes = reacoesDe(msg)
                      const selecionada = selectedIds.includes(msg.id)
                      return (
                      <div
                        key={msg.id}
                        onClick={selectionMode ? () => alternarSelecao(msg.id) : undefined}
                        className={cn(
                          'group/msg relative rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm transition-all',
                          out
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card text-foreground border border-border/50 dark:bg-[#202c33] dark:text-white/95 dark:border-white/5',
                          out ? (mIdx === 0 ? 'rounded-tr-none' : '') : (mIdx === 0 ? 'rounded-tl-none' : ''),
                          canCompose && !selectionMode && out && 'pr-9',
                          canCompose && !selectionMode && !out && 'pl-9',
                          selectionMode && 'cursor-pointer',
                          selecionada && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                          apagada && 'opacity-70',
                        )}
                      >
                        {selectionMode ? (
                          <span
                            aria-hidden
                            className={cn(
                              'absolute top-2 flex size-4 items-center justify-center rounded-[4px] border',
                              out ? 'right-1.5 border-primary-foreground/60' : 'left-1.5 border-muted-foreground/60',
                              selecionada && (out ? 'bg-primary-foreground/90' : 'bg-primary'),
                            )}
                          >
                            {selecionada ? (
                              <CheckCircle2
                                className={cn('size-3', out ? 'text-primary' : 'text-primary-foreground')}
                              />
                            ) : null}
                          </span>
                        ) : null}

                        {canCompose && !selectionMode ? (
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
                              <MoreVertical className="h-4 w-4" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={out ? 'end' : 'start'} className="min-w-52">
                              {/* Reação rápida: a fila de emojis que o WhatsApp põe no topo
                                  do menu. Reagir com o mesmo emoji de novo tira a reação. */}
                              {!apagada && msg.externalMessageId ? (
                                <div className="flex items-center gap-0.5 px-1 pb-1">
                                  {REACOES_RAPIDAS.map((em) => (
                                    <Button
                                      key={em}
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      disabled={reactingId === msg.id}
                                      className={cn(
                                        'size-8 rounded-full text-base font-normal leading-none hover:bg-muted',
                                        minhasReacoes.some((r) => r.minha && r.emoji === em) && 'bg-primary/15',
                                      )}
                                      onClick={() => void alternarReacao(msg, em)}
                                      title={`Reagir com ${em}`}
                                    >
                                      {em}
                                    </Button>
                                  ))}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger
                                      type="button"
                                      className={cn(
                                        buttonVariants({ variant: 'ghost', size: 'icon' }),
                                        'size-8 rounded-full',
                                      )}
                                      title="Outro emoji"
                                    >
                                      <SmilePlus className="size-4" aria-hidden />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align={out ? 'end' : 'start'}
                                      className="w-auto max-w-[min(100vw-2rem,22rem)] p-2"
                                    >
                                      <EmojiPicker onPick={(em) => void alternarReacao(msg, em)} />
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              ) : null}
                              {!apagada && msg.externalMessageId ? <DropdownMenuSeparator /> : null}

                              {!apagada && msg.externalMessageId ? (
                                <DropdownMenuItem onClick={() => setReplyTarget(msg)}>
                                  <Reply className="size-4" aria-hidden />
                                  Responder
                                </DropdownMenuItem>
                              ) : null}
                              {!apagada ? (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setForwardTarget(msg)
                                    setSelectedIds([])
                                    setForwardOpen(true)
                                  }}
                                >
                                  <Forward className="size-4" aria-hidden />
                                  Encaminhar
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem onClick={() => entrarNaSelecao(msg)}>
                                <CheckSquare className="size-4" aria-hidden />
                                Selecionar
                              </DropdownMenuItem>
                              {!apagada && msg.content ? (
                                <DropdownMenuItem onClick={() => void copiarUma(msg)}>
                                  <Copy className="size-4" aria-hidden />
                                  Copiar texto
                                </DropdownMenuItem>
                              ) : null}
                              {canEditOutboundText(msg) && !apagada ? (
                                <DropdownMenuItem onClick={() => openEditDialog(msg)}>
                                  <Pencil className="size-4" aria-hidden />
                                  Editar texto
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuSeparator />
                              {!apagada && msg.externalMessageId ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => pedirApagar(msg, 'everyone')}
                                >
                                  <Ban className="size-4" aria-hidden />
                                  Apagar no WhatsApp
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => pedirApagar(msg, 'crm')}
                              >
                                <Trash2 className="size-4" aria-hidden />
                                Esconder do CRM
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}

                        {/* Encaminhada: sem este selo, daqui a um mês ninguém sabe que
                            aquele texto não foi escrito nesta conversa. */}
                        {msg.forwardedFromId && !apagada ? (
                          <span
                            className={cn(
                              'mb-1 flex items-center gap-1 text-[10px] italic',
                              out ? 'text-primary-foreground/70' : 'text-muted-foreground',
                            )}
                          >
                            <Forward className="size-3" aria-hidden />
                            Encaminhada
                          </span>
                        ) : null}

                        {/* A mensagem CITADA, dentro da bolha — é o que faz um "pode ser"
                            continuar a fazer sentido três dias depois. */}
                        {citada && !apagada ? (
                          <div
                            className={cn(
                              'mb-1.5 flex flex-col gap-0.5 rounded-md border-l-2 px-2 py-1 text-[11px]',
                              out
                                ? 'border-primary-foreground/70 bg-primary-foreground/20 text-primary-foreground'
                                : 'border-primary/50 bg-muted/60 text-muted-foreground dark:bg-white/5',
                            )}
                          >
                            <span className="font-semibold">
                              {resolveAuthorLabel(citada.author, crm.users).nome}
                            </span>
                            <span className="line-clamp-2">{citada.content}</span>
                          </div>
                        ) : null}

                        {apagada ? (
                          <span
                            className={cn(
                              'flex items-center gap-1.5 italic',
                              out ? 'text-primary-foreground/70' : 'text-muted-foreground',
                            )}
                          >
                            <Ban className="size-3.5" aria-hidden />
                            {msg.deletedScope === 'everyone'
                              ? 'Esta mensagem foi apagada'
                              : 'Mensagem escondida do CRM'}
                          </span>
                        ) : (
                          renderContent(msg)
                        )}

                        {msg.editedAt && !apagada ? (
                          <span
                            className={cn(
                              'mt-0.5 block text-[10px] italic',
                              out ? 'text-primary-foreground/60' : 'text-muted-foreground/70',
                            )}
                          >
                            editada
                          </span>
                        ) : null}

                        {/* Reações: ficam POR FORA da bolha, agarradas ao canto de baixo,
                            como no WhatsApp — dentro, empurrariam o texto. */}
                        {minhasReacoes.length > 0 ? (
                          <div
                            className={cn(
                              'absolute -bottom-3 flex items-center gap-0.5',
                              out ? 'right-2' : 'left-2',
                            )}
                          >
                            {minhasReacoes.map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                disabled={!canCompose || reactingId === msg.id}
                                onClick={() => void alternarReacao(msg, r.emoji)}
                                title={r.minha ? 'Tirar a sua reação' : 'Reagir também'}
                                className={cn(
                                  'flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[11px] leading-none shadow-sm transition-colors',
                                  r.minha ? 'border-primary/60' : 'border-border',
                                  canCompose && 'hover:bg-muted',
                                )}
                              >
                                <span>{r.emoji}</span>
                                {r.total > 1 ? (
                                  <span className="text-[9px] text-muted-foreground">{r.total}</span>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      )
                    })}
                  </div>
                  
                  <div className={cn(
                    "flex items-center gap-2 px-1 mt-1 text-[10px] font-medium tracking-tight",
                    out ? "flex-row-reverse text-muted-foreground/80" : "text-muted-foreground/60"
                  )}>
                    {(() => {
                      const label = resolveAuthorLabel(first.author, crm.users)
                      return (
                        <span
                          className="max-w-[130px] truncate"
                          title={label.detalhe || undefined}
                        >
                          {label.nome}
                          {label.compartilhada ? (
                            <span className="ml-1 opacity-60" aria-label="conta compartilhada da equipe">
                              (equipe)
                            </span>
                          ) : null}
                        </span>
                      )
                    })()}
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
              <CalendarPlus className="mr-2 h-4 w-4" aria-hidden />
              Agendar consulta
            </Button>
          </div>
        ) : null}

        {canCompose && isActiveLead ? (
          <div className="flex shrink-0 flex-col gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            {/* A quem esta mensagem responde. Fica acima da caixa, com o X para desistir —
                é o único sítio onde a citação é visível ANTES de a mensagem sair. */}
            {replyTarget ? (
              <div className="flex items-start gap-2 rounded-xl border-l-2 border-primary bg-muted/50 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] font-semibold text-primary">
                    Respondendo a {resolveAuthorLabel(replyTarget.author, crm.users).nome}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{replyTarget.content}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  onClick={() => setReplyTarget(null)}
                  title="Cancelar resposta"
                >
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">Cancelar resposta</span>
                </Button>
              </div>
            ) : null}

            <AttachmentTray
              itens={pendingMedia}
              onRemove={removerAnexo}
              onCaption={definirLegenda}
              disabled={sending}
            />

            <Textarea
              id={`lead-chat-draft-${leadId}`}
              ref={draftTextareaRef}
              rows={1}
              value={draftMessage}
              readOnly={showAiResponding}
              onChange={(e) => {
                const val = e.target.value
                setDraftMessage(val)
                
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
                  setDraftMessage(val.replace('/agendar ', ''))
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
                      const lastSlashIdx = draftMessage.lastIndexOf('/')
                      const before = draftMessage.slice(0, lastSlashIdx)
                      setDraftMessage(before + msg.content)
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
                  if (!draftMessage.trim() && draftAttachments.length === 0) return
                  void handleSend()
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
              <div className="absolute bottom-full left-0 mb-2 w-full max-w-sm z-50 rounded-xl border border-border bg-popover shadow-sm overflow-hidden">
                <div className="px-3 py-2 border-b border-border bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground">Mensagens Rápidas</span>
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {filteredQuick.map((m, idx) => (
                    <Button
                      key={m.id}
                      type="button"
                      variant="ghost"
                      className={cn(
                        "h-auto w-full flex-col items-start gap-0 whitespace-normal rounded-lg px-3 py-2 text-left font-normal transition-colors",
                        idx === selectedQuickIdx
                          ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                          : "hover:bg-muted"
                      )}
                      onClick={() => {
                        const lastSlashIdx = draftMessage.lastIndexOf('/')
                        const before = draftMessage.slice(0, lastSlashIdx)
                        setDraftMessage(before + m.content)
                        setShowQuickMenu(false)
                        draftTextareaRef.current?.focus()
                      }}
                    >
                      <span className={cn("text-xs font-bold", idx === selectedQuickIdx ? "text-white" : "text-foreground")}>{m.title}</span>
                      <span className={cn("text-[10px] line-clamp-1", idx === selectedQuickIdx ? "text-white/80" : "text-muted-foreground")}>{m.content}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {/* No celular estas ações são só ícone. Escritas por extenso, "Anexar",
                "Agendar" e "Reenviar Bling" estouravam os 375px e quebravam para uma
                segunda linha: o compositor comia 142px dos 812 numa tela feita para ler
                a conversa. O title/sr-only de cada botão mantém o significado. */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <label
                  title="Anexar arquivo"
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:px-3"
                >
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                    className="sr-only"
                    onChange={(e) => {
                      void handleAttachFiles(e.target.files)
                      // Limpa o input: sem isto, escolher o MESMO ficheiro duas vezes
                      // seguidas não dispara o onChange e o anexo não entra.
                      e.target.value = ''
                    }}
                  />
                  <Paperclip className="size-4 shrink-0 sm:hidden" aria-hidden />
                  {pendingMedia.length > 0 ? (
                    <span className="tabular-nums">{pendingMedia.length}</span>
                  ) : null}
                  <span className="hidden sm:inline">
                    {pendingMedia.length > 0 ? 'arquivos' : 'Anexar'}
                  </span>
                  <span className="sr-only sm:hidden">Anexar arquivo</span>
                </label>
                <input
                  ref={stickerInputRef}
                  type="file"
                  accept=".webp,image/webp"
                  className="sr-only"
                  aria-label="Escolher figurinha WebP"
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
                  <Sticker className="h-4 w-4" aria-hidden />
                  <span className="sr-only">Enviar figurinha WebP</span>
                </Button>
                <AudioRecorder onRecorded={(f) => void anexarAudioGravado(f)} disabled={showAiResponding || sending} />
                {/* O "+" do WhatsApp: as mensagens que não são texto nem ficheiro. Cada
                    uma tem rota própria na W-API — o endereço escrito no texto não abre
                    o mapa no telemóvel de quem recebe, e é isso que a paciente precisa. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    type="button"
                    disabled={showAiResponding || sending}
                    title="Localização, contato, enquete, Pix, link"
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'sm' }),
                      'h-8 rounded-lg px-2 text-[10px]',
                    )}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Enviar localização, contato, enquete, Pix ou link</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-auto min-w-48">
                    <DropdownMenuItem onClick={() => setSpecialKind('location')}>
                      <MapPin className="size-4" aria-hidden />
                      Localização
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSpecialKind('contact')}>
                      <Contact className="size-4" aria-hidden />
                      Contato
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSpecialKind('poll')}>
                      <BarChart3 className="size-4" aria-hidden />
                      Enquete
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSpecialKind('pix')}>
                      <QrCode className="size-4" aria-hidden />
                      Chave Pix
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSpecialKind('link')}>
                      <Link2 className="size-4" aria-hidden />
                      Link com prévia
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                    <Smile className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Emojis</span>
                  </DropdownMenuTrigger>
                  {/* `w-auto` é obrigatório: o DropdownMenuContent nasce com
                      `w-(--anchor-width)` e, ancorado num botão de 32px, o seletor abria
                      com 32px de largura — tecnicamente aberto, visualmente invisível. */}
                  <DropdownMenuContent align="start" className="w-auto max-w-[min(100vw-2rem,22rem)] p-2">
                    <EmojiPicker onPick={insertEmojiIntoDraft} />
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
                      <span className="text-xs font-medium text-muted-foreground">
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
                            const current = draftMessage
                            const next = current ? `${current}${current.endsWith(' ') ? '' : ' '}${m.content}` : m.content
                            setDraftMessage(next)
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
                      title="Gerar link de pagamento (Pix ou cartão) · Rede"
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'sm' }),
                        'h-8 rounded-lg px-2 text-[10px]',
                      )}
                    >
                      <CreditCard className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden />
                      {pagbankLoading ? 'Gerando…' : 'Link pagamento'}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(Object.keys(PAGBANK_KIT_LABELS) as PagbankKit[]).map((kit) => (
                        <DropdownMenuItem key={kit} onClick={() => void handleGenerateRede(kit)}>
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
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 sm:mr-1.5" aria-hidden />
                    <span className="hidden sm:inline">Confirmar venda</span>
                    <span className="sr-only sm:hidden">Confirmar venda</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Gerar envio no Melhor Envio (carrinho ou etiqueta)"
                    className="h-8 rounded-lg px-2 text-[10px]"
                    onClick={() => navigate(`/leads/${leadId}/envio`)}
                  >
                    <Truck className="h-3.5 w-3.5 shrink-0 text-primary sm:mr-1.5" aria-hidden />
                    <span className="hidden sm:inline">Gerar envio</span>
                    <span className="sr-only sm:hidden">Gerar envio</span>
                  </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg px-2 text-[10px]"
                    title="Agendar consulta"
                    onClick={() => setIsScheduleOpen(true)}
                  >
                    <CalendarPlus className="h-3.5 w-3.5 shrink-0 text-primary sm:mr-1.5" aria-hidden />
                    <span className="hidden sm:inline">Agendar</span>
                    <span className="sr-only sm:hidden">Agendar consulta</span>
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
                  <RefreshCw className={cn('h-3.5 w-3.5 shrink-0 text-primary sm:mr-1.5', retryingBling && 'animate-spin')} aria-hidden />
                  <span className="hidden sm:inline">{retryingBling ? 'Enviando…' : 'Reenviar Bling'}</span>
                  <span className="sr-only sm:hidden">Relançar venda no Bling</span>
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-xl px-5"
                disabled={
                  showAiResponding ||
                  sending ||
                  pendingMedia.some((m) => m.uploading) ||
                  // Mídia sozinha é mensagem. Exigir texto era o que obrigava a escrever
                  // "segue a foto" só para poder mandar a foto.
                  (!draftMessage.trim() && draftAttachments.length === 0 && pendingMedia.length === 0)
                }
                onClick={() => void handleSend()}
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
              {editSaving ? 'Salvando…' : 'Salvar'}
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
        title={deleteMsgScope === 'everyone' ? 'Apagar no WhatsApp da pessoa?' : 'Esconder do histórico do CRM?'}
        description={
          deleteMsgScope === 'everyone'
            ? 'A mensagem some do WhatsApp dos dois lados, como o "apagar para todos" do telemóvel. O WhatsApp só permite por um tempo depois do envio; passado esse prazo, ele recusa e a mensagem fica. No CRM a bolha vira "esta mensagem foi apagada".'
            : 'A bolha passa a aparecer como escondida aqui no CRM, e mais nada: a mensagem continua no aparelho da pessoa. Para tirá-la de lá, use "Apagar no WhatsApp".'
        }
        confirmLabel={deleteMsgScope === 'everyone' ? 'Apagar no WhatsApp' : 'Esconder'}
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => void runDeleteMessage()}
      />

      <SpecialMessageDialog
        key={specialKind ?? 'nenhum'}
        kind={specialKind}
        onClose={() => setSpecialKind(null)}
        onSend={(m) => void enviarEspecial(m)}
        enviando={sending}
        nomeDoPolo={tenant.name}
      />

      <ForwardDialog
        open={forwardOpen}
        onOpenChange={(aberto) => {
          setForwardOpen(aberto)
          if (!aberto) setForwardTarget(null)
        }}
        quantidade={forwardTarget ? 1 : selectedIds.length}
        destinos={destinosDeEncaminhamento}
        enviando={forwarding}
        onConfirm={(ids) => void encaminhar(ids)}
      />

      <ScheduleAppointmentDialog
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        leadId={leadId}
        onScheduledMessage={setDraftMessage}
      />
    </div>
  )
}
