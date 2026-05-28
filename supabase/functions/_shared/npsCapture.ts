import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Tenta interpretar uma mensagem inbound do paciente como resposta NPS (nota 0-10).
 * Se o texto for um número solo entre 0 e 10 E houver um `survey_dispatch` pendente
 * (sem `survey_response` ainda) dentro da janela de captura para este lead, regista a
 * resposta e devolve um texto de agradecimento adequado à pontuação.
 *
 * Quem chama deve enviar o `thankYouText` pelo canal correto (WhatsApp/ManyChat) e
 * curto-circuitar a IA — assim o paciente não recebe uma resposta genérica depois.
 *
 * Janela curta (72h): NPS antigo expira sozinho. Evita colisão com menus numéricos
 * (ex.: triagem da Sofia 1–5) quando o lead é reaberto por follow-up dias depois.
 */

const SCORE_REGEX = /^\s*(10|[0-9])\s*$/
const NPS_CAPTURE_WINDOW_MS = 72 * 60 * 60 * 1000

export type NpsCaptureResult =
  | { captured: false }
  | {
      captured: true
      score: number
      dispatchId: string
      templateId: string
      thankYouText: string
    }

function thankYouFor(score: number, firstName: string): string {
  const who = firstName ? `, ${firstName}` : ''
  if (score >= 9) {
    return `Que bom${who}! ⭐ Muito obrigada pela nota *${score}*. Fico feliz em saber que correspondemos à sua expectativa. Se quiser compartilhar mais sobre o que mais gostou, ficaremos muito gratos!`
  }
  if (score >= 7) {
    return `Obrigada pela nota *${score}*${who}! 🙏 Estamos sempre buscando melhorar — se quiser nos contar o que poderíamos fazer ainda melhor, é só responder aqui.`
  }
  return `Obrigada pelo retorno${who}. Anotamos a sua nota *${score}*. Lamentamos se a experiência ficou abaixo do esperado — uma das nossas consultoras vai te procurar para entender melhor e fazer diferente da próxima vez.`
}

export async function captureNpsInboundResponse(
  admin: SupabaseClient,
  opts: {
    leadId: string
    inboundText: string
    patientName: string
    tenantId?: string
  },
): Promise<NpsCaptureResult> {
  const text = String(opts.inboundText ?? '').trim()
  if (!text) return { captured: false }
  const m = text.match(SCORE_REGEX)
  if (!m) return { captured: false }
  const score = Number.parseInt(m[1], 10)
  if (!Number.isFinite(score) || score < 0 || score > 10) return { captured: false }

  // Procura dispatch pendente (sem resposta) dentro da janela de captura.
  const since = new Date(Date.now() - NPS_CAPTURE_WINDOW_MS).toISOString()
  const { data: rows } = await admin
    .from('survey_dispatches')
    .select('id, template_id, sent_at, survey_responses(id)')
    .eq('lead_id', opts.leadId)
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(5)
  const pending = (rows ?? []).find(
    (r) => !((r as { survey_responses?: unknown[] }).survey_responses?.length),
  ) as { id: string; template_id: string; sent_at: string } | undefined
  if (!pending) return { captured: false }

  // Se a conversa foi reaberta (qualquer outbound da IA depois do dispatch), o número
  // provavelmente é resposta de menu/triagem, não NPS. Ex.: Sofia manda menu 1–5
  // após follow-up e o paciente digita "2".
  const { data: stateRow } = await admin
    .from('crm_conversation_states')
    .select('last_ai_reply_at')
    .eq('lead_id', opts.leadId)
    .maybeSingle()
  const lastAiReplyAt = (stateRow as { last_ai_reply_at?: string | null } | null)?.last_ai_reply_at
  if (lastAiReplyAt && new Date(lastAiReplyAt).getTime() > new Date(pending.sent_at).getTime()) {
    return { captured: false }
  }

  const responseId = `resp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const insertRow: Record<string, unknown> = {
    id: responseId,
    dispatch_id: pending.id,
    score,
    comment: null,
    responded_at: new Date().toISOString(),
  }
  if (opts.tenantId) insertRow.tenant_id = opts.tenantId

  const { error } = await admin.from('survey_responses').insert(insertRow)
  if (error) {
    console.warn('captureNpsInboundResponse insert:', error.message)
    return { captured: false }
  }

  const firstName = String(opts.patientName ?? '').trim().split(/\s+/)[0] || ''
  return {
    captured: true,
    score,
    dispatchId: pending.id,
    templateId: pending.template_id,
    thankYouText: thankYouFor(score, firstName),
  }
}
