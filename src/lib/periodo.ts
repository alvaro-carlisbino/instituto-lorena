import { diaLocal, diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'

/**
 * Filtro de período padrão das telas de resultado e do financeiro.
 *
 * Antes disto cada tela inventava o seu: /resultados tinha botões de 7/30/90 dias e
 * nenhum jeito de ver "julho fechado"; /extrato e /dre pediam duas datas na mão;
 * /gastos tinha um seletor de mês que ninguém mais usava. Quem fecha o mês precisava
 * digitar 01 e 31 em toda tela, e errar um dígito mudava o número sem avisar.
 *
 * O período é sempre um intervalo de dias INCLUSIVO no fuso da clínica, com rótulo
 * junto — o rótulo vai para o cabeçalho e para o nome do CSV, então relatório
 * exportado não fica sem dizer de que mês ele é.
 */

export type Periodo = {
  /** Primeiro dia, YYYY-MM-DD, inclusive. */
  de: string
  /** Último dia, YYYY-MM-DD, inclusive. */
  ate: string
  /** Como a pessoa chamaria este período ("Julho/2026", "Últimos 30 dias"). */
  rotulo: string
  /** Qual atalho gerou — só para o botão ficar aceso. */
  id: string
}

const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const ymd = (ano: number, mes: number, dia: number) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

/** Último dia do mês YYYY-MM. Dia 0 do mês seguinte é o último do atual. */
function ultimoDia(ym: string): number {
  const [ano, mes] = ym.split('-').map(Number)
  return new Date(ano, mes, 0).getDate()
}

/** Mês de referência (YYYY-MM) de hoje, no fuso do negócio. */
export function mesAtual(): string {
  return hojeLocal().slice(0, 7)
}

/** Anda `n` meses a partir de um YYYY-MM (n negativo volta). */
export function mesComOffset(ym: string, n: number): string {
  const [ano, mes] = ym.split('-').map(Number)
  const d = new Date(ano, mes - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function rotuloDoMes(ym: string): string {
  const [ano, mes] = ym.split('-').map(Number)
  const nome = MES_LONGO[mes - 1] ?? ym
  return `${nome[0].toUpperCase()}${nome.slice(1)}/${ano}`
}

/** Mês fechado (ou o pedaço dele que já passou, se for o mês corrente). */
export function periodoDoMes(ym: string): Periodo {
  const hoje = hojeLocal()
  const fim = `${ym}-${String(ultimoDia(ym)).padStart(2, '0')}`
  return {
    de: `${ym}-01`,
    // Mês corrente não vai até o dia 31: somar dia que ainda não aconteceu faz
    // média por dia despencar e comparação com o mês passado virar mentira.
    ate: fim > hoje ? hoje : fim,
    rotulo: rotuloDoMes(ym),
    id: `mes:${ym}`,
  }
}

/** Janela de N dias terminando hoje (hoje conta como um deles). */
export function periodoUltimosDias(dias: number): Periodo {
  return {
    de: diaLocalComOffset(-(dias - 1)),
    ate: hojeLocal(),
    rotulo: `Últimos ${dias} dias`,
    id: `dias:${dias}`,
  }
}

export function periodoEsteAno(): Periodo {
  const ano = Number(hojeLocal().slice(0, 4))
  return { de: ymd(ano, 1, 1), ate: hojeLocal(), rotulo: String(ano), id: `ano:${ano}` }
}

export function periodoPersonalizado(de: string, ate: string): Periodo {
  const [a, b] = de <= ate ? [de, ate] : [ate, de]
  return {
    de: a,
    ate: b,
    rotulo: `${diaCurto(a)} a ${diaCurto(b)}`,
    id: 'personalizado',
  }
}

const diaCurto = (d: string) => d.split('-').reverse().slice(0, 2).join('/')

// Períodos para AGENDA. Os de cima olham para trás (resultado não conta o que ainda
// não aconteceu); estes olham para frente, porque contato marcado mora no futuro. Com
// `periodoDoMes` o follow-up escondia todo paciente com ligação marcada para depois de hoje.

/** Soma dias a um YYYY-MM-DD em aritmética de calendário, sem depender do fuso do navegador. */
const somaDias = (d: string, dias: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

/** Um dia só, contado a partir de hoje: 0 é hoje, 1 é amanhã. */
export function periodoDoDia(offset: number): Periodo {
  const d = diaLocalComOffset(offset)
  return {
    de: d,
    ate: d,
    rotulo: offset === 0 ? 'Hoje' : offset === 1 ? 'Amanhã' : diaCurto(d),
    id: `dia:${offset}`,
  }
}

/** Semana INTEIRA de segunda a domingo (a semana da clínica começa na segunda): 0 é esta, 1 a que vem. */
export function periodoDaSemana(offset: number): Periodo {
  const hoje = hojeLocal()
  const desdeSegunda = (new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7
  const de = somaDias(hoje, offset * 7 - desdeSegunda)
  return {
    de,
    ate: somaDias(de, 6),
    rotulo: offset === 0 ? 'Esta semana' : offset === 1 ? 'Semana que vem' : `${diaCurto(de)} a ${diaCurto(somaDias(de, 6))}`,
    id: `semana:${offset}`,
  }
}

/** Mês de ponta a ponta, INCLUSIVE os dias que ainda não chegaram. */
export function periodoDoMesInteiro(ym: string): Periodo {
  return {
    de: `${ym}-01`,
    ate: `${ym}-${String(ultimoDia(ym)).padStart(2, '0')}`,
    rotulo: rotuloDoMes(ym),
    id: `mes-inteiro:${ym}`,
  }
}

/** Período anterior do MESMO tamanho, para comparação. */
export function periodoAnterior(p: Periodo): Periodo {
  const de = new Date(`${p.de}T12:00:00`)
  const ate = new Date(`${p.ate}T12:00:00`)
  const dias = Math.round((ate.getTime() - de.getTime()) / 86_400_000) + 1
  return periodoPersonalizado(
    diaLocal(new Date(de.getTime() - dias * 86_400_000)),
    diaLocal(new Date(ate.getTime() - dias * 86_400_000)),
  )
}

/** Início e fim como instantes, para RPC que recebe timestamptz. */
export function periodoEmInstantes(p: Periodo): { start: Date; end: Date } {
  return { start: new Date(`${p.de}T00:00:00-03:00`), end: new Date(`${p.ate}T23:59:59-03:00`) }
}
