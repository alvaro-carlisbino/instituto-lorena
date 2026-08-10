import { useCallback, useState } from 'react'

import type { NavGroupId } from '@/config/navigation'

/**
 * Quais grupos da sidebar ficam abertos, por navegador (localStorage).
 *
 * Antes esta escolha era estado volátil e zerava a cada navegação: abrir "Clínica" para
 * chegar em Agenda e, ao voltar para Leads, encontrá-lo fechado de novo. Para quem passa
 * o dia entre duas seções isso é um clique de imposto por troca de tela. Guardamos só o
 * que o usuário mexeu na mão — grupo em que ele nunca tocou continua seguindo o padrão
 * (aberto se for o da tela atual, ou "Início").
 */

const STORAGE_KEY = 'crm-nav-groups'

function readGroups(): Map<NavGroupId, boolean> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    return new Map(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
        .map(([id, open]) => [id as NavGroupId, open]),
    )
  } catch {
    // Storage cheio, desabilitado ou JSON corrompido: navegação sem preferência é
    // degradação aceitável, não pode derrubar a sidebar.
    return new Map()
  }
}

function writeGroups(groups: Map<NavGroupId, boolean>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(groups)))
  } catch {
    /* idem: preferência é opcional */
  }
}

export function useNavGroupPrefs() {
  const [openGroups, setOpenGroups] = useState<Map<NavGroupId, boolean>>(readGroups)

  const setGroupOpen = useCallback((id: NavGroupId, open: boolean) => {
    setOpenGroups((prev) => {
      const next = new Map(prev).set(id, open)
      writeGroups(next)
      return next
    })
  }, [])

  return { openGroups, setGroupOpen }
}
