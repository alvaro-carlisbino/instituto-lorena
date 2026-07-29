import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { destinationForPath, type NavDestination } from '@/config/navigation'

/**
 * Favoritos e recentes da navegação, por navegador (localStorage).
 *
 * O sistema tem ~50 telas visíveis para um admin. Ninguém usa 50 telas por dia: usa
 * uma dúzia. Fixar as suas + oferecer as últimas visitadas encurta a lista de leitura
 * sem esconder nada — os grupos completos continuam logo abaixo.
 */

const FAVORITES_KEY = 'crm-nav-favorites'
const RECENTS_KEY = 'crm-nav-recents'
const MAX_RECENTS = 6

function readIds(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    // Storage cheio, desabilitado ou JSON corrompido: navegação sem preferências
    // é degradação aceitável, não pode derrubar a sidebar.
    return []
  }
}

function writeIds(key: string, ids: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* idem: preferência é opcional */
  }
}

export function useNavPrefs(available: NavDestination[]) {
  const location = useLocation()
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readIds(FAVORITES_KEY))
  const [recentIds, setRecentIds] = useState<string[]>(() => readIds(RECENTS_KEY))

  // Registra a tela atual como recente. Favoritos ficam de fora: já estão fixados
  // no topo, repetir a mesma tela em duas listas só ocupa espaço.
  useEffect(() => {
    const current = destinationForPath(location.pathname)
    if (!current) return
    setRecentIds((prev) => {
      const next = [current.id, ...prev.filter((id) => id !== current.id)].slice(0, MAX_RECENTS)
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev
      writeIds(RECENTS_KEY, next)
      return next
    })
  }, [location.pathname])

  const toggleFavorite = useCallback((id: string) => {
    setFavoriteIds((prev) => {
      const next = prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
      writeIds(FAVORITES_KEY, next)
      return next
    })
  }, [])

  const byId = useMemo(() => new Map(available.map((d) => [d.id, d])), [available])

  // Resolvemos contra `available` para que uma tela que o usuário perdeu acesso
  // (troca de polo ou de permissão) simplesmente não apareça, em vez de virar link morto.
  const favorites = useMemo(
    () => favoriteIds.map((id) => byId.get(id)).filter((d): d is NavDestination => Boolean(d)),
    [favoriteIds, byId],
  )

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  // A tela atual sai dos recentes: ela já aparece destacada no próprio grupo, e listar
  // "Painel" duas vezes enquanto você está no Painel parece defeito, não atalho.
  const currentId = destinationForPath(location.pathname)?.id

  const recents = useMemo(
    () =>
      recentIds
        .filter((id) => !favoriteSet.has(id) && id !== currentId)
        .map((id) => byId.get(id))
        .filter((d): d is NavDestination => Boolean(d))
        .slice(0, 4),
    [recentIds, favoriteSet, byId, currentId],
  )

  const isFavorite = useCallback((id: string) => favoriteSet.has(id), [favoriteSet])

  return { favorites, recents, isFavorite, toggleFavorite }
}
