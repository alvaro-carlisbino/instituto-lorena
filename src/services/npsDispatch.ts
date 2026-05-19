import { supabase } from '@/lib/supabaseClient'

export type NpsDispatchResult =
  | { ok: true; dispatchId: string; templateId: string; channel: 'whatsapp' | 'meta'; sentVia: string }
  | { ok: false; error: string; detail?: string }

/**
 * Dispara a pesquisa NPS para o lead via WhatsApp / Instagram (ManyChat).
 * Chamado quando o card é movido para uma etapa "fim de jornada" ou via ação manual
 * em "Tarefas e NPS". A edge function `crm-nps-dispatch` resolve canal, envia a
 * pergunta e cria o `survey_dispatch` no banco com o canal real (whatsapp|meta).
 */
export async function dispatchNps(leadId: string, templateId?: string): Promise<NpsDispatchResult> {
  if (!supabase) return { ok: false, error: 'Sistema não configurado.' }

  const { data, error } = await supabase.functions.invoke('crm-nps-dispatch', {
    body: { leadId, templateId },
  })

  if (error) {
    return { ok: false, error: error.message || 'Falha ao enviar pesquisa NPS.' }
  }

  const parsed = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  if (parsed.ok === true && typeof parsed.dispatchId === 'string') {
    return {
      ok: true,
      dispatchId: String(parsed.dispatchId),
      templateId: String(parsed.templateId ?? templateId ?? ''),
      channel: parsed.channel === 'meta' ? 'meta' : 'whatsapp',
      sentVia: String(parsed.sent_via ?? ''),
    }
  }
  if (parsed.error) {
    return {
      ok: false,
      error: String(parsed.error),
      detail: typeof parsed.message === 'string' ? parsed.message : undefined,
    }
  }
  return { ok: false, error: 'Resposta inesperada do servidor NPS.' }
}
