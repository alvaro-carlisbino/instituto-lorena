import { ehAreaDoadora } from './tricoscopia'

/**
 * O PADRÃO DE RAREFAÇÃO: cada região contra a área doadora do próprio paciente,
 * medidas no MESMO exame.
 *
 * Por que esta comparação é defensável e a "razão com a doadora" que eu tinha
 * pensado não era: aquela dividia massa capilar de uma região pela da doadora, e
 * massa é contagem × calibre — deu 23,2% de ruído, pior do que qualquer métrica
 * isolada, porque razão entre dois números barulhentos compõe os dois erros. Aqui
 * a comparação é de ESPESSURA MÉDIA, que varia 5,1%, e a distância fisiológica
 * entre nuca e vértice é da ordem de 15 a 20%: o sinal passa longe do ruído.
 *
 * E é a comparação certa clinicamente. A doadora é o teto genético daquela pessoa
 * — quanto o fio dela consegue ser grosso quando o hormônio não interfere. A
 * distância de cada região até esse teto é o desenho da alopecia androgenética
 * daquele paciente, e não de uma tabela de referência de outra gente.
 */

export type RegiaoNoPerfil = {
  regiao: string
  espessuraUm: number | null
  pctFinos: number | null
  ehDoadora: boolean
}

export type Perfil = {
  regioes: RegiaoNoPerfil[]
  referenciaUm: number | null
  regiaoReferencia: string | null
  referenciaHistoricaUm: number | null
}

/** Ordena e marca a doadora. Fora do componente para poder ser testado. */
export function montarPerfil(
  medidas: Array<{ regiao: string | null; espessuraMediaUm: number | null; pctFiosFinos: number | null }>,
  /**
   * Medidas de doadora do paciente nos OUTROS exames. Sem excluir o exame que está
   * sendo julgado, a captura suspeita entra na própria referência e amortece o
   * desvio que a gente quer justamente detectar.
   */
  doadoraHistorica: number[] = [],
): {
  regioes: RegiaoNoPerfil[]
  referenciaUm: number | null
  regiaoReferencia: string | null
  referenciaHistoricaUm: number | null
} {
  const regioes: RegiaoNoPerfil[] = medidas
    .filter((m): m is typeof m & { regiao: string } => !!m.regiao)
    .map((m) => ({
      regiao: m.regiao,
      espessuraUm: m.espessuraMediaUm,
      pctFinos: m.pctFiosFinos,
      ehDoadora: ehAreaDoadora(m.regiao),
    }))

  // Com mais de uma doadora capturada, a referência é a média delas: uma única
  // captura de occipital carrega os 5,1% de erro sozinha.
  const doadoras = regioes.filter((r) => r.ehDoadora && r.espessuraUm !== null)
  const referenciaUm =
    doadoras.length > 0
      ? doadoras.reduce((a, r) => a + (r.espessuraUm ?? 0), 0) / doadoras.length
      : null

  // Mediana, não média: um exame com captura ruim puxa a média e some no meio da
  // amostra pela mediana, que é exatamente o que se quer de uma referência.
  const ordenadas = doadoraHistorica.filter((v) => v > 0).sort((a, b) => a - b)
  const referenciaHistoricaUm =
    ordenadas.length >= 2
      ? ordenadas.length % 2
        ? ordenadas[(ordenadas.length - 1) / 2]
        : (ordenadas[ordenadas.length / 2 - 1] + ordenadas[ordenadas.length / 2]) / 2
      : null

  return {
    regioes,
    referenciaUm,
    regiaoReferencia: doadoras.length === 1 ? doadoras[0].regiao : doadoras.length > 1 ? 'média das occipitais' : null,
    referenciaHistoricaUm,
  }
}
