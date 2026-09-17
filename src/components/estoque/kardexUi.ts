// Rótulos, cores, datas e links do kardex, compartilhados pela ficha do item e pelas listas.
import type { FiltroKardex, GrupoOperacao, LinhaKardex } from '@/lib/kardex'

export const ROTULO_GRUPO: Record<FiltroKardex['grupo'], string> = {
  tudo: 'Todas as operações',
  entradas: 'Só entradas',
  saidas: 'Só saídas',
  compra: 'Compras (notas)',
  kit: 'Kits',
  transferencia: 'Transferências',
  inventario: 'Inventário e acertos',
  avulso: 'Lançamentos avulsos',
  estorno: 'Estornos',
}

export const COR_GRUPO: Record<GrupoOperacao, string> = {
  compra: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  kit: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  transferencia: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  inventario: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
  estorno: 'bg-muted text-muted-foreground',
  avulso: 'bg-muted text-foreground',
}

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export const dataDia = (dia: string | null) => (dia ? dia.slice(0, 10).split('-').reverse().join('/') : '')

/** Onde a origem abre: nota no financeiro (quem vê), kit na tela do kit, transferência na lista. */
export function linkDaOrigem(l: LinhaKardex, podeVerFinanceiro: boolean): string | null {
  const o = l.origem
  if (o.tipo === 'nota' && o.id && podeVerFinanceiro) return `/contas-a-pagar?nota=${o.id}`
  if (o.tipo === 'kit' && o.id) return `/kits/${o.id}/editar`
  if (o.tipo === 'transferencia') return '/transferencias-estoque'
  if (o.tipo === 'inventario') return '/inventario'
  return null
}
