import { createContext, useContext } from 'react'
import { useCrmState } from '../hooks/useCrmState'

type CrmContextValue = ReturnType<typeof useCrmState>

const CrmContext = createContext<CrmContextValue | null>(null)

export const CrmProvider = CrmContext.Provider

export const useCrm = () => {
  const context = useContext(CrmContext)
  if (!context) {
    throw new Error('useCrm deve ser usado dentro do CrmProvider.')
  }
  return context
}
