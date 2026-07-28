import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * TRAVA CRUZADA entre as duas pesquisas de satisfação da clínica.
 *
 * A clínica tem DOIS caminhos de pesquisa que escutam o mesmo evento (o lead entrou
 * numa etapa de fim de jornada) e não se conheciam:
 *
 *   1. NPS da Sofia — texto "0 a 10" enviado por `crm-nps-dispatch` quando o card é
 *      movido para Encerrado/Fechado. Grava `survey_dispatches` + `survey_responses`.
 *   2. Card de avaliação com botões — flow do ManyChat disparado pelo cron
 *      `crm-payment-confirm-watch` (a cada 2 min) para as etapas consulta/fechado.
 *      Marca `leads.custom_fields.feedback_sent_at`.
 *
 * Resultado até 28/jul/2026: 122 pacientes receberam AS DUAS pesquisas — o Álvaro
 * levou as duas com 61 segundos de diferença, respondeu nota na primeira e a segunda
 * chegou perguntando de novo.
 *
 * Regra: quem disparar primeiro bloqueia o outro por 30 dias NO MESMO LEAD. Vale nos
 * dois sentidos e é deliberadamente conservadora — o custo de não pedir avaliação é
 * muito menor do que o de metralhar o paciente logo depois do atendimento.
 */

export const SURVEY_COOLDOWN_DAYS = 30
const SURVEY_COOLDOWN_MS = SURVEY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000

/** Início da janela de silêncio, em ISO (o mesmo formato gravado em `feedback_sent_at`). */
export function surveyCooldownSince(now: number = Date.now()): string {
  return new Date(now - SURVEY_COOLDOWN_MS).toISOString()
}

/**
 * O card do ManyChat já saiu para este lead dentro da janela?
 * Lê `custom_fields` que o chamador já tem em mãos — sem ida extra ao banco.
 */
export function manychatFeedbackSentRecently(
  customFields: Record<string, unknown> | null | undefined,
  now: number = Date.now(),
): { blocked: boolean; at: string | null } {
  const raw = String((customFields ?? {})['feedback_sent_at'] ?? '').trim()
  if (!raw) return { blocked: false, at: null }
  const ts = new Date(raw).getTime()
  // Carimbo inválido (houve uma fase em que gravávamos `true` em vez de data): trata
  // como enviado e bloqueia — repetir a pesquisa é pior do que pular uma vez.
  if (!Number.isFinite(ts)) return { blocked: true, at: raw }
  return { blocked: ts > now - SURVEY_COOLDOWN_MS, at: raw }
}

/**
 * Dos leads informados, quais receberam o NPS da Sofia dentro da janela.
 * Uma query só para o lote inteiro — o cron processa até 25 leads por rodada.
 */
export async function leadsWithRecentNpsDispatch(
  admin: SupabaseClient,
  leadIds: string[],
): Promise<Set<string>> {
  const ids = leadIds.filter(Boolean)
  if (!ids.length) return new Set()
  const { data, error } = await admin
    .from('survey_dispatches')
    .select('lead_id')
    .in('lead_id', ids)
    .gte('sent_at', surveyCooldownSince())
  if (error) {
    // Em caso de falha na leitura, não bloqueia nada: o claim atômico do chamador
    // continua garantindo que o card não sai duas vezes.
    console.warn('[surveyCooldown] leitura de survey_dispatches falhou:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => String((r as { lead_id: unknown }).lead_id)))
}

/** Versão para um lead só (usada pelo `crm-nps-dispatch` antes de enviar). */
export async function hasRecentNpsDispatch(
  admin: SupabaseClient,
  leadId: string,
): Promise<{ blocked: boolean; at: string | null }> {
  const { data } = await admin
    .from('survey_dispatches')
    .select('sent_at')
    .eq('lead_id', leadId)
    .gte('sent_at', surveyCooldownSince())
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const at = (data as { sent_at?: string } | null)?.sent_at ?? null
  return { blocked: Boolean(at), at }
}
