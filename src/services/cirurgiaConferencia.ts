import { supabase } from '@/lib/supabaseClient'

/**
 * Conferência entre o que a Central de Vendas diz e o que a sala de cirurgia registrou.
 *
 * O funil marcava "cirurgia realizada" pela data da planilha, não por alguém ter operado.
 * Resultado: 135 vendas com status "realizada" e 12 cirurgias de verdade no espelho.
 * Esta tela existe para que esse número pare de ser invisível.
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type ConferenciaStatus =
  | 'confirmada'
  | 'data_diverge'
  | 'realizada_sem_confirmacao'
  | 'agendada_sem_espelho'
  | 'sem_espelho'

export type LinhaConferencia = {
  saleId: string
  leadId: string | null
  pacienteNome: string
  prontuario: string | null
  status: string
  dataVendida: string | null
  dataDaSala: string | null
  srgSurgeryId: number | null
  matchKind: string | null
  diffDias: number | null
  foliculosImplantados: number | null
  conferencia: ConferenciaStatus
}

export const ROTULO_CONFERENCIA: Record<ConferenciaStatus, string> = {
  confirmada: 'Confirmada pela sala',
  data_diverge: 'Data diverge da sala',
  realizada_sem_confirmacao: 'Dada como realizada, sala não confirma',
  agendada_sem_espelho: 'Agendada, ainda não está na sala',
  sem_espelho: 'Sem registro na sala',
}

/**
 * A ordem importa: é a ordem de gravidade com que a tela mostra.
 * Uma cirurgia dada como realizada que a sala nunca viu é um problema de faturamento;
 * uma agendada que ainda não chegou na sala é rotina, porque quem carimba a sala é a
 * equipe no dia (o espelho inteiro tem 1 cirurgia futura).
 */
export const ORDEM_GRAVIDADE: ConferenciaStatus[] = [
  'realizada_sem_confirmacao',
  'data_diverge',
  'sem_espelho',
  'agendada_sem_espelho',
  'confirmada',
]

type Row = {
  sale_id: string
  lead_id: string | null
  patient_name: string | null
  shosp_prontuario: string | null
  status: string
  data_vendida: string | null
  data_da_sala: string | null
  srg_surgery_id: number | null
  srg_match_kind: string | null
  srg_date_diff_days: number | null
  total_implantados: number | null
  conferencia: ConferenciaStatus
}

export async function listarConferencia(): Promise<LinhaConferencia[]> {
  const { data, error } = await assertClient()
    .from('v_cirurgia_conferencia')
    .select('*')
    .limit(1000)
  if (error) throw new Error(error.message)

  return ((data ?? []) as Row[]).map((r) => ({
    saleId: r.sale_id,
    leadId: r.lead_id,
    pacienteNome: r.patient_name ?? 'Sem nome',
    prontuario: r.shosp_prontuario,
    status: r.status,
    dataVendida: r.data_vendida,
    dataDaSala: r.data_da_sala,
    srgSurgeryId: r.srg_surgery_id,
    matchKind: r.srg_match_kind,
    diffDias: r.srg_date_diff_days,
    foliculosImplantados: r.total_implantados,
    conferencia: r.conferencia,
  }))
}

export async function resumoConferencia(): Promise<Map<ConferenciaStatus, number>> {
  const { data, error } = await assertClient().rpc('crm_cirurgia_conferencia_resumo')
  if (error) throw new Error(error.message)
  const mapa = new Map<ConferenciaStatus, number>()
  for (const linha of (data ?? []) as { conferencia: ConferenciaStatus; total: number }[]) {
    mapa.set(linha.conferencia, Number(linha.total))
  }
  return mapa
}

export type ProtocoloSemCatalogo = {
  saleId: string
  leadId: string | null
  pacienteNome: string
  rotulo: string
  valor: number
  vendidoEm: string | null
  motivo: 'outros' | 'parcela'
}

/**
 * Venda de protocolo que não virou protocolo do paciente. São 10 hoje: rótulo que a
 * normalização não reconheceu, e "ENTRADA/RESTANTE DE PROTOCOLO", que é pedaço de
 * pagamento e viraria protocolo duplicado. Some da tela seria pior do que aparecer.
 */
export async function listarProtocolosSemCatalogo(): Promise<ProtocoloSemCatalogo[]> {
  const { data, error } = await assertClient()
    .from('v_protocolo_sem_catalogo')
    .select('*')
    .limit(200)
  if (error) throw new Error(error.message)

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    saleId: String(r.sale_id),
    leadId: (r.lead_id as string | null) ?? null,
    pacienteNome: (r.patient_name as string | null) ?? 'Sem nome',
    rotulo: (r.procedure_label as string | null) ?? '',
    valor: Number(r.valor ?? 0),
    vendidoEm: (r.sold_at as string | null) ?? null,
    motivo: (r.motivo as 'outros' | 'parcela') ?? 'outros',
  }))
}
