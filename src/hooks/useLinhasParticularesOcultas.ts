import { useEffect, useMemo, useState } from 'react'

import { useCrm } from '@/context/CrmContext'
import {
  fetchWhatsappChannelInstances,
  type WhatsappChannelInstance,
} from '@/services/whatsappChannelInstances'

/**
 * LINHA PARTICULAR (16/set/2026). O WhatsApp da Aline Muniz entrou visível para o polo
 * inteiro, e a Aline da SDR viu a carteira da colega chegando na lista dela. Linha com
 * `private_owner_id` só aparece para a dona e para admin.
 *
 * Devolve os ids das linhas particulares de OUTRA pessoa: lead amarrado numa delas sai da
 * lista do chat e dos alertas. Filtro de tela, não trava: o card segue no quadro e a ficha
 * abre a conversa (ver migration 20260916230000).
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

// Uma busca por carga de página: a lista de linhas muda quase nunca, e o chat e o sino de
// alertas montam juntos.
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

export function useLinhasParticularesOcultas(): Set<string> {
  const crm = useCrm()
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

  return useMemo(
    () => linhasParticularesDeOutros(linhas, crm.myAppUserId, crm.effectiveRole),
    [linhas, crm.myAppUserId, crm.effectiveRole],
  )
}
