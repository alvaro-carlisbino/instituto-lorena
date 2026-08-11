import { FAIXAS, faixasDoHistograma, type FaixaId, type HistogramaBruto } from './tricoscopia'

/**
 * O FEIXE: cem fios do paciente, desenhados direto do histograma.
 *
 * Esta é a montagem mais honesta que os dados permitem, e nasceu de um problema
 * real do desenho do campo folicular: ele desenha a DENSIDADE, e densidade é a
 * medida mais barulhenta do exame (13,8% de variação na área doadora, que não
 * rala). Um paciente que "ganhou 12% de densidade" ganhou ruído, e o campo
 * desenhava isso como um punhado visível de fios a mais. Gráfico bonito, conclusão
 * errada — de novo.
 *
 * Aqui o número de fios é FIXO nos dois lados. Cem de um lado, cem do outro. Some
 * por construção a variável barulhenta, e o que sobra na tela é só a diferença de
 * CALIBRE — que é a parte estável da medida (espessura média varia 5,1%, a
 * proporção de fios finos 2,4 pp).
 *
 * E não há sorteio de posição: os fios saem ordenados do mais fino para o mais
 * grosso, e a quantidade em cada faixa é exatamente a proporção medida no exame.
 * O desenho é uma leitura direta do histograma, não uma simulação. Se o exame diz
 * 33% abaixo de 40 µm, trinta e três dos cem fios saem finos.
 */

/** Cem cabe em 700px de largura com 5px por fio e ainda se conta a olho. */
export const FIOS_NO_FEIXE = 100

/** Faixas em µm. A última é aberta; corta em 140 para desenhar. */
const LIMITES: Record<FaixaId, [number, number]> = {
  ate40: [15, 40],
  f40a60: [40, 60],
  f60a80: [60, 80],
  f80a100: [80, 100],
  acima100: [100, 140],
}

export type FioDoFeixe = {
  /** posição no feixe, 0..n-1, já ordenado do mais fino para o mais grosso */
  ordem: number
  espessuraUm: number
  faixa: FaixaId
}

export type Feixe = {
  fios: FioDoFeixe[]
  /** quantos dos cem caíram em cada faixa — é a proporção medida, arredondada */
  porFaixa: Record<FaixaId, number>
  /** proporção de fio miniaturizado, o número que a clínica acompanha */
  pctFinos: number
  espessuraMediaUm: number | null
  /** segmento visível do fio no quadro, em mm. Escala o comprimento do traço. */
  comprimentoMm: number | null
}

export type MedidaParaFeixe = {
  espessuraHist: HistogramaBruto
  espessuraMediaUm: number | null
  comprimentoMedioMm: number | null
}

/**
 * Reparte `total` entre as faixas na proporção do histograma. Usa maiores restos
 * (Hamilton) porque arredondar cada faixa por conta própria dá 99 ou 101 fios, e
 * um feixe com contagem diferente do outro estragaria justamente a comparação que
 * este desenho existe para fazer.
 */
function repartir(pesos: Record<FaixaId, number>, total: number): Record<FaixaId, number> {
  const soma = Object.values(pesos).reduce((a, b) => a + b, 0)
  const saida = {} as Record<FaixaId, number>
  if (soma <= 0) {
    for (const f of FAIXAS) saida[f.id] = 0
    return saida
  }

  const exatos = FAIXAS.map((f) => ({ id: f.id, v: (pesos[f.id] / soma) * total }))
  let distribuido = 0
  for (const e of exatos) {
    saida[e.id] = Math.floor(e.v)
    distribuido += saida[e.id]
  }

  const restos = exatos
    .map((e) => ({ id: e.id, resto: e.v - Math.floor(e.v) }))
    .sort((a, b) => b.resto - a.resto)

  for (let i = 0; distribuido < total; i++, distribuido++) {
    saida[restos[i % restos.length].id]++
  }
  return saida
}

export function montarFeixe(m: MedidaParaFeixe, total = FIOS_NO_FEIXE): Feixe | null {
  const hist = faixasDoHistograma(m.espessuraHist)
  if (!hist) return null

  const porFaixa = repartir(hist, total)
  const fios: FioDoFeixe[] = []

  // Dentro da faixa, distribui os fios uniformemente entre os dois limites em vez
  // de empilhar todos no meio: assim o feixe tem gradiente contínuo, como cabelo
  // de verdade, sem inventar informação que o histograma não tem.
  for (const faixa of FAIXAS) {
    const n = porFaixa[faixa.id]
    if (n === 0) continue
    const [min, max] = LIMITES[faixa.id]
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1)
      fios.push({ ordem: fios.length, espessuraUm: min + t * (max - min), faixa: faixa.id })
    }
  }

  const finos = porFaixa.ate40
  return {
    fios,
    porFaixa,
    pctFinos: (finos / Math.max(fios.length, 1)) * 100,
    espessuraMediaUm: m.espessuraMediaUm,
    comprimentoMm: m.comprimentoMedioMm,
  }
}
