import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { PaymentsPanel } from '@/components/payments/ClinicPaymentsPanel'
import { useTenant } from '@/context/TenantContext'

/**
 * Financeiro / Reconciliação (Fase 3 da frente de vendas Tricopill). Reaproveita o
 * PaymentsPanel completo (recebido, a receber, % conciliado/comprovante, gráfico por dia,
 * import de extrato bancário com match automático, conciliação manual, comprovantes, CSV) —
 * antes só acessível dentro de "Links de pagamento". Agora é uma tela de primeira classe.
 */
export function TricopilFinancePage() {
  const { tenant } = useTenant()
  return (
    <AppLayout
      title="Recebimentos"
      subtitle="O que entrou, o que falta conciliar e os comprovantes."
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />
      <PaymentsPanel />
    </AppLayout>
  )
}
