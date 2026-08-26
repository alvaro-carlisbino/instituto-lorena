/**
 * O formulário qualificado existe para SEPARAR quem quer operar de quem está
 * passeando. Se a resposta virasse só uma linha de anotação, o filtro não
 * filtraria nada: alguém teria que abrir card por card para descobrir quem
 * respondeu "nas próximas 4 semanas". Por isso o prazo vira score e temperatura,
 * e a praça vira aviso.
 *
 * Mora fora do `index.ts` para poder ser testado sem subir o servidor.
 */

export const PESO_PRAZO: Record<
  string,
  { nivel: string; score: number; temperatura: 'hot' | 'warm' | 'cold' }
> = {
  '4semanas': { nivel: 'QUENTE', score: 90, temperatura: 'hot' },
  '1a3meses': { nivel: 'MORNO', score: 75, temperatura: 'hot' },
  'mais3meses': { nivel: 'FRIO', score: 55, temperatura: 'warm' },
  'pesquisando': { nivel: 'FRIO', score: 40, temperatura: 'warm' },
}

export type Qualificacao = {
  nivel: string
  score: number
  temperatura: 'hot' | 'warm' | 'cold'
  foraDePraca: boolean
  prazo: string
  cidade: string
  avaliacao: string
}

export function qualificar(respostas: Record<string, string>): Qualificacao | null {
  const prazo = String(respostas.prazo ?? '')
  const cidade = String(respostas.cidade ?? '')
  const avaliacao = String(respostas.avaliacao ?? '')
  const base = PESO_PRAZO[prazo]
  // Sem as perguntas respondidas (formulário antigo, de 3 campos), nada muda: o
  // lead segue com o score padrão de formulário e NÃO vira frio por falta de
  // resposta — os 970 leads do formulário velho não são piores por isso.
  if (!base) return null
  // Fora da praça e sem querer online: a consulta não acontece. Não é descarte,
  // é aviso para o time não tratar como se fosse de Maringá.
  const foraDePraca = cidade === 'outro_estado' && avaliacao !== 'online'
  const score = Math.max(20, base.score - (foraDePraca ? 20 : 0))
  return { nivel: base.nivel, score, temperatura: base.temperatura, foraDePraca, prazo, cidade, avaliacao }
}
