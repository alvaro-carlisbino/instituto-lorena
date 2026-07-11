import { supabase } from '@/lib/supabaseClient'
import { fetchClinicalNotes, type ClinicalNote } from '@/services/clinicalNotes'

// Perfil consolidado do cliente: junta identidade, origem (atribuição), jornada (etapa),
// feedback (survey_responses), notas clínicas e pagamentos — tudo do que o sistema já tem.

export type ProfileFeedback = { score: number | null; comment: string; when: string }
export type ProfilePayment = { gateway: string; amountCents: number; status: string; method: string; when: string }
export type ClientProfile = {
  id: string
  name: string
  phone: string
  cpf: string
  email: string
  channel: string
  source: string
  attributionChannel: string
  attributionCampaign: string
  pipelineId: string
  stageId: string
  createdAt: string
  shospProntuario: string
  feedbacks: ProfileFeedback[]
  notes: ClinicalNote[]
  payments: ProfilePayment[]
  interactionsCount: number
  lastInteractionAt: string | null
}

function cf(obj: unknown, ...path: string[]): string {
  let cur: unknown = obj
  for (const p of path) cur = (cur as Record<string, unknown> | null)?.[p]
  return cur == null ? '' : String(cur)
}

export async function fetchClientProfile(leadId: string): Promise<ClientProfile | null> {
  if (!supabase || !leadId) return null

  const { data: lead } = await supabase.from('leads')
    .select('id, patient_name, phone, source, custom_fields, pipeline_id, stage_id, created_at, last_interaction_at, shosp_prontuario, attribution_channel, attribution_campaign')
    .eq('id', leadId).maybeSingle()
  if (!lead) return null
  const l = lead as Record<string, unknown>
  const custom = (l.custom_fields ?? {}) as Record<string, unknown>

  // feedback (dispatches deste lead → responses)
  const feedbacks: ProfileFeedback[] = []
  const { data: disp } = await supabase.from('survey_dispatches').select('id').eq('lead_id', leadId).limit(50)
  const dispIds = (disp ?? []).map((d) => String((d as { id: string }).id))
  if (dispIds.length) {
    const { data: resp } = await supabase.from('survey_responses')
      .select('score, comment, responded_at').in('dispatch_id', dispIds).order('responded_at', { ascending: false })
    for (const r of (resp ?? []) as Array<{ score: number | null; comment: string | null; responded_at: string }>) {
      feedbacks.push({ score: r.score == null ? null : Number(r.score), comment: String(r.comment ?? ''), when: String(r.responded_at) })
    }
  }

  // notas clínicas
  let notes: ClinicalNote[] = []
  try { notes = await fetchClinicalNotes({ leadId, limit: 50 }) } catch { /* ignore */ }

  // pagamentos (rede + asaas)
  const payments: ProfilePayment[] = []
  const [{ data: rede }, { data: asaas }] = await Promise.all([
    supabase.from('rede_payments').select('amount_cents, status, method, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(20),
    supabase.from('asaas_payments').select('amount_cents, status, method, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(20),
  ])
  for (const p of (rede ?? []) as Array<Record<string, unknown>>) payments.push({ gateway: 'e.Rede', amountCents: Number(p.amount_cents ?? 0), status: String(p.status ?? ''), method: String(p.method ?? ''), when: String(p.created_at ?? '') })
  for (const p of (asaas ?? []) as Array<Record<string, unknown>>) payments.push({ gateway: 'Asaas', amountCents: Number(p.amount_cents ?? 0), status: String(p.status ?? ''), method: String(p.method ?? ''), when: String(p.created_at ?? '') })
  payments.sort((a, b) => (a.when < b.when ? 1 : -1))

  // contagem de interações
  const { count } = await supabase.from('interactions').select('id', { count: 'exact', head: true }).eq('lead_id', leadId)

  return {
    id: String(l.id),
    name: String(l.patient_name ?? '').trim() || 'Sem nome',
    phone: String(l.phone ?? ''),
    cpf: cf(custom, 'cadastro', 'cpf') || cf(custom, 'cpf'),
    email: cf(custom, 'cadastro', 'email') || cf(custom, 'email'),
    channel: cf(custom, 'channel'),
    source: String(l.source ?? ''),
    attributionChannel: String(l.attribution_channel ?? ''),
    attributionCampaign: String(l.attribution_campaign ?? ''),
    pipelineId: String(l.pipeline_id ?? ''),
    stageId: String(l.stage_id ?? ''),
    createdAt: String(l.created_at ?? ''),
    shospProntuario: String(l.shosp_prontuario ?? ''),
    feedbacks,
    notes,
    payments,
    interactionsCount: count ?? 0,
    lastInteractionAt: l.last_interaction_at ? String(l.last_interaction_at) : null,
  }
}
