import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import { cn } from '@/lib/utils'
import type { Interaction } from '@/mocks/crmMock'

const CHANNEL_SHORT: Record<string, string> = {
  whatsapp: 'WA',
  meta: 'Meta',
  system: 'Sys',
  ai: 'IA',
}

type Props = {
  leadId: string
  history: Interaction[]
  /** Se true, mostra só mensagens cujo canal é WhatsApp. */
  whatsappOnly?: boolean
  canCompose?: boolean
}

export function LeadChatThread({ leadId, history, whatsappOnly, canCompose }: Props) {
  const crm = useCrm()
  const [onlyWa, setOnlyWa] = useState(Boolean(whatsappOnly))

  const items = useMemo(() => {
    const list = [...history].sort(
      (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
    )
    return onlyWa ? list.filter((m) => m.channel === 'whatsapp') : list
  }, [history, onlyWa])

  const isActiveLead = crm.selectedLeadId === leadId

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={onlyWa ? 'default' : 'outline'}
          onClick={() => setOnlyWa(true)}
          aria-pressed={onlyWa}
        >
          Só WhatsApp
        </Button>
        <Button
          type="button"
          size="sm"
          variant={!onlyWa ? 'default' : 'outline'}
          onClick={() => setOnlyWa(false)}
          aria-pressed={!onlyWa}
        >
          Todas as conversas
        </Button>
      </div>

      <ScrollArea className="min-h-[12rem] flex-1 rounded-lg border border-border bg-[#0b141a] p-3">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.length === 0 ? (
            <li className="text-center text-xs text-white/60">Nenhuma mensagem neste filtro.</li>
          ) : (
            items.map((msg) => {
              const out = msg.direction === 'out'
              const wa = msg.channel === 'whatsapp'
              return (
                <li
                  key={msg.id}
                  className={cn('flex max-w-[min(100%,20rem)] flex-col gap-0.5', out ? 'ml-auto items-end' : 'mr-auto items-start')}
                >
                  <div
                    className={cn(
                      'rounded-lg px-3 py-2 text-sm shadow-sm',
                      out
                        ? 'rounded-tr-none bg-[#005c4b] text-white'
                        : 'rounded-tl-none bg-[#202c33] text-white/95',
                      !wa && 'ring-1 ring-white/10',
                    )}
                  >
                    <p className="m-0 whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 px-0.5 text-[10px] text-white/50">
                    <span>{msg.author}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={msg.happenedAt}>{new Date(msg.happenedAt).toLocaleString('pt-BR')}</time>
                    <span className="rounded bg-white/10 px-1 font-medium">{CHANNEL_SHORT[msg.channel] ?? msg.channel}</span>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </ScrollArea>

      {canCompose && isActiveLead ? (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <label htmlFor={`lead-chat-draft-${leadId}`} className="text-xs font-medium text-muted-foreground">
            Mensagem (envio via provider WhatsApp)
          </label>
          <Textarea
            id={`lead-chat-draft-${leadId}`}
            rows={2}
            value={crm.draftMessage}
            onChange={(e) => crm.setDraftMessage(e.target.value)}
            placeholder="Digite uma mensagem de saída…"
            className="resize-none bg-background"
          />
          <Button type="button" className="self-end" onClick={() => void crm.sendMessage()}>
            Enviar
          </Button>
        </div>
      ) : null}
    </div>
  )
}
