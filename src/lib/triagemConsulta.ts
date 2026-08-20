import { diaLocal } from '@/lib/diaLocal'

/**
 * A triagem da landing /consulta.
 *
 * Cinco perguntas, uma resposta por toque, nenhuma digitação até o fim. Cada uma
 * existe por um motivo comercial ou clínico, e a ordem é intencional: começa pelo
 * que a pessoa quer (fácil de responder, mostra que a página entendeu o problema) e
 * termina em "quando você quer resolver", que é o filtro que realmente separa quem
 * paga a hora da atendente de quem está passeando.
 *
 * A NOTA não mora aqui. O score é calculado na edge function `crm-agendar-publico`,
 * porque nota vinda do navegador é nota que qualquer um edita. O que mora aqui é a
 * regra de tela: quem responde "só pesquisando" não vê agenda, vira lead frio e
 * conversa no WhatsApp. A agenda da Dra. é o recurso escasso que isto protege.
 */

export type RespostasTriagem = {
  objetivo?: string
  grau?: string
  tempoQueda?: string
  jaFez?: string
  urgencia?: string
}

export type OpcaoTriagem = {
  valor: string
  rotulo: string
  detalhe?: string
}

export type PerguntaTriagem = {
  id: keyof RespostasTriagem
  titulo: string
  ajuda?: string
  /** Escala visual desenhada ao lado das opções (Norwood para eles, Ludwig para elas). */
  visual?: 'norwood' | 'ludwig'
  opcoes: OpcaoTriagem[]
  /** Pergunta que só faz sentido para parte das pessoas (grau depende do objetivo). */
  visivel?: (r: RespostasTriagem) => boolean
}

export const OBJETIVOS: OpcaoTriagem[] = [
  { valor: 'transplante_masculino', rotulo: 'Cabelo (masculino)', detalhe: 'Entradas, coroa ou topo da cabeça' },
  { valor: 'transplante_feminino', rotulo: 'Cabelo (feminino)', detalhe: 'Rarefação, risco aberto, densidade' },
  { valor: 'sobrancelha', rotulo: 'Sobrancelhas', detalhe: 'Falhas, formato, pelos que não nascem' },
  { valor: 'barba', rotulo: 'Barba', detalhe: 'Falhas ou barba que nunca fechou' },
  { valor: 'tratamento', rotulo: 'Tratar a queda sem cirurgia', detalhe: 'Terapia regenerativa, laser, protocolo' },
  { valor: 'nao_sei', rotulo: 'Ainda não sei', detalhe: 'Quero entender o meu caso primeiro' },
]

export const GRAUS_NORWOOD: OpcaoTriagem[] = [
  { valor: '1', rotulo: 'Grau 1', detalhe: 'Cabelo cheio, quase sem recuo' },
  { valor: '2', rotulo: 'Grau 2', detalhe: 'Entradas começando nos cantos' },
  { valor: '3', rotulo: 'Grau 3', detalhe: 'Entradas fundas, topo ainda com fio' },
  { valor: '3v', rotulo: 'Grau 3 com coroa', detalhe: 'Entradas fundas e falha no alto' },
  { valor: '4', rotulo: 'Grau 4', detalhe: 'Entradas e coroa separadas por uma faixa' },
  { valor: '5', rotulo: 'Grau 5', detalhe: 'A faixa do meio está fina' },
  { valor: '6', rotulo: 'Grau 6', detalhe: 'Frente e coroa viraram uma área só' },
  { valor: '7', rotulo: 'Grau 7', detalhe: 'Sobrou a faixa das laterais e da nuca' },
]

export const GRAUS_LUDWIG: OpcaoTriagem[] = [
  { valor: 'ludwig_1', rotulo: 'Leve', detalhe: 'O risco do cabelo abriu um pouco' },
  { valor: 'ludwig_2', rotulo: 'Moderada', detalhe: 'Dá para ver o couro no alto da cabeça' },
  { valor: 'ludwig_3', rotulo: 'Avançada', detalhe: 'Rarefação clara no topo' },
]

export const PERGUNTAS: PerguntaTriagem[] = [
  {
    id: 'objetivo',
    titulo: 'O que você quer resolver?',
    ajuda: 'Escolha o que mais incomoda hoje.',
    opcoes: OBJETIVOS,
  },
  {
    id: 'grau',
    titulo: 'Qual imagem se parece mais com você hoje?',
    ajuda: 'Escala usada na avaliação médica. Escolha a mais próxima, sem perfeccionismo.',
    visual: 'norwood',
    opcoes: GRAUS_NORWOOD,
    visivel: (r) => r.objetivo === 'transplante_masculino',
  },
  {
    id: 'grau',
    titulo: 'Como está a sua rarefação hoje?',
    ajuda: 'Escolha a mais próxima, sem perfeccionismo.',
    visual: 'ludwig',
    opcoes: GRAUS_LUDWIG,
    visivel: (r) => r.objetivo === 'transplante_feminino',
  },
  {
    id: 'tempoQueda',
    titulo: 'Há quanto tempo você percebe a perda?',
    opcoes: [
      { valor: 'menos_1_ano', rotulo: 'Menos de 1 ano' },
      { valor: 'de_1_a_3_anos', rotulo: 'De 1 a 3 anos' },
      { valor: 'mais_3_anos', rotulo: 'Mais de 3 anos' },
    ],
    visivel: (r) => r.objetivo !== 'sobrancelha' && r.objetivo !== 'barba',
  },
  {
    id: 'jaFez',
    titulo: 'Você já fez transplante alguma vez?',
    opcoes: [
      { valor: 'nao', rotulo: 'Nunca fiz' },
      { valor: 'sim_outro_lugar', rotulo: 'Já fiz, em outro lugar' },
      { valor: 'sim_aqui', rotulo: 'Já fiz aqui no Instituto' },
    ],
  },
  {
    id: 'urgencia',
    titulo: 'Quando você quer resolver isso?',
    ajuda: 'Responda de verdade. É isso que define se a gente reserva um horário agora.',
    opcoes: [
      { valor: 'este_mes', rotulo: 'Este mês', detalhe: 'Quero avaliar e definir o quanto antes' },
      { valor: 'ate_3_meses', rotulo: 'Nos próximos 3 meses' },
      { valor: 'esse_ano', rotulo: 'Ainda este ano' },
      { valor: 'pesquisando', rotulo: 'Só estou pesquisando', detalhe: 'Quero informação, sem marcar nada' },
    ],
  },
]

/** As perguntas que fazem sentido para o que a pessoa já respondeu. */
export function perguntasVisiveis(r: RespostasTriagem): PerguntaTriagem[] {
  return PERGUNTAS.filter((p) => (p.visivel ? p.visivel(r) : true))
}

/** Terminou quando toda pergunta visível tem resposta. */
export function triagemCompleta(r: RespostasTriagem): boolean {
  return perguntasVisiveis(r).every((p) => Boolean(r[p.id]))
}

/**
 * Quem vê agenda. "Só pesquisando" não vê: é o filtro inteiro da página. Sem isso a
 * agenda enche de gente que não aparece e a consulta cara vira buraco no dia.
 */
export function podeReservarHorario(r: RespostasTriagem): boolean {
  return Boolean(r.urgencia) && r.urgencia !== 'pesquisando'
}

/** Estimativa de folículos só existe para cabelo (a referência da casa é de escalpo). */
export function temEstimativa(r: RespostasTriagem): boolean {
  return r.objetivo === 'transplante_masculino' || r.objetivo === 'transplante_feminino'
}

export function escalaDoGrau(grau: string): { escala: 'norwood' | 'ludwig'; grau: string } | null {
  if (!grau) return null
  if (grau.startsWith('ludwig_')) return { escala: 'ludwig', grau: grau.replace('ludwig_', '') }
  return { escala: 'norwood', grau }
}

export type Horario = { unidadeId: string; slotAt: string }
export type DiaComHorarios = { dia: string; horarios: Horario[] }

/** Agrupa os horários por dia do calendário de Maringá, não do fuso do navegador. */
export function agruparPorDia(horarios: Horario[]): DiaComHorarios[] {
  const mapa = new Map<string, Horario[]>()
  for (const h of horarios) {
    const dia = diaLocal(h.slotAt)
    if (!dia) continue
    const atual = mapa.get(dia)
    if (atual) atual.push(h)
    else mapa.set(dia, [h])
  }
  return [...mapa.entries()]
    .map(([dia, lista]) => ({
      dia,
      horarios: [...lista].sort((a, b) => a.slotAt.localeCompare(b.slotAt)),
    }))
    .sort((a, b) => a.dia.localeCompare(b.dia))
}

/** (44) 99149-3656 enquanto a pessoa digita. Guarda só dígito, mostra formatado. */
export function mascararTelefone(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Celular brasileiro utilizável: DDD + 8 ou 9 dígitos. */
export function telefoneValido(valor: string): boolean {
  const d = valor.replace(/\D/g, '')
  return d.length === 10 || d.length === 11
}

export function nomeValido(valor: string): boolean {
  return valor.trim().length >= 3 && valor.trim().includes(' ')
}
