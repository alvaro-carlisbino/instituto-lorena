import { useEffect, useMemo, useState } from 'react'

import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'

/** Handoffs mais antigos que isto viram lead frio: vão para follow-up, não para o alerta. */
export const HANDOFF_WINDOW_HOURS = 48
const POLL_MS = 30_000

export type PendingHandoffRow = {
  lead_id: string
  patient_name: string | null
  waiting_since: string | null
  last_message: string | null
  channel: string | null
  /**
   * 'valor' = a Sofia prometeu que a equipe manda o preço; 'handoff' = encaminhamento normal;
   * 'cliente' = quem JÁ COMPROU mandou mensagem e ninguém respondeu.
   */
  reason?: string | null
}

/**
 * Uma assinatura só da RPC `crm_pending_human_handoff`, compartilhada por quem precisar
 * do número. O card do painel e o sino do cabeçalho aparecem juntos na home: com um
 * poller em cada componente eram duas chamadas idênticas a cada 30s, e os dois podiam
 * divergir por meio ciclo (card mostrando 3 e sino mostrando 4 na mesma tela).
 *
 * `null` significa "ainda não sei", e é diferente de lista vazia: sem essa distinção o
 * sino piscava "tudo certo" por meio segundo antes da primeira resposta chegar.
 */
let rows: PendingHandoffRow[] | null = null
let timer: number | null = null
let currentTenant: string | null = null
const listeners = new Set<(next: PendingHandoffRow[] | null) => void>()

function emit() {
  for (const notify of listeners) notify(rows)
}

async function fetchRows(tenantId: string) {
  if (!supabase) return
  // Duas filas, um alerta só. A segunda (cliente que já pagou e ficou sem resposta) NÃO é
  // handoff da IA: ela olha o outro lado da conversa e, de propósito, não respeita opt-out
  // nem conversa arquivada — foi exatamente aí que o Márcio (R$ 1.890,50) se escondeu por
  // 4 dias. Manter no mesmo card evita mais um lugar pra equipe ter que lembrar de olhar.
  const [handoff, clientes] = await Promise.all([
    supabase.rpc('crm_pending_human_handoff', { p_window_hours: HANDOFF_WINDOW_HOURS }),
    supabase.rpc('crm_paying_customers_waiting', {}),
  ])
  // Em erro preserva a última lista boa: um 500 passageiro não pode apagar o alerta
  // da tela e fazer a equipe achar que a fila esvaziou.
  if (handoff.error || tenantId !== currentTenant) return
  const base = (handoff.data as PendingHandoffRow[]) ?? []
  // Se só a fila nova falhar, mostra a antiga em vez de zerar o card.
  const pagantes = clientes.error ? [] : ((clientes.data as PendingHandoffRow[]) ?? [])
  // Quem está nas duas listas entra como 'cliente': já comprou, é a espera mais cara.
  const porCliente = new Set(pagantes.map((r) => r.lead_id))
  rows = [...pagantes, ...base.filter((r) => !porCliente.has(r.lead_id))]
  emit()
}

function start(tenantId: string) {
  if (currentTenant !== tenantId) {
    currentTenant = tenantId
    rows = null // trocou de polo: não mostra o número do polo anterior enquanto recarrega
    emit()
  }
  if (timer != null) return
  void fetchRows(tenantId)
  timer = window.setInterval(() => {
    if (currentTenant) void fetchRows(currentTenant)
  }, POLL_MS)
}

function stopIfIdle() {
  if (listeners.size > 0 || timer == null) return
  window.clearInterval(timer)
  timer = null
}

/**
 * Leads aguardando consultor, já ordenados do que espera há mais tempo para o mais
 * recente. `null` enquanto a primeira carga não voltou.
 *
 * Sem Supabase (modo demonstração) cai no filtro client-side de `crm.leads`, o mesmo
 * fallback que o card do painel sempre teve. Ficar só na RPC deixava o sino vazio numa
 * tela em que o card mostrava fila, que é exatamente a divergência que este hook existe
 * para acabar.
 */
export function usePendingHandoff(): PendingHandoffRow[] | null {
  const crm = useCrm()
  const { tenant } = useTenant()
  const enabled = isSupabaseConfigured && !!supabase
  const [local, setLocal] = useState<PendingHandoffRow[] | null>(rows)

  useEffect(() => {
    if (!enabled) return
    listeners.add(setLocal)
    start(tenant.id)
    return () => {
      listeners.delete(setLocal)
      stopIfIdle()
    }
  }, [enabled, tenant.id])

  const mock = useMemo<PendingHandoffRow[]>(
    () =>
      crm.leads
        .filter((l) => l.conversation_status === 'waiting_human')
        .map((l) => ({
          lead_id: l.id,
          patient_name: l.patientName,
          waiting_since: l.last_interaction_at ?? null,
          last_message: null,
          channel: null,
          reason: null,
        })),
    [crm.leads],
  )

  const lista = enabled ? local : mock
  return useMemo(() => {
    if (lista === null) return null
    return [...lista].sort(
      (a, b) => new Date(a.waiting_since ?? 0).getTime() - new Date(b.waiting_since ?? 0).getTime(),
    )
  }, [lista])
}
