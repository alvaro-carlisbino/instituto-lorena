import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { BRAND_LOGO_HORIZONTAL_NEGATIVE_URL } from '@/config/brandAssets'
import { APP_ENV_BADGE, APP_TV_HEADING } from '@/config/branding'
import { useCrm } from '@/context/CrmContext'
import { cn } from '@/lib/utils'

function layoutStyle(layout: Record<string, unknown>): CSSProperties {
  const col = typeof layout.col === 'number' ? layout.col : Number(layout.col) || 1
  const row = typeof layout.row === 'number' ? layout.row : Number(layout.row) || 1
  const span = typeof layout.span === 'number' ? layout.span : Number(layout.span) || 1
  return {
    gridColumn: `${col} / span ${span}`,
    gridRow: row,
  }
}

export function TvDashboardPage() {
  const crm = useCrm()
  const [tick, setTick] = useState<number>(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((previous) => previous + 1)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [])

  const metricByKey = (key: string) => crm.metrics.find((metric) => metric.id === key)

  const orderedWidgets = useMemo(
    () => crm.tvWidgets.filter((widget) => widget.enabled).sort((a, b) => a.position - b.position),
    [crm.tvWidgets],
  )

  const hasLayout = orderedWidgets.some((w) => w.layout && (w.layout as { grid?: string }).grid !== 'legacy')

  if (!crm.currentPermission.canViewTvPanel) {
    return (
      <div className="bg-brand-tv-gradient min-h-svh px-8 py-10 text-white">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-3">
            <img src={BRAND_LOGO_HORIZONTAL_NEGATIVE_URL} alt="" className="h-9 max-w-[11rem] object-contain object-left opacity-90" />
          </div>
          <h1 className="m-0 text-3xl font-semibold tracking-tight">{APP_TV_HEADING}</h1>
          <p className="mt-2 text-sm font-medium uppercase tracking-wider text-white/55">{APP_ENV_BADGE}</p>
          <p className="mt-1 text-white/70">Acesso negado para o perfil atual.</p>
        </header>
      </div>
    )
  }

  return (
    <div className="bg-brand-tv-gradient min-h-svh px-8 py-10 text-white">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-3">
            <img src={BRAND_LOGO_HORIZONTAL_NEGATIVE_URL} alt="" className="h-10 max-w-[12rem] object-contain object-left opacity-95 md:h-11" />
          </div>
          <h1 className="m-0 text-3xl font-semibold tracking-tight md:text-4xl">{APP_TV_HEADING}</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-white/55">Painel TV · {APP_ENV_BADGE}</p>
          <p className="mt-2 text-lg text-white/70">Atualização automática a cada 15 s · ciclo {tick}</p>
        </div>
      </header>

      <section
        className={cn(
          'mb-8 gap-4',
          hasLayout ? 'grid' : 'grid sm:grid-cols-2 xl:grid-cols-4',
        )}
        style={
          hasLayout
            ? {
                display: 'grid',
                gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
                gridAutoRows: 'minmax(5rem, auto)',
              }
            : undefined
        }
      >
        {orderedWidgets
          .filter((widget) => widget.widgetType === 'kpi')
          .map((widget) => {
            const metric = metricByKey(widget.metricKey)
            return (
              <article
                key={widget.id}
                className={cn(
                  'rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg backdrop-blur-sm',
                  hasLayout ? '' : '',
                )}
                style={hasLayout ? layoutStyle(widget.layout) : undefined}
              >
                <p className="m-0 text-sm text-white/65">{widget.title}</p>
                <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight">
                  {metric ? metric.value : crm.totalQualified}
                </p>
              </article>
            )
          })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        {orderedWidgets.some((widget) => widget.widgetType === 'bar') ? (
          <article className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg">
            <h2 className="m-0 mb-4 text-xl font-semibold text-white">Captação × qualificação por hora</h2>
            <ul className="m-0 list-none space-y-4 p-0">
              {crm.tvKpiSeries.map((point) => (
                <li key={point.label} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-24 shrink-0 text-sm text-white/65">{point.label}</span>
                  <div className="flex min-h-3 flex-1 gap-1">
                    <div
                      className="h-3 rounded-full bg-[var(--brand-tv-bar-primary)]"
                      style={{ width: `${Math.min(100, point.leads * 7)}%` }}
                    />
                    <div
                      className="h-3 rounded-full bg-[var(--brand-tv-bar-secondary)]"
                      style={{ width: `${Math.min(100, point.qualified * 7)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        <article className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg">
          <h2 className="m-0 mb-4 text-xl font-semibold text-white">Ranking SDR</h2>
          <ul className="m-0 list-none space-y-3 p-0">
            {crm.workloadBySdr.map((sdr) => (
              <li key={sdr.id} className="flex items-center justify-between gap-4 border-b border-white/5 pb-3 last:border-0">
                <span className="text-white/85">{sdr.name}</span>
                <strong className="text-lg tabular-nums text-white">{sdr.total} leads</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  )
}
