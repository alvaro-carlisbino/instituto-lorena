import { useEffect, useMemo, useState } from 'react'

import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { nomeCurtoDaLinha } from '@/lib/linhaWhatsapp'
import {
  fetchWhatsappChannelInstances,
  type WhatsappChannelInstance,
} from '@/services/whatsappChannelInstances'

/**
 * LINHA PARTICULAR (16/set/2026). O WhatsApp da Aline Muniz entrou visível para o polo
 * inteiro, e a Aline da SDR viu a carteira da colega chegando na lista dela. Linha com
 * `private_owner_id` só aparece para a dona e para admin.
 *
 * Devolve os ids das linhas particulares de OUTRA pessoa: conversa por uma delas sai da
 * lista do chat, do fio e dos alertas. Filtro de tela, não trava: o card segue no quadro
 * (ver migration 20260916230000).
 */
export function linhasParticularesDeOutros(
  linhas: Array<Pick<WhatsappChannelInstance, 'id' | 'privateOwnerId'>>,
  myAppUserId: string | null,
  role: string,
): Set<string> {
  const ocultas = new Set<string>()
  if (role === 'admin') return ocultas
  for (const l of linhas) {
    if (l.privateOwnerId && l.privateOwnerId !== myAppUserId) ocultas.add(l.id)
  }
  return ocultas
}

// Uma busca por carga de página: a lista de linhas muda quase nunca, e o chat, o fio e o sino
// de alertas montam juntos.
let cache: Promise<WhatsappChannelInstance[]> | null = null

function carregarLinhas(): Promise<WhatsappChannelInstance[]> {
  if (!cache) {
    cache = fetchWhatsappChannelInstances().catch(() => {
      cache = null
      return []
    })
  }
  return cache
}

function useTodasAsLinhas(): WhatsappChannelInstance[] {
  const [linhas, setLinhas] = useState<WhatsappChannelInstance[]>([])
  useEffect(() => {
    let vivo = true
    void carregarLinhas().then((rows) => {
      if (vivo) setLinhas(rows)
    })
    return () => {
      vivo = false
    }
  }, [])
  return linhas
}

export function useLinhasParticularesOcultas(): Set<string> {
  const crm = useCrm()
  const linhas = useTodasAsLinhas()
  return useMemo(
    () => linhasParticularesDeOutros(linhas, crm.myAppUserId, crm.effectiveRole),
    [linhas, crm.myAppUserId, crm.effectiveRole],
  )
}

export type LinhaDoPolo = {
  id: string
  label: string
  nomeCurto: string
  /** Dona do número particular (só ela e admin veem). `null` = o polo inteiro vê. */
  privateOwnerId: string | null
  /** `false` = número só da equipe, a IA não fala por ele. */
  aiAutoReply: boolean
}

export type LinhasDoPolo = {
  /** Linhas ATIVAS do polo da tela, na ordem de `sort_order`. */
  linhas: LinhaDoPolo[]
  ids: ReadonlySet<string>
  /** Primeira ativa: por onde sai o lead sem linha. */
  padraoId: string | null
  /** As que ESTE usuário pode ver (tira as particulares de outra pessoa). */
  visiveis: LinhaDoPolo[]
  ocultas: ReadonlySet<string>
  /** Polo com mais de um número: a conversa passa a ser separada por linha. */
  variasLinhas: boolean
}

export function useLinhasDoPolo(): LinhasDoPolo {
  const crm = useCrm()
  const { tenant } = useTenant()
  const todas = useTodasAsLinhas()
  return useMemo(() => {
    const ocultas = linhasParticularesDeOutros(todas, crm.myAppUserId, crm.effectiveRole)
    const linhas = todas
      .filter((l) => l.tenantId === tenant.id && l.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        id: l.id,
        label: l.label,
        nomeCurto: nomeCurtoDaLinha(l.label),
        privateOwnerId: l.privateOwnerId,
        aiAutoReply: l.aiAutoReply,
      }))
    return {
      linhas,
      ids: new Set(linhas.map((l) => l.id)),
      padraoId: linhas[0]?.id ?? null,
      visiveis: linhas.filter((l) => !ocultas.has(l.id)),
      ocultas,
      variasLinhas: linhas.length >= 2,
    }
  }, [todas, tenant.id, crm.myAppUserId, crm.effectiveRole])
}
