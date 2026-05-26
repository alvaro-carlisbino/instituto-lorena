/**
 * Detector de opt-out em mensagens inbound + gate de envio outbound.
 *
 * Por que importa: WhatsApp baniu contas por taxa de denúncia >= 3%. Se um
 * paciente pede "SAIR" / "PARAR" e o sistema continua mandando, vira
 * denúncia certa. Bloquear envios pra leads que optaram saída é proteção
 * básica de operação.
 *
 * Palavras detectadas (case/acento-insensíveis, mensagem completa ou tokens):
 *   SAIR, PARAR, STOP, CANCELAR, NAO QUERO MAIS, NAO ENVIE MAIS,
 *   DESCADASTRAR, REMOVER, DESINSCREVER.
 *
 * Falsos positivos previstos: a palavra "sair" pode aparecer em conversa
 * legítima ("preciso sair agora pra resolver um problema"). Por isso só
 * disparamos quando a mensagem é CURTA (<= 30 chars) ou quando "SAIR"
 * aparece como token isolado/maiúscula explícita.
 */

const NORMALIZE = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const OPT_OUT_PHRASES = [
  'sair',
  'parar',
  'stop',
  'cancelar',
  'cancela',
  'descadastrar',
  'descadastra',
  'remover meu numero',
  'desinscrever',
  'desinscreva',
  'nao quero mais',
  'nao enviar mais',
  'nao envie mais',
  'nao me mande mais',
  'nao manda mais',
  'pare de me mandar',
  'pare de mandar',
  'nao tenho interesse',
]

/**
 * Detecta se a mensagem inbound é uma intenção de opt-out.
 * Regras:
 *  - Mensagem curta (<= 30 chars) que CONTÉM uma das frases → opt-out
 *  - Mensagem longa só dispara se a frase aparecer como linha isolada
 */
export function isOptOutMessage(text: string): boolean {
  if (!text) return false
  const norm = NORMALIZE(text)
  if (norm.length === 0) return false

  const short = norm.length <= 30
  for (const phrase of OPT_OUT_PHRASES) {
    if (short && norm.includes(phrase)) return true
    // Linha isolada exata (depois de split por quebra)
    const lines = norm.split(/[\n\r]+/).map((l) => l.trim())
    if (lines.some((l) => l === phrase)) return true
  }
  return false
}

type SupabaseLike = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>
      }
    }
  }
}

/**
 * Marca o lead como opt-out via RPC (service_role bypass de RLS).
 * Idempotente: se já estiver marcado, não muda nada.
 */
export async function applyOptOutToLead(
  admin: SupabaseLike,
  leadId: string,
  reason = 'inbound_opt_out_keyword',
): Promise<void> {
  if (!leadId) return
  try {
    await admin.rpc('mark_lead_opted_out', { p_lead_id: leadId, p_reason: reason })
  } catch (e) {
    console.warn('applyOptOutToLead failed:', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Verifica se o lead está com opt-out ativo (deve bloquear envio outbound).
 * Use isso no início de cada edge function de envio antes de despachar.
 */
export async function isLeadOptedOut(admin: SupabaseLike, leadId: string): Promise<boolean> {
  if (!leadId) return false
  try {
    const { data } = await admin
      .from('leads')
      .select('opted_out_at')
      .eq('id', leadId)
      .maybeSingle()
    const ts = (data as { opted_out_at?: string | null } | null)?.opted_out_at
    return ts != null && String(ts).length > 0
  } catch {
    return false
  }
}
