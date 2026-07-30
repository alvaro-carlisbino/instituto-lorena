import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlarmClock, Bell, MessageSquare } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCrm } from '@/context/CrmContext'
import { usePendingHandoff } from '@/hooks/usePendingHandoff'
import { useNowMs } from '@/hooks/useNowMs'
import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'

/** Quantos itens de cada seção cabem antes de "ver todos". */
const MAX_POR_SECAO = 4

function esperandoHa(iso: string | null | undefined, agora: number): string {
  if (!iso) return 'agora'
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) return 'agora'
  const mins = Math.floor(Math.max(0, agora - ts) / 60_000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins} min`
  const horas = Math.floor(mins / 60)
  if (horas < 24) return `há ${horas}h`
  return `há ${Math.floor(horas / 24)}d`
}

/**
 * Alertas do dia no cabeçalho, visíveis de QUALQUER tela.
 *
 * Existiam os dois dados, e nenhum dos dois aparecia fora do painel: quem aguardava
 * consultor só era visto por quem abrisse /dashboard, e o follow-up com data marcada
 * só por quem abrisse /tarefas. Na prática a recepção descobria o lead parado quando
 * ele reclamava, e o retorno combinado ("me chama quando eu voltar de viagem") só era
 * lembrado se alguém procurasse. As duas coisas são a mesma pergunta, "com quem eu
 * preciso falar agora", então moram no mesmo sino.
 */
export function AlertsBell() {
  const crm = useCrm()
  const navigate = useNavigate()
  const handoffs = usePendingHandoff()
  const agora = useNowMs(60_000)

  // Vencidas entram junto com as de hoje: uma tarefa de ontem que ninguém fez não
  // deixa de ser cobrança, e some da tela se o filtro for só do dia.
  const followUps = useMemo(() => {
    const hoje = hojeLocal()
    return crm.leadTasks
      .filter((t) => t.status === 'open' && t.dueAt && diaLocal(t.dueAt) <= hoje)
      .sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime())
  }, [crm.leadTasks])

  const aguardando = handoffs ?? []
  const total = aguardando.length + followUps.length
  const carregando = handoffs === null

  const nomeDoLead = (leadId: string) => crm.leads.find((l) => l.id === leadId)?.patientName ?? 'Lead sem nome'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          total > 0 && 'text-red-600',
        )}
        aria-label={total > 0 ? `Alertas: ${total} pendente(s)` : 'Alertas (nada pendente)'}
      >
        <Bell className="size-4" aria-hidden />
        {total > 0 ? (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white tabular-nums"
            aria-hidden
          >
            {total > 99 ? '99+' : total}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[min(100vw-2rem,20rem)]">
        <DropdownMenuLabel className="text-xs font-semibold">Precisa de você agora</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {carregando && followUps.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Carregando…</p>
        ) : null}

        {aguardando.length > 0 ? (
          <>
            <p className="px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-700/80">
              Aguardando consultor · {aguardando.length}
            </p>
            {aguardando.slice(0, MAX_POR_SECAO).map((row) => (
              <DropdownMenuItem
                key={row.lead_id}
                onClick={() => navigate(`/chat?leadId=${encodeURIComponent(row.lead_id)}`)}
              >
                <MessageSquare className="size-4 text-red-600" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{row.patient_name || 'Lead sem nome'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {esperandoHa(row.waiting_since, agora)}
                </span>
              </DropdownMenuItem>
            ))}
            {aguardando.length > MAX_POR_SECAO ? (
              <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                <span className="text-xs text-muted-foreground">
                  Ver os outros {aguardando.length - MAX_POR_SECAO} no painel
                </span>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}

        {followUps.length > 0 ? (
          <>
            {aguardando.length > 0 ? <DropdownMenuSeparator /> : null}
            <p className="px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700/80">
              Follow-up de hoje · {followUps.length}
            </p>
            {followUps.slice(0, MAX_POR_SECAO).map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => navigate(`/chat?leadId=${encodeURIComponent(t.leadId)}`)}
              >
                <AlarmClock className="size-4 text-amber-600" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{nomeDoLead(t.leadId)}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {diaLocal(t.dueAt ?? '') < hojeLocal() ? 'atrasado' : 'hoje'}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => navigate('/tarefas')}>
              <span className="text-xs text-muted-foreground">Abrir a lista de follow-up</span>
            </DropdownMenuItem>
          </>
        ) : null}

        {!carregando && total === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Ninguém esperando e nenhum retorno marcado para hoje.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
