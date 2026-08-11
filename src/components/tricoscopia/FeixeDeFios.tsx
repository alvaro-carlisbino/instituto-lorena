import { FIOS_NO_FEIXE, montarFeixe, type MedidaParaFeixe } from '@/lib/feixeDeFios'
import { FAIXAS, dia } from '@/lib/tricoscopia'

/**
 * Cem fios do paciente, do mais fino ao mais grosso. Ver @/lib/feixeDeFios para o
 * porquê da contagem ser fixa: some a densidade, que é a medida barulhenta, e o que
 * fica na tela é só o calibre, que é a estável.
 *
 * Nada aqui é sorteado. A quantidade de fios em cada faixa é a proporção medida no
 * exame, e a ordem é a espessura. É o histograma desenhado como cabelo.
 */

const COR: Record<string, string> = Object.fromEntries(
  FAIXAS.map((f, i) => [f.id, `var(--viz-faixa-${i + 1})`]),
)

/**
 * 7px por fio × 100 = 700 de largura. O traço mais grosso para em 5px, então sobram
 * 2px de respiro: sem isso o lado grosso do feixe vira um bloco sólido e some
 * justamente a leitura de "são fios separados".
 */
const PASSO = 7
const ALTURA = 150

type Quadro = MedidaParaFeixe & { capturadoEm: string; rotulo: string }

function Painel({ quadro, escalaComprimento }: { quadro: Quadro; escalaComprimento: number }) {
  const feixe = montarFeixe(quadro)

  if (!feixe) {
    return (
      <figure className="m-0">
        <Legenda quadro={quadro} />
        <div className="flex h-[150px] items-center justify-center rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
          Exame sem histograma de espessura.
        </div>
      </figure>
    )
  }

  const largura = FIOS_NO_FEIXE * PASSO

  return (
    <figure className="m-0">
      <Legenda quadro={quadro} />
      <svg
        viewBox={`0 0 ${largura} ${ALTURA}`}
        className="w-full rounded-lg border border-border"
        style={{ background: 'var(--viz-couro)' }}
        role="img"
        aria-label={`${quadro.rotulo}, ${dia(quadro.capturadoEm)}: de cada cem fios, ${feixe.porFaixa.ate40} estão abaixo de 40 micrômetros`}
      >
        {feixe.fios.map((f) => {
          const x = f.ordem * PASSO + PASSO / 2
          // comprimento do traço proporcional ao segmento realmente medido, para o
          // quadro que teve fio mais curto não mentir que teve fio igual
          const alturaFio = ALTURA * 0.82 * escalaComprimento
          return (
            <line
              key={f.ordem}
              x1={x}
              y1={ALTURA - 6}
              x2={x}
              y2={ALTURA - 6 - alturaFio}
              stroke={COR[f.faixa]}
              strokeWidth={Math.max(1.2, (f.espessuraUm / 140) * 5)}
              strokeLinecap="round"
            />
          )
        })}
        {/* marca dos 40 µm: a partir daqui, o fio é miniaturizado */}
        {feixe.porFaixa.ate40 > 0 && (
          <line
            x1={feixe.porFaixa.ate40 * PASSO}
            y1={4}
            x2={feixe.porFaixa.ate40 * PASSO}
            y2={ALTURA - 2}
            stroke="var(--viz-linha)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
      </svg>
      <p className="m-0 mt-1.5 text-xs text-muted-foreground tabular-nums">
        <strong className="text-foreground">{feixe.porFaixa.ate40} de cada 100</strong> abaixo de 40 µm ·
        fio médio {feixe.espessuraMediaUm?.toFixed(1).replace('.', ',') ?? '—'} µm
      </p>
    </figure>
  )
}

function Legenda({ quadro }: { quadro: Quadro }) {
  return (
    <figcaption className="mb-1.5 flex items-baseline gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {quadro.rotulo}
      </span>
      <span className="text-sm tabular-nums">{dia(quadro.capturadoEm)}</span>
    </figcaption>
  )
}

export function FeixeDeFios({ primeiro, ultimo }: { primeiro: Quadro; ultimo: Quadro }) {
  // Os dois quadros compartilham a escala de comprimento, senão o fio mais curto
  // apareceria do mesmo tamanho do mais longo e a comparação viraria decoração.
  const maior = Math.max(primeiro.comprimentoMedioMm ?? 0, ultimo.comprimentoMedioMm ?? 0) || 1
  const escala = (q: Quadro) => (q.comprimentoMedioMm ? q.comprimentoMedioMm / maior : 1)

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <Painel quadro={primeiro} escalaComprimento={escala(primeiro)} />
        <Painel quadro={ultimo} escalaComprimento={escala(ultimo)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {FAIXAS.map((f, i) => (
          <span key={f.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block w-3.5 rounded-full"
              style={{ background: `var(--viz-faixa-${i + 1})`, height: Math.max(2, (i + 1) * 1.2) }}
            />
            {f.label}
          </span>
        ))}
      </div>

      <p className="m-0 rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">São cem fios dos dois lados, de propósito.</strong> A quantidade
        de fios por cm² é a medida mais instável do exame — a área doadora, que não rala, oscila 13,8% entre
        capturas. Fixando a contagem, o que sobra na tela é só a mudança de calibre, que é a parte confiável.
        A quantidade de fios em cada faixa é a proporção medida naquele exame, e a ordem é a espessura:
        nenhuma posição aqui é sorteada. A linha tracejada marca os 40 µm, o corte de miniaturização.
      </p>
    </div>
  )
}
