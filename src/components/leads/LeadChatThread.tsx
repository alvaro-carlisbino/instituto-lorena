import { useMemo, useState } from 'react'
import { CalendarPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScheduleAppointmentDialog } from '@/components/leads/ScheduleAppointmentDialog'
import { useCrm } from '@/context/CrmContext'
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
}

export function LeadChatThread({ leadId, history, whatsappOnly, canCompose }: Props) {
  const crm = useCrm()
  const [filter, setFilter] = useState<ChatFilter>(whatsappOnly ? 'whatsapp' : 'all')
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)

  const items = useMemo(() => {
    const list = [...history].sort(
      (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
    )
    if (filter === 'whatsapp') return list.filter((m) => m.channel === 'whatsapp')
    if (filter === 'meta') return list.filter((m) => m.channel === 'meta')
    return list
  }, [history, filter])

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
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 sm:gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={filter === 'whatsapp' ? 'default' : 'outline'}
          className="rounded-lg"
          onClick={() => setFilter('whatsapp')}
          aria-pressed={filter === 'whatsapp'}
        >
          Só WhatsApp
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'meta' ? 'default' : 'outline'}
          className="rounded-lg"
          onClick={() => setFilter('meta')}
          aria-pressed={filter === 'meta'}
        >
          Só Instagram / Meta
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          className="rounded-lg"
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          Todas as conversas
        </Button>
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Histórico de mensagens"
        className="min-h-[12rem] w-full min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-muted/35 p-3 shadow-inner sm:min-h-[14rem] dark:bg-[#0b141a]"
      >
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 sm:gap-3">
          {items.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border/60 bg-background/80 px-3 py-8 text-center text-sm text-muted-foreground">
              Nenhuma mensagem neste filtro.
            </li>
          ) : (
            items.map((msg) => {
              const out = msg.direction === 'out'
              return (
                <li
                  key={msg.id}
                  className={cn(
                    'flex w-full max-w-full flex-col gap-0.5 sm:max-w-[min(100%,32rem)]',
                    out ? 'ml-auto items-end' : 'mr-auto items-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-full rounded-xl px-3 py-2.5 text-sm leading-relaxed shadow-sm sm:px-4 sm:text-[0.9375rem]',
                      out
                        ? 'rounded-tr-none bg-primary text-primary-foreground'
                        : 'rounded-tl-none bg-card text-foreground ring-1 ring-border/80 dark:bg-[#202c33] dark:text-white/95 dark:ring-white/10',
                    )}
                  >
                    <p className="m-0 max-w-full whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                  <div className="flex max-w-full flex-wrap items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground dark:text-white/55">
                    <span className="truncate">{msg.author}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={msg.happenedAt}>{new Date(msg.happenedAt).toLocaleString('pt-BR')}</time>
                    <span className="rounded bg-muted px-1 font-medium text-foreground/80 dark:bg-white/10 dark:text-white/90">
                      {CHANNEL_SHORT[msg.channel] ?? msg.channel}
                    </span>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>

      {canCompose && isActiveLead ? (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border/70 bg-background/60 pt-2 sm:gap-3 sm:pt-3">
          <label htmlFor={`lead-chat-draft-${leadId}`} className="text-xs font-medium text-muted-foreground sm:text-sm">
            Mensagem para o cliente
          </label>
          <Textarea
            id={`lead-chat-draft-${leadId}`}
            rows={3}
            value={crm.draftMessage}
            onChange={(e) => {
              const val = e.target.value
              crm.setDraftMessage(val)
              if (val.endsWith('/agendar ')) {
                crm.setDraftMessage(val.replace('/agendar ', ''))
                setIsScheduleOpen(true)
              }
            }}
            placeholder="Digite uma mensagem... (dica: digite /agendar para marcar)"
            className="min-h-[5.5rem] resize-y rounded-xl border-border/70 bg-background text-base sm:min-h-[6rem]"
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
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl flex items-center gap-2 h-10 px-3"
              onClick={() => setIsScheduleOpen(true)}
            >
              <CalendarPlus className="w-4 h-4 text-primary" />
              <span className="hidden sm:inline">Agendar</span>
            </Button>
            <Button type="button" className="rounded-xl h-10 px-6 ml-auto" onClick={() => void crm.sendMessage()}>
              Enviar
            </Button>
          </div>
        </div>
      ) : null}

      <ScheduleAppointmentDialog 
        isOpen={isScheduleOpen} 
        onClose={() => setIsScheduleOpen(false)} 
        leadId={leadId} 
      />
    </div>
  )
}
