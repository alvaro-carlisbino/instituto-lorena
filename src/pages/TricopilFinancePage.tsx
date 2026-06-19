import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { PaymentsPanel } from '@/components/payments/ClinicPaymentsPanel'

/**
 * Financeiro / Reconciliação (Fase 3 da frente de vendas Tricopill). Reaproveita o
 * PaymentsPanel completo (recebido, a receber, % conciliado/comprovante, gráfico por dia,
 * import de extrato bancário com match automático, conciliação manual, comprovantes, CSV) —
 * antes só acessível dentro de "Links de pagamento". Agora é uma tela de primeira classe.
 */
export function TricopilFinancePage() {
  return (
    <AppLayout title="Financeiro Tricopill">
      <PageHeader
        title="Financeiro"
        description="Recebimentos, conciliação com o extrato bancário e comprovantes — tudo num lugar."
      />
      <PaymentsPanel />
    </AppLayout>
  )
}
