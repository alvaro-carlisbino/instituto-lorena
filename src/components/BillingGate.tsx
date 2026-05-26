import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTenant } from '@/context/TenantContext'

/**
 * Gate de billing: se o tenant está suspended/canceled, bloqueia o acesso ao app
 * com uma tela explicando e oferecendo contato. Trial expirado também bloqueia.
 *
 * NOTA: `lifetime` plan (Instituto Lorena) sempre passa.
 */
export function BillingGate({ children }: { children: ReactNode }) {
  const { tenant, loading } = useTenant()
  if (loading) return children as JSX.Element

  const billing = tenant.billing
  if (!billing) return children as JSX.Element

  const trialExpired =
    billing.status === 'trial' &&
    billing.trial_ends_at != null &&
    new Date(billing.trial_ends_at).getTime() < Date.now()

  const blocked =
    billing.status === 'suspended' ||
    billing.status === 'canceled' ||
    trialExpired

  if (!blocked) return children as JSX.Element

  const title =
    billing.status === 'suspended'
      ? 'Acesso suspenso'
      : billing.status === 'canceled'
        ? 'Assinatura cancelada'
        : 'Trial expirado'

  const description =
    billing.status === 'suspended'
      ? 'Sua assinatura está suspensa por falta de pagamento. Regularize para reativar o acesso.'
      : billing.status === 'canceled'
        ? 'Sua assinatura foi cancelada. Reative para voltar a usar o CRM.'
        : 'O período de trial de 14 dias acabou. Escolha um plano para continuar.'

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button
            onClick={() => {
              window.location.href = '/configuracoes#billing'
            }}
          >
            Ver planos
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              const { supabase } = await import('@/lib/supabaseClient')
              await supabase?.auth.signOut()
              window.location.href = '/'
            }}
          >
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
