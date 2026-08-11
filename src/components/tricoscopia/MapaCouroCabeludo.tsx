import { pontoNoCouro, type Veredito } from '@/lib/tricoscopia'
import { cn } from '@/lib/utils'

/**
 * Onde, na cabeça, o tratamento está funcionando. É o desenho que o médico gira a
 * tela e mostra — por isso número grande, sem decimal, e a leitura fina fica nas
 * tabelas abaixo.
 *
 * Cor sozinha não decide nada: cada região carrega o número com sinal, e o
 * veredito também sai escrito na lista ao lado. Quem não distingue azul de
 * vermelho lê exatamente a mesma informação.
 */

export type RegiaoNoMapa = {
  regiao: string
  rotulo: string
  valor: number | null
  veredito: Veredito
  /** Sem série (um exame só) não tem variação para mostrar. */
  temSerie: boolean
}

const FILL: Record<Veredito, string> = {
  ganho: 'var(--viz-ganho)',
  perda: 'var(--viz-perda)',
  estavel: 'var(--viz-estavel)',
  indefinido: 'transparent',
}

const INK: Record<Veredito, string> = {
  ganho: '#ffffff',
  perda: '#ffffff',
  estavel: 'var(--viz-ink)',
  indefinido: 'var(--viz-muted)',
}

/** Silhueta vista de cima, nariz para cima. */
const CRANIO =
  'M130 10 C 80 10, 42 58, 40 138 C 38 228, 72 328, 130 330 C 188 328, 222 228, 220 138 C 218 58, 180 10, 130 10 Z'

/** Vírgula decimal: o resto do laudo usa pt-BR, e "15.6%" ao lado de "15,6%" parece defeito. */
const n1 = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}`

export function MapaCouroCabeludo({
  regioes,
  selecionada,
  onSelecionar,
  sufixo,
}: {
  regioes: RegiaoNoMapa[]
  selecionada: string | null
  onSelecionar: (regiao: string | null) => void
  /** Unidade do número — '%' para variação relativa, 'pp' para ponto percentual. */
  sufixo: string
}) {
  const noDesenho = regioes
    .map((r) => ({ ...r, ponto: pontoNoCouro(r.regiao) }))
    .filter((r): r is RegiaoNoMapa & { ponto: { x: number; y: number } } => r.ponto !== null)

  const foraDoDesenho = regioes.filter((r) => pontoNoCouro(r.regiao) === null)

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <figure className="m-0">
        <svg viewBox="0 0 260 344" role="img" className="w-full max-w-[260px]" aria-labelledby="mapa-couro-titulo">
          <title id="mapa-couro-titulo">
            Mapa do couro cabeludo visto de cima, com a variação de cada região medida
          </title>

          {/* referência de orientação: o entalhe é o nariz */}
          <path d={CRANIO} fill="var(--viz-cranio)" stroke="var(--viz-linha)" strokeWidth="1.5" />
          <path d="M122 12 L130 2 L138 12" fill="none" stroke="var(--viz-linha)" strokeWidth="1.5" />
          <path d="M40 128 L30 138 L40 152" fill="none" stroke="var(--viz-linha)" strokeWidth="1.5" />
          <path d="M220 128 L230 138 L220 152" fill="none" stroke="var(--viz-linha)" strokeWidth="1.5" />

          {noDesenho.map((r) => {
            const ativa = selecionada === r.regiao
            return (
              <g
                key={r.regiao}
                className="cursor-pointer"
                onClick={() => onSelecionar(ativa ? null : r.regiao)}
                role="button"
                tabIndex={0}
                aria-label={`${r.rotulo}: ${r.temSerie && r.valor !== null ? `${r.valor > 0 ? 'mais' : 'menos'} ${Math.abs(r.valor).toFixed(1).replace('.', ',')}${sufixo}` : 'exame único, sem comparação'}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelecionar(ativa ? null : r.regiao)
                  }
                }}
              >
                {/* anel na cor da superfície: separa círculos que se encostam */}
                <circle cx={r.ponto.x} cy={r.ponto.y} r={16.5} fill="var(--viz-surface)" />
                <circle
                  cx={r.ponto.x}
                  cy={r.ponto.y}
                  r={15}
                  fill={r.temSerie ? FILL[r.veredito] : 'transparent'}
                  stroke={ativa ? 'var(--viz-ink)' : 'var(--viz-linha)'}
                  strokeWidth={ativa ? 2.5 : 1}
                  strokeDasharray={r.temSerie ? undefined : '3 3'}
                />
                <text
                  x={r.ponto.x}
                  y={r.ponto.y + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill={r.temSerie ? INK[r.veredito] : 'var(--viz-muted)'}
                >
                  {r.temSerie && r.valor !== null ? `${r.valor > 0 ? '+' : ''}${Math.round(r.valor)}` : '1×'}
                </text>
              </g>
            )
          })}
        </svg>
        <figcaption className="mt-2 max-w-[260px] text-[0.7rem] leading-snug text-muted-foreground">
          Visto de cima, nariz para cima. A <strong>esquerda da tela é a esquerda do paciente</strong>.
          Círculo tracejado com <code>1×</code> é região com um exame só: não há o que comparar.
        </figcaption>
      </figure>

      <div className="min-w-0">
        <ul className="m-0 divide-y divide-border border-y border-border p-0">
          {regioes.map((r) => {
            const ativa = selecionada === r.regiao
            return (
              <li key={r.regiao} className="list-none">
                <button
                  type="button"
                  onClick={() => onSelecionar(ativa ? null : r.regiao)}
                  className={cn(
                    'flex w-full items-center gap-3 px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50',
                    ativa && 'bg-muted',
                  )}
                >
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full border"
                    style={{
                      background: r.temSerie ? FILL[r.veredito] : 'transparent',
                      borderColor: 'var(--viz-linha)',
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{r.rotulo}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {!r.temSerie
                      ? 'exame único'
                      : r.veredito === 'estavel'
                        ? 'estável'
                        : r.veredito === 'ganho'
                          ? 'ganhou'
                          : r.veredito === 'perda'
                            ? 'perdeu'
                            : '—'}
                  </span>
                  <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                    {r.temSerie && r.valor !== null ? `${n1(r.valor)}${sufixo}` : '—'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {foraDoDesenho.length > 0 && (
          <p className="mt-2 text-[0.7rem] text-muted-foreground">
            Fora do desenho da cabeça: {foraDoDesenho.map((r) => r.rotulo).join(', ')}. São pontos digitados à
            mão no aparelho, sem posição definida no worklist — o número vale, o lugar no mapa não.
          </p>
        )}
      </div>
    </div>
  )
}
