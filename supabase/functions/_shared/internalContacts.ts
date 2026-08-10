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

// Nomes internos curtos demais para busca por substring: 'spa' casaria dentro de "espaco"
// e barraria paciente de verdade. Estes só valem como nome INTEIRO da conversa.
const EXACT_TERMS = ['spa']

// Rede de segurança por TELEFONE. A lista de nomes acima é frágil de propósito conhecido:
// quem renomeia o card desarma a proteção. E desde que a conversa passou a seguir a linha
// (20260810180848), a mesma pessoa usa UM card só — o mais antigo, que costuma ser o da
// clínica, com o nome curto. A Aline tem card "Aline Comercial Instituto Lorena Visentainer"
// no Tricopill (casa em 'comercial') e card "Aline" na clínica (não casa em nada); é o da
// clínica que ganha. A Lorena não casa em nenhum termo nos dois. Sem isto, ao destravar o
// bot de vendas por linha, a Sofia começaria a vender Tricopill pra própria equipe.
//
// Só dígitos, com DDI. Variantes de 9º dígito são normalizadas em `isInternalPhone`.
const INTERNAL_PHONES = [
  '554491663410', // Spa Capilar (Ingrid)
  '554499852313', // Aline — Comercial Instituto Lorena
  '554491828888', // Recepção
  '554497168329', // Álvaro Carlisbino
  '5543991143090', // Lorena Visentainer
]

/** 55 + DDD + número, sem o 9º dígito, para comparar variantes com/sem ele. */
function phoneKey(phone: unknown): string {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3)
  return d
}

const INTERNAL_PHONE_KEYS = new Set(INTERNAL_PHONES.map(phoneKey))

/** Telefone de contato interno, independente de como o card está nomeado. */
export function isInternalPhone(phone: unknown): boolean {
  const k = phoneKey(phone)
  return Boolean(k) && INTERNAL_PHONE_KEYS.has(k)
}

/** Contato interno por nome OU por telefone. Use esta quando o telefone estiver à mão. */
export function matchesInternalContact(name: unknown, phone?: unknown): boolean {
  return matchesInternalTerm(name) || isInternalPhone(phone)
}

/** Só os termos internos (clínica/financeiro/sócios). Usado no AUTO-REPLY — não barra
 *  nome-de-emoji, senão travaria o atendimento de um cliente com nome esquisito. */
export function matchesInternalTerm(name: unknown): boolean {
  const n = norm(String(name ?? '')).trim()
  if (EXACT_TERMS.includes(n)) return true
  return BLOCK_TERMS.some((t) => n.includes(t))
}

/** Termos internos + nome só de emoji/símbolo. Usado no REENGAJAMENTO (não ofertar
 *  recompra pra contato interno nem pra nome sem letras reais). */
export function isBlockedContact(name: unknown): boolean {
  const n = norm(String(name ?? '')).trim()
  if ((n.match(/[a-z]/g) || []).length < 3) return true // emoji/símbolos, sem nome real
  return matchesInternalTerm(name)
}
