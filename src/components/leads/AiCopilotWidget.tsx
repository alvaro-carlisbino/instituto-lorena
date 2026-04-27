import { useState } from 'react'
import { Bot, FileText, Sparkles, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { invokeCrmAiAssistant } from '@/services/crmAiAssistant'
import type { Lead, Interaction } from '@/mocks/crmMock'

type Props = {
  lead: Lead
  interactions: Interaction[]
}

type AiInsights = {
  summary: string
  suggestedReplies: string[]
  temperature: 'hot' | 'warm' | 'cold'
}

export function AiCopilotWidget({ lead, interactions }: Props) {
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState<AiInsights | null>(null)

  const handleGenerateInsights = async () => {
    setLoading(true)
    try {
      const historyText = interactions
        .filter((i) => i.channel === 'whatsapp')
        .slice(-10)
        .map((i) => `[${i.direction === 'in' ? 'Paciente' : 'Clínica'}]: ${i.content}`)
        .join('\n')

      const prompt = `Você é um assistente de CRM médico. Resuma o seguinte histórico recente do paciente "${lead.patientName}".
Forneça a resposta APENAS em um JSON válido com o formato:
{
  "summary": "Resumo em 2 frases das dores e necessidades",
  "temperature": "hot" | "warm" | "cold",
  "suggestedReplies": ["Sugestão de resposta 1", "Sugestão 2"]
}

Histórico:
${historyText || '(Nenhum histórico recente)'}`

      const res = await invokeCrmAiAssistant({
        messages: [{ role: 'user', content: prompt }],
        model: 'glm-4-flash',
      })

      if (!res.ok) {
        toast.error('Falha ao gerar insights da IA.')
        setLoading(false)
        return
      }

      // Try to parse JSON from the reply. It might have markdown block ```json
      let jsonStr = res.reply
      if (jsonStr.includes('```json')) {
        jsonStr = jsonStr.split('```json')[1]?.split('```')[0]?.trim() ?? jsonStr
      } else if (jsonStr.includes('```')) {
        jsonStr = jsonStr.split('```')[1]?.split('```')[0]?.trim() ?? jsonStr
      }

      const data = JSON.parse(jsonStr) as AiInsights
      setInsights({
        summary: data.summary,
        suggestedReplies: data.suggestedReplies || [],
        temperature: data.temperature || 'cold',
      })
      toast.success('Insights da IA gerados com sucesso!')
    } catch (error) {
      console.error(error)
      toast.error('A resposta da IA não estava no formato correto.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Resposta copiada para a área de transferência!')
  }

  if (!insights && !loading) {
    return (
      <Card className="border border-primary/20 shadow-none bg-primary/5">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-xs flex items-center gap-2 font-semibold text-primary uppercase tracking-widest">
            <Sparkles className="size-3.5" />
            Copilot I.A.
          </CardTitle>
          <CardDescription className="text-xs text-primary/70">
            Deixe a I.A. analisar a conversa e sugerir os próximos passos.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <Button
            size="sm"
            variant="default"
            className="w-full text-xs font-bold gap-2"
            onClick={handleGenerateInsights}
          >
            <Bot className="size-4" />
            Gerar Insights
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border border-primary/30 shadow-none bg-card">
      <CardHeader className="pb-3 pt-4 px-4 bg-primary/5 border-b border-primary/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2 font-semibold text-primary uppercase tracking-widest">
            <Sparkles className="size-3.5" />
            Copilot I.A.
          </CardTitle>
          {loading ? (
            <span className="text-[10px] font-medium text-muted-foreground animate-pulse">Pensando...</span>
          ) : (
            <Button variant="ghost" size="icon" className="size-6 text-primary" onClick={handleGenerateInsights} title="Regerar Insights">
              <RefreshCw className="size-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 py-4 space-y-4">
        {loading ? (
           <div className="space-y-2">
             <div className="h-3 w-full bg-muted/60 animate-pulse rounded-full" />
             <div className="h-3 w-4/5 bg-muted/60 animate-pulse rounded-full" />
           </div>
        ) : insights ? (
          <>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <FileText className="size-3.5 text-muted-foreground" />
                Resumo da Conversa
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {insights.summary}
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <AlertCircle className="size-3.5 text-muted-foreground" />
                Respostas Sugeridas
              </div>
              <div className="flex flex-col gap-1.5">
                {insights.suggestedReplies.map((reply, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleCopy(reply)}
                    className="text-left text-[11px] leading-tight p-2 rounded-md bg-muted/30 hover:bg-primary/10 border border-border/50 hover:border-primary/30 transition-colors text-foreground"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

// Just to avoid missing RefreshCw import above, let's fix it.
import { RefreshCw } from 'lucide-react'
