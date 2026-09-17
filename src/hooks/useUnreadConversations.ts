import { useCallback, useEffect, useMemo, useState } from 'react'

import { ehRecebidaDoPaciente } from '@/lib/mensagemDeConversa'
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

export type SeenMap = Record<string, number>
type ForcedMap = Record<string, true>

/**
 * O mapa de "visto por último" depois de abrir uma conversa. **Devolve o MESMO objeto
 * quando não há nada para ver** — é essa identidade que segura o ciclo de render (ver
 * `markSeen`). Pura e exportada para poder ser testada sem montar a árvore do React.
 */
export function proximoSeen(
  prev: SeenMap,
  chave: string,
  ultimaRecebida: number,
  agora: number,
): SeenMap {
  if (!chave) return prev
  if ((prev[chave] ?? 0) >= ultimaRecebida) return prev
  return { ...prev, [chave]: Math.max(agora, ultimaRecebida) }
}

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

  /**
   * Última mensagem RECEBIDA DO PACIENTE por lead.
   *
   * Nota de sistema não conta — ver `ehRecebidaDoPaciente`. Sem isso, mexer no quadro
   * marca a conversa como não lida para todo mundo.
   */
  const lastInboundByLead = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of interactions) {
      if (!ehRecebidaDoPaciente(i)) continue
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

  /**
   * Marcar como lida é IDEMPOTENTE: conversa já lida não vira estado novo.
   *
   * A guarda daqui era `>= Date.now()`, e o relógio sempre anda: toda chamada devolvia um
   * mapa novo, mesmo numa conversa lida há uma hora. Quem abre uma conversa fecha um
   * ciclo com isso — `seen` novo → `isUnread` novo → a lista de conversas é remontada →
   * `activeConversa` é outro objeto → o efeito que marca como lida roda DE NOVO. O ciclo
   * só parava quando duas voltas caíam no MESMO milissegundo, ou seja, por sorte: em tela
   * leve convergia em duas voltas, e na lista cheia da clínica (2,7 mil contatos, 32 mil
   * mensagens) cada volta passa de 1ms e ele não converge nunca. O React corta em 50
   * updates aninhados e a tela morre com o erro #185 ("Maximum update depth exceeded") —
   * "O CRM encontrou um erro ao abrir" ao clicar na conversa, 17/set/2026.
   *
   * Agora a pergunta certa: já vi tudo o que o paciente mandou? Se já, não mexe em nada, e
   * o ciclo morre na primeira volta por construção, não por corrida com o relógio. Guarda
   * pelo menos o horário da última recebida para que mensagem com data adiantada (relógio
   * do WhatsApp à frente) não deixe a conversa eternamente não lida — que traria o loop de
   * volta pela outra ponta.
   */
  const markSeen = useCallback((leadId: string) => {
    if (!leadId) return
    const ultimaRecebida = lastInboundByLead.get(leadId) ?? 0
    setSeen((prev) => {
      const next = proximoSeen(prev, leadId, ultimaRecebida, Date.now())
      if (next === prev) return prev
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
  }, [lastInboundByLead])

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
