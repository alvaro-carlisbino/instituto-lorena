import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, Mail, Search, UserRound } from 'lucide-react'

import { ConversationModeSwitch } from '@/components/leads/ConversationModeSwitch'
import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { WorkspaceLeadSidebar } from '@/components/leads/WorkspaceLeadSidebar'
import { useCrm } from '@/context/CrmContext'
import { useLinhasDoPolo } from '@/hooks/useLinhasParticularesOcultas'
import { chaveDaConversa, linhaDaMensagem } from '@/lib/linhaWhatsapp'
import { useTenant } from '@/context/TenantContext'
import { AppLayout } from '@/layouts/AppLayout'
import { ehMensagemDeConversa, ehRecebidaDoPaciente } from '@/lib/mensagemDeConversa'
import { getSourceStyle } from '@/lib/channelStyles'
import { formatDurationFromMinutes } from '@/lib/formatDuration'
import { cn } from '@/lib/utils'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { labelForIdName } from '@/lib/selectDisplay'
import { teamHoursGateFromAiConfig, type AiConversationGate } from '@/lib/aiTypingIndicator'
import {
  getAiConfig,
  getConversationState,
  setConversationMode,
  type ConversationOwnerMode,
} from '@/services/conversationControl'
import { getLeadPhoneDisplay, isLeadWhatsappComposeBlocked } from '@/lib/leadFields'
import { formatConversationHeaderStamp, formatConversationStamp } from '@/lib/chatDates'
import { fetchWhatsappChannelInstances, type BotKind } from '@/services/whatsappChannelInstances'
import type { Lead } from '@/mocks/crmMock'
import { useUnreadConversations } from '@/hooks/useUnreadConversations'

const MODE_SUMMARY: Record<ConversationOwnerMode, string> = {
  human: 'Humano',
  ai: 'IA',
  auto: 'Misto',
}

/** Chave do número escolhido nas abas da lista (por navegador). */
const LINHA_ESCOLHIDA_KEY = 'chat.linhaEscolhida'

function lerLinhaEscolhida(): string | null {
  try {
    return window.localStorage.getItem(LINHA_ESCOLHIDA_KEY)
  } catch {
    return null
  }
}

function gravarLinhaEscolhida(id: string) {
  try {
    window.localStorage.setItem(LINHA_ESCOLHIDA_KEY, id)
  } catch {
    // sem armazenamento: a escolha vale só até recarregar
  }
}

/**
 * Uma conversa da lista. Com mais de um número no polo, é o par (lead, número): a mesma pessoa
 * que fala com a SDR e com a Aline Muniz aparece duas vezes, cada uma com o seu fio.
 */
type Conversa = { lead: Lead; linha: string | null; chave: string }

/** Iniciais para o avatar do contato na lista (1ª + última palavra). */
function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/**
 * Workspace de conversas. Sem props = inbox comercial completo (todas as linhas).
 * Com `restrictToBotKind` (ex.: 'sales') só mostra os leads das linhas de WhatsApp
 * daquele tipo — base da aba Tricopill, que reaproveita esta mesma UI.
 */
export function ChatWorkspacePage({
  title = 'Conversas',
  restrictToBotKind,
}: { title?: string; restrictToBotKind?: BotKind } = {}) {
  const crm = useCrm()
  const { tenant } = useTenant()
  const { dataMode } = crm
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [sortMode, setSortMode] = useState<'recent' | 'long_wait'>('recent')
  const [leadMode, setLeadMode] = useState<ConversationOwnerMode>('auto')
  const [modeLoading, setModeLoading] = useState(false)
  const [leadSheetOpen, setLeadSheetOpen] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  // Números de WhatsApp do polo, os que este usuário vê e a linha padrão.
  const linhasPolo = useLinhasDoPolo()
  // Conversa separada por número: só quando o polo tem mais de um (e fora da aba do Tricopill,
  // que já filtra por tipo de linha).
  const porLinha = !restrictToBotKind && linhasPolo.variasLinhas
  // "Não lida" é por CONVERSA: mensagem nova no número da Muniz não acende a conversa da SDR.
  const interacoesPorConversa = useMemo(() => {
    if (!porLinha) return crm.interactions
    return crm.interactions.map((i) => {
      const linha = linhaDaMensagem(i, linhasPolo.ids, linhasPolo.padraoId)
      const chave = linha ? chaveDaConversa(i.leadId, linha, linhasPolo.padraoId) : i.leadId
      return chave === i.leadId ? i : { ...i, leadId: chave }
    })
  }, [porLinha, crm.interactions, linhasPolo])
  const { isUnread, markSeen, markUnread } = useUnreadConversations(interacoesPorConversa)
  // Ids das linhas de WhatsApp do tipo `restrictToBotKind` (ex.: vendas/Tricopill).
  // null = ainda carregando; Set vazio = nenhuma linha desse tipo configurada.
  const [restrictInstanceIds, setRestrictInstanceIds] = useState<Set<string> | null>(null)
  // Ids das linhas do POLO ATIVO. null = ainda carregando.
  const [tenantInstanceIds, setTenantInstanceIds] = useState<Set<string> | null>(null)
  const [aiConversationBase, setAiConversationBase] = useState<AiConversationGate | null>(null)
  // Aba de número escolhida. null = ninguém escolheu ainda (abre na primeira linha).
  const [linhaEscolhida, setLinhaEscolhida] = useState<string | null>(() => lerLinhaEscolhida())
  // Número da conversa clicada, amarrado ao lead (o mesmo lead pode estar em dois números).
  const [linhaSelecionada, setLinhaSelecionada] = useState<{ leadId: string; linha: string | null } | null>(null)

  const ownerSelectLabel = useMemo(
    () =>
      labelForIdName(
        ownerFilter,
        crm.users.map((u) => ({ id: u.id, name: u.name })),
        { value: 'all', label: 'Todos responsáveis' },
        'Responsável',
      ),
    [ownerFilter, crm.users],
  )

  /**
   * `waitingSinceByLead`: timestamp da última inbound do paciente quando NÃO houve
   * resposta humana/IA subsequente. `null` quando o lead está em dia. Usado pela
   * ordenação "Longa espera" (mais antigo primeiro = mais urgente).
   */
  const waitingSinceByLead = useMemo(() => {
    const lastIn = new Map<string, number>()
    const lastOut = new Map<string, number>()
    for (const i of crm.interactions) {
      const t = new Date(i.happenedAt).getTime()
      if (Number.isNaN(t)) continue
      // Nota de sistema não é o paciente esperando resposta: se contasse, mover card no
      // quadro jogaria a conversa para o topo de "Longa espera".
      if (!ehMensagemDeConversa(i)) continue
      if (ehRecebidaDoPaciente(i)) {
        if (!lastIn.has(i.leadId) || t > (lastIn.get(i.leadId) ?? 0)) lastIn.set(i.leadId, t)
      } else if (i.direction === 'out') {
        if (!lastOut.has(i.leadId) || t > (lastOut.get(i.leadId) ?? 0)) lastOut.set(i.leadId, t)
      }
    }
    const result = new Map<string, number | null>()
    for (const [leadId, inTs] of lastIn) {
      const outTs = lastOut.get(leadId) ?? 0
      result.set(leadId, inTs > outTs ? inTs : null)
    }
    return result
  }, [crm.interactions])

  useEffect(() => {
    let alive = true
    void fetchWhatsappChannelInstances()
      .then((rows) => {
        if (!alive) return
        setTenantInstanceIds(new Set(rows.filter((r) => r.tenantId === tenant.id).map((r) => r.id)))
        setRestrictInstanceIds(
          restrictToBotKind
            ? new Set(rows.filter((r) => r.botKind === restrictToBotKind).map((r) => r.id))
            : null,
        )
      })
      .catch(() => {
        if (!alive) return
        setTenantInstanceIds(new Set())
        setRestrictInstanceIds(restrictToBotKind ? new Set() : null)
      })
    return () => {
      alive = false
    }
  }, [restrictToBotKind, tenant.id])

  /**
   * Uma pessoa pode ser paciente da clínica E cliente do Tricopill ao mesmo tempo.
   * Por isso o polo do lead não pode ser o único critério: quem é dono da LINHA em
   * que a conversa acontece precisa enxergar a conversa.
   *
   * Sem isto a mensagem caía no banco e não aparecia pra ninguém. Era o caso do
   * Ismael: lead no polo Clínica, conversa na linha do Tricopill. No workspace
   * Tricopill o lead sumia daqui, e no workspace Clínica o RLS cortava as
   * mensagens. Ele ficou 3 dias pedindo pra comprar sem ninguém ver.
   */
  const belongsToWorkspace = useCallback(
    (lead: { tenantId?: string; whatsappInstanceId?: string | null }): boolean => {
      if (!lead.tenantId || lead.tenantId === tenant.id) return true
      return Boolean(lead.whatsappInstanceId && tenantInstanceIds?.has(lead.whatsappInstanceId))
    },
    [tenant.id, tenantInstanceIds],
  )

  /**
   * SEPARADO POR NÚMERO (16/set/2026). Com o WhatsApp da Aline Muniz ao lado da SDR, quem vê os
   * dois (admin, e a própria Muniz) pediu "os dois, mas separados" e depois "tá misturando
   * mensagem, não pode". A conversa é o par (lead, número): cada mensagem de WhatsApp diz por
   * onde passou (`interactions.whatsapp_instance_id`), e a mesma pessoa aparece uma vez em cada
   * número por onde falou. Uma aba por número, mais "Todos".
   *
   * Mensagem sem número gravado (todo o histórico de antes) e contato sem mensagem em memória
   * ficam no número "de casa": onde o lead está amarrado, ou o padrão do polo (primeira linha
   * ativa por `sort_order`, a mesma regra do `resolveOutboundProviderForLead`).
   */
  const separarPorLinha = porLinha && linhasPolo.visiveis.length >= 2
  const filtroLinha = useMemo((): string => {
    if (!separarPorLinha) return 'all'
    if (linhaEscolhida === 'all') return 'all'
    if (linhaEscolhida && linhasPolo.visiveis.some((l) => l.id === linhaEscolhida)) return linhaEscolhida
    return linhasPolo.visiveis[0]!.id
  }, [separarPorLinha, linhaEscolhida, linhasPolo])
  const escolherLinha = useCallback((id: string) => {
    setLinhaEscolhida(id)
    gravarLinhaEscolhida(id)
  }, [])
  const nomeCurtoPorLinha = useMemo(
    () => new Map(linhasPolo.linhas.map((l) => [l.id, l.nomeCurto])),
    [linhasPolo],
  )
  const linhaDeCasa = useCallback(
    (lead: { whatsappInstanceId?: string | null }): string | null => {
      const id = lead.whatsappInstanceId
      return id && linhasPolo.ids.has(id) ? id : linhasPolo.padraoId
    },
    [linhasPolo],
  )

  // Última mensagem, prévia e espera de CADA conversa (lead + número), num passe só.
  const resumoPorConversa = useMemo(() => {
    const resumo = new Map<string, { ultima: number; ultimaIso: string; previa: string; entrada: number; saida: number }>()
    const linhasPorLead = new Map<string, Set<string>>()
    if (!porLinha) return { resumo, linhasPorLead }
    for (const i of crm.interactions) {
      if (!ehMensagemDeConversa(i)) continue
      const linha = linhaDaMensagem(i, linhasPolo.ids, linhasPolo.padraoId)
      if (!linha) continue
      const t = new Date(i.happenedAt).getTime()
      if (Number.isNaN(t)) continue
      const chave = chaveDaConversa(i.leadId, linha, linhasPolo.padraoId)
      let r = resumo.get(chave)
      if (!r) {
        r = { ultima: 0, ultimaIso: '', previa: '', entrada: 0, saida: 0 }
        resumo.set(chave, r)
      }
      if (t > r.ultima) {
        r.ultima = t
        r.ultimaIso = i.happenedAt
        r.previa = i.content
      }
      if (ehRecebidaDoPaciente(i)) r.entrada = Math.max(r.entrada, t)
      else if (i.direction === 'out') r.saida = Math.max(r.saida, t)
      let set = linhasPorLead.get(i.leadId)
      if (!set) {
        set = new Set()
        linhasPorLead.set(i.leadId, set)
      }
      set.add(linha)
    }
    return { resumo, linhasPorLead }
  }, [porLinha, crm.interactions, linhasPolo])

  const esperaDaConversa = useCallback(
    (c: Conversa): number | null => {
      if (porLinha) {
        const r = resumoPorConversa.resumo.get(c.chave)
        if (r) return r.entrada > r.saida ? r.entrada : null
      }
      return waitingSinceByLead.get(c.lead.id) ?? null
    },
    [porLinha, resumoPorConversa, waitingSinceByLead],
  )

  // Todas as conversas do escopo (polo, linha do bot, responsável), antes da busca, da aba e do
  // "só não lidas". Os contadores das abas saem daqui.
  const todasAsConversas = useMemo((): Conversa[] => {
    const lista: Conversa[] = []
    for (const lead of crm.leads) {
      // Escopa ao workspace ATIVO (Clínica × Tricopill). Sem isso, o RLS traz os
      // leads dos 2 polos p/ quem é multi-polo e a Dandara via clínica + Tricopill
      // misturados mesmo com o polo trocado no switcher.
      if (!belongsToWorkspace(lead)) continue
      if (restrictToBotKind) {
        if (!restrictInstanceIds) continue
        if (!lead.whatsappInstanceId || !restrictInstanceIds.has(lead.whatsappInstanceId)) continue
      }
      if (ownerFilter !== 'all' && lead.ownerId !== ownerFilter) continue
      if (!porLinha) {
        // Um número só: uma conversa por lead, como sempre. Particular de outra pessoa fica fora.
        if (lead.whatsappInstanceId && linhasPolo.ocultas.has(lead.whatsappInstanceId)) continue
        lista.push({ lead, linha: null, chave: lead.id })
        continue
      }
      const linhas = new Set(resumoPorConversa.linhasPorLead.get(lead.id) ?? [])
      const casa = linhaDeCasa(lead)
      if (casa) linhas.add(casa)
      for (const linha of linhasPolo.linhas) {
        if (!linhas.has(linha.id) || linhasPolo.ocultas.has(linha.id)) continue
        lista.push({ lead, linha: linha.id, chave: chaveDaConversa(lead.id, linha.id, linhasPolo.padraoId) })
      }
    }
    return lista
  }, [crm.leads, belongsToWorkspace, restrictToBotKind, restrictInstanceIds, ownerFilter, porLinha, linhasPolo, resumoPorConversa, linhaDeCasa])

  const conversations = useMemo(() => {
    const text = search.trim().toLowerCase()
    const filtered = todasAsConversas.filter((c) => {
      if (filtroLinha !== 'all' && c.linha !== filtroLinha) return false
      if (unreadOnly && !isUnread(c.chave)) return false
      if (!text) return true
      return [c.lead.patientName, c.lead.phone, c.lead.summary].join(' ').toLowerCase().includes(text)
    })

    // Última mensagem por lead, calculada UMA vez.
    //
    // Antes isto era um `crm.interactions.find(...)` DENTRO do comparador do sort: com
    // 1.000 interações em memória e algumas centenas de conversas na lista, dava milhões
    // de varreduras de array a cada re-render — e a lista re-renderiza a cada mensagem
    // que chega. Era o congelamento ao rolar/filtrar as conversas.
    //
    // `interactions` já vem ordenada por happened_at DESC, então o PRIMEIRO registro de
    // cada lead é o mais recente: um passe só monta o mapa inteiro.
    // Só mensagem de verdade define a recência. Em 31/08 a reorganização do Kanban
    // gravou nota em 175 cards e todos pularam para o topo da lista, soterrando quem
    // tinha acabado de escrever — ver `ehMensagemDeConversa`.
    const ultimaMsgPorLead = new Map<string, number>()
    for (const i of crm.interactions) {
      if (!ehMensagemDeConversa(i)) continue
      if (!ultimaMsgPorLead.has(i.leadId)) {
        ultimaMsgPorLead.set(i.leadId, new Date(i.happenedAt).getTime())
      }
    }
    // Por número, vale a última mensagem DAQUELE número. Sem nenhuma em memória, a conversa de
    // casa herda a do lead (Instagram, histórico); a de outro número, a data do cadastro.
    const recencia = (c: Conversa): number => {
      const doNumero = porLinha ? resumoPorConversa.resumo.get(c.chave)?.ultima : undefined
      if (doNumero) return doNumero
      if (!porLinha || c.linha === linhaDeCasa(c.lead)) {
        const doLead = ultimaMsgPorLead.get(c.lead.id)
        if (doLead) return doLead
      }
      return new Date(c.lead.createdAt).getTime()
    }

    if (sortMode === 'long_wait') {
      // Leads aguardando resposta primeiro, mais antigos no topo.
      // Lead sem espera pendente cai pro fim (ordenado por interação recente).
      return filtered.sort((a, b) => {
        const aw = esperaDaConversa(a)
        const bw = esperaDaConversa(b)
        if (aw !== null && bw !== null) return aw - bw
        if (aw !== null) return -1
        if (bw !== null) return 1
        return recencia(b) - recencia(a)
      })
    }

    return filtered.sort((a, b) => recencia(b) - recencia(a))
  }, [todasAsConversas, crm.interactions, search, sortMode, unreadOnly, isUnread, filtroLinha, porLinha, resumoPorConversa, linhaDeCasa, esperaDaConversa])

  // Contador do selo "Não lidas" com o MESMO escopo da lista (workspace/tenant + linha
  // de bot + responsável) — só sem o filtro de texto e o próprio toggle. O `unreadCount`
  // do hook conta sobre TODAS as interactions (os 2 polos, todas as linhas), então mostrava
  // um número que não batia com a lista: o selo tinha "3" mas clicar em "Não lidas" trazia
  // lista vazia porque as não lidas eram de outro polo/linha (ou forçadas em localStorage
  // de leads que nem estão carregados aqui).
  // Na mesma passada, as não lidas de CADA número, para o selo das abas.
  const { scopedUnreadCount, naoLidasPorLinha } = useMemo(() => {
    let n = 0
    const porNumero = new Map<string, number>()
    for (const c of todasAsConversas) {
      if (!isUnread(c.chave)) continue
      if (c.linha) porNumero.set(c.linha, (porNumero.get(c.linha) ?? 0) + 1)
      if (filtroLinha !== 'all' && c.linha !== filtroLinha) continue
      n += 1
    }
    return { scopedUnreadCount: n, naoLidasPorLinha: porNumero }
  }, [todasAsConversas, isUnread, filtroLinha])

  // Conversa aberta. O lead selecionado pode estar em mais de um número: vale o que foi clicado,
  // senão o de casa, senão o primeiro que este usuário vê.
  const activeConversa = useMemo((): Conversa | null => {
    const lead = crm.selectedLead
    if (!lead) return conversations[0] ?? null
    const doLead = todasAsConversas.filter((c) => c.lead.id === lead.id)
    const clicada = linhaSelecionada?.leadId === lead.id ? linhaSelecionada.linha : undefined
    const achada =
      (clicada !== undefined ? doLead.find((c) => c.linha === clicada) : undefined) ??
      doLead.find((c) => c.linha === linhaDeCasa(lead)) ??
      doLead[0]
    if (achada) return achada
    if (!porLinha) return { lead, linha: null, chave: lead.id }
    // Fora da lista (outro responsável no filtro, por exemplo): abre no número de casa, ou no
    // primeiro que este usuário vê se o de casa for particular de outra pessoa.
    const casa = linhaDeCasa(lead)
    const linha = casa && !linhasPolo.ocultas.has(casa) ? casa : linhasPolo.visiveis[0]?.id ?? null
    return { lead, linha, chave: chaveDaConversa(lead.id, linha, linhasPolo.padraoId) }
  }, [crm.selectedLead, conversations, todasAsConversas, linhaSelecionada, linhaDeCasa, porLinha, linhasPolo])

  const activeLead = activeConversa?.lead ?? null
  // No celular o chat é master-detail: mostra a LISTA ou a CONVERSA, nunca as duas empilhadas
  // (antes a lista comia 38dvh fixos no topo e a conversa ficava espremida embaixo). A partir
  // de md volta a ser lado-a-lado. `hasSelection` = atendente abriu uma conversa de propósito.
  const hasSelection = Boolean(crm.selectedLeadId)
  const waComposeBlocked = activeLead ? isLeadWhatsappComposeBlocked(activeLead) : false
  const activeHistory = useMemo(
    () => (activeLead ? crm.interactions.filter((i) => i.leadId === activeLead.id) : []),
    [crm.interactions, activeLead],
  )

  // Troca do modo de atendimento (Humano/IA/Misto) — usado no cabeçalho (desktop) e na
  // faixa do topo da conversa (mobile). Antes vivia inline só no bloco `hidden lg:block`,
  // o que deixava o celular SEM jeito de desligar a IA.
  const handleModeChange = (next: ConversationOwnerMode) => {
    if (!activeLead) return
    setModeLoading(true)
    void setConversationMode(activeLead.id, next)
      .then((state) => {
        setLeadMode(state.owner_mode as ConversationOwnerMode)
        toast.success(`Modo alterado para ${MODE_SUMMARY[next]}`)
      })
      .catch(() => toast.error('Falha ao alterar modo'))
      .finally(() => setModeLoading(false))
  }

  // Aplica o leadId da URL apenas uma vez por valor distinto. Antes este efeito
  // dependia de `crm` (objeto novo a cada render), entao rodava em TODO render e
  // forcava a selecao de volta para o lead da URL — travando a troca de lead.
  const leadIdParam = searchParams.get('leadId')
  const appliedLeadIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!leadIdParam) return
    if (appliedLeadIdRef.current === leadIdParam) return
    if (crm.leads.some((lead) => lead.id === leadIdParam)) {
      appliedLeadIdRef.current = leadIdParam
      crm.setSelectedLeadId(leadIdParam)
    }
  }, [leadIdParam, crm.leads, crm.setSelectedLeadId])

  useEffect(() => {
    if (ownerFilter !== 'all' && !crm.users.some((u) => u.id === ownerFilter)) {
      setOwnerFilter('all')
    }
  }, [crm.users, ownerFilter])

  useEffect(() => {
    if (!activeLead || crm.dataMode !== 'supabase') {
      setAiConversationBase(null)
      return
    }
    setModeLoading(true)
    void Promise.all([getConversationState(activeLead.id), getAiConfig()])
      .then(([state, cfg]) => {
        setLeadMode((state.owner_mode as ConversationOwnerMode) ?? 'auto')
        const turno = teamHoursGateFromAiConfig(cfg ?? {})
        setAiConversationBase({
          ownerMode: (state.owner_mode as ConversationOwnerMode) ?? 'auto',
          aiEnabled: state.ai_enabled !== false,
          offHoursOnly: turno.offHoursOnly,
          teamHours: turno.teamHours,
          firstTouchInTeamHours: turno.firstTouchInTeamHours,
        })
      })
      .catch(() => {
        setLeadMode('auto')
        setAiConversationBase(null)
      })
      .finally(() => setModeLoading(false))
  }, [activeLead, crm.dataMode])

  const aiGateForThread = useMemo(() => {
    if (!aiConversationBase) return null
    return { ...aiConversationBase, ownerMode: leadMode }
  }, [aiConversationBase, leadMode])

  // Conversa ABERTA pelo atendente (selectedLeadId explícito) conta como lida — e re-marca
  // quando chega mensagem nova com ela aberta. Usamos selectedLeadId em vez de activeLead de
  // propósito: a 1ª conversa da lista aparece por fallback mas NÃO deve "auto-ler" sozinha,
  // senão o "marcar como não lida" seria revertido na hora.
  useEffect(() => {
    if (crm.selectedLeadId && activeConversa) markSeen(activeConversa.chave)
  }, [crm.selectedLeadId, activeConversa, activeHistory, markSeen])

  useEffect(() => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured || !supabase) return
    const client = supabase

    const channel = client
      .channel('crm-chat-conversation-mode')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversation_states' }, (payload) => {
        const lid = activeLead?.id
        const row = payload.new as { lead_id?: string } | undefined
        if (lid && row?.lead_id === lid) {
          void getConversationState(lid).then((state) => {
            setLeadMode((state.owner_mode as ConversationOwnerMode) ?? 'auto')
            setAiConversationBase((prev) => ({
              ownerMode: (state.owner_mode as ConversationOwnerMode) ?? 'auto',
              aiEnabled: state.ai_enabled !== false,
              // Turno vem da config da IA, não do estado da conversa: preserva o que já foi lido.
              offHoursOnly: prev?.offHoursOnly,
              teamHours: prev?.teamHours,
              firstTouchInTeamHours: prev?.firstTouchInTeamHours,
            }))
          })
        }
      })
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [dataMode, activeLead?.id])

  return (
    <AppLayout title={title} fullHeight={true} mainClassName="min-h-0 p-2 sm:p-3 md:p-4 bg-muted/30 dark:bg-transparent">
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2 overflow-hidden sm:gap-3 md:flex-row md:gap-4">
        {/* Left Column: Lead List, no mobile ocupa a tela inteira e some ao abrir uma conversa */}
        <Card className={cn(
          "flex min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden rounded-2xl border border-border/40 bg-card/70 py-0 shadow-xl backdrop-blur-md md:h-full md:min-h-0 md:flex-none md:w-[min(300px,34vw)] md:max-w-[340px] md:min-w-[260px]",
          hasSelection && "hidden md:flex",
        )}>
          <CardHeader className="shrink-0 border-b border-border/20 bg-muted/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">Mensagens</CardTitle>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
                {conversations.length}
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              {separarPorLinha ? (
                <div
                  role="tablist"
                  aria-label="Número de WhatsApp"
                  className="flex gap-1 rounded-lg bg-muted/40 p-0.5"
                >
                  {[...linhasPolo.visiveis.map((l) => ({ id: l.id, nome: l.nomeCurto })), { id: 'all', nome: 'Todos' }].map((aba) => {
                    const ativa = filtroLinha === aba.id
                    const naoLidas =
                      aba.id === 'all'
                        ? [...naoLidasPorLinha.values()].reduce((a, b) => a + b, 0)
                        : naoLidasPorLinha.get(aba.id) ?? 0
                    return (
                      <button
                        key={aba.id}
                        type="button"
                        role="tab"
                        aria-selected={ativa}
                        onClick={() => escolherLinha(aba.id)}
                        className={cn(
                          'inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors',
                          ativa
                            ? 'bg-background font-semibold text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                        title={aba.id === 'all' ? 'Conversas de todos os números' : `Conversas do número ${aba.nome}`}
                      >
                        <span className="truncate">{aba.nome}</span>
                        {naoLidas > 0 ? (
                          <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground">
                            {naoLidas > 99 ? '99+' : naoLidas}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/70" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 rounded-lg border-border/60 bg-background/50 pl-8 text-xs focus:bg-background"
                  placeholder="Buscar contato..."
                  aria-label="Buscar contato"
                  type="search"
                />
              </div>
              <Select value={ownerFilter} onValueChange={(value) => setOwnerFilter(value ?? 'all')}>
                <LabeledSelectTrigger aria-label="Filtrar por responsável" className="h-8 rounded-lg border-border/30 bg-background/30 text-[11px]" size="sm">
                  {ownerSelectLabel}
                </LabeledSelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos responsáveis</SelectItem>
                  {crm.users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={sortMode}
                onValueChange={(value) => setSortMode((value === 'long_wait' ? 'long_wait' : 'recent'))}
              >
                <LabeledSelectTrigger aria-label="Ordenar conversas" className="h-8 rounded-lg border-border/30 bg-background/30 text-[11px]" size="sm">
                  {sortMode === 'long_wait' ? 'Longa espera' : 'Mais recentes'}
                </LabeledSelectTrigger>
                <SelectContent>
                  <SelectItem value="recent" className="text-xs">Mais recentes</SelectItem>
                  <SelectItem value="long_wait" className="text-xs">Longa espera</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant={unreadOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => setUnreadOnly((v) => !v)}
                className="h-8 w-full justify-between rounded-lg px-2.5 text-[11px]"
                title="Mostrar só conversas com mensagem nova não lida"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5" aria-hidden />
                  {unreadOnly ? 'Só não lidas' : 'Não lidas'}
                </span>
                {scopedUnreadCount > 0 ? (
                  <span
                    className={cn(
                      'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums',
                      unreadOnly ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {scopedUnreadCount > 99 ? '99+' : scopedUnreadCount}
                  </span>
                ) : null}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-border/40">
            {conversations.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nenhuma conversa encontrada"
                className="h-full justify-center p-6 py-6"
              />
            ) : (
              <div className="divide-y divide-border/5">
                {conversations.map((conversa) => {
                  const lead = conversa.lead
                  const resumo = porLinha ? resumoPorConversa.resumo.get(conversa.chave) : undefined
                  const waitingSince = esperaDaConversa(conversa)
                  const waitingMinutes = waitingSince ? Math.floor((Date.now() - waitingSince) / 60000) : 0
                  // Sem isto, conversas paradas há semanas viravam "2486H 39M".
                  const waitingLabel = formatDurationFromMinutes(waitingMinutes)
                  const unread = isUnread(conversa.chave)
                  const isActive = crm.selectedLeadId === lead.id && activeConversa?.chave === conversa.chave
                  return (
                  <Button
                    key={conversa.chave}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      markSeen(conversa.chave)
                      setLinhaSelecionada({ leadId: lead.id, linha: conversa.linha })
                      crm.setSelectedLeadId(lead.id)
                    }}
                    className={cn(
                      'flex h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-none border-0 p-3 text-left font-normal transition-all duration-200 hover:bg-muted/30 hover:text-foreground sm:px-4',
                      isActive
                        ? 'bg-primary/5 shadow-[inset_3px_0_0_0_hsl(var(--primary))]'
                        : unread ? 'bg-primary/[0.03]' : 'transparent',
                    )}
                  >
                    <span
                      className={cn(
                        'relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-tight',
                        unread ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {initials(lead.patientName)}
                      {unread ? (
                        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" />
                      ) : null}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className={cn(
                        "truncate text-sm tracking-tight",
                        unread ? "font-bold text-foreground" : isActive ? "font-medium text-primary" : "font-medium text-foreground"
                      )}>
                        {lead.patientName}
                      </span>
                      <span className={cn(
                        "shrink-0 text-[10px] tabular-nums",
                        unread ? "font-semibold text-primary" : "text-muted-foreground/60"
                      )}>
                        {formatConversationStamp(resumo?.ultimaIso || (lead.last_interaction_at ?? lead.createdAt))}
                      </span>
                    </div>
                    <p className={cn(
                      "line-clamp-1 w-full text-xs leading-normal",
                      unread ? "font-medium text-foreground/80" : "text-muted-foreground/70"
                    )}>
                      {resumo?.previa || lead.summary || 'Sem resumo disponível'}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        lead.temperature === 'hot' ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]" :
                        lead.temperature === 'warm' ? "bg-yellow-500" : "bg-blue-500"
                      )} title={lead.temperature} />
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                          getSourceStyle(lead.source).pill,
                        )}
                      >
                        <span className={cn('h-1 w-1 rounded-full', getSourceStyle(lead.source).dot)} aria-hidden />
                        {getSourceStyle(lead.source).label}
                      </span>
                      {separarPorLinha && filtroLinha === 'all' && conversa.linha ? (
                        <span
                          className="truncate rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground"
                          title="Número de WhatsApp desta conversa"
                        >
                          {nomeCurtoPorLinha.get(conversa.linha) ?? ''}
                        </span>
                      ) : null}
                      {waitingSince ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                            waitingMinutes >= 30
                              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                          )}
                          title={`Última mensagem do paciente sem resposta há ${waitingLabel}`}
                        >
                          {waitingLabel}
                        </span>
                      ) : null}
                    </div>
                    </div>
                  </Button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Middle Column: Chat Area */}
        <Card className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-2xl border border-border/40 bg-card py-0 shadow-xl md:flex-[3]",
          !hasSelection && "hidden md:flex",
        )}>
          {activeLead ? (
            <>
              {/* O cabeçalho da conversa media 179px dos 812 do celular, numa tela cuja
                  razão de existir é ler a conversa: nome, meta, dois botões e o seletor de
                  modo caíam em três linhas. Com os botões e o seletor em ícone abaixo de
                  `sm`, cabe em duas linhas curtas. */}
              <CardHeader className="shrink-0 border-b border-border/20 bg-muted/5 px-3 py-2 sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 sm:items-center sm:gap-4">
                  {/* No celular o nome toma a linha INTEIRA e as ações descem para a
                      segunda: dividindo a mesma linha, o bloco do nome era espremido a
                      ~110px, "Mariana Alves" virava "M." e o telefone quebrava em quatro
                      linhas — o cabeçalho ficava maior do que era antes. A partir de `sm`
                      volta a reservar 14rem e dividir a linha com as ações. */}
                  <div className="flex min-w-0 flex-1 basis-full items-start gap-2 sm:basis-56">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-ml-1 mt-0.5 size-8 shrink-0 rounded-xl md:hidden"
                      onClick={() => crm.setSelectedLeadId('')}
                      title="Voltar para a lista de conversas"
                      aria-label="Voltar para a lista de conversas"
                    >
                      <ChevronLeft className="size-5" aria-hidden />
                    </Button>
                    <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="truncate text-sm font-bold tracking-tight sm:text-lg">
                        {activeLead.patientName}
                      </CardTitle>
                      {activeLead.temperature === 'hot' && (
                        <Badge className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/10 dark:text-orange-400 border-none px-1.5 py-0 text-[10px]">
                          HOT
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground/80">
                      {(() => {
                        const ph = getLeadPhoneDisplay(activeLead)
                        return (
                          <span
                            className={ph.isReal ? 'font-mono' : 'italic text-muted-foreground/55'}
                            title={ph.isReal ? undefined : 'Telefone real ainda não recebido do ManyChat'}
                          >
                            {ph.label}
                          </span>
                        )
                      })()}
                      <span className="text-muted-foreground/30">•</span>
                      <span className="capitalize">{activeLead.source.replace('meta_', '')}</span>
                      {(() => {
                        const stamp = formatConversationHeaderStamp(activeLead.last_interaction_at ?? activeLead.createdAt)
                        // A data da última mensagem só aparece a partir de `sm`: no celular
                        // ela empurrava a meta para uma segunda linha, e o próprio fio da
                        // conversa já traz o separador de dia logo abaixo.
                        return stamp ? (
                          <>
                            <span className="hidden text-muted-foreground/30 sm:inline">•</span>
                            <span className="hidden sm:inline" title="Data da última mensagem">{stamp}</span>
                          </>
                        ) : null
                      })()}
                    </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl gap-1.5 text-xs"
                      onClick={() => {
                        markUnread(activeConversa?.chave ?? activeLead.id)
                        crm.setSelectedLeadId('')
                        toast.success('Conversa marcada como não lida')
                      }}
                      title="Marcar esta conversa como não lida (volta a aparecer em destaque na lista)"
                      aria-label="Marcar conversa como não lida"
                    >
                      <Mail className="size-3.5" aria-hidden />
                      <span className="hidden sm:inline">Não lida</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="lg:hidden rounded-xl gap-1.5 text-xs"
                      onClick={() => setLeadSheetOpen(true)}
                    >
                      <UserRound className="size-3.5" aria-hidden />
                      <span className="hidden sm:inline">Ficha</span>
                      <span className="sr-only sm:hidden">Abrir ficha do lead</span>
                    </Button>
                    {/* Compacto e na MESMA linha em qualquer largura: o atendente precisa
                        desligar a IA pelo celular, mas não às custas de meia tela. */}
                    <ConversationModeSwitch
                      variant="compact"
                      value={leadMode}
                      loading={modeLoading}
                      onChange={handleModeChange}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/10 p-2 sm:p-4 dark:bg-background/20">
                <LeadChatThread
                  leadId={activeLead.id}
                  history={activeHistory}
                  linha={porLinha ? activeConversa?.linha ?? null : undefined}
                  canCompose={crm.currentPermission.canRouteLeads && !waComposeBlocked}
                  readOnlyInstagramHint={waComposeBlocked}
                  aiConversationBase={crm.dataMode === 'supabase' ? aiGateForThread : null}
                />
              </CardContent>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-12 text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/5 shadow-inner">
                <Mail className="size-8 text-muted-foreground/50" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">Sua Central de Mensagens</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground/80">
                Selecione um lead na lista lateral para iniciar o atendimento ou ver o histórico completo.
              </p>
            </div>
          )}
        </Card>

        {/* Right Column: Lead Sidebar (desktop lg+) */}
        {activeLead && (
          <WorkspaceLeadSidebar 
            lead={activeLead} 
            history={activeHistory}
            className="hidden h-full min-h-0 lg:flex lg:w-[min(340px,28vw)] lg:shrink-0" 
          />
        )}

        {/* Lead Sheet (mobile/tablet) */}
        {activeLead && (
          <Sheet open={leadSheetOpen} onOpenChange={setLeadSheetOpen}>
            <SheetContent side="right" className="w-[min(100vw,420px)] p-0 overflow-hidden">
              <SheetHeader className="sr-only">
                <SheetTitle>Ficha do lead</SheetTitle>
                <SheetDescription>Campos e etapa do lead na conversa</SheetDescription>
              </SheetHeader>
              <WorkspaceLeadSidebar
                lead={activeLead}
                history={activeHistory}
                className="flex h-full w-full rounded-none border-0 shadow-none"
              />
            </SheetContent>
          </Sheet>
        )}
      </div>
    </AppLayout>
  )
}
