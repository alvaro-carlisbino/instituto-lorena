// Ponte de atribuição SITE → WHATSAPP.
//
// O problema que ela resolve: o cliente clica no anúncio do Google (URL com ?gclid=...),
// cai no site, e o site guarda essa atribuição no localStorage. Aí ele clica em "Comprar no
// WhatsApp" e a venda fecha na conversa. Como o lead nasce do WhatsApp, o gclid FICA PRA TRÁS
// — o Google vê o clique e nunca a venda. Resultado: PMax otimizando às cegas e o painel
// dizendo "1 conversão" quando existem mais.
//
// Como funciona: o CTA do site carimba "(ref: SITE-<sid>)" na 1ª mensagem e registra o evento
// whatsapp_click em storefront_events COM a atribuição da sessão. Aqui a gente lê o token da
// mensagem, acha a sessão e copia a atribuição pro lead. Aí a venda tem gclid e o
// crm-gads-backfill consegue devolver a conversão pro Google.
//
// Best-effort: nunca derruba o webhook de mensagem.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/** Extrai o sid de "(ref: SITE-a1b2c3d4)". Aceita o token solto também. */
export function extractSiteSid(text: string): string | null {
  const m = /SITE-([A-Za-z0-9_-]{4,32})/.exec(String(text ?? ''))
  return m ? m[1] : null
}

/**
 * Se a mensagem tem o token do site, copia a atribuição da sessão pro lead
 * (custom_fields.attribution). Só grava se o lead ainda não tem — first-touch vence,
 * e mensagem repetida não sobrescreve.
 */
export async function linkSiteAttributionToLead(
  admin: SupabaseClient,
  leadId: string,
  messageText: string,
): Promise<{ linked: boolean; gclid?: string }> {
  try {
    const sid = extractSiteSid(messageText)
    if (!sid) return { linked: false }

    const { data: leadRow } = await admin
      .from('leads').select('custom_fields').eq('id', leadId).maybeSingle()
    const cf = (((leadRow as { custom_fields?: Record<string, unknown> } | null)?.custom_fields) ?? {}) as Record<string, unknown>
    if (cf.attribution) return { linked: false } // já tem atribuição, não mexe

    // O sid do site é o localStorage tp_sid cortado em 8 chars; o session_id do evento é o
    // completo. Casa por prefixo, pegando o evento mais recente dessa sessão.
    const { data: ev } = await admin
      .from('storefront_events')
      .select('attribution, session_id, created_at')
      .like('session_id', `${sid}%`)
      .not('attribution', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const attribution = (ev as { attribution?: Record<string, unknown> } | null)?.attribution
    if (!attribution) return { linked: false }

    await admin.from('leads')
      .update({ custom_fields: { ...cf, attribution, attribution_source: 'site_bridge' } })
      .eq('id', leadId)

    const first = ((attribution as Record<string, unknown>).first ?? {}) as Record<string, unknown>
    const gclid = typeof first.gclid === 'string' ? first.gclid : undefined
    return { linked: true, gclid }
  } catch {
    return { linked: false } // atribuição nunca pode quebrar o atendimento
  }
}
