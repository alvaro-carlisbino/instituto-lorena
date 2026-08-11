import { faixasDoHistograma, type FaixaId, type HistogramaBruto } from './tricoscopia'

/**
 * O CAMPO FOLICULAR DESENHADO A PARTIR DOS NÚMEROS.
 *
 * A foto é o que impressiona na tricoscopia, e a foto é o que não temos: são
 * 32.331 capturas de PNG 2274×2048, entre 4 e 8 MB cada — 130 a 250 GB, dias de
 * upload na internet da clínica. Subir isso para mostrar evolução na consulta é
 * caro e lento demais para o que entrega.
 *
 * Mas quase tudo que a foto comunica já está medido: quantas unidades foliculares
 * por cm², quantos fios em cada uma, e a espessura de cada fio distribuída em
 * faixas. Com isso dá para DESENHAR um centímetro quadrado representativo daquele
 * exame. Lado a lado, primeiro exame contra o último, a diferença aparece do jeito
 * que o paciente entende: menos traço e mais fino de um lado, mais traço e mais
 * grosso do outro.
 *
 * ISTO NÃO É A FOTO, E A TELA DIZ ISSO EM LETRA GRANDE. É uma representação fiel
 * às contagens e à distribuição de espessura, e nada além disso: a posição exata
 * de cada fio é sorteada, porque essa informação o CRM não guarda. Vender desenho
 * como exame seria pior do que não ter imagem nenhuma.
 *
 * O sorteio é SEMENTE FIXA, derivada do capture_id + região: o mesmo exame desenha
 * sempre igual. Imagem de laudo que muda a cada refresh não é ilustração médica, é
 * enfeite — e o paciente que voltasse na consulta seguinte veria outro "exame".
 */

/** Um cm² de couro cabeludo. Casa com a ordem de grandeza do ROI real (~0,9 a 1,2 cm²). */
export const LADO_MM = 10

export type FioDesenhado = {
  x: number
  y: number
  angulo: number
  comprimentoMm: number
  espessuraUm: number
  faixa: FaixaId
}

export type UnidadeDesenhada = {
  x: number
  y: number
  fios: FioDesenhado[]
}

export type CampoFolicular = {
  ladoMm: number
  unidades: UnidadeDesenhada[]
  totalFios: number
  totalUnidades: number
  espessuraMediaUm: number | null
}

export type MedidaParaCampo = {
  captureId: string
  regiao: string | null
  densidadeUfCm2: number | null
  densidadeFiosCm2: number | null
  espessuraMediaUm: number | null
  espessuraHist: HistogramaBruto
}

/** Faixas em µm, na ordem de FAIXAS. A última é aberta: cortamos em 140 para desenhar. */
const LIMITES: Record<FaixaId, [number, number]> = {
  ate40: [20, 40],
  f40a60: [40, 60],
  f60a80: [60, 80],
  f80a100: [80, 100],
  acima100: [100, 140],
}

/** mulberry32: gerador pequeno e determinístico. Não é criptografia, é ilustração. */
function semente(texto: string): () => number {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function montarCampo(m: MedidaParaCampo): CampoFolicular | null {
  const nUf = Math.round(m.densidadeUfCm2 ?? 0)
  const nFios = Math.round(m.densidadeFiosCm2 ?? 0)
  if (nUf < 1 || nFios < 1) return null

  const faixas = faixasDoHistograma(m.espessuraHist)
  const rnd = semente(`${m.captureId}|${m.regiao ?? ''}`)

  // Amostrador de espessura tirado do histograma do próprio exame. Sem histograma,
  // cai na espessura média — desenho mais pobre, mas nunca inventado.
  const acumulado: Array<[FaixaId, number]> = []
  if (faixas) {
    let soma = 0
    for (const [id, qtd] of Object.entries(faixas) as Array<[FaixaId, number]>) {
      soma += qtd
      acumulado.push([id, soma])
    }
    if (soma > 0) for (const par of acumulado) par[1] /= soma
  }

  const sortearEspessura = (): { um: number; faixa: FaixaId } => {
    if (acumulado.length === 0) {
      const um = m.espessuraMediaUm ?? 60
      const faixa: FaixaId = um < 40 ? 'ate40' : um < 60 ? 'f40a60' : um < 80 ? 'f60a80' : um < 100 ? 'f80a100' : 'acima100'
      return { um, faixa }
    }
    const p = rnd()
    const achado = acumulado.find(([, ate]) => p <= ate) ?? acumulado[acumulado.length - 1]
    const [min, max] = LIMITES[achado[0]]
    return { um: min + rnd() * (max - min), faixa: achado[0] }
  }

  /**
   * Unidade folicular não se distribui em grade nem em nuvem aleatória: fica mais
   * ou menos espaçada. Grade com tremor dá exatamente isso e não precisa de
   * Poisson-disk para um desenho deste tamanho.
   */
  const colunas = Math.ceil(Math.sqrt(nUf))
  const passo = LADO_MM / colunas
  const unidades: UnidadeDesenhada[] = []

  /**
   * Fios por unidade: a razão média é conhecida (fios ÷ UF), a distribuição real
   * não — o CRM guarda contagem, não o agrupamento fio a fio. Então cada unidade
   * recebe o piso ou o teto dessa razão, na proporção que reproduz a média exata.
   * É a hipótese mais fraca possível: não inventa tufo de 4 fios que a medida não
   * sustenta.
   */
  const razao = nFios / nUf
  const piso = Math.max(1, Math.floor(razao))
  const chanceTeto = razao - piso

  let fiosColocados = 0
  for (let i = 0; i < nUf; i++) {
    const col = i % colunas
    const lin = Math.floor(i / colunas)
    const x = (col + 0.5) * passo + (rnd() - 0.5) * passo * 0.7
    const y = (lin + 0.5) * passo + (rnd() - 0.5) * passo * 0.7
    if (y > LADO_MM) break

    const quantos = rnd() < chanceTeto ? piso + 1 : piso
    const fios: FioDesenhado[] = []
    // direção comum da unidade: fios do mesmo folículo saem quase paralelos
    const direcao = rnd() * Math.PI * 2

    for (let f = 0; f < quantos && fiosColocados < nFios; f++) {
      const { um, faixa } = sortearEspessura()
      fios.push({
        x: x + (rnd() - 0.5) * 0.22,
        y: y + (rnd() - 0.5) * 0.22,
        angulo: direcao + (rnd() - 0.5) * 0.9,
        // fio miniaturizado também é curto: o comprimento acompanha a espessura,
        // que é o que se vê na tricoscopia de verdade
        comprimentoMm: 0.5 + (um / 140) * 0.9,
        espessuraUm: um,
        faixa,
      })
      fiosColocados++
    }
    if (fios.length > 0) unidades.push({ x, y, fios })
  }

  return {
    ladoMm: LADO_MM,
    unidades,
    totalFios: fiosColocados,
    totalUnidades: unidades.length,
    espessuraMediaUm: m.espessuraMediaUm,
  }
}
