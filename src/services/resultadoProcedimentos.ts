import { supabase } from '@/lib/supabaseClient'
import type { LinhaResultado } from '@/lib/resultadoProcedimento'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type Procedimento = LinhaResultado & {
  saleId: string | null
  kind: 'cirurgia' | 'protocolo' | 'sem_venda'
  status: string | null
  dia: string
  paciente: string
  leadId: string | null
  procedimento: string
  kitIds: string[]
  /** Como o kit chegou nesta venda: escolhido, deduzido (mesmo paciente, até 7 dias) ou nenhum. */
  vinculo: 'manual' | 'automatico' | 'sem_kit' | 'sem_venda'
  srgSurgeryId: number | null
  prontuario: string | null
}

export async function listResultadoProcedimentos(de: string, ate: string): Promise<Procedimento[]> {
  const { data, error } = await assertClient().rpc('crm_resultado_procedimentos', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    saleId: r.sale_id != null ? String(r.sale_id) : null,
    kind: (r.kind as Procedimento['kind']) ?? 'cirurgia',
    status: (r.status as string | null) ?? null,
    dia: String(r.dia ?? ''),
    paciente: String(r.patient_name ?? 'Sem nome'),
    leadId: (r.lead_id as string | null) ?? null,
    procedimento: String(r.procedure_label ?? ''),
    receitaCents: Number(r.receita_cents ?? 0),
    cobradoKitsCents: Number(r.cobrado_kits_cents ?? 0),
    materiaisKitsCents: Number(r.materiais_kits_cents ?? 0),
    materiaisManualCents: Number(r.materiais_manual_cents ?? 0),
    custoMedicoCents: Number(r.custo_medico_cents ?? 0),
    impostoCents: Number(r.imposto_cents ?? 0),
    outrosCents: Number(r.outros_cents ?? 0),
    kits: Number(r.kits ?? 0),
    kitIds: ((r.kit_ids as string[] | null) ?? []).map(String),
    vinculo: (r.vinculo as Procedimento['vinculo']) ?? 'sem_kit',
    srgSurgeryId: r.srg_surgery_id != null ? Number(r.srg_surgery_id) : null,
    prontuario: (r.shosp_prontuario as string | null) ?? null,
  }))
}

/** Custos lançados na venda. `profit_cents` na tabela é coluna calculada e acompanha sozinho. */
export async function salvarCustosDaVenda(
  saleId: string,
  custos: { medicoCents: number; impostoCents: number; outrosCents: number; materiaisManualCents: number },
): Promise<void> {
  const { error } = await assertClient()
    .from('clinic_sales')
    .update({
      cost_doctor_cents: Math.max(0, Math.round(custos.medicoCents)),
      tax_cents: Math.max(0, Math.round(custos.impostoCents)),
      cost_other_cents: Math.max(0, Math.round(custos.outrosCents)),
      cost_materials_cents: Math.max(0, Math.round(custos.materiaisManualCents)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', saleId)
  if (error) throw new Error(error.message)
}

export type VendaDoPaciente = {
  id: string
  kind: string
  status: string
  dia: string | null
  procedimento: string
  valorCents: number
}

/** Vendas do paciente para ligar o kit à cirurgia certa (mais próximas da data primeiro). */
export async function listVendasDoPaciente(leadId: string, dataReferencia?: string | null): Promise<VendaDoPaciente[]> {
  const { data, error } = await assertClient()
    .from('clinic_sales')
    .select('id, kind, status, sold_at, scheduled_at, procedure_label, value_cents')
    .eq('lead_id', leadId)
    .neq('status', 'cancelada')
    .order('sold_at', { ascending: false })
    .limit(30)
  if (error) throw new Error(error.message)
  const ref = dataReferencia ? new Date(`${dataReferencia}T12:00:00`).getTime() : Date.now()
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => {
      const agendada = r.scheduled_at ? String(r.scheduled_at).slice(0, 10) : null
      return {
        id: String(r.id),
        kind: String(r.kind ?? ''),
        status: String(r.status ?? ''),
        dia: agendada ?? (r.sold_at != null ? String(r.sold_at) : null),
        procedimento: String(r.procedure_label ?? ''),
        valorCents: Number(r.value_cents ?? 0),
      }
    })
    .sort((a, b) => {
      const da = a.dia ? Math.abs(new Date(`${a.dia}T12:00:00`).getTime() - ref) : Number.MAX_SAFE_INTEGER
      const db = b.dia ? Math.abs(new Date(`${b.dia}T12:00:00`).getTime() - ref) : Number.MAX_SAFE_INTEGER
      return da - db
    })
}

/** Liga (ou desliga, com null) o kit a uma venda. */
export async function vincularKitAVenda(kitId: string, saleId: string | null): Promise<void> {
  const { error } = await assertClient().from('stock_kits').update({ clinic_sale_id: saleId }).eq('id', kitId)
  if (error) throw new Error(error.message)
}
