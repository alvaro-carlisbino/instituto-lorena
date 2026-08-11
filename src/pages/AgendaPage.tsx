import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { AgendaCirurgicaPanel } from '@/components/agenda/AgendaCirurgicaPanel'
import { ShospAgendaPanel } from '@/components/agenda/ShospAgendaPanel'

/**
 * A clínica tem duas agendas que não se misturam.
 *
 * CONSULTA acontece na Shosp: a agenda interna antiga (grade de salas + auto-agendamento)
 * foi aposentada, e ver, agendar e cancelar acontecem direto lá (ShospAgendaPanel), com o
 * funil sendo movido pelo status real da Shosp (ver crm-shosp / shospSync).
 *
 * CIRURGIA não passa pela Shosp: nasce na venda (clinic_sales) e é executada no sistema do
 * centro cirúrgico (espelho srg_*). Por isso a segunda aba, com fonte e calendário próprios.
 */
export const agendaTabs = [
  { to: '/agenda', label: 'Consultas (Shosp)' },
  { to: '/agenda/cirurgica', label: 'Agenda cirúrgica' },
]

export function AgendaPage() {
  return (
    <AppLayout title="Agenda Shosp">
      <SubTabs tabs={agendaTabs} />
      <ShospAgendaPanel />
    </AppLayout>
  )
}

export function AgendaCirurgicaPage() {
  return (
    <AppLayout
      title="Agenda cirúrgica"
      subtitle="O mês do centro cirúrgico: o que foi vendido e marcado, e o que a sala registrou."
    >
      <SubTabs tabs={agendaTabs} />
      <AgendaCirurgicaPanel />
    </AppLayout>
  )
}
