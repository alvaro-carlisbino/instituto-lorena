/**
 * A régua de qualificação da clínica, uma só para os dois caminhos de entrada.
 *
 * Nasceu no formulário qualificado (`crm-meta-leadform-webhook`) e passou a valer
 * também para a CONVERSA em 31/08/2026, quando a Sofia começou a perguntar cidade
 * e prazo antes de passar o lead para a Aline.
 *
 * Ela precisa ser a MESMA nos dois lugares. Se o formulário pontuasse de um jeito
 * e a conversa de outro, os dois scores não seriam comparáveis, e comparar canal
 * com canal é justamente o que faltava: formulário agenda 2,6% e conversa agenda
 * 7,4% a 18,5% ([[crm_temperatura_invertida_lead_form]]).
 *
 * Divisão de trabalho: o MODELO classifica a resposta em um dos códigos abaixo
 * (é o que ele faz bem) e o SERVIDOR faz a aritmética (que precisa ser sempre
 * igual). A IA nunca escolhe o score.
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

/**
 * O que vale para o lead de formulário que NÃO respondeu as perguntas.
 *
 * Era `hot` com score 70, e a intenção fazia sentido: não punir quem nunca teve
 * a chance de responder. Medido em 31/08/2026, a premissa não se sustentou. Em
 * 30 dias, formulário agendou 2,6% (5 de 193), contra 7,4% da conversa vinda de
 * anúncio e 18,5% de quem chega sozinho. E como 786 dos 865 leads de formulário
 * nasciam quentes sem ninguém ter perguntado nada, o painel ficou ao contrário:
 * lead `hot` agendava 1,8% e lead `warm` agendava 7,7%.
 */
export const SEM_QUALIFICACAO: { temperatura: 'warm'; score: number } = {
  temperatura: 'warm',
  score: 50,
}

export const PRAZOS = Object.keys(PESO_PRAZO)
export const CIDADES = ['maringa', 'londrina', 'outra_pr', 'outro_estado']
export const AVALIACOES = ['pres_maringa', 'pres_londrina', 'online']

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
  // lead segue com o padrão de SEM_QUALIFICACAO e não é rebaixado por falta de
  // resposta que ninguém fez.
  if (!base) return null
  // Fora da praça e sem querer online: a consulta não acontece. Não é descarte,
  // é aviso para o time não tratar como se fosse de Maringá.
  const foraDePraca = cidade === 'outro_estado' && avaliacao !== 'online'
  const score = Math.max(20, base.score - (foraDePraca ? 20 : 0))
  return { nivel: base.nivel, score, temperatura: base.temperatura, foraDePraca, prazo, cidade, avaliacao }
}

/**
 * Uma linha curta para a Aline ler no card sem abrir a conversa inteira. É esse
 * o ponto de qualificar: a resposta vira DADO, não fica enterrada no histórico.
 */
export function resumoQualificacao(q: Qualificacao): string {
  const prazoTxt: Record<string, string> = {
    '4semanas': 'quer nas próximas 4 semanas',
    '1a3meses': 'quer em 1 a 3 meses',
    'mais3meses': 'quer em mais de 3 meses',
    'pesquisando': 'só pesquisando',
  }
  const cidadeTxt: Record<string, string> = {
    maringa: 'Maringá',
    londrina: 'Londrina',
    outra_pr: 'outra cidade do PR',
    outro_estado: 'outro estado',
  }
  const partes = [
    cidadeTxt[q.cidade] ?? q.cidade,
    prazoTxt[q.prazo] ?? q.prazo,
  ].filter(Boolean)
  if (q.avaliacao === 'online') partes.push('aceita online')
  const alerta = q.foraDePraca ? ' ⚠️ fora da praça e não pediu online' : ''
  return `${q.nivel} (${q.score}) · ${partes.join(' · ')}${alerta}`
}
