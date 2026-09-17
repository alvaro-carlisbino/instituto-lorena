import type { StockItem } from '@/services/estoqueCompras'
import type { KitStatus } from '@/services/estoqueKits'

export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const formatQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** Fração pequena de estoque (2 ml de um frasco de 1 L = 0,002): com 2 casas vira "0". */
export const formatFracao = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

/** "consumido" é palavra de banco; na tela da enfermagem o kit foi usado. */
export const STATUS_KIT: Record<KitStatus, { label: string; className: string }> = {
  montado: { label: 'Montado', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  consumido: { label: 'Usado', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  cancelado: { label: 'Cancelado', className: 'bg-muted text-muted-foreground' },
}

/**
 * Item de modelo que é uma escolha, não um produto: "CURATIVO ( ) FEM ( ) MAS", "PIJAMA TAM:".
 * Tem saldo zero de propósito; quem monta precisa trocar pelo item de verdade.
 */
export const itemEhEscolha = (nome: string | undefined) => Boolean(nome && /\(\s*\)/.test(nome))

const colacao = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

/**
 * Linhas de kit em ordem alfabética do produto. Com 90 itens na ordem em que foram lançados,
 * achar o Ringer era rolar a lista inteira. Linha ainda sem produto vai para o fim.
 */
export function ordenarPorNome<T>(linhas: T[], nome: (linha: T) => string | null | undefined): T[] {
  return [...linhas].sort((a, b) => {
    const na = nome(a)
    const nb = nome(b)
    if (!na || !nb) return na ? -1 : nb ? 1 : 0
    return colacao.compare(na, nb)
  })
}

export type GrupoMatMed = 'MAT' | 'MED'
export const ROTULO_GRUPO: Record<GrupoMatMed, string> = { MAT: 'Material', MED: 'Medicação' }

/** Medicação pela categoria do cadastro; material hospitalar, saneantes e sem categoria são MAT. */
export const grupoMatMed = (categoria: string | null | undefined): GrupoMatMed =>
  categoria && /medica/.test(categoria.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) ? 'MED' : 'MAT'

/**
 * Separa em Material e Medicação, cada grupo em ordem alfabética, como a equipe confere a bandeja
 * e como a conta é lida. Grupo vazio não aparece.
 */
export function agruparMatMed<T>(
  linhas: T[],
  nome: (linha: T) => string | null | undefined,
  categoria: (linha: T) => string | null | undefined,
): Array<{ grupo: GrupoMatMed; rotulo: string; linhas: T[] }> {
  return (['MAT', 'MED'] as const)
    .map((grupo) => ({
      grupo,
      rotulo: ROTULO_GRUPO[grupo],
      linhas: ordenarPorNome(
        linhas.filter((l) => grupoMatMed(categoria(l)) === grupo),
        nome,
      ),
    }))
    .filter((g) => g.linhas.length > 0)
}

/**
 * Leitor disparado com o cursor na barra de busca digita o código ali antes do Enter. O bipe
 * vale (o leitor global trata), mas a busca ficaria com o código e esconderia a lista.
 */
export const semCodigoBipado = (busca: string, codigo: string) =>
  codigo && busca.endsWith(codigo) ? busca.slice(0, -codigo.length).trimEnd() : busca

export function produtosParaBusca(items: StockItem[]) {
  return items.map((i) => ({
    id: i.id,
    label: i.name,
    hint: [i.category, i.controlled ? 'controlado' : null].filter(Boolean).join(' · ') || undefined,
    meta: `${formatQtd(i.qty)} ${i.unit}`,
    // O código entra na busca: quem tem a caixa na mão digita mais rápido que o nome.
    searchable: [i.sku, i.barcode, ...i.aliases].filter(Boolean).join(' '),
  }))
}
