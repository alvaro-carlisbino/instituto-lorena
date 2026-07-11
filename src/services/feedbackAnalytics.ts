import { supabase } from '@/lib/supabaseClient'

// Analytics de feedback/avaliação: lê survey_responses (nota+comentário) + survey_dispatches
// (canal/template) + leads (nome). RLS escopa no polo ativo; filtramos por tenant tb (super-admin).

export type FeedbackPoint = { date: string; label: string; respostas: number; nps: number }
export type FeedbackComment = { score: number | null; comment: string; nome: string; canal: string; quando: string }
export type FeedbackBreakdown = { chave: string; label: string; n: number; media: number }
export type FeedbackAnalytics = {
  total: number
  media: number | null
  nps: number | null
  promotores: number
  neutros: number
  detratores: number
  comComentario: number
  porCanal: FeedbackBreakdown[]
  serie: FeedbackPoint[]
  comentarios: FeedbackComment[]
}

const EMPTY: FeedbackAnalytics = {
  total: 0, media: null, nps: null, promotores: 0, neutros: 0, detratores: 0,
  comComentario: 0, porCanal: [], serie: [], comentarios: [],
}

const CANAL_LABEL: Record<string, string> = {
  manychat: 'WhatsApp (ManyChat)',
  whatsapp: 'WhatsApp',
  wapi: 'WhatsApp (W-API)',
  instagram: 'Instagram',
}

function isoDay(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)
}
function dayKey(iso: string): string {
  // chave AAAA-MM-DD em horário de Brasília (UTC-3)
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
}

export async function fetchFeedbackAnalytics(tenantId: string, days: number): Promise<FeedbackAnalytics> {
  if (!supabase) return EMPTY
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString()

  const { data: resp, error } = await supabase
    .from('survey_responses')
    .select('id, dispatch_id, score, comment, responded_at')
    .eq('tenant_id', tenantId)
    .gte('responded_at', sinceIso)
    .order('responded_at', { ascending: false })
    .limit(2000)
  if (error) throw new Error(error.message)
  const responses = Array.isArray(resp) ? resp : []
  if (responses.length === 0) return EMPTY

  // dispatches (canal + lead) e leads (nome)
  const dispatchIds = [...new Set(responses.map((r) => String(r.dispatch_id)).filter(Boolean))]
  const dispById = new Map<string, { channel: string; lead_id: string }>()
  if (dispatchIds.length) {
    const { data: disp } = await supabase.from('survey_dispatches').select('id, channel, lead_id').in('id', dispatchIds)
    for (const d of (disp ?? []) as Array<{ id: string; channel: string; lead_id: string }>) {
      dispById.set(String(d.id), { channel: String(d.channel ?? ''), lead_id: String(d.lead_id ?? '') })
    }
  }
  const leadIds = [...new Set([...dispById.values()].map((d) => d.lead_id).filter(Boolean))]
  const nameById = new Map<string, string>()
  if (leadIds.length) {
    const { data: leads } = await supabase.from('leads').select('id, patient_name').in('id', leadIds)
    for (const l of (leads ?? []) as Array<{ id: string; patient_name: string }>) {
      nameById.set(String(l.id), String(l.patient_name ?? '').trim())
    }
  }

  // agregações
  let soma = 0, comNota = 0, promotores = 0, neutros = 0, detratores = 0, comComentario = 0
  const canalAgg = new Map<string, { n: number; soma: number; comNota: number }>()
  const serieMap = new Map<string, { respostas: number; prom: number; det: number; comNota: number }>()
  const comentarios: FeedbackComment[] = []

  for (const r of responses) {
    const score = r.score == null ? null : Number(r.score)
    const disp = dispById.get(String(r.dispatch_id))
    const canal = disp?.channel || 'outro'
    const nome = disp ? (nameById.get(disp.lead_id) || 'Cliente') : 'Cliente'
    if (score != null && Number.isFinite(score)) {
      soma += score; comNota++
      if (score >= 9) promotores++
      else if (score >= 7) neutros++
      else detratores++
    }
    const ca = canalAgg.get(canal) ?? { n: 0, soma: 0, comNota: 0 }
    ca.n++; if (score != null) { ca.soma += score; ca.comNota++ }
    canalAgg.set(canal, ca)

    const dk = dayKey(String(r.responded_at))
    const sp = serieMap.get(dk) ?? { respostas: 0, prom: 0, det: 0, comNota: 0 }
    sp.respostas++
    if (score != null) { sp.comNota++; if (score >= 9) sp.prom++; else if (score <= 6) sp.det++ }
    serieMap.set(dk, sp)

    const comment = String(r.comment ?? '').trim()
    if (comment) {
      comComentario++
      if (comentarios.length < 30) comentarios.push({ score, comment, nome, canal, quando: String(r.responded_at) })
    }
  }

  const nps = comNota > 0 ? Math.round(((promotores - detratores) / comNota) * 100) : null
  const media = comNota > 0 ? Math.round((soma / comNota) * 10) / 10 : null

  const porCanal: FeedbackBreakdown[] = [...canalAgg.entries()]
    .map(([k, v]) => ({ chave: k, label: CANAL_LABEL[k] ?? k, n: v.n, media: v.comNota ? Math.round((v.soma / v.comNota) * 10) / 10 : 0 }))
    .sort((a, b) => b.n - a.n)

  const serie: FeedbackPoint[] = [...serieMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dk, v]) => ({
      date: dk,
      label: isoDay(new Date(`${dk}T12:00:00Z`)),
      respostas: v.respostas,
      nps: v.comNota ? Math.round(((v.prom - v.det) / v.comNota) * 100) : 0,
    }))

  return { total: responses.length, media, nps, promotores, neutros, detratores, comComentario, porCanal, serie, comentarios }
}
