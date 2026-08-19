/**
 * Regra do calendário de vagas da cirurgia: que cor o dia tem e para onde o clique leva.
 *
 * Vive fora do componente para ser testável — são poucas linhas, mas é o que decide
 * se a vendedora está olhando para uma vaga que precisa vender (vermelho) ou para um
 * dia já resolvido (verde), e um cruzamento errado aqui vende sala ocupada.
 */

/** O que um quadradinho do calendário de vagas pode dizer de um dia. */
export type EstadoDaVaga = 'livre' | 'aberta' | 'preenchida'

/**
 * O que o quadradinho mostra. `ocupada` e `preenchida` são as duas caras do verde:
 * a primeira vem de cirurgia marcada no CRM, a segunda é a vendedora dizendo que a
 * vaga foi fechada fora dele. A diferença importa no texto, não na cor.
 */
export type SituacaoDoDia = 'livre' | 'aberta' | 'preenchida' | 'ocupada'

/** O que o banco sabe do dia: a linha de data aberta, se houver. */
export type DataAbertaDoDia = { slots: number; preenchida: boolean } | undefined

export type QuadradoDoDia = {
  situacao: SituacaoDoDia
  /** Cirurgias do CRM naquele dia. */
  marcadas: number
  /** Vagas abertas ainda sem paciente. */
  vagas: number
}

/**
 * Vagas contadas contra as cirurgias que a TELA tem, não contra a view: a fila da
 * aba é a mesma que a tabela embaixo mostra, então o quadradinho reage no mesmo
 * instante que a linha — e "preenchida à mão" zera as vagas mesmo sem venda.
 */
export function situacaoDoDia(aberta: DataAbertaDoDia, marcadas: number): QuadradoDoDia {
  const vagas = aberta && !aberta.preenchida ? Math.max(aberta.slots - marcadas, 0) : 0
  const situacao: SituacaoDoDia = aberta?.preenchida
    ? 'preenchida'
    : vagas > 0
      ? 'aberta'
      : marcadas > 0
        ? 'ocupada'
        : 'livre'
  return { situacao, marcadas, vagas }
}

/**
 * Para onde o clique leva. Dia vazio anda livre → aberta → preenchida → livre.
 * Dia que já tem cirurgia só alterna "cabe mais uma" (aberta) e volta: marcar como
 * preenchida à mão um dia que o CRM já mostra verde não diria nada novo.
 */
export function proximoEstado(q: Pick<QuadradoDoDia, 'situacao' | 'marcadas'>): EstadoDaVaga {
  if (q.situacao === 'livre' || q.situacao === 'ocupada') return 'aberta'
  if (q.situacao === 'aberta') return q.marcadas > 0 ? 'livre' : 'preenchida'
  return 'livre'
}

/**
 * Quantas vagas a linha do banco passa a ter depois do clique. Abrir vaga num dia
 * que já tem cirurgia quer dizer "cabe MAIS UMA", então sobe para uma acima do que
 * está marcado; abrir num dia vazio é uma vaga. Nunca diminui o que a Agenda
 * Cirúrgica já tinha configurado, e respeita o teto de 12 do banco.
 */
export function slotsAposClique(estado: Exclude<EstadoDaVaga, 'livre'>, slotsAtuais: number, marcadas: number): number {
  const limitar = (n: number) => Math.min(Math.max(n, 1), 12)
  return estado === 'aberta' ? limitar(Math.max(slotsAtuais, marcadas + 1)) : limitar(slotsAtuais)
}
