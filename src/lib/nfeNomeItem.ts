// O fornecedor carimba lote, validade, fabricação e quantidade DENTRO do xProd da NF-e.
// Se o nome cru virar item de estoque, a próxima nota do mesmo produto com outro lote cria
// um item novo — foi assim que a carga de julho gerou duplicata de luva/equipo/seringa.
//
// A regra: cortar o rastro, MANTER dosagem e tamanho (40mg, 1ml, 6.5, P/M/G são identidade
// do produto, não lote). O nome cru vira alias do item, então a próxima nota casa sozinha.
//
// Quatro formatos convivem nas notas da clínica:
//   "... - MEDSONDA L83588 V11/29"                          (sem dois-pontos)
//   "... (CREMER)   L: 739482550L Q: 4.800,0000 F: 08/12/25 V: 09/12/2030"
//   "... (Fornecedor: 1898, Lote: BD-064/25M, Qtde: 1 ,Data Fab:"   (parêntese truncado)
//   "... (BD)   L: 5307777 ... , nFCI: 28C209D5-F046-"

/** Marcadores que abrem o bloco de rastro. O corte vale do mais à esquerda que casar. */
const MARCADORES: RegExp[] = [
  /\(\s*Fornecedor\s*:/i,
  /,?\s*nFCI\s*:/i,
  /\s+Lote\s*:/i,
  /\s+Qtde\s*:/i,
  /\s+Data\s+Fab/i,
  /\s+L\s*:\s*/,
  /\s+Q\s*:\s*/,
  /\s+F\s*:\s*/,
  /\s+V\s*:\s*/,
  /\s+Val(?:idade)?\s*:?\s*\d{2}\/\d{2}/i,
  // Sem dois-pontos, sempre no fim: "L83588 V11/29", "LM0689 26 V03/28", "L9853 25 V10/27".
  /\s+L[A-Z0-9][A-Z0-9._/-]*(?:\s+\d{1,4})?\s+V\d{1,2}\/\d{2,4}\s*$/i,
]

/** Sobra de corte: separador solto, parêntese aberto sem fechar, vírgula/hífen no fim. */
const aparar = (v: string): string => {
  let out = v.replace(/\s+/g, ' ').trim()
  // "CATETER ... (BD" -> "CATETER ... (BD)" não; preferimos remover o parêntese órfão inteiro
  const abre = (out.match(/\(/g) ?? []).length
  const fecha = (out.match(/\)/g) ?? []).length
  if (abre > fecha) out = out.slice(0, out.lastIndexOf('(')).trim()
  return out.replace(/[\s,;:_-]+$/g, '').trim()
}

/**
 * Nome do item de estoque a partir do xProd da NF-e, sem o rastro de lote/validade.
 * Devolve o cru quando o corte não sobra nada útil (nome curto demais = corte errado).
 */
export function limparNomeItemNfe(raw: string | null | undefined): string {
  const cru = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!cru) return ''
  let corte = cru.length
  for (const re of MARCADORES) {
    const m = cru.match(re)
    if (m?.index !== undefined && m.index < corte) corte = m.index
  }
  const limpo = aparar(cru.slice(0, corte))
  // Corte que come o produto inteiro é corte errado — fica com o nome cru aparado.
  return limpo.length >= 4 ? limpo : aparar(cru)
}

/** true quando o nome cru trazia rastro (aí vale guardar o cru como alias). */
export function temRastroNoNome(raw: string | null | undefined): boolean {
  const cru = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return cru.length > 0 && limparNomeItemNfe(cru) !== cru
}

/** Normalização usada pra comparar nomes (igual à do casamento de itens do import). */
export function normalizarNome(v: string | null | undefined): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
