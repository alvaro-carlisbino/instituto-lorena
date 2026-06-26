import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, MessageSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useCrm } from '@/context/CrmContext'
import { useNowMs } from '@/hooks/useNowMs'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
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
/** Handoffs mais antigos que isto viram "lead frio" (vão p/ follow-up, não p/ este card). */
const WINDOW_HOURS = 48
const POLL_MS = 30_000

type WaitingItem = { id: string; name: string; since: string | null }

type PendingHandoffRow = {
  lead_id: string
  patient_name: string | null
  waiting_since: string | null
  last_message: string | null
  channel: string | null
}

export function PendingHumanHandoffPanel() {
  const crm = useCrm()
  const navigate = useNavigate()
  const nowMs = useNowMs(60_000)

  // Fonte da verdade real: RPC que deriva das interactions (independe da escrita de
  // conversation_status, que historicamente nunca acendia para a clínica). Em modo
  // mock (sem Supabase) cai no filtro client-side de crm.leads.
  const usingRpc = isSupabaseConfigured && !!supabase
  const [rpcRows, setRpcRows] = useState<PendingHandoffRow[] | null>(null)

  useEffect(() => {
    if (!usingRpc || !supabase) return
    const sb = supabase
    let cancelled = false
    const fetchRows = async () => {
      const { data, error } = await sb.rpc('crm_pending_human_handoff', {
        p_window_hours: WINDOW_HOURS,
      })
      if (cancelled || error) return // em erro, preserva a última lista boa
      setRpcRows((data as PendingHandoffRow[]) ?? [])
    }
    void fetchRows()
    const id = window.setInterval(fetchRows, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [usingRpc])

  const waiting = useMemo<WaitingItem[] | null>(() => {
    if (usingRpc) {
      if (rpcRows === null) return null // ainda carregando — evita piscar verde→vermelho
      return rpcRows.map((r) => ({
        id: r.lead_id,
        name: r.patient_name || 'Lead sem nome',
        since: r.waiting_since,
      }))
    }
    return crm.leads
      .filter((l) => l.conversation_status === 'waiting_human')
      .sort((a, b) => {
        const ta = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0
        const tb = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0
        return ta - tb
      })
      .map((l) => ({ id: l.id, name: l.patientName || 'Lead sem nome', since: l.last_interaction_at ?? null }))
  }, [usingRpc, rpcRows, crm.leads])

  // Primeira carga do RPC ainda em andamento: não renderiza nada (sem flash do estado vazio).
  if (waiting === null) return null

  const count = waiting.length
  const top = waiting.slice(0, MAX_VISIBLE)
  const overflow = count - top.length

  if (count === 0) {
    return (
      <div className="rounded-3xl border border-emerald-500/15 bg-emerald-500/[0.03] p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/10">
            <MessageSquare className="size-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700/70">Atendimento Pendente</p>
            <h4 className="text-sm font-bold text-foreground/80">Nenhum lead aguardando consultor.</h4>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative rounded-3xl border bg-card/60 p-6 shadow-lg',
        'border-red-500/30 bg-red-500/[0.04] shadow-red-500/5',
      )}
    >
      <div className="absolute inset-0 rounded-3xl ring-1 ring-red-500/20 animate-pulse pointer-events-none" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertOctagon className="size-5 text-red-600" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-red-700/80">
                Atendimento Pendente
              </p>
              <h4 className="text-base font-black text-foreground tracking-tight">
                {count} {count === 1 ? 'lead aguarda consultor' : 'leads aguardam consultor'}
              </h4>
            </div>
          </div>
          <span className="flex size-8 items-center justify-center rounded-full bg-red-500 text-xs font-black text-white tabular-nums">
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
                <p className="truncate text-sm font-bold text-foreground/90">{lead.name}</p>
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
            +{overflow} {overflow === 1 ? 'outro lead' : 'outros leads'} aguardando — veja todos no quadro.
          </p>
        ) : null}
      </div>
    </div>
  )
}
