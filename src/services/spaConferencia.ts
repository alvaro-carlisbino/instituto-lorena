import type { LinhaConferenciaSpa } from '@/lib/conferenciaSpa'
import { supabase } from '@/lib/supabaseClient'

// Conferência do SPA: agenda do Spa Capilar (espelho do Shosp) × kits do SPA. O casamento mora
// no banco (stock_spa_conferencia, migration 20260923150000): agendamento, prontuário, cadastro
// ou nome no mesmo dia.

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export async function listarConferenciaSpa(de: string, ate: string): Promise<LinhaConferenciaSpa[]> {
  const { data, error } = await assertClient().rpc('stock_spa_conferencia', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    tipo: r.tipo === 'kit_sem_agenda' ? 'kit_sem_agenda' : 'atendimento',
    codigoAgendamento: r.codigo_agendamento != null ? String(r.codigo_agendamento) : null,
    data: String(r.data ?? ''),
    horario: r.horario != null ? String(r.horario) : null,
    prestador: r.prestador != null ? String(r.prestador) : null,
    paciente: String(r.paciente ?? ''),
    prontuario: r.prontuario != null ? String(r.prontuario) : null,
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    status: r.status != null ? String(r.status) : null,
    semMaterial: Boolean(r.sem_material),
    kitId: r.kit_id != null ? String(r.kit_id) : null,
    kitNome: r.kit_nome != null ? String(r.kit_nome) : null,
    kitStatus: r.kit_status != null ? String(r.kit_status) : null,
  }))
}

/** Atendimento que não gasta material (avaliação, retorno): sai da lista de pendentes. */
export async function marcarSemMaterial(agendamentos: string[]): Promise<void> {
  if (agendamentos.length === 0) return
  const { error } = await assertClient()
    .from('stock_spa_sem_material')
    .upsert(
      agendamentos.map((codigo) => ({ codigo_agendamento: codigo })),
      { onConflict: 'tenant_id,codigo_agendamento', ignoreDuplicates: true },
    )
  if (error) throw new Error(error.message)
}

export async function desfazerSemMaterial(agendamentos: string[]): Promise<void> {
  if (agendamentos.length === 0) return
  const { error } = await assertClient().from('stock_spa_sem_material').delete().in('codigo_agendamento', agendamentos)
  if (error) throw new Error(error.message)
}
