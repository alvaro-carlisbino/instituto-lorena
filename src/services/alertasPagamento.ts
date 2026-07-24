import { supabase } from '@/lib/supabaseClient'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type UnpaidAppointmentAlert = {
  appointmentId: string
  leadId: string
  patientName: string
  phone: string
  startsAt: string
  status: string
  hasReceivable: boolean
  hasGatewayPayment: boolean
}

/** Consultas próximas sem pagamento vinculado ao lead — tela + conciliação da Luana. */
export async function listUnpaidAppointmentAlerts(): Promise<UnpaidAppointmentAlert[]> {
  const client = assertClient()
  const from = new Date()
  from.setDate(from.getDate() - 1)
  const to = new Date()
  to.setDate(to.getDate() + 14)

  const { data: appts, error } = await client
    .from('appointments')
    .select('id, lead_id, starts_at, status, leads(patient_name, phone)')
    .in('status', ['confirmed', 'draft'])
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .not('lead_id', 'is', null)
    .order('starts_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)

  const leadIds = [...new Set((appts ?? []).map((a) => String(a.lead_id)).filter(Boolean))]
  if (leadIds.length === 0) return []

  const [recv, rede, asaas] = await Promise.all([
    client.from('fin_receivables').select('lead_id, status').in('lead_id', leadIds),
    client.from('rede_payments').select('lead_id, status').in('lead_id', leadIds),
    client.from('asaas_payments').select('lead_id, status').in('lead_id', leadIds),
  ])

  const paidLeads = new Set<string>()
  for (const r of recv.data ?? []) {
    if (['recebido', 'pago', 'received', 'paid', 'parcial'].includes(String(r.status))) {
      paidLeads.add(String(r.lead_id))
    }
  }
  for (const r of rede.data ?? []) {
    if (String(r.status) === 'paid') paidLeads.add(String(r.lead_id))
  }
  for (const r of asaas.data ?? []) {
    const s = String(r.status)
    if (['RECEIVED', 'CONFIRMED', 'paid', 'received'].includes(s)) paidLeads.add(String(r.lead_id))
  }

  const hasRecv = new Set((recv.data ?? []).map((r) => String(r.lead_id)))
  const hasGw = new Set([
    ...(rede.data ?? []).map((r) => String(r.lead_id)),
    ...(asaas.data ?? []).map((r) => String(r.lead_id)),
  ])

  return (appts ?? [])
    .filter((a) => a.lead_id && !paidLeads.has(String(a.lead_id)))
    .map((a) => {
      const lead = a.leads as { patient_name?: unknown; phone?: unknown } | null
      return {
        appointmentId: String(a.id),
        leadId: String(a.lead_id),
        patientName: lead?.patient_name != null ? String(lead.patient_name) : 'Paciente',
        phone: lead?.phone != null ? String(lead.phone) : '',
        startsAt: String(a.starts_at ?? ''),
        status: String(a.status ?? ''),
        hasReceivable: hasRecv.has(String(a.lead_id)),
        hasGatewayPayment: hasGw.has(String(a.lead_id)),
      }
    })
}

/** Dispara o cron SQL sob demanda (service role via RPC). */
export async function runUnpaidAppointmentAlertsNow(): Promise<number> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_unpaid_appointment_alerts')
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
