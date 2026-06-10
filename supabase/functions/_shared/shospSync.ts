import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from './crm.ts'
import {
  shospAgendaPorPaciente,
  shospListEspecialidades,
  shospListPlanosSaude,
  shospListPrestadores,
  shospListServicos,
  shospListUnidades,
  shospSearchPaciente,
} from './shosp.ts'

// Sync de leitura Shosp → tabelas espelho do CRM. Tudo idempotente (upsert) e
// limitado por lote para não estourar o tempo da edge function — o cron alcança
// o resto ao longo do tempo.

function nowIso(): string {
  return new Date().toISOString()
}

function digits(s: unknown): string {
  return String(s ?? '').replace(/\D/g, '')
}
function last8(s: unknown): string {
  const d = digits(s)
  return d.length >= 8 ? d.slice(-8) : ''
}
function cleanName(s: unknown): string {
  return String(s ?? '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extrai a lista de `dados`, lidando com array OU objeto-por-código. */
function dadosArray(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const dados = (data as Record<string, unknown>).dados
  if (Array.isArray(dados)) return dados as Record<string, unknown>[]
  if (dados && typeof dados === 'object') return Object.values(dados as Record<string, unknown>) as Record<string, unknown>[]
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  return []
}

/** porpaciente: { ret, dados: { "YYYY-MM-DD": [ {agendamento} ] } } */
function agendaByDate(data: unknown): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {}
  const dados = data && typeof data === 'object' ? (data as Record<string, unknown>).dados : null
  if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
    for (const [k, v] of Object.entries(dados as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v as Record<string, unknown>[]
    }
  }
  return out
}

export async function syncShospReferences(admin: SupabaseClient): Promise<{ upserted: number; error?: string | null }> {
  const rows: Array<{ kind: string; codigo: string; nome: string | null; payload: unknown; synced_at: string }> = []
  const push = (kind: string, codigo: unknown, nome: unknown, payload: unknown) => {
    const c = String(codigo ?? '').trim()
    if (!c || c === 'undefined' || c === 'null') return
    rows.push({ kind, codigo: c, nome: nome != null ? String(nome) : null, payload, synced_at: nowIso() })
  }

  for (const u of dadosArray((await shospListUnidades()).data)) push('unidade', u.codigoUnidade ?? u.codigo, u.nome, u)
  for (const e of dadosArray((await shospListEspecialidades()).data)) push('especialidade', e.codigoEspecialidade ?? e.codigo, e.nomeEspecialidade ?? e.nome, e)
  for (const p of dadosArray((await shospListPrestadores()).data)) push('prestador', p.codigo ?? p.codigoPrestador, p.nome, p)
  for (const s of dadosArray((await shospListServicos()).data)) push('servico', s.codigoServico ?? s.codigo, s.nome, s)
  for (const grp of dadosArray((await shospListPlanosSaude()).data)) {
    const planos = (grp as Record<string, unknown>).planosSaude
    if (Array.isArray(planos)) for (const pl of planos) push('planosaude', (pl as Record<string, unknown>).codigoPlanoSaude, (pl as Record<string, unknown>).nomePlanoSaude, pl)
  }

  // Dedupe por (kind,codigo): o Postgres aborta o upsert inteiro se a mesma chave
  // aparecer duas vezes no batch ("cannot affect row a second time").
  const byKey = new Map<string, (typeof rows)[number]>()
  for (const r of rows) byKey.set(`${r.kind}:${r.codigo}`, r)
  const deduped = Array.from(byKey.values())

  let error: string | null = null
  if (deduped.length) {
    const res = await admin.from('shosp_reference').upsert(deduped, { onConflict: 'kind,codigo' })
    if (res.error) {
      error = res.error.message
      console.warn('[shosp-sync] reference upsert error:', res.error.message)
    }
  }
  await admin.from('shosp_sync_state').update({ last_reference_sync_at: nowIso() }).eq('id', 'default')
  return { upserted: error ? 0 : deduped.length, error }
}

export async function matchLeadsToPatients(admin: SupabaseClient, limit = 15): Promise<{ matched: number; checked: number }> {
  const { data: leads } = await admin
    .from('leads')
    .select('id, patient_name, phone')
    .is('deleted_at', null)
    .is('shosp_prontuario', null)
    .not('phone', 'like', '888001%') // ignora telefones sintéticos do ManyChat (não casam por telefone)
    .order('last_interaction_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  let matched = 0
  let checked = 0
  for (const lead of (leads ?? []) as Array<{ id: string; patient_name: string; phone: string }>) {
    checked++
    const phone8 = last8(lead.phone)
    if (!phone8) continue // sem telefone real não dá pra confirmar o match com segurança
    const name = cleanName(lead.patient_name)
    if (name.length < 3) continue
    const searchName = name.split(' ').slice(0, 2).join(' ')

    let candidates: Record<string, unknown>[] = []
    try {
      candidates = dadosArray((await shospSearchPaciente({ nome: searchName })).data)
    } catch {
      continue
    }
    const hit = candidates.find((c) => last8(c.celular) === phone8 || last8(c.telefone) === phone8)
    if (!hit) continue
    const prontuario = String(hit.prontuario ?? hit.codigo ?? '').trim()
    if (!prontuario) continue

    await admin.from('shosp_patients').upsert(
      {
        prontuario,
        nome: hit.nome != null ? String(hit.nome) : null,
        cpf: hit.cpf != null ? String(hit.cpf) : null,
        celular: hit.celular != null ? String(hit.celular) : null,
        telefone: hit.telefone != null ? String(hit.telefone) : null,
        email: hit.email != null ? String(hit.email) : null,
        lead_id: lead.id,
        payload: hit,
        synced_at: nowIso(),
      },
      { onConflict: 'prontuario' },
    )
    await admin.from('leads').update({ shosp_prontuario: prontuario }).eq('id', lead.id)
    matched++
  }

  await admin.from('shosp_sync_state').update({ last_match_sync_at: nowIso() }).eq('id', 'default')
  return { matched, checked }
}

/**
 * Move o lead para a etapa certa conforme o status real da agenda Shosp (só
 * AVANÇA, nunca volta). Substitui o gatilho da agenda interna — Shosp é a fonte
 * da verdade. Casa a etapa pelo NOME dentro do pipeline do lead (sem hardcode de id).
 */
async function advanceLeadStageFromShosp(
  admin: SupabaseClient,
  leadId: string,
  hasComparecido: boolean,
  hasAgendado: boolean,
): Promise<boolean> {
  if (!hasComparecido && !hasAgendado) return false
  const { data: lead } = await admin
    .from('leads')
    .select('pipeline_id, stage_id, patient_name')
    .eq('id', leadId)
    .maybeSingle()
  const l = lead as { pipeline_id?: string; stage_id?: string; patient_name?: string } | null
  if (!l?.pipeline_id) return false
  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, name, position')
    .eq('pipeline_id', l.pipeline_id)
  const list = (stages ?? []) as Array<{ id: string; name: string; position: number }>
  if (!list.length) return false
  const curPos = list.find((s) => s.id === l.stage_id)?.position ?? -1
  const norm = (s: string) => s.toLowerCase()
  let target: { id: string; name: string; position: number } | undefined
  if (hasComparecido) target = list.find((s) => /consulta realizada|atendid|comparec|realizad/.test(norm(s.name)))
  if (!target && hasAgendado) target = list.find((s) => /consulta agendad|agendad/.test(norm(s.name)))
  if (!target || target.position <= curPos) return false

  await admin
    .from('leads')
    .update({ stage_id: target.id, stage_entered_at: nowIso(), updated_at: nowIso() })
    .eq('id', leadId)
  try {
    await insertInteraction(admin, {
      leadId,
      patientName: String(l.patient_name ?? ''),
      channel: 'system',
      direction: 'system',
      author: 'Sincronização Shosp',
      content: `Lead movido para "${target.name}" pela agenda Shosp (${hasComparecido ? 'paciente compareceu' : 'consulta agendada'}).`,
      happenedAt: nowIso(),
    })
  } catch {
    // log best-effort
  }
  return true
}

export async function syncAppointments(admin: SupabaseClient, limit = 25): Promise<{ leads: number; appts: number; advanced: number }> {
  const { data: leads } = await admin
    .from('leads')
    .select('id, shosp_prontuario')
    .is('deleted_at', null)
    .not('shosp_prontuario', 'is', null)
    .order('last_interaction_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  let appts = 0
  let advanced = 0
  for (const lead of (leads ?? []) as Array<{ id: string; shosp_prontuario: string }>) {
    const pront = String(lead.shosp_prontuario)
    let byDate: Record<string, Record<string, unknown>[]> = {}
    try {
      byDate = agendaByDate((await shospAgendaPorPaciente(pront)).data)
    } catch {
      continue
    }
    const rows: Array<Record<string, unknown>> = []
    for (const [dateKey, list] of Object.entries(byDate)) {
      for (const a of list) {
        const codigo = String(a.codigoAgendamento ?? '').trim()
        if (!codigo) continue
        rows.push({
          codigo_agendamento: codigo,
          prontuario: pront,
          lead_id: lead.id,
          codigo_unidade: a.codigoUnidade != null ? String(a.codigoUnidade) : null,
          codigo_prestador: a.codigoPrestador != null ? String(a.codigoPrestador) : null,
          prestador: a.prestador != null ? String(a.prestador) : null,
          servico: a.servico != null ? String(a.servico) : null,
          plano_saude: a.planoSaude != null ? String(a.planoSaude) : null,
          data: a.data != null ? String(a.data) : dateKey,
          horario: a.horario != null ? String(a.horario) : null,
          status: a.status != null ? String(a.status) : null,
          payload: a,
          synced_at: nowIso(),
        })
      }
    }
    if (rows.length) {
      await admin.from('shosp_appointments').upsert(rows, { onConflict: 'codigo_agendamento' })
      appts += rows.length
      // Shosp é a fonte da verdade: avança a etapa do lead pelo status real.
      const hasComparecido = rows.some((r) => /atendid|comparec|realizad/i.test(String(r.status ?? '')))
      const hasAgendado = rows.some((r) => /agendad|confirmad/i.test(String(r.status ?? '')))
      try {
        if (await advanceLeadStageFromShosp(admin, lead.id, hasComparecido, hasAgendado)) advanced++
      } catch {
        // best-effort
      }
    }
  }

  await admin.from('shosp_sync_state').update({ last_appointments_sync_at: nowIso() }).eq('id', 'default')
  return { leads: (leads ?? []).length, appts, advanced }
}

export async function runShospSync(
  admin: SupabaseClient,
  opts: { matchLimit?: number; apptLimit?: number; steps?: string[] } = {},
): Promise<Record<string, unknown>> {
  const steps = opts.steps ?? ['references', 'match', 'appointments']
  const result: Record<string, unknown> = {}
  if (steps.includes('references')) result.references = await syncShospReferences(admin)
  if (steps.includes('match')) result.match = await matchLeadsToPatients(admin, opts.matchLimit ?? 15)
  if (steps.includes('appointments')) result.appointments = await syncAppointments(admin, opts.apptLimit ?? 25)
  return result
}
