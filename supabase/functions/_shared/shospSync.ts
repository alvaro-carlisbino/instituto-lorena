import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from './crm.ts'
import {
  shospAgendaPorPaciente,
  shospGetAgenda,
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
/** Data → chave comparável AAAA-MM-DD. Aceita DD/MM/AAAA (cadastro) e AAAA-MM-DD (Shosp). */
function dateKey(s: unknown): string {
  const v = String(s ?? '').trim()
  let m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return ''
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

export async function matchLeadsToPatients(
  admin: SupabaseClient,
  limit = 15,
  agendaLimit = 20,
): Promise<{ matched: number; checked: number }> {
  // A API da Shosp tem rate limit (429 "Limit Exceeded"): busca espaçada, um retry
  // com pausa e, se persistir, encerra a RODADA inteira (o cron de 15min continua).
  // null = estourou o limite (pare o passe); [] = busca ok sem resultado (siga).
  let shospRateLimited = false
  const searchPaciente = async (nome: string): Promise<Record<string, unknown>[] | null> => {
    if (shospRateLimited) return null
    await new Promise((r) => setTimeout(r, 900))
    const call = async () => {
      try {
        return await shospSearchPaciente({ nome })
      } catch {
        return { ok: false, status: 0, data: null }
      }
    }
    let res = await call()
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 6000))
      res = await call()
    }
    if (res.status === 429) {
      shospRateLimited = true
      return null
    }
    return dadosArray(res.data)
  }

  let matched = 0
  let checked = 0

  // Pass 4 PRIMEIRO (agenda → lead, direção inversa): parte de quem JÁ AGENDOU.
  // Os passes 1-3 buscam pelo nome do LEAD (apelido de WhatsApp — quase nunca acha)
  // e reprocessam sempre os mesmos recentes. Aqui a fonte é a agenda espelhada, que
  // tem prontuário + NOME REAL (payload.paciente): busca o cadastro por esse nome
  // (veio da própria Shosp, a busca acha), espelha em shosp_patients e casa o
  // telefone com um lead sem vínculo. Roda primeiro porque é o passe de maior
  // rendimento e o rate limit da Shosp pode derrubar o resto da rodada.
  const { data: apptRows } = await admin
    .from('shosp_appointments')
    .select('prontuario, payload')
    .gte('data', ymdOffset(-45))
    .not('prontuario', 'is', null)
    .order('data', { ascending: false })
    .limit(2000)
  const { data: mirroredRows } = await admin.from('shosp_patients').select('prontuario')
  const mirrored = new Set(
    ((mirroredRows ?? []) as Array<{ prontuario: unknown }>).map((r) => String(r.prontuario)),
  )
  const pending: Array<{ prontuario: string; nome: string }> = []
  const seenPront = new Set<string>()
  for (const r of (apptRows ?? []) as Array<{ prontuario: unknown; payload: Record<string, unknown> | null }>) {
    const pront = String(r.prontuario ?? '').trim()
    if (!pront || mirrored.has(pront) || seenPront.has(pront)) continue
    seenPront.add(pront)
    const nome = cleanName(r.payload?.paciente)
    if (nome.length < 3) continue
    pending.push({ prontuario: pront, nome })
    if (pending.length >= agendaLimit) break
  }

  if (pending.length > 0) {
    // Índice de telefone dos leads da clínica sem vínculo (uma leitura só).
    const { data: freeLeads } = await admin
      .from('leads')
      .select('id, phone')
      .eq('tenant_id', 'instituto-lorena')
      .is('deleted_at', null)
      .is('shosp_prontuario', null)
      .not('phone', 'like', '888001%')
      .limit(5000)
    const leadsByLast8 = new Map<string, string[]>()
    for (const l of (freeLeads ?? []) as Array<{ id: string; phone: string }>) {
      const k = last8(l.phone)
      if (!k) continue
      const arr = leadsByLast8.get(k) ?? []
      arr.push(l.id)
      leadsByLast8.set(k, arr)
    }

    for (const p of pending) {
      checked++
      const candidates = await searchPaciente(p.nome.split(' ').slice(0, 2).join(' '))
      if (candidates === null) break
      const hit = candidates.find((c) => String(c.prontuario ?? c.codigo ?? '').trim() === p.prontuario)
      if (!hit) continue

      const phoneKeys = [...new Set([last8(hit.celular), last8(hit.telefone)].filter(Boolean))]
      const leadIds = [...new Set(phoneKeys.flatMap((k) => leadsByLast8.get(k) ?? []))]
      const leadId = leadIds.length === 1 ? leadIds[0] : null // ambíguo = não vincula

      // Espelha SEMPRE que achar o cadastro (mesmo sem lead): não re-busca na
      // próxima rodada e o telefone fica disponível pra matches futuros.
      await admin.from('shosp_patients').upsert(
        {
          prontuario: p.prontuario,
          nome: hit.nome != null ? String(hit.nome) : null,
          cpf: hit.cpf != null ? String(hit.cpf) : null,
          celular: hit.celular != null ? String(hit.celular) : null,
          telefone: hit.telefone != null ? String(hit.telefone) : null,
          email: hit.email != null ? String(hit.email) : null,
          lead_id: leadId,
          payload: hit,
          synced_at: nowIso(),
        },
        { onConflict: 'prontuario' },
      )
      if (leadId) {
        await admin.from('leads').update({ shosp_prontuario: p.prontuario }).eq('id', leadId)
        await admin
          .from('shosp_appointments')
          .update({ lead_id: leadId })
          .eq('prontuario', p.prontuario)
          .is('lead_id', null)
        for (const k of phoneKeys) leadsByLast8.delete(k)
        matched++
      }
    }
  }

  const { data: leads } = await admin
    .from('leads')
    .select('id, patient_name, phone')
    .is('deleted_at', null)
    .is('shosp_prontuario', null)
    .not('phone', 'like', '888001%') // ignora telefones sintéticos do ManyChat (não casam por telefone)
    .order('last_interaction_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  for (const lead of (leads ?? []) as Array<{ id: string; patient_name: string; phone: string }>) {
    checked++
    const phone8 = last8(lead.phone)
    if (!phone8) continue // sem telefone real não dá pra confirmar o match com segurança
    const name = cleanName(lead.patient_name)
    if (name.length < 3) continue
    const searchName = name.split(' ').slice(0, 2).join(' ')

    const candidates = await searchPaciente(searchName)
    if (candidates === null) break
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

  // Pass 2: leads com CPF no cadastro extraído da conversa. O telefone do ManyChat
  // é sintético (não casa), mas o CPF é único e confirma o paciente com segurança —
  // busca por nome e só vincula quando o CPF do candidato bate exatamente.
  const { data: cadastroLeads } = await admin
    .from('leads')
    .select('id, patient_name, custom_fields')
    .is('deleted_at', null)
    .is('shosp_prontuario', null)
    .not('custom_fields->cadastro->>cpf', 'is', null)
    .order('last_interaction_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  for (const lead of (cadastroLeads ?? []) as Array<{
    id: string
    patient_name: string
    custom_fields: Record<string, unknown> | null
  }>) {
    checked++
    const cadastro = (lead.custom_fields?.cadastro ?? {}) as Record<string, unknown>
    const cpfDigits = digits(cadastro.cpf)
    if (cpfDigits.length !== 11) continue
    const baseName = cleanName(cadastro.nomeCompleto ?? lead.patient_name)
    if (baseName.length < 3) continue
    const searchName = baseName.split(' ').slice(0, 2).join(' ')

    const candidates = await searchPaciente(searchName)
    if (candidates === null) break
    const hit = candidates.find((c) => digits(c.cpf) === cpfDigits)
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

  // Pass 3: leads com DATA DE NASCIMENTO no cadastro (o CPF nem sempre é ditado, e o
  // telefone sintético não casa). Nome (busca) + nascimento igual identifica com
  // segurança; se o candidato tiver CPF cadastrado E o lead também, os dois ainda
  // precisam bater — nunca vincula contra evidência.
  const { data: nascLeads } = await admin
    .from('leads')
    .select('id, patient_name, custom_fields')
    .is('deleted_at', null)
    .is('shosp_prontuario', null)
    .not('custom_fields->cadastro->>dataNascimento', 'is', null)
    .order('last_interaction_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  for (const lead of (nascLeads ?? []) as Array<{
    id: string
    patient_name: string
    custom_fields: Record<string, unknown> | null
  }>) {
    checked++
    const cadastro = (lead.custom_fields?.cadastro ?? {}) as Record<string, unknown>
    const nascKey = dateKey(cadastro.dataNascimento)
    if (!nascKey) continue
    const leadCpf = digits(cadastro.cpf)
    const baseName = cleanName(cadastro.nomeCompleto ?? lead.patient_name)
    if (baseName.length < 3) continue
    const searchName = baseName.split(' ').slice(0, 2).join(' ')

    const candidates = await searchPaciente(searchName)
    if (candidates === null) break
    const hit = candidates.find((c) => {
      if (dateKey(c.dataNascimento ?? c.nascimento) !== nascKey) return false
      const candCpf = digits(c.cpf)
      return !(leadCpf.length === 11 && candCpf.length === 11 && candCpf !== leadCpf)
    })
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

function ymdOffset(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

/**
 * Sync da agenda INTEIRA (todos os prestadores, janela futura) — não só do lead
 * casado. Extrai os slots OCUPADOS da grade Shosp para `shosp_appointments`,
 * dando base para métricas de volume/ocupação por médico. Atenção: a grade geral
 * traz paciente/status/plano, mas NÃO o serviço (esse só vem no por-paciente).
 */
export async function syncFullAgenda(
  admin: SupabaseClient,
  opts: { diasTotal?: number } = {},
): Promise<{ appts: number; prestadores: number }> {
  const diasTotal = Math.min(120, Math.max(7, opts.diasTotal ?? 45))
  const { data: prestadores } = await admin.from('shosp_reference').select('codigo, nome').eq('kind', 'prestador')
  const presList = (prestadores ?? []) as Array<{ codigo: string; nome: string }>

  const { data: matched } = await admin.from('leads').select('id, shosp_prontuario').not('shosp_prontuario', 'is', null)
  const leadByPront = new Map<string, string>()
  for (const m of (matched ?? []) as Array<{ id: string; shosp_prontuario: string }>) {
    leadByPront.set(String(m.shosp_prontuario), m.id)
  }

  let appts = 0
  for (const p of presList) {
    for (let offset = 0; offset < diasTotal; offset += 31) {
      const dias = Math.min(31, diasTotal - offset)
      let agendaData: unknown = null
      try {
        agendaData = (await shospGetAgenda({ codigoUnidade: 1, dataInicial: ymdOffset(offset), diasMostrar: dias, codigoPrestador: Number(p.codigo) })).data
      } catch {
        continue
      }
      const flat: Record<string, unknown>[] = []
      const walk = (x: unknown) => {
        if (Array.isArray(x)) x.forEach(walk)
        else if (x && typeof x === 'object') flat.push(x as Record<string, unknown>)
      }
      walk((agendaData as { dados?: unknown })?.dados ?? null)

      const rows: Array<Record<string, unknown>> = []
      for (const pr of flat.filter((o) => 'horarios' in o)) {
        const horarios = (pr.horarios ?? {}) as Record<string, { horario?: Record<string, unknown>[] }>
        for (const [date, info] of Object.entries(horarios)) {
          for (const h of info.horario ?? []) {
            const codigo = String(h.codigoAgendamento ?? '').trim()
            if (!codigo) continue // só ocupados
            const pront = h.codigoPaciente != null ? String(h.codigoPaciente) : null
            rows.push({
              codigo_agendamento: codigo,
              prontuario: pront,
              lead_id: pront ? leadByPront.get(pront) ?? null : null,
              codigo_unidade: '1',
              codigo_prestador: String(p.codigo),
              prestador: pr.nomePrestador != null ? String(pr.nomePrestador) : p.nome,
              servico: h.servico != null ? String(h.servico) : null,
              plano_saude: h.planoSaude != null ? String(h.planoSaude) : null,
              data: date,
              horario: h.horario != null ? String(h.horario) : null,
              status: h.status != null ? String(h.status) : null,
              payload: h,
              synced_at: nowIso(),
            })
          }
        }
      }
      if (rows.length) {
        await admin.from('shosp_appointments').upsert(rows, { onConflict: 'codigo_agendamento' })
        appts += rows.length
      }
    }
  }
  await admin.from('shosp_sync_state').update({ last_appointments_sync_at: nowIso() }).eq('id', 'default')
  return { appts, prestadores: presList.length }
}

export async function runShospSync(
  admin: SupabaseClient,
  opts: { matchLimit?: number; apptLimit?: number; diasTotal?: number; steps?: string[]; agendaLimit?: number } = {},
): Promise<Record<string, unknown>> {
  const steps = opts.steps ?? ['references', 'match', 'appointments']
  const result: Record<string, unknown> = {}
  if (steps.includes('references')) result.references = await syncShospReferences(admin)
  if (steps.includes('match')) result.match = await matchLeadsToPatients(admin, opts.matchLimit ?? 15, opts.agendaLimit ?? 20)
  if (steps.includes('appointments')) result.appointments = await syncAppointments(admin, opts.apptLimit ?? 25)
  if (steps.includes('full_agenda')) result.full_agenda = await syncFullAgenda(admin, { diasTotal: opts.diasTotal })
  return result
}
