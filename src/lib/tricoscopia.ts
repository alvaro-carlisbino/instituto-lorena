/**
 * Regras de leitura da tricoscopia do HairMetrix. Tudo aqui é função pura, para
 * poder ser testado sem subir tela — e porque errar qualquer uma delas produz um
 * laudo bonito e errado na frente do paciente.
 */

// ---------------------------------------------------------------------------
// RUÍDO DA MEDIDA
// ---------------------------------------------------------------------------
/**
 * O maior risco desta tela é vender ruído como resultado.
 *
 * A área doadora (occipital) não rala: é justamente por isso que ela é doadora.
 * Então tudo que ela varia entre dois exames do MESMO paciente é erro de medida —
 * o ROI cai dois centímetros ao lado, o cabelo está mais comprido, o operador
 * encostou o aparelho em outro ângulo. Isso dá um piso de ruído medido, não
 * chutado.
 *
 * Levantado em 11/08/2026 sobre pares consecutivos de occipital no mesmo aparelho
 * (mediana da variação absoluta entre exames vizinhos):
 *
 *   % de fios finos .......  2,4 pp    proporção
 *   comprimento médio .....  4,2%      por fio
 *   espessura média .......  5,1%      por fio
 *   espessura mediana .....  5,2%      por fio
 *   % de fio terminal .....  5,5 pp    proporção
 *   fios por UF ...........  6,8%      razão entre duas contagens
 *   espessura p10 ......... 10,8%      percentil extremo, amostra pequena
 *   densidade fios/cm² .... 13,8%      contagem ÷ área
 *   massa capilar ......... 15,5%      contagem × calibre
 *   razão com a doadora ... 23,2%      razão entre dois ruídos
 *
 * A REGRA QUE SAI DAÍ: tudo que é POR FIO é estável; tudo que envolve CONTAR
 * DENTRO DE UMA ÁREA herda o erro de posicionamento do ROI, que sozinho já anda
 * 5,1%. Por isso o laudo lidera por espessura e miniaturização, e a densidade
 * aparece marcada.
 *
 * Duas montagens boas morreram nessa conta, e ficam registradas para ninguém
 * tentar de novo achando que é ideia nova:
 *
 *   - MASSA CAPILAR (área transversal total de fio por cm², somada faixa a faixa
 *     do histograma). É o número que corresponde ao que a pessoa vê no espelho, e
 *     a média por região bate certinho com a fisiologia — occipital 0,57 >
 *     vértice 0,44 > frontal 0,37 > temporal 0,28 mm²/cm². Mas tem 15,5% de
 *     ruído, pior que a densidade: multiplica o erro de contagem pelo de calibre.
 *   - RAZÃO COM A PRÓPRIA DOADORA (normalizar a região pelo teto genético do
 *     paciente). Parecia cancelar o erro de captura por serem do mesmo dia; na
 *     prática deu 23,2%, o pior de todos, porque os erros de ROI de duas regiões
 *     são independentes e a razão soma as duas variâncias em vez de cancelar.
 *     O que sobrou dessa ideia e vale é comparar ESPESSURA com a doadora dentro
 *     do mesmo exame — ver PerfilDoCouro.
 *
 * Para refazer a conta quando houver mais exame:
 *   lag() por (paciente, região) em regiao ilike 'occiput%', percentile_cont(0.5)
 *   da variação absoluta, agrupando por serial_dispositivo igual ou diferente.
 *   Com troca de aparelho tudo piora: densidade 16,1%, área do ROI 12,8%.
 */
export const RUIDO = {
  densidadePct: 13.8,
  espessuraPct: 5.1,
  finosPp: 2.4,
  fiosPorUfPct: 6.8,
  comprimentoPct: 4.2,
  medianaPct: 5.2,
  p10Pct: 10.8,
} as const

export type Veredito = 'ganho' | 'estavel' | 'perda' | 'indefinido'

/**
 * Classifica uma variação contra o ruído da própria métrica. Dentro do piso é
 * 'estavel' — não "leve melhora", não "tendência positiva". Estável.
 */
export function classificar(valor: number | null | undefined, ruido: number, inverso = false): Veredito {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return 'indefinido'
  if (Math.abs(valor) < ruido) return 'estavel'
  const positivo = valor > 0
  return (inverso ? !positivo : positivo) ? 'ganho' : 'perda'
}

// ---------------------------------------------------------------------------
// NOMES
// ---------------------------------------------------------------------------

/** O Mirror grava "SOBRENOME, NOME". Vira "Nome Sobrenome" para leitura. */
export function nomePacienteLegivel(nomePasta: string): string {
  const [sobrenome, nome] = nomePasta.split(',').map((s) => s.trim())
  const cru = nome ? `${nome} ${sobrenome}` : nomePasta
  return cru.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
}

/**
 * O worklist repete região dentro da mesma sessão com sufixo `_1`, `_2` quando o
 * operador recaptura o ponto. É o MESMO ponto anatômico: sem tirar o sufixo, a
 * série se parte em duas e a evolução some.
 */
export function baseRegiao(regiao: string): string {
  return regiao.replace(/_\d+$/, '').trim()
}

/**
 * Área doadora. O regex antigo (`occiput|occipital`) perdia o que a equipe digita
 * à mão — "doadora", "area doadora", "Occiptal" — e aí o controle da medida
 * sumia justo nos exames feitos fora do worklist padrão.
 */
export function ehAreaDoadora(regiao: string | null | undefined): boolean {
  if (!regiao) return false
  return /occip|occpi|doadora/i.test(regiao)
}

/** Região que não é couro cabeludo. Barba e sobrancelha não entram no mapa da cabeça. */
export function foraDoCouro(regiao: string | null | undefined): boolean {
  if (!regiao) return false
  return /barba|sobrancelh/i.test(regiao)
}

/** Explicação curta em português, para o paciente. Vazia quando não há tradução honesta. */
export function glosaRegiao(regiao: string | null | undefined): string {
  if (!regiao) return ''
  const r = baseRegiao(regiao).toLowerCase()
  if (/barba/.test(r)) return 'barba'
  if (/sobrancelh/.test(r)) return 'sobrancelha'
  if (ehAreaDoadora(r)) return 'área doadora — não rala, serve de controle'
  if (/vertex|coroa/.test(r)) return 'coroa'
  if (/^mid|escalpe medio/.test(r)) return 'meio da cabeça'
  if (/frontal|risca|topete/.test(r)) return 'frente / entradas'
  if (/temporal/.test(r)) return 'entrada lateral'
  if (/parietal/.test(r)) return 'lateral'
  return ''
}

/**
 * Ordem de leitura anatômica, da frente para a nuca. Ordenar por volume de exame
 * (o que a tela fazia) embaralha frente com nuca e atrapalha quem está lendo em
 * voz alta para o paciente.
 */
export function ordemRegiao(regiao: string | null | undefined): number {
  if (!regiao) return 900
  const r = baseRegiao(regiao).toLowerCase()
  if (/frontal|risca|topete/.test(r)) return 10
  if (/temporal/.test(r)) return 20
  if (/^mid|escalpe medio/.test(r)) return 30
  if (/vertex|coroa/.test(r)) return 40
  if (/parietal/.test(r)) return 50
  if (ehAreaDoadora(r)) return 60
  if (foraDoCouro(r)) return 80
  return 70
}

// ---------------------------------------------------------------------------
// MAPA DO COURO CABELUDO
// ---------------------------------------------------------------------------
/**
 * Vista de cima, nariz para cima. Quem olha está ATRÁS do paciente, olhando para
 * baixo — então a esquerda da tela é a esquerda do paciente. Isso está escrito na
 * legenda do mapa: espelhar lado em laudo de saúde é o tipo de erro que ninguém
 * percebe até operar o lado errado.
 *
 * Coordenadas no viewBox 0 0 260 340. Região que não casa devolve null e aparece
 * fora do desenho, com o número — melhor de fora do que num lugar inventado.
 */
export type PontoCouro = { x: number; y: number }

const PONTOS: Array<[RegExp, PontoCouro]> = [
  // frente
  [/^frontal 1 left$/, { x: 100, y: 54 }],
  [/^frontal 1 right$/, { x: 160, y: 54 }],
  [/^frontal 2 left$/, { x: 102, y: 86 }],
  [/^frontal 2 right$/, { x: 158, y: 86 }],
  [/^frontal 2$/, { x: 130, y: 86 }],
  [/^frontal|^risca|^topete/, { x: 130, y: 52 }],
  // laterais altas
  [/^temporal 1 left$|^temporal left$|^temporal esq/, { x: 58, y: 88 }],
  [/^temporal 1 right$|^temporal right$|^temporal dir/, { x: 202, y: 88 }],
  [/^temporal 2 left$/, { x: 50, y: 120 }],
  [/^temporal 2 right$/, { x: 210, y: 120 }],
  // meio
  [/^mid lateral left$/, { x: 72, y: 120 }],
  [/^mid lateral right$/, { x: 188, y: 120 }],
  [/^mid left$/, { x: 100, y: 120 }],
  [/^mid right$/, { x: 160, y: 120 }],
  [/^mid$|^mild$|^escalpe medio$/, { x: 130, y: 120 }],
  // coroa
  [/^vertex 2 anterior$/, { x: 130, y: 152 }],
  [/^vertex 2 posterior$/, { x: 130, y: 208 }],
  [/^vertex|^coroa/, { x: 130, y: 180 }],
  // laterais baixas
  [/^parietal 1a left$/, { x: 64, y: 152 }],
  [/^parietal 1a right$/, { x: 196, y: 152 }],
  [/^parietal 1b left$|^parietal 1 left$/, { x: 56, y: 182 }],
  [/^parietal 1b right$|^parietal 1 right$/, { x: 204, y: 182 }],
  [/^parietal 2. left$/, { x: 62, y: 212 }],
  [/^parietal 2. right$/, { x: 198, y: 212 }],
  [/^parietal 3. left$/, { x: 72, y: 240 }],
  [/^parietal 3. right$/, { x: 188, y: 240 }],
  [/^parietal.*left$/, { x: 58, y: 182 }],
  [/^parietal.*right$/, { x: 202, y: 182 }],
  // nuca
  [/^occiput 1 left$/, { x: 106, y: 234 }],
  [/^occiput 1 right$/, { x: 154, y: 234 }],
  [/^occiput 2 left$/, { x: 102, y: 264 }],
  [/^occiput 2 right$/, { x: 158, y: 264 }],
  [/^occiput 3 left$/, { x: 100, y: 294 }],
  [/^occiput 3 right$/, { x: 160, y: 294 }],
  [/^occiput 4 left$/, { x: 112, y: 318 }],
  [/^occiput 4 right$/, { x: 148, y: 318 }],
  [/alto$/, { x: 130, y: 246 }],
  [/baixo$/, { x: 130, y: 314 }],
  [/^occip|^occpi|doadora/, { x: 130, y: 288 }],
]

export function pontoNoCouro(regiao: string | null | undefined): PontoCouro | null {
  if (!regiao || foraDoCouro(regiao)) return null
  const r = baseRegiao(regiao).toLowerCase().trim()
  for (const [re, ponto] of PONTOS) if (re.test(r)) return ponto
  return null
}

// ---------------------------------------------------------------------------
// HISTOGRAMA DE ESPESSURA
// ---------------------------------------------------------------------------
/**
 * O agente grava seis faixas, e a mais fina ("ate20") é quase sempre vazia. As
 * duas primeiras viram uma só porque 40 µm é o corte de miniaturização que o
 * próprio espelho usa em `pct_fios_finos`: abaixo disso é fio em involução.
 * Cinco faixas também é o que a rampa de cor aguenta com passos distinguíveis.
 */
export type FaixaId = 'ate40' | 'f40a60' | 'f60a80' | 'f80a100' | 'acima100'

export const FAIXAS: Array<{ id: FaixaId; label: string; descricao: string }> = [
  { id: 'ate40', label: 'até 40 µm', descricao: 'fio miniaturizado, em involução' },
  { id: 'f40a60', label: '40–60 µm', descricao: 'fio fino' },
  { id: 'f60a80', label: '60–80 µm', descricao: 'fio médio' },
  { id: 'f80a100', label: '80–100 µm', descricao: 'fio grosso' },
  { id: 'acima100', label: 'acima de 100 µm', descricao: 'fio muito grosso' },
]

export type HistogramaBruto = Record<string, unknown> | null | undefined

export function faixasDoHistograma(hist: HistogramaBruto): Record<FaixaId, number> | null {
  if (!hist || typeof hist !== 'object') return null
  const n = (k: string) => {
    const v = (hist as Record<string, unknown>)[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const faixas: Record<FaixaId, number> = {
    ate40: n('ate20') + n('20a40'),
    f40a60: n('40a60'),
    f60a80: n('60a80'),
    f80a100: n('80a100'),
    acima100: n('acima100'),
  }
  const total = Object.values(faixas).reduce((a, b) => a + b, 0)
  return total > 0 ? faixas : null
}

// ---------------------------------------------------------------------------
// FORMATAÇÃO
// ---------------------------------------------------------------------------

export function dia(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

/** "1 ano e 3 meses" lê melhor que "462 dias" quando o médico narra a evolução. */
export function periodoLegivel(dias: number | null | undefined): string {
  if (dias === null || dias === undefined || dias <= 0) return 'exame inicial'
  if (dias < 45) return `${dias} dia${dias === 1 ? '' : 's'}`
  const meses = Math.round(dias / 30.4)
  if (meses < 18) return `${meses} meses`
  const anos = Math.floor(meses / 12)
  const resto = meses % 12
  const a = `${anos} ano${anos === 1 ? '' : 's'}`
  return resto === 0 ? a : `${a} e ${resto} ${resto === 1 ? 'mês' : 'meses'}`
}

export function sinal(v: number, casas = 1): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(casas)}`
}
