// Nome do lead em COPY que sai pro cliente. Fonte única porque cada rotina proativa
// (follow-up, reengajamento, carrinho, NPS) tinha o seu próprio `firstName` de uma linha,
// e todas erravam do mesmo jeito.
//
// Caso que gerou este módulo (18/ago/2026): o lead sem push name é gravado como
// "Contato WhatsApp", e o reengajamento mandou "Oi Contato, tudo bem?" pra 9 pessoas.
// No mesmo lote saíram "Oi neusabarbosa" e "Oi MARIA" — nome como veio do WhatsApp.
//
// Duas regras: nome que não é de gente NÃO vira vocativo (some, em vez de virar "Oi, você!"),
// e nome de gente sai com a cara certa (primeiro nome, capitalizado).

import { isPlaceholderName } from './crm.ts'
import { isProviderPlaceholderName } from './internalContacts.ts'

/**
 * Primeiro nome apresentável, ou '' quando não temos nome de gente (vazio, placeholder do
 * provider, "Lead"/"Novo contato", ou só emoji/símbolo).
 */
export function firstNameOrEmpty(patientName: unknown): string {
  const raw = String(patientName ?? '').trim()
  if (!raw || isProviderPlaceholderName(raw) || isPlaceholderName(raw)) return ''
  const token = (raw.split(/\s+/)[0] ?? '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
  if ((token.match(/\p{L}/gu) ?? []).length < 2) return ''
  // "MARIA" e "neusabarbosa" saem como vieram do WhatsApp. Só normaliza quando o token está
  // todo numa caixa só: "McKenzie" e "d'Ávila" ficam como a pessoa escreveu.
  return token === token.toUpperCase() || token === token.toLowerCase()
    ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    : token
}

/**
 * Troca o marcador de nome no template. Sem nome de gente, o VOCATIVO SOME em vez de virar
 * "Oi, você!":
 *   "Oi, {nome}! 💚 Vi que..."  → "Oi! 💚 Vi que..."
 *   "{nome}, ainda dá pra..."   → "Ainda dá pra..."
 *   "...te ajudar, {nome}. E.." → "...te ajudar. E.."
 */
export function applyLeadName(template: string, patientName: unknown, marker = 'nome'): string {
  const name = firstNameOrEmpty(patientName)
  const tag = `\\{${marker}\\}`
  if (name) return template.replace(new RegExp(tag, 'g'), name)
  return template
    // Vocativo que ABRE a frase leva a vírgula junto: "{nome}, ainda dá..." → "Ainda dá...".
    .replace(new RegExp(`^\\s*${tag}\\s*,\\s*`), '')
    // No meio da frase, some só o nome e a vírgula que vem ANTES dele. A vírgula seguinte é
    // da frase, não do vocativo: "Oi {nome}, tudo bem?" → "Oi, tudo bem?" (e não "Oi tudo bem?").
    .replace(new RegExp(`\\s*,?\\s*${tag}`, 'g'), '')
    .replace(/^\s*(\p{Ll})/u, (_m, c: string) => c.toUpperCase())
    .trim()
}
