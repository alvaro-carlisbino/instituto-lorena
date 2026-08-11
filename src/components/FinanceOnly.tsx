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

  // A ordem importa: quem JÁ passou pela cerca continua dentro durante uma recarga.
  // Com `if (loading) return null` na frente, qualquer revalidação de sessão desmontava a
  // tela e levava junto formulário, filtro e lista — o usuário voltava do Google e tinha
  // perdido tudo. Só segura quem ainda não sabe se pode entrar.
  if (canViewFinance) return <>{children}</>
  if (loading) return null

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
