import { useEffect, useState } from 'react'

import {
  fetchShospAgenda,
  fetchShospPrestadores,
  type ShospPrestadorAgenda,
} from '@/services/shosp'

function isFree(slot: { codigoAgendamento?: number; paciente?: string }): boolean {
  return !slot.codigoAgendamento && !slot.paciente
}

export function ShospAgendaPanel() {
  const [prestadores, setPrestadores] = useState<Array<{ codigo: string; nome: string }>>([])
  const [codigoPrestador, setCodigoPrestador] = useState<string>('')
  const [agenda, setAgenda] = useState<ShospPrestadorAgenda[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchShospPrestadores()
      .then((list) => {
        setPrestadores(list)
        if (list.length && !codigoPrestador) setCodigoPrestador(list[0].codigo)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao listar prestadores.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!codigoPrestador) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchShospAgenda({ codigoPrestador: Number(codigoPrestador), diasMostrar: 15 })
      .then((res) => {
        if (!cancelled) setAgenda(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar agenda Shosp.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [codigoPrestador])

  const days = agenda[0]?.days ?? []

  return (
    <section className="rounded-xl border border-border/30 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Agenda Shosp — tempo real</h2>
          <p className="text-xs text-muted-foreground">
            Grade do prestador direto da Shosp (verde = livre, ocupado = paciente agendado).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={codigoPrestador}
            onChange={(e) => setCodigoPrestador(e.target.value)}
            className="rounded-md border border-border/40 bg-background px-2 py-1 text-sm"
          >
            {prestadores.map((p) => (
              <option key={p.codigo} value={p.codigo}>{p.nome}</option>
            ))}
          </select>
          {loading && <span className="text-xs text-muted-foreground">Carregando…</span>}
        </div>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {!error && days.length === 0 && !loading && (
        <p className="py-8 text-center text-xs text-muted-foreground">Sem dias retornados para este prestador.</p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {days.map((day) => (
          <div key={day.data} className="min-w-[150px] flex-1 rounded-lg border border-border/20 bg-muted/10 p-2">
            <div className="mb-2 border-b border-border/20 pb-1 text-center">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">{day.diaSemana}</p>
              <p className="text-xs font-medium">{day.data.split('-').reverse().slice(0, 2).join('/')}</p>
            </div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {day.slots.length === 0 && <li className="text-center text-[10px] text-muted-foreground">—</li>}
              {day.slots.map((slot, i) => (
                <li
                  key={`${day.data}-${slot.horario}-${i}`}
                  className={
                    isFree(slot)
                      ? 'rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400'
                      : 'rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300'
                  }
                  title={isFree(slot) ? 'Livre' : `${slot.paciente ?? ''} — ${slot.status ?? ''}`}
                >
                  <span className="font-mono">{slot.horario}</span>{' '}
                  {isFree(slot) ? (
                    <span className="opacity-70">livre</span>
                  ) : (
                    <span className="truncate">{(slot.paciente ?? 'ocupado').split(' ').slice(0, 2).join(' ')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
