import { cn } from '@/lib/utils'
import { lerTriagemLanding } from '@/lib/triagemLanding'
import { temperatureBadgeClass } from '@/lib/leadRowStyles'
import { temperatureLabel } from '@/lib/fieldLabels'
import type { Lead } from '@/mocks/crmMock'

/**
 * O que a pessoa respondeu na landing `/consulta`, na ficha de quem vai atender.
 *
 * A edge function já mandava tudo para o `summary` do lead, mas o summary tem 400
 * caracteres, é uma linha só e aparece truncado na lista — a atendente ligava sem
 * saber o grau, a urgência nem a estimativa de folículos. Este cartão só existe para
 * leads carimbados com `origem_landing`; para todo o resto ele não renderiza nada.
 *
 * O score aparece SOBRE O TETO da triagem que aquela pessoa respondeu, e não sobre
 * 100: a landing já encolheu duas vezes (saiu a escolha de horário, depois duas
 * perguntas), e ler "60/100" faria a atendente rebaixar sozinha quem o sistema
 * classificou como morno pela régua certa. Ver `tetoDaTriagem`.
 */
export function LeadTriagemCard({ lead }: { lead: Lead }) {
  const t = lerTriagemLanding(lead.customFields)
  if (!t) return null

  const linhas: Array<{ label: string; value: string; wide?: boolean }> = [
    { label: 'Objetivo', value: t.objetivo },
    { label: 'Grau', value: t.grau },
    {
      label: 'Estimativa',
      value: t.estimativaFoliculos ? `~${t.estimativaFoliculos.toLocaleString('pt-BR')} unidades foliculares` : '',
      wide: true,
    },
    { label: 'Intenção', value: t.urgencia },
    { label: 'Tempo de queda', value: t.tempo },
    { label: 'Histórico', value: t.jaFez },
    { label: 'Cidade', value: t.cidade },
    { label: 'Unidade', value: t.unidade },
  ].filter((l) => l.value)

  // A triagem classificou de um jeito e o lead está de outro. Não é acusação de erro
  // (esfriar na mão é legítimo, e acontece depois da primeira conversa), mas é a
  // informação que explica por que um lead de score alto está no fim da fila — e o
  // primeiro lugar onde olhar quando a temperatura parecer estranha.
  const divergente = t.temperatura != null && t.temperatura !== lead.temperature

  return (
    <section aria-labelledby="lead-triagem-heading" className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="lead-triagem-heading" className="text-sm font-semibold">
          Triagem da landing /{t.landing}
        </h2>
        {t.score != null ? (
          <>
            <span className="text-xs text-muted-foreground">
              Score {t.score} de {t.teto} · {t.fracaoPct}%
            </span>
            {t.temperatura ? (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                  temperatureBadgeClass(t.temperatura),
                )}
              >
                {temperatureLabel[t.temperatura]} na triagem
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
        {linhas.map((l) => (
          <div key={l.label} className={cn('flex flex-col', l.wide && 'sm:col-span-2')}>
            <dt className="text-xs text-muted-foreground">{l.label}</dt>
            <dd>{l.value}</dd>
          </div>
        ))}
      </dl>

      {divergente ? (
        <p className="mt-2 text-xs text-muted-foreground">
          O lead está hoje como <strong className="font-medium">{temperatureLabel[lead.temperature]}</strong>, diferente
          do que a triagem calculou.
        </p>
      ) : null}
    </section>
  )
}
