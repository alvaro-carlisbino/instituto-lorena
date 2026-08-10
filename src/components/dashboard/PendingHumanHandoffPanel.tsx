import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, MessageSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePendingHandoff } from '@/hooks/usePendingHandoff'
import { useNowMs } from '@/hooks/useNowMs'
import { cn } from '@/lib/utils'

function formatWaitingFor(iso: string | null | undefined, now: number): string {
  if (!iso) return 'agora'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return 'agora'
  const diffMs = Math.max(0, now - ts)
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem ? `há ${hours}h ${rem}m` : `há ${hours}h`
  const days = Math.floor(hours / 24)
  const remH = hours % 24
  return remH ? `há ${days}d ${remH}h` : `há ${days}d`
}

const MAX_VISIBLE = 5

type WaitingItem = { id: string; name: string; since: string | null; reason: string | null }

export function PendingHumanHandoffPanel() {
  const navigate = useNavigate()
  const nowMs = useNowMs(60_000)

  // Fonte da verdade real: RPC que deriva das interactions (independe da escrita de
  // conversation_status, que historicamente nunca acendia para a clínica). A busca, a
  // ordenação e o fallback de modo demonstração moram em usePendingHandoff, que este
  // card divide com o sino do cabeçalho para os dois nunca mostrarem números diferentes.
  const rows = usePendingHandoff()

  const waiting = useMemo<WaitingItem[] | null>(
    () =>
      rows?.map((r) => ({
        id: r.lead_id,
        name: r.patient_name || 'Lead sem nome',
        since: r.waiting_since,
        reason: r.reason ?? null,
      })) ?? null,
    [rows],
  )

  // Primeira carga do RPC ainda em andamento: não renderiza nada (sem flash do estado vazio).
  if (waiting === null) return null

  const count = waiting.length
  const top = waiting.slice(0, MAX_VISIBLE)
  const overflow = count - top.length

  if (count === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03] p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/10">
            <MessageSquare className="size-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700/70">Atendimento Pendente</p>
            <h4 className="text-sm font-bold text-foreground/80">Ninguém aguardando atendimento.</h4>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative rounded-xl border bg-card/60 p-6 shadow-lg',
        'border-red-500/30 bg-red-500/[0.04] shadow-red-500/5',
      )}
    >
      <div className="absolute inset-0 rounded-xl ring-1 ring-red-500/20 animate-pulse pointer-events-none" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertOctagon className="size-5 text-red-600" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-700/80">
                Atendimento Pendente
              </p>
              <h4 className="text-base font-semibold text-foreground tracking-tight">
                {/* "consultor" não cabe mais: metade da fila pode ser cliente que já pagou
                    e só quer resposta, não atendimento comercial. */}
                {count} {count === 1 ? 'pessoa aguarda atendimento' : 'pessoas aguardam atendimento'}
              </h4>
            </div>
          </div>
          <span className="flex size-8 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        </div>

        <ul className="space-y-1.5">
          {top.map((lead) => (
            <li
              key={lead.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-red-500/10 bg-background/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold text-foreground/90">{lead.name}</p>
                  {lead.reason === 'valor' ? (
                    <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
                      Pediu valor
                    </span>
                  ) : null}
                  {lead.reason === 'cliente' ? (
                    <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                      Já comprou
                    </span>
                  ) : null}
                  {/* Não houve promessa da IA nem compra: o cliente falou e ficou no vácuo. */}
                  {lead.reason === 'sem_resposta' ? (
                    <span className="shrink-0 rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-700">
                      Sem resposta
                    </span>
                  ) : null}
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-700/70">
                  Aguardando {formatWaitingFor(lead.since, nowMs)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg border-red-500/30 bg-background text-xs font-bold text-red-700 hover:bg-red-500/10"
                onClick={() => navigate(`/chat?leadId=${encodeURIComponent(lead.id)}`)}
              >
                Atender
              </Button>
            </li>
          ))}
        </ul>

        {overflow > 0 ? (
          <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground/70">
            +{overflow} {overflow === 1 ? 'outro lead' : 'outros leads'} aguardando, veja todos no quadro.
          </p>
        ) : null}
      </div>
    </div>
  )
}
