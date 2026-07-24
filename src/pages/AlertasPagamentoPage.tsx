import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BellRing, RefreshCw } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import {
  type UnpaidAppointmentAlert,
  listUnpaidAppointmentAlerts,
  runUnpaidAppointmentAlertsNow,
} from '@/services/alertasPagamento'

export function AlertasPagamentoPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [rows, setRows] = useState<UnpaidAppointmentAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [pushing, setPushing] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setRows(await listUnpaidAppointmentAlerts())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar alertas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenant.id])

  const urgentCount = useMemo(() => rows.length, [rows])

  const pushInbox = async () => {
    setPushing(true)
    try {
      const n = await runUnpaidAppointmentAlertsNow()
      toast.success(n > 0 ? `${n} alerta(s) enviados ao sino (Luana/gestores).` : 'Nada novo para alertar agora.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao disparar alertas')
    } finally {
      setPushing(false)
    }
  }

  return (
    <AppLayout
      title="Alertas de pagamento"
      subtitle="Consultas agendadas sem pagamento — alerta para Luana e conciliação."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="bg-red-500/15 text-red-600">
          <AlertTriangle className="mr-1 size-3.5" />
          {urgentCount} sem pagamento
        </Badge>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" /> Atualizar
        </Button>
        <Button size="sm" onClick={() => void pushInbox()} disabled={pushing}>
          <BellRing className="size-3.5" /> {pushing ? 'Enviando…' : 'Alertar no sino agora'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('/conciliacao')}>
          Ir para conciliação
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Próximos 14 dias · sem pagamento no lead</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title={loading ? 'Carregando…' : 'Nenhum alerta'}
              description="Quando houver consulta agendada sem recebimento, aparece aqui."
            />
          ) : (
            rows.map((r) => (
              <div
                key={r.appointmentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5"
              >
                <div>
                  <div className="font-semibold">{r.patientName}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.startsAt).toLocaleString('pt-BR')}
                    {r.phone ? ` · ${r.phone}` : ''}
                    {' · '}
                    {r.status}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/leads/${r.leadId}`)}>
                    Abrir lead
                  </Button>
                  <Button size="sm" onClick={() => navigate('/contas-a-receber')}>
                    Lançar recebimento
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
