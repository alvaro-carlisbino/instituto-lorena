// Cor de cada classe do Resumo do mês. As variáveis moram em index.css (escopo .viz), validadas
// contra o fundo claro e o escuro. A cor vem da ORDEM fixa da classe (resumoBanco), nunca da
// posição no ranking: Pessoas é a mesma cor em qualquer mês e em qualquer filtro.

import { OUTROS_GRUPOS, SEM_CENTRO, corDaClasse, type Direcao } from '@/lib/resumoBanco'

export const COR_ENTROU = 'var(--viz-ganho)'
export const COR_SAIU = 'var(--viz-perda)'

export function corDe(direcao: Direcao, classe: string): string {
  const slot = corDaClasse(direcao, classe)
  if (slot) return `var(--viz-cat-${slot})`
  if (classe === OUTROS_GRUPOS) return 'var(--viz-neutro-2)'
  if (classe === SEM_CENTRO) return 'var(--viz-neutro)'
  return 'var(--viz-neutro-2)'
}

export const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** "R$ 12,3 mil", "R$ 1,2 mi": para eixo e rótulo curto. */
export function brlCurto(c: number): string {
  const r = Math.abs(c) / 100
  const sinal = c < 0 ? '−' : ''
  if (r >= 1_000_000) return `${sinal}R$ ${(r / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (r >= 1_000) return `${sinal}R$ ${(r / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: r >= 100_000 ? 0 : 1 })} mil`
  return `${sinal}R$ ${r.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

/** Eixo do gráfico: "140 mil", "1,2 mi". O R$ fica no título, para o rótulo caber numa linha. */
export function eixo(c: number): string {
  const r = Math.abs(c) / 100
  const sinal = c < 0 ? '−' : ''
  if (r >= 1_000_000) return `${sinal}${(r / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (r >= 1_000) return `${sinal}${Math.round(r / 1_000).toLocaleString('pt-BR')} mil`
  return `${sinal}${Math.round(r)}`
}

export const pct = (parte: number, todo: number) =>
  todo > 0 ? `${((parte / todo) * 100).toLocaleString('pt-BR', { maximumFractionDigits: parte / todo < 0.1 ? 1 : 0 })}%` : '0%'
