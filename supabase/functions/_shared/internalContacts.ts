// Contatos INTERNOS (clínica, financeiro, marketing, sócios, recepção) que NÃO são
// clientes. O bot de vendas não deve nem responder a eles (auto-reply) nem oferecer
// recompra (reengajamento). Fonte única pra os dois fluxos não divergirem.
//
// Caso Kauan (financeiro do Instituto Lorena): mandava conciliação de caixa no número
// da Tricopill e o auto-reply respondia "sou a assistente de vendas, fale com a Ingrid".

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const BLOCK_TERMS = [
  'recepc', 'marketing', 'comercial', 'spa capilar',
  'instituto lorena', 'lorena visentainer', 'alvaro carlisbino', 'financeiro',
  'atendimento', 'guegrorioda',
]

// Nome que o PROVIDER grava quando o WhatsApp não manda push name. É o oposto de contato
// interno: é exatamente assim que chega um desconhecido — inclusive lead pago do Ads.
//
// 'contato whatsapp' esteve em BLOCK_TERMS de 15/jul (46d1c9a) a 18/ago e calou a IA em 6
// leads de venda: todos caíam em 'contato_interno', ninguém respondia, e 15 min depois o
// follow-up disparava "Oi, Contato WhatsApp! Vi que ficou pendente aqui". Um deles veio do
// Google Ads com gclid; outro mandou 19 mensagens sem receber uma resposta.
//
// NÃO devolver para BLOCK_TERMS: quem protege a equipe de verdade é INTERNAL_PHONES, que
// não depende de como o card está nomeado.
const PROVIDER_PLACEHOLDER_NAMES = ['contato whatsapp', 'lead whatsapp']

/** Nome default de provider (WhatsApp sem push name), não identifica ninguém. */
export function isProviderPlaceholderName(name: unknown): boolean {
  return PROVIDER_PLACEHOLDER_NAMES.includes(norm(String(name ?? '')).trim())
}

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
  // Mesa do financeiro/admin: manda conciliação de caixa pra linha do Tricopill ("tem uns de
  // maio que ainda não foram lançados") e "Estorno realizado!" + nome de paciente pra clínica.
  // Duas pessoas no mesmo aparelho, Kauan e Jayne, por isso o nome sozinho nunca bastou.
  '5511996109567',
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

// O dono testa o atendimento pelo próprio WhatsApp — e o próprio WhatsApp dele está na
// lista de interno duas vezes (nome e telefone). Resultado: ele mandava "teste" na linha do
// Tricopill e não voltava NADA, o que parece IA desligada e não é.
//
// A exceção vale SÓ para responder (`matchesInternalContact`, usada no auto-reply). No
// reengajamento a lista continua inteira — `isBlockedContact` não passa por aqui —, então
// o bot não volta a oferecer recompra pra equipe, que é o motivo de a lista existir.
const TESTER_PHONE_KEYS = new Set(
  [
    '554497168329', // Álvaro Carlisbino — testa o bot pelo número dele
  ].map(phoneKey),
)

/** Interno que MESMO ASSIM pode conversar com o bot (teste do dono). */
export function isTesterPhone(phone: unknown): boolean {
  const k = phoneKey(phone)
  return Boolean(k) && TESTER_PHONE_KEYS.has(k)
}

/** Contato interno por nome OU por telefone. Use esta quando o telefone estiver à mão. */
export function matchesInternalContact(name: unknown, phone?: unknown): boolean {
  if (isTesterPhone(phone)) return false
  return matchesInternalTerm(name) || isInternalPhone(phone)
}

/** Só os termos internos (clínica/financeiro/sócios). Usado no AUTO-REPLY — não barra
 *  nome-de-emoji, senão travaria o atendimento de um cliente com nome esquisito. */
export function matchesInternalTerm(name: unknown): boolean {
  const n = norm(String(name ?? '')).trim()
  if (isProviderPlaceholderName(n)) return false
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
