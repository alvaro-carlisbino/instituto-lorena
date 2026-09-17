/**
 * Por qual número de WhatsApp cada mensagem passou (16/set/2026).
 *
 * Com o WhatsApp da Aline Muniz ao lado da SDR, a mesma pessoa conversa pelos dois números. A
 * conversa é o par (lead, LINHA): o fio de um número não mostra o que passou pelo outro. A linha
 * vem de `interactions.whatsapp_instance_id` (migration 20260917000000).
 */

type MensagemComLinha = { channel: string; whatsappInstanceId?: string | null }

/** "SDR Instituto (W-API)" → "SDR Instituto": o parêntese não cabe numa aba. */
export function nomeCurtoDaLinha(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim() || label
}

/**
 * Linha da mensagem, ou `null` quando ela é do LEAD e vale em todo fio (nota de sistema,
 * Instagram). Mensagem de WhatsApp sem linha gravada, ou com linha que não é uma linha ativa
 * deste polo, é da linha PADRÃO: todo o histórico anterior a 16/set/2026 é de quando a clínica
 * tinha um número só, e é por ela que a resposta sai.
 */
export function linhaDaMensagem(
  m: MensagemComLinha,
  idsDoPolo: ReadonlySet<string>,
  padraoId: string | null,
): string | null {
  if (m.channel !== 'whatsapp') return null
  const id = m.whatsappInstanceId
  return id && idsDoPolo.has(id) ? id : padraoId
}

/**
 * Chave da conversa para "não lida" (localStorage). A linha padrão continua usando só o id do
 * lead: é a chave que já estava gravada no navegador de todo mundo, e trocá-la marcaria o
 * histórico inteiro como não lido.
 */
export function chaveDaConversa(leadId: string, linhaId: string | null, padraoId: string | null): string {
  return linhaId && linhaId !== padraoId ? `${leadId}@${linhaId}` : leadId
}
