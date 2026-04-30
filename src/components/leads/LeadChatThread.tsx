import { useEffect, useMemo, useState, useRef } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarPlus } from 'lucide-react'
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
  /** Se true, inicia o filtro em só WhatsApp (compat). */
  whatsappOnly?: boolean
  canCompose?: boolean
  /** Mostra aviso no lugar do compositor (lead Instagram; envio só fora do CRM até haver WhatsApp). */
  readOnlyInstagramHint?: boolean
}

export function LeadChatThread({ leadId, history, whatsappOnly, canCompose, readOnlyInstagramHint }: Props) {
  const crm = useCrm()
  const [filter, setFilter] = useState<ChatFilter>(whatsappOnly ? 'whatsapp' : 'all')
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [items, leadId])

  const items = useMemo(() => {
    const list = [...history].sort(
      (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
    )
    const withoutMergeNoise = list.filter((m) => !isWaInstagramMergeNotice(m))
    if (filter === 'whatsapp') return withoutMergeNoise.filter((m) => m.channel === 'whatsapp')
    if (filter === 'meta') return withoutMergeNoise.filter((m) => m.channel === 'meta')
    return withoutMergeNoise
  }, [history, filter])

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

  return (
    <>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
        {hasWaInstagramMerge ? (
          <Badge variant="secondary" className="max-w-full shrink truncate rounded-lg px-2 py-1 text-[10px] font-normal sm:text-xs">
            IG → WhatsApp vinculado
          </Badge>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={filter === 'whatsapp' ? 'default' : 'outline'}
          className="h-8 rounded-lg px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
          onClick={() => setFilter('whatsapp')}
          aria-pressed={filter === 'whatsapp'}
        >
          Só WhatsApp
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'meta' ? 'default' : 'outline'}
          className="h-8 rounded-lg px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
          onClick={() => setFilter('meta')}
          aria-pressed={filter === 'meta'}
        >
          Só Instagram
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          className="h-8 rounded-lg px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          Todas
        </Button>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Histórico de mensagens"
        className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overscroll-contain rounded-xl border border-border/20 bg-muted/20 p-4 scrollbar-thin scrollbar-thumb-border/30 dark:bg-[#0b141a]/50"
      >
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {items.length === 0 ? (
            <li className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center opacity-40">
                <span className="text-xl">📥</span>
              </div>
              <p className="text-xs text-muted-foreground font-medium">Nenhuma mensagem neste filtro</p>
            </li>
          ) : (
            items.map((msg) => {
              const out = msg.direction === 'out'
              return (
                <li
                  key={msg.id}
                  className={cn(
                    'flex w-full flex-col gap-1',
                    out ? 'items-end' : 'items-start',
                  )}
                >
                  <div
                    className={cn(
                      'relative max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm sm:max-w-[75%]',
                      out
                        ? 'rounded-tr-none bg-primary text-primary-foreground'
                        : 'rounded-tl-none bg-card text-foreground border border-border/50 dark:bg-[#202c33] dark:text-white/95 dark:border-white/5',
                    )}
                  >
                    <p className="m-0 whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                  <div className={cn(
                    "flex items-center gap-2 px-1 text-[10px] font-medium tracking-tight",
                    out ? "flex-row-reverse text-muted-foreground/80" : "text-muted-foreground/60"
                  )}>
                    <span className="truncate max-w-[100px]">{msg.author}</span>
                    <span className="opacity-30">•</span>
                    <time dateTime={msg.happenedAt}>{format(new Date(msg.happenedAt), 'HH:mm', { locale: ptBR })}</time>
                    <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider dark:bg-white/5">
                      {CHANNEL_SHORT[msg.channel] ?? msg.channel}
                    </span>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>

      <div className="flex shrink-0 flex-col gap-2">
        {readOnlyInstagramHint && isActiveLead ? (
          <div className="flex max-h-[min(32dvh,10rem)] min-h-0 shrink-0 flex-col gap-1.5 overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 sm:max-h-none sm:px-4">
            <p className="m-0 text-sm font-medium text-foreground">Lead do Instagram</p>
            <p className="m-0 text-xs leading-snug text-muted-foreground sm:text-sm sm:leading-relaxed">
              Envio pelo CRM = WhatsApp. Com número sintético ManyChat (888001…), responda no IG/ManyChat. Com número WA
              real, o campo de envio volta aqui.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-0.5 w-fit shrink-0 rounded-xl"
              onClick={() => setIsScheduleOpen(true)}
            >
              <CalendarPlus className="mr-2 h-4 w-4" />
              Agendar consulta
            </Button>
          </div>
        ) : null}

        {canCompose && isActiveLead ? (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border/70 bg-background/60 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-2 sm:gap-3 sm:pb-0 sm:pt-3">
          <label htmlFor={`lead-chat-draft-${leadId}`} className="text-xs font-medium text-muted-foreground sm:text-sm">
            Mensagem para o cliente
          </label>
          <Textarea
            id={`lead-chat-draft-${leadId}`}
            rows={2}
            value={crm.draftMessage}
            onChange={(e) => {
              const val = e.target.value
              crm.setDraftMessage(val)
              if (val.endsWith('/agendar ')) {
                crm.setDraftMessage(val.replace('/agendar ', ''))
                setIsScheduleOpen(true)
              }
            }}
            placeholder="Mensagem..."
            className="min-h-[3.5rem] resize-none rounded-xl border-border/70 bg-background text-sm [field-sizing:content] sm:min-h-[5rem] sm:text-base sm:resize-y"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <input
                type="file"
                multiple
                accept="audio/*,image/*,.pdf,.doc,.docx,.txt"
                className="sr-only"
                onChange={(e) => void handleAttachFiles(e.target.files)}
              />
              Anexar áudio/arquivo
            </label>
            {crm.draftAttachments.length > 0 ? (
              <span className="text-xs text-muted-foreground">{crm.draftAttachments.length} anexo(s) pronto(s)</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex h-9 shrink-0 items-center gap-2 rounded-xl px-2.5 sm:h-10 sm:px-3"
              onClick={() => setIsScheduleOpen(true)}
              title="Agendar consulta"
            >
              <CalendarPlus className="h-4 w-4 text-primary" />
              <span className="hidden min-[400px]:inline">Agendar</span>
            </Button>
            <Button
              type="button"
              className="ml-auto min-h-10 min-w-0 shrink-0 rounded-xl px-5 sm:ml-auto sm:px-6"
              onClick={() => void crm.sendMessage()}
            >
              Enviar
            </Button>
          </div>
        </div>
        ) : null}
      </div>
    </div>
    <ScheduleAppointmentDialog
      isOpen={isScheduleOpen}
      onClose={() => setIsScheduleOpen(false)}
      leadId={leadId}
    />
    </>
  )
}
