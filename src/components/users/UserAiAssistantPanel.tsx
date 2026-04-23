import { useCallback, useRef, useState } from 'react'
import { Bot, SendHorizonal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NoticeBanner, noticeVariantFromMessage } from '@/components/NoticeBanner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { GLM_MODEL_OPTIONS, type GlmModelId, type UserAiChatMessage, invokeUserAiAssistant } from '@/services/userAiAssistant'

const DEFAULT_MODEL: GlmModelId = 'glm-4.7'

const INTRO_USER: UserAiChatMessage = {
  role: 'user',
  content:
    'Olá. Em uma frase, como você pode me ajudar a gerir utilizadores e papéis neste CRM?',
}

type Props = {
  dataMode: 'mock' | 'supabase'
}

export function UserAiAssistantPanel({ dataMode }: Props) {
  const [model, setModel] = useState<GlmModelId>(DEFAULT_MODEL)
  const [messages, setMessages] = useState<UserAiChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const scrollToEnd = useCallback(() => {
    queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }, [])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return

      const nextUser: UserAiChatMessage = { role: 'user', content: trimmed }
      const history = [...messages, nextUser]
      setMessages(history)
      setDraft('')
      setNotice('')
      setLoading(true)
      scrollToEnd()

      const result = await invokeUserAiAssistant({ messages: history, model })

      setLoading(false)
      if (!result.ok) {
        setMessages((prev) => prev.slice(0, -1))
        setNotice([result.error, result.detail].filter(Boolean).join(' — '))
        scrollToEnd()
        return
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }])
      scrollToEnd()
    },
    [loading, messages, model, scrollToEnd]
  )

  const startConversation = useCallback(() => {
    if (loading) return
    void send(INTRO_USER.content)
  }, [loading, send])

  if (dataMode !== 'supabase') {
    return (
      <Card className="border-border shadow-none rounded-none bg-muted/10">
        <CardHeader>
          <CardTitle className="text-base font-bold uppercase tracking-widest">Assistente IA (equipa)</CardTitle>
          <CardDescription>
            Ative <code className="text-xs">VITE_DATA_MODE=supabase</code>, publique a função{' '}
            <code className="text-xs">user-ai-assistant</code> e defina o secret <code className="text-xs">ZAI_API_KEY</code> no
            Supabase para usar modelos GLM da Z.ai.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="border-border shadow-none rounded-none bg-card">
      <CardHeader className="space-y-1 border-b border-border/50 bg-muted/10 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg font-bold uppercase tracking-widest">
          <Bot className="size-5 text-primary" />
          Assistente IA — utilizadores
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          Modelos <strong className="text-foreground">GLM (Z.ai)</strong> via API compatível. A lista de equipa é enviada pelo
          servidor (Edge Function); a chave <code className="text-[10px]">ZAI_API_KEY</code> não fica no browser.
        </CardDescription>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Modelo</span>
            <Select value={model} onValueChange={(v) => v && setModel(v as GlmModelId)}>
              <SelectTrigger size="sm" className="w-[min(100%,11rem)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GLM_MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-none text-[10px] font-bold uppercase tracking-widest"
            disabled={loading}
            onClick={startConversation}
          >
            {messages.length === 0 ? 'Iniciar conversa' : 'Repetir pergunta inicial'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {notice ? <NoticeBanner message={notice} variant={noticeVariantFromMessage(notice)} className="rounded-none" /> : null}

        <ScrollArea className="h-[min(22rem,50vh)] rounded-md border border-border bg-muted/20 p-3">
          <ul className="m-0 list-none space-y-3 p-0">
            {messages.map((m, i) => (
              <li
                key={`${i}-${m.role}`}
                className={
                  m.role === 'user'
                    ? 'ml-6 rounded-md border border-border bg-background px-3 py-2 text-sm'
                    : 'mr-6 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm'
                }
              >
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {m.role === 'user' ? 'Você' : 'GLM'}
                </span>
                <p className="m-0 whitespace-pre-wrap">{m.content}</p>
              </li>
            ))}
            {loading ? (
              <li className="mr-6 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                A pensar…
              </li>
            ) : null}
            <div ref={endRef} />
          </ul>
        </ScrollArea>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ex.: Que papel recomendas para quem só gere leads no Kanban?"
            className="min-h-[4.5rem] flex-1 rounded-none border-foreground/20"
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(draft)
              }
            }}
          />
          <Button
            type="button"
            className="h-11 shrink-0 rounded-none uppercase tracking-widest font-bold sm:h-auto sm:px-6"
            disabled={loading || !draft.trim()}
            onClick={() => void send(draft)}
          >
            <SendHorizonal className="size-4 sm:mr-2" />
            Enviar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
