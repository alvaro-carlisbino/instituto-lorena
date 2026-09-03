import { diaLocal } from '@/lib/diaLocal'

/**
 * A triagem da landing /consulta.
 *
 * TRÊS perguntas, uma resposta por toque, nenhuma digitação até o fim (duas, para
 * sobrancelha e barba, que não têm escala). Eram cinco até 27/ago/2026: "há quanto
 * tempo você percebe a perda" e "já fez transplante" saíram porque somavam 16 pontos
 * de 85 no score e custavam dois toques cada, e o que a landing precisa entregar não
 * é ficha clínica, é uma conversa de WhatsApp já aquecida. O resto a atendente
 * pergunta falando com a pessoa, que é o trabalho dela.
 *
 * Cada uma das três que ficaram tem função própria e nenhuma é dispensável:
 *  - objetivo: define o assunto e o texto que a pessoa recebe;
 *  - grau: é o que produz a estimativa de folículos, a recompensa da página;
 *  - urgência: é o filtro. Vale 35 dos pontos e separa quem compra de quem passeia.
 *
 * A NOTA não mora aqui. O score é calculado na edge function `crm-agendar-publico`,
 * porque nota vinda do navegador é nota que qualquer um edita. O que mora aqui é a
 * regra de tela: quem responde "só pesquisando" recebe um texto mais macio, sem
 * empurrar consulta.
 */

export type RespostasTriagem = {
  objetivo?: string
  grau?: string
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
    ajuda: 'Escala usada na consulta médica. Escolha a mais próxima, sem perfeccionismo.',
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
    id: 'urgencia',
    titulo: 'Quando você quer resolver isso?',
    ajuda: 'Responda de verdade. É por isso que a equipe já chega sabendo do que falar com você.',
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
 * Quem está pronto para marcar. Desde que a agenda saiu da página (27/ago/2026) isto
 * não abre nem fecha tela nenhuma: muda o TEXTO, aqui e na mensagem que a Sofia manda.
 * Quem respondeu "só pesquisando" não leva empurrão de consulta.
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

export type Horario = {
  unidadeId: string
  slotAt: string
  /** Profissional da Shosp dono daquele horário. A regra da casa escolhe, não o paciente. */
  codigoPrestador: string
  profissional: string
}
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

/**
 * (44) 99149-3656 enquanto a pessoa digita. Guarda só dígito, mostra formatado.
 *
 * O 55 do país sai ANTES do corte, e isto não é detalhe: o preenchimento automático
 * do celular entrega `+5544997168329`, e cortar em 11 dígitos primeiro produzia
 * `(55) 44997-1683`. Um número que não existe, que passa em `telefoneValido` (tem 11
 * dígitos) e que só o servidor recusava. Quem preenchesse com um toque levava erro
 * sem entender por quê.
 *
 * 12 ou 13 dígitos só existem com o país junto (o brasileiro tem no máximo 11), então
 * ali o 55 da frente é país. Com 11 ou menos, `55` na frente é o DDD de Santa Maria e
 * fica onde está. Mesma regra do `telefoneBr` da edge function.
 */
export function mascararTelefone(valor: string): string {
  let bruto = valor.replace(/\D/g, '')
  if (bruto.startsWith('55') && bruto.length >= 12) bruto = bruto.slice(2)
  const d = bruto.slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Celular brasileiro utilizável: DDD + 8 ou 9 dígitos. */
export function telefoneValido(valor: string): boolean {
  let d = valor.replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  return d.length === 10 || d.length === 11
}

export function nomeValido(valor: string): boolean {
  return valor.trim().length >= 3 && valor.trim().includes(' ')
}
