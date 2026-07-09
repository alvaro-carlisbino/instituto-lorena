import { supabase } from '@/lib/supabaseClient'

// Frente de Loja (PDV): cria/atualiza o lead do cliente de balcão ANTES do fechamento da
// venda (confirmSale lê o lead no servidor pelo id, então a linha precisa existir já). Grava
// tenant_id (visibilidade no workspace) e shosp_prontuario (vínculo com o paciente Shosp),
// que o persistLead padrão não mapeia. `source: 'manual'`, origem PDV no custom_fields.

export type PosLeadInput = {
  id: string
  patientName: string
  phone: string
  ownerId: string
  pipelineId: string
  stageId: string
  tenantId: string
  customFields: Record<string, unknown>
  shospProntuario?: string | null
}

export async function upsertPosLead(input: PosLeadInput): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const now = new Date().toISOString()
  const { error } = await supabase.from('leads').upsert(
    {
      id: input.id,
      patient_name: input.patientName,
      phone: input.phone,
      source: 'manual',
      created_at: now,
      position: 1,
      score: 0,
      temperature: 'warm',
      owner_id: input.ownerId,
      pipeline_id: input.pipelineId,
      stage_id: input.stageId,
      summary: 'Venda balcão (PDV)',
      custom_fields: input.customFields ?? {},
      whatsapp_instance_id: null,
      conversation_status: 'new',
      tenant_id: input.tenantId,
      ...(input.shospProntuario ? { shosp_prontuario: input.shospProntuario } : {}),
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}
