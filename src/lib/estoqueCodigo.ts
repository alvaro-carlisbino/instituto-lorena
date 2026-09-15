// Achar o produto pelo código bipado.
//
// O mesmo produto chega com mais de um código: o EAN da caixa, o da unidade, o SKU do
// fornecedor. Só há uma coluna `barcode`, então os códigos extras vivem em `aliases`
// (que também guardam nomes de nota). Comparar só com `barcode` fazia o segundo código do
// mesmo produto cair em "não cadastrado" toda vez.

type ComCodigo = { barcode: string | null; sku: string | null; aliases: string[] }

export const normalizarCodigo = (v: string | null | undefined) => String(v ?? '').replace(/\s+/g, '').trim()

/** EAN-13 com zero à esquerda é o mesmo UPC-A de 12 dígitos: o leitor pode mandar qualquer um. */
const semZerosAEsquerda = (v: string) => (/^\d+$/.test(v) ? v.replace(/^0+/, '') : v)

const mesmoCodigo = (a: string | null | undefined, b: string) => {
  const x = normalizarCodigo(a)
  if (!x || !b) return false
  if (x.toLowerCase() === b.toLowerCase()) return true
  return /^\d{8,}$/.test(x) && /^\d{8,}$/.test(b) && semZerosAEsquerda(x) === semZerosAEsquerda(b)
}

export function acharItemPorCodigo<T extends ComCodigo>(items: T[], bruto: string): T | null {
  const codigo = normalizarCodigo(bruto)
  if (!codigo) return null
  return (
    items.find((i) => mesmoCodigo(i.barcode, codigo)) ??
    items.find((i) => mesmoCodigo(i.sku, codigo)) ??
    items.find((i) => i.aliases.some((a) => mesmoCodigo(a, codigo))) ??
    null
  )
}
