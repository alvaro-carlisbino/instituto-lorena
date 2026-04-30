import { useEffect, useMemo, useState, useRef } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { 
  CalendarPlus,
  Video as VideoIcon,
  Music as MusicIcon,
  File as FileIcon,
  Image as ImageIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScheduleAppointmentDialog } from '@/components/leads/ScheduleAppointmentDialog'
import { useCrm } from '@/context/CrmContext'
import {
  isWaInstagramMergeNotice,
  tryConsumeWaInstagramMergeToast,
} from '@/lib/waInstagramMergeNotice'
import { cn } from '@/lib/utils'
import type { Interaction } from '@/mocks/crmMock'

const CHANNEL_SHORT: Record<string, string> = {
  whatsapp: 'WA',
  meta: 'Meta',
  system: 'Sys',
  ai: 'IA',
}

type ChatFilter = 'all' | 'whatsapp' | 'meta'

type Props = {
  leadId: string
  history: Interaction[]
  whatsappOnly?: boolean
  canCompose?: boolean
  readOnlyInstagramHint?: boolean
}

export function LeadChatThread({ leadId, history, whatsappOnly, canCompose, readOnlyInstagramHint }: Props) {
  const crm = useCrm()
  const [filter, setFilter] = useState<ChatFilter>(whatsappOnly ? 'whatsapp' : 'all')
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
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

  const isActiveLead = crm.selectedLeadId === leadId

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
      return (
        <div className="flex flex-col gap-2 py-1">
          {media.map((item) => {
            if (item.type === 'image' && item.base64) {
              return (
                <div key={item.id} className="overflow-hidden rounded-lg border border-border/20">
                  <img 
                    src={`data:${item.mimeType || 'image/jpeg'};base64,${item.base64}`} 
                    alt={item.caption || 'Foto'} 
                    className="max-h-64 w-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => window.open(`data:${item.mimeType || 'image/jpeg'};base64,${item.base64}`, '_blank')}
                  />
                  {item.caption && <p className="mt-1 px-2 pb-1 text-xs opacity-80">{item.caption}</p>}
                </div>
              )
            }
            if (item.type === 'audio' && item.base64) {
              return (
                <div key={item.id} className="flex flex-col gap-1">
                  <audio controls className="h-8 w-full min-w-[200px]">
                    <source src={`data:${item.mimeType || 'audio/ogg'};base64,${item.base64}`} type={item.mimeType || 'audio/ogg'} />
                    Seu navegador não suporta áudio.
                  </audio>
                  <span className="text-[10px] opacity-60 px-1">Áudio recebido</span>
                </div>
              )
            }
            if (item.type === 'document' && item.base64) {
              return (
                <div 
                  key={item.id} 
                  className="flex items-center gap-3 rounded-lg bg-black/5 p-2 transition-colors hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 cursor-pointer"
                  onClick={() => {
                    const link = document.createElement('a')
                    link.href = `data:${item.mimeType || 'application/octet-stream'};base64,${item.base64}`
                    link.download = item.caption || 'documento'
                    link.click()
                  }}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-500">
                    <FileIcon className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate text-sm font-semibold">{item.caption || 'Documento'}</span>
                    <span className="text-[10px] uppercase opacity-60">Clique para baixar</span>
                  </div>
                </div>
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
      </div>

      {/* Message History */}
      <div
        ref={scrollRef}
        role="log"
        className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overscroll-contain rounded-xl border border-border/20 bg-muted/10 p-4 scrollbar-thin scrollbar-thumb-border/30 dark:bg-[#0b141a]/50"
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
                <li
                  key={`group-${gIdx}`}
                  className={cn(
                    'flex w-full flex-col gap-1',
                    out ? 'items-end' : 'items-start',
                  )}
                >
                  <div className="flex flex-col gap-1.5 w-full max-w-[85%] sm:max-w-[75%]">
                    {group.map((msg, mIdx) => (
                      <div
                        key={msg.id}
                        className={cn(
                          'relative rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm transition-all',
                          out
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card text-foreground border border-border/50 dark:bg-[#202c33] dark:text-white/95 dark:border-white/5',
                          out ? (mIdx === 0 ? 'rounded-tr-none' : '') : (mIdx === 0 ? 'rounded-tl-none' : '')
                        )}
                      >
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
                    <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider dark:bg-white/5">
                      {CHANNEL_SHORT[first.channel] ?? first.channel}
                    </span>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>

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
              rows={1}
              value={crm.draftMessage}
              onChange={(e) => {
                const val = e.target.value
                crm.setDraftMessage(val)
                if (val.endsWith('/agendar ')) {
                  crm.setDraftMessage(val.replace('/agendar ', ''))
                  setIsScheduleOpen(true)
                }
              }}
              placeholder="Digite sua mensagem..."
              className="min-h-[2.5rem] max-h-[8rem] resize-none rounded-xl border-border/70 bg-background text-sm [field-sizing:content] sm:text-base"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
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
              </div>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-xl px-5"
                disabled={!crm.draftMessage.trim() && crm.draftAttachments.length === 0}
                onClick={() => void crm.sendMessage()}
              >
                Enviar
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ScheduleAppointmentDialog
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        leadId={leadId}
      />
    </div>
  )
}
