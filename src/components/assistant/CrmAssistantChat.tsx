import { useCallback, useRef, useState } from 'react'
import { Bot, SendHorizonal } from 'lucide-react'

import { NoticeBanner } from '@/components/NoticeBanner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AssistantMarkdown } from '@/components/assistant/AssistantMarkdown'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import {
  GLM_MODEL_OPTIONS,
  type CrmAiAssistantContext,
  type CrmAiChatMessage,
  type GlmModelId,
  invokeCrmAiAssistant,
} from '@/services/crmAiAssistant'

const DEFAULT_MODEL: GlmModelId = 'glm-4.7'

type Props = {
  dataMode: 'mock' | 'supabase'
  context: CrmAiAssistantContext
}

export function CrmAssistantChat({ dataMode, context }: Props) {
  const [model, setModel] = useState<GlmModelId>(DEFAULT_MODEL)
  const [messages, setMessages] = useState<CrmAiChatMessage[]>([])
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

      const nextUser: CrmAiChatMessage = { role: 'user', content: trimmed }
      const history = [...messages, nextUser]
      setMessages(history)
      setDraft('')
      setNotice('')
      setLoading(true)
      scrollToEnd()

      const result = await invokeCrmAiAssistant({ messages: history, model, context })

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
    [context, loading, messages, model, scrollToEnd]
  )

  const startConversation = useCallback(() => {
    if (loading) return
    const intro =
      context.leadId != null
        ? 'Olá. Tens contexto do lead em foco. Em 2–3 frases, resume oportunidades e próximos passos recomendados.'
        : context.focus === 'analytics'
          ? 'Olá. Com base no snapshot desta semana, que padrões ou alertas destacarias para a equipa comercial?'
          : 'Olá. Em que podes ajudar neste CRM (leads, métricas, semana, churn, scores) com os dados que tens?'
    void send(intro)
  }, [context.focus, context.leadId, loading, send])

  if (dataMode !== 'supabase') {
    return (
      <Card className="border-border shadow-none rounded-none bg-muted/10">
        <CardHeader>
          <CardTitle className="text-base font-bold uppercase tracking-widest">Assistente CRM (GLM)</CardTitle>
          <CardDescription className="space-y-2 text-xs leading-relaxed">
            <p className="m-0">
              Ative <code className="text-[10px]">VITE_DATA_MODE=supabase</code>, faça deploy da função{' '}
              <code className="text-[10px]">crm-ai-assistant</code> e defina <code className="text-[10px]">ZAI_API_KEY</code> nos
              secrets do Supabase.
            </p>
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
          Conversa
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          Cada mensagem atualiza o <strong className="text-foreground">snapshot</strong> do CRM (sempre com as tuas permissões).
          Enter envia; Shift+Enter nova linha.
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
            {messages.length === 0 ? 'Iniciar conversa' : 'Nova pergunta guia'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {notice ? <NoticeBanner message={notice} variant={noticeVariantFromMessage(notice)} className="rounded-none" /> : null}

        <ScrollArea className="h-[min(28rem,55vh)] rounded-md border border-border bg-muted/20 p-3">
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
                {m.role === 'user' ? (
                  <p className="m-0 whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <AssistantMarkdown content={m.content} />
                )}
              </li>
            ))}
            {loading ? (
              <li className="mr-6 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                A analisar dados…
              </li>
            ) : null}
            <div ref={endRef} />
          </ul>
        </ScrollArea>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ex.: O que mudou esta semana nos leads quentes? Sugere um email de follow-up (rascunho)."
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
