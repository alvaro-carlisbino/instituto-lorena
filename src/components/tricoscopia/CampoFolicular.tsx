import { LADO_MM, montarCampo, type MedidaParaCampo } from '@/lib/campoFolicular'
import { FAIXAS, dia } from '@/lib/tricoscopia'

/**
 * Antes e depois desenhados a partir das medidas. Ver o cabeçalho de
 * @/lib/campoFolicular para o porquê de não ser a foto — e para o cuidado de
 * nunca deixar isso passar por foto.
 *
 * Os dois quadros são o MESMO centímetro quadrado e a MESMA escala de espessura.
 * Sem isso o desenho vira ilusão de ótica em vez de comparação.
 *
 * É o único desenho da tela que mostra densidade, que é a medida barulhenta. Por
 * isso ele vem DEPOIS do feixe de fios no laudo, e o rodapé diz o tamanho do ruído.
 */

const COR_FAIXA: Record<string, string> = Object.fromEntries(
  FAIXAS.map((f, i) => [f.id, `var(--viz-faixa-${i + 1})`]),
)

/** px por mm no desenho. 34 dá um quadro de 340px, que cabe em dois por linha. */
const ESCALA = 34

function Quadro({ medida, rotulo }: { medida: MedidaParaCampo & { capturadoEm: string }; rotulo: string }) {
  const campo = montarCampo(medida)
  const lado = LADO_MM * ESCALA

  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</span>
        <span className="text-sm tabular-nums">{dia(medida.capturadoEm)}</span>
      </figcaption>

      {campo === null ? (
        <div
          className="flex items-center justify-center rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground"
          style={{ aspectRatio: '1 / 1' }}
        >
          Exame sem calibração: não dá para desenhar em escala.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${lado} ${lado}`}
          className="w-full rounded-lg border border-border"
          style={{ background: 'var(--viz-couro)' }}
          role="img"
          aria-label={`${rotulo}, ${dia(medida.capturadoEm)}: ${campo.totalUnidades} unidades foliculares e ${campo.totalFios} fios por centímetro quadrado`}
        >
          {campo.unidades.map((u, iu) =>
            u.fios.map((f, i) => {
              const x = f.x * ESCALA
              const y = f.y * ESCALA
              const dx = (Math.cos(f.angulo) * f.comprimentoMm * ESCALA) / 2
              const dy = (Math.sin(f.angulo) * f.comprimentoMm * ESCALA) / 2
              return (
                <line
                  key={`${iu}-${i}`}
                  x1={x - dx}
                  y1={y - dy}
                  x2={x + dx}
                  y2={y + dy}
                  stroke={COR_FAIXA[f.faixa]}
                  // espessura do traço proporcional à espessura medida, com um piso
                  // para o fio fino não sumir na tela do consultório
                  strokeWidth={Math.max(1, (f.espessuraUm / 140) * 5)}
                  strokeLinecap="round"
                />
              )
            }),
          )}
        </svg>
      )}

      {campo && (
        <p className="m-0 mt-1.5 text-xs text-muted-foreground tabular-nums">
          {campo.totalUnidades} unidades · {campo.totalFios} fios · fio médio{' '}
          {campo.espessuraMediaUm?.toFixed(1).replace('.', ',') ?? '—'} µm
        </p>
      )}
    </figure>
  )
}

export function CampoFolicular({
  primeiro,
  ultimo,
}: {
  primeiro: MedidaParaCampo & { capturadoEm: string }
  ultimo: MedidaParaCampo & { capturadoEm: string }
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Quadro medida={primeiro} rotulo="Primeiro exame" />
        <Quadro medida={ultimo} rotulo="Exame mais recente" />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {FAIXAS.map((f, i) => (
          <span key={f.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: `var(--viz-faixa-${i + 1})`, height: Math.max(2, (i + 1) * 1.1) }}
            />
            {f.label}
          </span>
        ))}
      </div>

      {/* O aviso é do tamanho que precisa ser. Desenho passando por exame é pior
          do que não ter imagem nenhuma. */}
      <p className="m-0 rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Isto não é a foto do exame.</strong> É um desenho de{' '}
        <strong>1 cm² representativo</strong>, gerado a partir das medidas daquela captura: a quantidade de
        unidades foliculares, quantos fios em cada uma e a distribuição de espessura são as do exame. A posição
        de cada fio é sorteada — mas com semente fixa, então este desenho é sempre o mesmo para este exame.
        Os dois quadros usam a mesma escala.
        {' '}
        <strong className="text-foreground">A quantidade de fios oscila 13,8% entre capturas</strong> mesmo
        sem nada mudar na cabeça — é o erro de posicionar o quadrado. Diferença menor que isso entre os dois
        lados não quer dizer nada; para ver o que mudou de verdade, o feixe de fios acima fixa a contagem.
      </p>
    </div>
  )
}
