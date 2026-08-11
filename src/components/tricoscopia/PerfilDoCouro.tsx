import { RUIDO } from '@/lib/tricoscopia'
import type { RegiaoNoPerfil } from '@/lib/perfilDoCouro'
import { cn } from '@/lib/utils'

/**
 * O PADRÃO DE RAREFAÇÃO: cada região contra a área doadora do próprio paciente,
 * medidas no MESMO exame.
 *
 * Por que isto é defensável e a "razão com a doadora" que eu ia montar não era: a
 * tentativa anterior dividia massa capilar de uma região pela da doadora, e massa
 * é contagem × calibre — o resultado ficou com 23,2% de ruído, pior do que
 * qualquer métrica isolada, porque razão entre dois números barulhentos compõe os
 * dois erros. Aqui a comparação é de ESPESSURA MÉDIA, que varia 5,1%, e a distância
 * fisiológica entre nuca e vértice é da ordem de 15 a 20%: o sinal passa longe do
 * ruído.
 *
 * E é a comparação certa clinicamente. A doadora é o teto genético daquela pessoa —
 * quanto o fio dela consegue ser grosso quando o hormônio não interfere. A distância
 * de cada região até esse teto é o desenho da alopecia androgenética daquele
 * paciente, e não de uma tabela de referência de outra gente.
 */


export type { RegiaoNoPerfil }

export function PerfilDoCouro({
  regioes,
  referenciaUm,
  regiaoReferencia,
  referenciaHistoricaUm,
}: {
  regioes: RegiaoNoPerfil[]
  /** espessura da doadora no mesmo exame; null quando ela não foi capturada */
  referenciaUm: number | null
  regiaoReferencia: string | null
  /**
   * Mediana da doadora deste paciente em TODOS os exames. Serve para desconfiar da
   * própria referência: a régua inteira pendura na doadora daquela sessão, e se
   * aquela captura saiu torta, todas as distâncias saem tortas juntas — sem nada na
   * tela denunciando, porque o erro é comum a todas as barras.
   */
  referenciaHistoricaUm: number | null
}) {
  const desvioDaReferencia =
    referenciaUm && referenciaHistoricaUm
      ? ((referenciaUm - referenciaHistoricaUm) * 100) / referenciaHistoricaUm
      : null
  const referenciaSuspeita = desvioDaReferencia !== null && Math.abs(desvioDaReferencia) >= RUIDO.espessuraPct
  const valores = regioes.map((r) => r.espessuraUm ?? 0)
  const teto = Math.max(...valores, referenciaUm ?? 0, 1)

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {regioes.map((r) => {
          const largura = r.espessuraUm ? (r.espessuraUm / teto) * 100 : 0
          const distancia =
            referenciaUm && r.espessuraUm && !r.ehDoadora
              ? ((r.espessuraUm - referenciaUm) * 100) / referenciaUm
              : null

          return (
            <div key={r.regiao} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_5rem] items-center gap-3">
              <span className="truncate text-sm">
                {r.regiao}
                {r.ehDoadora && (
                  <span className="ml-1.5 text-xs text-muted-foreground">referência</span>
                )}
              </span>

              <div className="relative h-6">
                <div
                  className={cn('h-full rounded-sm', r.ehDoadora ? 'opacity-100' : 'opacity-85')}
                  style={{
                    width: `${largura}%`,
                    background: r.ehDoadora ? 'var(--viz-controle)' : 'var(--viz-serie)',
                  }}
                />
                {/* a linha do teto do próprio paciente, atravessando todas as barras */}
                {referenciaUm && (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 w-px"
                    style={{ left: `${(referenciaUm / teto) * 100}%`, background: 'var(--viz-ink)' }}
                  />
                )}
              </div>

              <span className="text-right text-sm tabular-nums">
                {r.espessuraUm ? `${r.espessuraUm.toFixed(1).replace('.', ',')} µm` : '—'}
                {distancia !== null && (
                  <span className="block text-xs text-muted-foreground">
                    {distancia > 0 ? '+' : ''}
                    {distancia.toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {referenciaSuspeita && desvioDaReferencia !== null && (
        <p className="m-0 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
          A área doadora deste exame está{' '}
          <strong className="tabular-nums">
            {desvioDaReferencia > 0 ? '+' : ''}
            {desvioDaReferencia.toFixed(0)}%
          </strong>{' '}
          longe da mediana dela nos outros exames deste paciente ({referenciaHistoricaUm?.toFixed(1).replace('.', ',')} µm).
          Ela não deveria mudar. Como a régua inteira pendura nela, todas as distâncias abaixo estão
          deslocadas na mesma medida — leia a ordem entre as regiões, não o número.
        </p>
      )}

      <p className="m-0 text-xs leading-relaxed text-muted-foreground">
        {referenciaUm && regiaoReferencia ? (
          <>
            A linha vertical é a <strong className="text-foreground">{regiaoReferencia}</strong>, a área
            doadora deste paciente: {referenciaUm.toFixed(1).replace('.', ',')} µm. Ela não sofre a ação
            hormonal, então é o teto de espessura que o cabelo dele alcança. A porcentagem ao lado de cada
            região é a distância até esse teto — é o desenho da alopecia <em>deste</em> paciente, não de uma
            tabela de referência de outra gente. Todas as medidas são do mesmo exame, mesmo dia, mesmo
            operador.
          </>
        ) : (
          <>
            Este exame não capturou a área doadora, então não há referência interna: dá para comparar as
            regiões entre si, mas não para dizer o quanto cada uma está longe do teto do próprio paciente.
          </>
        )}
      </p>
    </div>
  )
}
