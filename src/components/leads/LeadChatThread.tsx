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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={onlyWa ? 'default' : 'outline'}
          className="rounded-lg"
          onClick={() => setOnlyWa(true)}
          aria-pressed={onlyWa}
        >
          Só WhatsApp
        </Button>
        <Button
          type="button"
          size="sm"
          variant={!onlyWa ? 'default' : 'outline'}
          className="rounded-lg"
          onClick={() => setOnlyWa(false)}
          aria-pressed={!onlyWa}
        >
          Todas as conversas
        </Button>
      </div>

      <ScrollArea className="min-h-[12rem] flex-1 rounded-xl border border-border/70 bg-[#0b141a] p-3 shadow-inner">
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
                  className={cn('flex max-w-[min(100%,20rem)] flex-col gap-0.5 transition-all duration-200', out ? 'ml-auto items-end' : 'mr-auto items-start')}
                >
                  <div
                    className={cn(
                      'rounded-xl px-3 py-2 text-sm shadow-sm',
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
            Mensagem para o cliente
          </label>
          <Textarea
            id={`lead-chat-draft-${leadId}`}
            rows={2}
            value={crm.draftMessage}
            onChange={(e) => crm.setDraftMessage(e.target.value)}
            placeholder="Digite uma mensagem de saída…"
            className="resize-none rounded-xl border-border/70 bg-background"
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
          <Button type="button" className="self-end rounded-xl" onClick={() => void crm.sendMessage()}>
            Enviar
          </Button>
        </div>
      ) : null}
    </div>
  )
}
