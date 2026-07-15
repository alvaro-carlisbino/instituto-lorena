// Contatos INTERNOS (clínica, financeiro, marketing, sócios, recepção) que NÃO são
// clientes. O bot de vendas não deve nem responder a eles (auto-reply) nem oferecer
// recompra (reengajamento). Fonte única pra os dois fluxos não divergirem.
//
// Caso Kauan (financeiro do Instituto Lorena): mandava conciliação de caixa no número
// da Tricopill e o auto-reply respondia "sou a assistente de vendas, fale com a Ingrid".

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const BLOCK_TERMS = [
  'recepc', 'marketing', 'comercial', 'contato whatsapp', 'spa capilar',
  'instituto lorena', 'lorena visentainer', 'alvaro carlisbino', 'financeiro',
  'atendimento', 'guegrorioda',
]

/** Só os termos internos (clínica/financeiro/sócios). Usado no AUTO-REPLY — não barra
 *  nome-de-emoji, senão travaria o atendimento de um cliente com nome esquisito. */
export function matchesInternalTerm(name: unknown): boolean {
  const n = norm(String(name ?? '')).trim()
  return BLOCK_TERMS.some((t) => n.includes(t))
}

/** Termos internos + nome só de emoji/símbolo. Usado no REENGAJAMENTO (não ofertar
 *  recompra pra contato interno nem pra nome sem letras reais). */
export function isBlockedContact(name: unknown): boolean {
  const n = norm(String(name ?? '')).trim()
  if ((n.match(/[a-z]/g) || []).length < 3) return true // emoji/símbolos, sem nome real
  return matchesInternalTerm(name)
}
