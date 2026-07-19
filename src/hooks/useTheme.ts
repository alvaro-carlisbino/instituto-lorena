import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'crm-theme'

/** index.html aplica a classe antes do primeiro paint; aqui só lemos o estado atual. */
function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme)

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // navegação privada sem storage: o tema vale só até o reload
    }
    document.documentElement.classList.toggle('dark', next === 'dark')
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(readTheme() === 'dark' ? 'light' : 'dark')
  }, [setTheme])

  // Sincroniza trocas feitas em outra aba do CRM.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const next: Theme = e.newValue === 'dark' ? 'dark' : 'light'
      setThemeState(next)
      document.documentElement.classList.toggle('dark', next === 'dark')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { theme, setTheme, toggleTheme }
}
