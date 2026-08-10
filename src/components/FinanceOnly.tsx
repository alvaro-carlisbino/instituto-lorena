import type { ReactNode } from 'react'

import { AppLayout } from '@/layouts/AppLayout'
import { EmptyState } from '@/components/ui/empty-state'
import { useTenant } from '@/context/TenantContext'
import { Lock } from 'lucide-react'

/**
 * Cerca das telas de financeiro. Esconder do menu não basta: quem soubesse a URL
 * abria a tela. A RLS (`current_user_can_finance`) é quem garante que o dado não sai
 * do banco — isto aqui é a versão honesta na tela, em vez de um financeiro vazio.
 */
export function FinanceOnly({ children }: { children: ReactNode }) {
  const { canViewFinance, loading } = useTenant()

  if (loading) return null
  if (canViewFinance) return <>{children}</>

  return (
    <AppLayout title="Financeiro" subtitle="Área restrita">
      <EmptyState
        icon={Lock}
        title="Acesso restrito ao financeiro"
        description="Extrato, contas e conciliação ficam com o financeiro e a gerência. Se você precisa desse acesso, peça para quem administra o sistema liberar."
      />
    </AppLayout>
  )
}
