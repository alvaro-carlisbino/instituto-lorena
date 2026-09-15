import type { StockItem } from '@/services/estoqueCompras'
import type { KitStatus } from '@/services/estoqueKits'

export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const formatQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

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
