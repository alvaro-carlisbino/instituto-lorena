import { AppLayout } from '@/layouts/AppLayout'
import { ShospAgendaPanel } from '@/components/agenda/ShospAgendaPanel'

/**
 * Agenda do CRM = Shosp, sempre. A agenda interna antiga (grade de salas +
 * auto-agendamento) foi aposentada — a fonte da verdade é a Shosp: ver, agendar
 * e cancelar acontecem direto nela (ShospAgendaPanel), e o funil é movido pelo
 * status real da Shosp (ver crm-shosp / shospSync).
 */
export function AgendaPage() {
  return (
    <AppLayout title="Agenda Shosp">
      <ShospAgendaPanel />
    </AppLayout>
  )
}
