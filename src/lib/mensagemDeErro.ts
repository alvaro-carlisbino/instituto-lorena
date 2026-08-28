/**
 * Texto legível de um erro, inclusive quando ele NÃO é um `Error`.
 *
 * O Supabase devolve `PostgrestError` como objeto simples (`{message, code, details, hint}`),
 * e `AuthError` como objeto com `status`. Nenhum dos dois é instância de `Error`, então o
 * `error instanceof Error ? error.message : String(error)` que estava espalhado pela tela caía
 * no `String(objeto)` e imprimia **"[object Object]"**.
 *
 * Isso custou tempo de verdade em 28/08/2026: o Postgres do projeto reiniciou às 17:46 e a
 * tela do CRM mostrou "Perfil: [object Object]" e o onboarding de clínica nova para quem já
 * tinha conta. A causa (PGRST002, a API sem cache de schema) estava no erro que a tela jogou
 * fora. Mensagem de erro que não diz o que houve não é mensagem de erro.
 */
export function mensagemDeErro(erro: unknown): string {
  if (typeof erro === 'string') return erro.trim() || 'erro sem descrição'
  if (erro instanceof Error && erro.message.trim()) return erro.message.trim()

  if (erro && typeof erro === 'object') {
    const o = erro as Record<string, unknown>
    const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
    // `code` entra junto porque é ele que distingue "sem permissão" (42501/PGRST301) de
    // "API fora do ar" (PGRST002) — e é a primeira coisa que se procura no suporte.
    const partes = [txt(o.message) || txt(o.error_description) || txt(o.error), txt(o.details), txt(o.hint)]
      .filter(Boolean)
    const codigo = txt(o.code) || (typeof o.status === 'number' ? String(o.status) : '')
    if (partes.length) return codigo ? `${partes.join(' — ')} (${codigo})` : partes.join(' — ')
    if (codigo) return `erro ${codigo}`
  }

  // Último recurso: JSON antes de "[object Object]". Feio, mas diagnosticável.
  try {
    const s = JSON.stringify(erro)
    if (s && s !== '{}' && s !== 'null') return s.slice(0, 300)
  } catch { /* referência circular: cai no texto abaixo */ }
  return 'erro desconhecido'
}
