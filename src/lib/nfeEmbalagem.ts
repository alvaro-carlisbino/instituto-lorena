import { limparNomeItemNfe } from '@/lib/nfeNomeItem'

// A nota vende a EMBALAGEM ("LUVA CIRURGICA 7,0 ESTERIL C/200 PARES", 1 CX); a enfermagem conta
// o que se USA (518 pares). Sem converter, a entrada soma 1 onde chegaram 200 e o custo do par
// vira o preço da caixa — a contagem deixa de valer na primeira nota.
//
// Duas fontes de fator, nessa ordem:
//   1) aprendido: alguém confirmou na importação manual e o item guardou (por EAN e por nome);
//   2) nome: "C/100", "CX.C/1000", "100AMP", "25FR" — só quando a unidade da nota é embalagem
//      e o item é contado em unidade. Na dúvida fica 1, que é o comportamento antigo.

/** Unidades de nota que são embalagem, não a coisa que se usa. */
const UNIDADES_EMBALAGEM = new Set(['CX', 'CXA', 'CAIXA', 'PCT', 'PT', 'PAC', 'PACOTE', 'FD', 'FARDO', 'KIT', 'KT', 'EMB'])

const normalizarUnidade = (u: string | null | undefined) =>
  String(u ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '') // "CX100" -> "CX", "Unid." -> "UNID"

/** "pc" também aparece como pacote ("ABAIXADOR DE LINGUA PCT C/100", unidade pc). */
export function unidadeEhEmbalagem(unit: string | null | undefined, description?: string | null): boolean {
  const u = normalizarUnidade(unit)
  if (UNIDADES_EMBALAGEM.has(u)) return true
  return u === 'PC' && /\b(PCT|PACOTE)\b/i.test(String(description ?? ''))
}

// "C/100", "C/ 50", "CX.C/1000", "C/200 PARES", "C/30 AMP" — mas não "C/60 CAPS" nem "C/10 GR20":
// número seguido de medida ou de conteúdo do frasco não é quantas unidades vêm na caixa.
const RE_COM = /\bC\s*\/\s*(\d{1,5})(?!\s*(?:MCG|MG|GRS?|G\b|KG|ML|LTS?\b|L\b|MTS?\b|M\b|CM|MM|CAPS?|COMP|CPR|CP\b|FLS?\b|FOLHAS|W\b|V\b|%|[.,]\d|\d))/gi
const RE_CX_BARRA = /\bCX\s*\/\s*(\d{1,5})\b/gi
// "100AMP", "25FR", "50FAM", "10 SER", "20 FRASCOS", "PACOTE 50UN", "100 AMPX2ML"
const RE_CONTEUDO = /\b(\d{1,5})\s*(?:(?:UN|UND|UNID|UNIDADES|PCS|PARES|AMP|AMPOLAS|FAM|F\/A|FA|FR|FRASCOS|BOLSAS?|SER)\b|AMPX(?=\d))/i

/**
 * Quantas unidades de uso vêm numa unidade da nota, lido do nome. Embalagem dentro de embalagem
 * multiplica ("C/5 C/100" = 500 compressas). null quando o nome não diz.
 */
export function fatorDoNome(description: string | null | undefined): number | null {
  const nome = String(description ?? '')
  const aninhados = [...nome.matchAll(RE_COM), ...nome.matchAll(RE_CX_BARRA)].map((m) => Number(m[1]))
  let fator = aninhados.filter((n) => n > 1).reduce((acc, n) => acc * n, 1)
  if (fator === 1) {
    const m = nome.match(RE_CONTEUDO)
    fator = m ? Number(m[1]) : 1
  }
  return fator > 1 && fator <= 100_000 ? fator : null
}

const normalizarNome = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Chaves com que o item guarda o fator aprendido: o EAN e o nome da nota sem lote/validade. */
export function chavesEmbalagem(description: string | null | undefined, ean: string | null | undefined): string[] {
  const chaves: string[] = []
  const digitos = String(ean ?? '').replace(/\D/g, '')
  if (digitos.length >= 8) chaves.push(`ean:${digitos}`)
  const nome = normalizarNome(limparNomeItemNfe(description))
  if (nome) chaves.push(`nome:${nome}`)
  return chaves
}

export type FatorEmbalagem = { fator: number; origem: 'aprendido' | 'nome' }

export function sugerirFatorEmbalagem(
  linha: { description: string; unit: string; ean: string | null },
  item: { unit: string; packFactors?: Record<string, number> | null },
): FatorEmbalagem | null {
  const aprendidos = item.packFactors ?? {}
  for (const chave of chavesEmbalagem(linha.description, linha.ean)) {
    const f = Number(aprendidos[chave])
    if (Number.isFinite(f) && f > 0) return { fator: f, origem: 'aprendido' }
  }
  // Item que já é contado em caixa recebe caixa: converter aqui é que estragaria o saldo.
  if (!unidadeEhEmbalagem(linha.unit, linha.description) || unidadeEhEmbalagem(item.unit)) return null
  const fator = fatorDoNome(linha.description)
  return fator ? { fator, origem: 'nome' } : null
}

/** Quantidade e custo da nota convertidos para a unidade do item. */
export function converterPorEmbalagem(qty: number, unitCostCents: number, fator: number) {
  const f = Number.isFinite(fator) && fator > 0 ? fator : 1
  return {
    qty: Math.round(qty * f * 1000) / 1000,
    unitCostCents: Math.round(unitCostCents / f),
  }
}
