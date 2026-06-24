import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Interaction } from '@/mocks/crmMock'

/**
 * "Não lido" por atendente, simples e sem migration: guardamos em localStorage o
 * timestamp da última vez que ESTE navegador abriu cada conversa. Uma conversa é
 * "não lida" quando a última mensagem RECEBIDA do cliente é mais nova que esse
 * "visto por último". Abrir a conversa (ou receber msg com ela aberta) marca como lida.
 *
 * É per-device de propósito: cada atendente tem o seu próprio estado de leitura —
 * que é exatamente a semântica de "não lido". Pode evoluir p/ uma tabela por-usuário
 * depois, mas isto entrega o valor agora sem tocar no backend.
 */
const STORAGE_KEY = 'crm.chat.lastSeen.v1'
// "Não lido" FORÇADO pelo atendente (botão "marcar como não lida"). Persiste à parte
// do "visto por último" porque tem precedência: vale mesmo que não tenha chegado msg nova.
const UNREAD_KEY = 'crm.chat.forcedUnread.v1'

type SeenMap = Record<string, number>
type ForcedMap = Record<string, true>

function loadSeen(): SeenMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SeenMap) : {}
  } catch {
    return {}
  }
}

function saveSeen(map: SeenMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* localStorage indisponível (modo privado) — degrada sem quebrar */
  }
}

function loadForced(): ForcedMap {
  try {
    const raw = localStorage.getItem(UNREAD_KEY)
    return raw ? (JSON.parse(raw) as ForcedMap) : {}
  } catch {
    return {}
  }
}

function saveForced(map: ForcedMap): void {
  try {
    localStorage.setItem(UNREAD_KEY, JSON.stringify(map))
  } catch {
    /* idem — degrada sem quebrar */
  }
}

export type UnreadConversations = {
  isUnread: (leadId: string) => boolean
  unreadCount: number
  markSeen: (leadId: string) => void
  markUnread: (leadId: string) => void
}

export function useUnreadConversations(interactions: Interaction[]): UnreadConversations {
  const [seen, setSeen] = useState<SeenMap>(() => loadSeen())
  const [forced, setForced] = useState<ForcedMap>(() => loadForced())

  /** Última mensagem RECEBIDA (direction 'in') por lead. */
  const lastInboundByLead = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of interactions) {
      if (i.direction !== 'in') continue
      const t = new Date(i.happenedAt).getTime()
      if (Number.isNaN(t)) continue
      if (t > (map.get(i.leadId) ?? 0)) map.set(i.leadId, t)
    }
    return map
  }, [interactions])

  const isUnread = useCallback(
    (leadId: string) => {
      if (forced[leadId]) return true
      const inbound = lastInboundByLead.get(leadId)
      if (!inbound) return false
      return inbound > (seen[leadId] ?? 0)
    },
    [lastInboundByLead, seen, forced],
  )

  const unreadCount = useMemo(() => {
    let n = 0
    const seenIds = new Set<string>()
    for (const [leadId, inbound] of lastInboundByLead) {
      seenIds.add(leadId)
      if (forced[leadId] || inbound > (seen[leadId] ?? 0)) n += 1
    }
    // Forçadas sem inbound recente (ex.: marcou não lida uma conversa antiga) também contam.
    for (const leadId of Object.keys(forced)) {
      if (!seenIds.has(leadId)) n += 1
    }
    return n
  }, [lastInboundByLead, seen, forced])

  const markSeen = useCallback((leadId: string) => {
    if (!leadId) return
    setSeen((prev) => {
      const now = Date.now()
      if ((prev[leadId] ?? 0) >= now) return prev
      const next = { ...prev, [leadId]: now }
      saveSeen(next)
      return next
    })
    // Abrir/ler a conversa cancela o "não lida" forçado.
    setForced((prev) => {
      if (!prev[leadId]) return prev
      const next = { ...prev }
      delete next[leadId]
      saveForced(next)
      return next
    })
  }, [])

  const markUnread = useCallback((leadId: string) => {
    if (!leadId) return
    setForced((prev) => {
      if (prev[leadId]) return prev
      const next = { ...prev, [leadId]: true as const }
      saveForced(next)
      return next
    })
  }, [])

  // Sincroniza entre abas: se outra aba marcou como lida/não lida, reflete aqui.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSeen(loadSeen())
      if (e.key === UNREAD_KEY) setForced(loadForced())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { isUnread, unreadCount, markSeen, markUnread }
}
