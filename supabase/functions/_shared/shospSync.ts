import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from './crm.ts'
import {
  shospAgendaPorPaciente,
  shospCallCount,
  shospGetAgenda,
  shospIsRateLimited,
  shospRateLimitDetalhe,
  shospListEspecialidades,
  shospListPlanosSaude,
  shospListPrestadores,
  shospListServicos,
  shospListUnidades,
  shospResetCallStats,
  shospSearchPaciente,
} from './shosp.ts'

// Sync de leitura Shosp → tabelas espelho do CRM. Tudo idempotente (upsert) e
// limitado por lote para não estourar o tempo da edge function — o cron alcança
// o resto ao longo do tempo.
//
// NÃO MANDAR `first_seen_at` NO PAYLOAD DE `shosp_appointments`. A coluna guarda
// a primeira vez que o CRM viu o agendamento, e é o único proxy de "quando foi
// marcado" (a Shosp só devolve a data DA CONSULTA). Ela funciona por omissão:
// coluna ausente do payload não entra no DO UPDATE SET do PostgREST, então o
// default now() vale no INSERT e nada reescreve depois. Incluir o campo, mesmo
// com o valor certo, faz a data de criação virar a data do último sync e mata a
// métrica em silêncio, do mesmo jeito que `synced_at` já não serve para isso.

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

  // Cota estourada: as 5 listas voltaram 429 e `deduped` está vazio. Antes isto
  // devolvia `{ upserted: 0, error: null }` — indistinguível de "a Shosp não tem
  // nada cadastrado" — e ainda carimbava `last_reference_sync_at`. Agora falha alto
  // e não mente sobre a data do último sync.
  if (shospIsRateLimited()) {
    console.error('[shosp-sync] referências: cota da Shosp estourada (HTTP 429)')
    return { upserted: 0, error: 'rate_limited' }
  }

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
 *
 * A nota de sistema é carimbada com o tenant do FUNIL onde o card se moveu, nunca
 * pela linha de WhatsApp. Sem o carimbo explícito, o trigger `_stamp_tenant_id_from_lead`
 * aplica a regra "a conversa segue a linha", que vale para mensagem e não para evento
 * de funil: em 21/ago/26 o João (paciente da clínica, prontuário 7044) tinha falado de
 * manhã na linha do Tricopill, e o aviso de "movido para Agendado" no funil PROTOCOLOS
 * E SPA foi parar na timeline da loja. Evento de funil pertence ao polo do funil.
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
  const { data: pipe } = await admin
    .from('pipelines')
    .select('tenant_id')
    .eq('id', l.pipeline_id)
    .maybeSingle()
  const pipelineTenant = (pipe as { tenant_id?: string } | null)?.tenant_id ?? null
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
      tenantId: pipelineTenant ?? undefined,
    })
  } catch {
    // log best-effort
  }
  return true
}

export async function syncAppointments(admin: SupabaseClient, limit = 25): Promise<{ leads: number; appts: number; advanced: number }> {
  // Cota já estourada nesta rodada: não gasta mais chamada nem carimba sucesso.
  if (shospIsRateLimited()) return { leads: 0, appts: 0, advanced: 0 }

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

  // O carimbo significa "dado NOVO entrou", não "eu tentei".
  //
  // A guarda anterior era só `!shospIsRateLimited()`, e a bandeira de 429 é por invocação:
  // uma rodada que não estourou a cota mas também não trouxe nenhum agendamento carimbava
  // sucesso do mesmo jeito. Foi assim que em 28/jul o estado dizia "sincronizado às 11:00"
  // com o espelho parado em 09/jul, 19 dias, e o painel exibindo a foto velha como se
  // fosse de hoje. Exigir `appts > 0` amarra o carimbo ao único fato que interessa: a
  // Shosp respondeu com agendamento.
  if (!shospIsRateLimited() && appts > 0) {
    await admin.from('shosp_sync_state').update({ last_appointments_sync_at: nowIso() }).eq('id', 'default')
  }
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
 *
 * MULTI-UNIDADE: varre todas as unidades cadastradas em `shosp_reference`, não a
 * unidade 1 fixa. Enquanto o código estava cravado em `codigoUnidade: 1`, agenda
 * de qualquer outra praça (Londrina) simplesmente nunca era buscada — e como o
 * `codigo_unidade` gravado também era '1' na mão, nem dava pra separar depois.
 */
export async function syncFullAgenda(
  admin: SupabaseClient,
  opts: { diasTotal?: number } = {},
): Promise<{ appts: number; prestadores: number; unidades: number }> {
  const diasTotal = Math.min(120, Math.max(7, opts.diasTotal ?? 45))
  const { data: prestadores } = await admin.from('shosp_reference').select('codigo, nome').eq('kind', 'prestador')
  const presList = (prestadores ?? []) as Array<{ codigo: string; nome: string }>

  const { data: unidadesRef } = await admin.from('shosp_reference').select('codigo, nome').eq('kind', 'unidade')
  // Sem referência sincronizada (ex.: primeira execução), cai na unidade 1 — o
  // comportamento antigo — em vez de não varrer nada.
  const uniList = ((unidadesRef ?? []) as Array<{ codigo: string; nome: string }>).filter((u) => u.codigo)
  const unidades = uniList.length ? uniList : [{ codigo: '1', nome: '' }]

  const { data: matched } = await admin.from('leads').select('id, shosp_prontuario').not('shosp_prontuario', 'is', null)
  const leadByPront = new Map<string, string>()
  for (const m of (matched ?? []) as Array<{ id: string; shosp_prontuario: string }>) {
    leadByPront.set(String(m.shosp_prontuario), m.id)
  }

  let appts = 0
  for (const u of unidades) {
  for (const p of presList) {
    for (let offset = 0; offset < diasTotal; offset += 31) {
      if (shospIsRateLimited()) break // cota estourada: para de queimar chamada
      const dias = Math.min(31, diasTotal - offset)
      let agendaData: unknown = null
      try {
        agendaData = (await shospGetAgenda({ codigoUnidade: u.codigo, dataInicial: ymdOffset(offset), diasMostrar: dias, codigoPrestador: Number(p.codigo) })).data
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
              codigo_unidade: String(u.codigo),
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
  }
  // Mesma regra do `syncAppointments`: carimba só se agendamento realmente entrou.
  if (!shospIsRateLimited() && appts > 0) {
    await admin.from('shosp_sync_state').update({ last_appointments_sync_at: nowIso() }).eq('id', 'default')
  }
  return { appts, prestadores: presList.length, unidades: unidades.length }
}

/**
 * Espelho dos horários LIVRES da agenda da Shosp, que é o que a landing /consulta
 * oferece ao paciente.
 *
 * `syncFullAgenda` (acima) guarda o que está OCUPADO, porque nasceu para medir
 * ocupação por médico. Aqui é o contrário: a linha que interessa é a que tem
 * `codigoHorario` e NÃO tem `codigoAgendamento`. A resposta da Shosp traz os três
 * tipos no mesmo array:
 *   { codigoHorario, horario }                    → livre
 *   { codigoAgendamento, paciente, status, ... }  → ocupado
 *   { horario, restricao: "AGENDA FECHADA" }      → dia/turno fechado
 *
 * Varre só os profissionais cadastrados em `clinic_booking_prestadores`, que hoje
 * são três. Varrer os oito prestadores (spa incluso) seria queimar cota para
 * mostrar horário de lavagem pós-cirúrgica como se fosse avaliação.
 *
 * A janela inteira é apagada e reescrita: horário que a clínica preencheu na Shosp
 * some daqui na próxima rodada, que é exatamente o comportamento que se espera de
 * um espelho.
 */
export async function syncAgendaLivre(
  admin: SupabaseClient,
  opts: { dias?: number } = {},
): Promise<{ livres: number; prestadores: number; dias: number; rate_limited: boolean }> {
  const dias = Math.min(31, Math.max(1, opts.dias ?? 21))

  const { data: prestadores } = await admin
    .from('clinic_booking_prestadores')
    .select('codigo_prestador, nome, unidade_id, active')
    .eq('active', true)
  const { data: unidades } = await admin
    .from('clinic_booking_units')
    .select('id, shosp_codigo_unidade')
    .eq('active', true)
    .not('shosp_codigo_unidade', 'is', null)

  // Um profissional pode servir duas unidades (Maringá e online usam a mesma
  // agenda da Shosp). A chamada é por CÓDIGO DE UNIDADE da Shosp, então dedupa.
  const codigosUnidade = new Set<string>()
  for (const u of (unidades ?? []) as Array<{ shosp_codigo_unidade: string | null }>) {
    if (u.shosp_codigo_unidade) codigosUnidade.add(String(u.shosp_codigo_unidade))
  }
  const codigosPrestador = new Map<string, string>()
  for (const p of (prestadores ?? []) as Array<{ codigo_prestador: string; nome: string }>) {
    codigosPrestador.set(String(p.codigo_prestador), String(p.nome ?? ''))
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const fim = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10)
  let livres = 0

  for (const codigoUnidade of codigosUnidade) {
    for (const [codigoPrestador, nome] of codigosPrestador) {
      if (shospIsRateLimited()) break
      let agenda: unknown = null
      try {
        agenda = (
          await shospGetAgenda({
            codigoUnidade,
            dataInicial: hoje,
            diasMostrar: dias,
            codigoPrestador: Number(codigoPrestador),
          })
        ).data
      } catch {
        continue
      }

      const blocos: Record<string, unknown>[] = []
      const walk = (x: unknown) => {
        if (Array.isArray(x)) x.forEach(walk)
        else if (x && typeof x === 'object') blocos.push(x as Record<string, unknown>)
      }
      walk((agenda as { dados?: unknown })?.dados ?? null)

      const linhas: Array<Record<string, unknown>> = []
      for (const bloco of blocos.filter((o) => 'horarios' in o)) {
        const horarios = (bloco.horarios ?? {}) as Record<string, { horario?: Record<string, unknown>[] }>
        for (const [dia, info] of Object.entries(horarios)) {
          for (const h of info.horario ?? []) {
            if (h.codigoAgendamento) continue        // ocupado
            if (h.restricao) continue                // AGENDA FECHADA
            const codigoHorario = h.codigoHorario
            if (codigoHorario === undefined || codigoHorario === null) continue
            const hora = String(h.horario ?? '').slice(0, 5)
            if (!/^\d{2}:\d{2}$/.test(hora)) continue
            linhas.push({
              codigo_unidade: String(codigoUnidade),
              codigo_prestador: String(codigoPrestador),
              prestador: String((bloco.nomePrestador as string | undefined) ?? nome),
              dia,
              horario: hora,
              codigo_horario: String(codigoHorario),
              synced_at: nowIso(),
            })
          }
        }
      }

      // Só apaga a janela depois de a Shosp ter respondido: se a chamada falhar, o
      // espelho antigo continua de pé em vez de a landing ficar sem agenda nenhuma.
      await admin
        .from('shosp_agenda_slots')
        .delete()
        .eq('codigo_unidade', String(codigoUnidade))
        .eq('codigo_prestador', String(codigoPrestador))
        .gte('dia', hoje)
        .lte('dia', fim)

      if (linhas.length) {
        await admin
          .from('shosp_agenda_slots')
          .upsert(linhas, { onConflict: 'codigo_unidade,codigo_prestador,dia,horario' })
        livres += linhas.length
      }
    }
  }

  return { livres, prestadores: codigosPrestador.size, dias, rate_limited: shospIsRateLimited() }
}

/**
 * Preenche o SERVIÇO das consultas que a grade geral trouxe sem ele.
 *
 * A grade por prestador (`syncFullAgenda`) devolve paciente, status e plano, mas NÃO o serviço —
 * esse só vem na agenda POR PACIENTE. Resultado: em agosto/2026, 1.023 dos 1.117 agendamentos
 * estavam sem tipo, e a conversão da consulta não conseguia separar consulta de transplante de
 * consulta clínica, que é o que a gerência mede ("conversão sobre as consultas de TC geradas").
 *
 * Roda por PRONTUÁRIO, não por lead: 45% dos pacientes que consultam não têm lead casado, e são
 * consultas iguais às outras. Escreve com UPDATE (nunca upsert) e só onde o serviço está vazio —
 * assim não apaga nada que a agenda já tinha e pode rodar quantas vezes for preciso.
 *
 * Cota: uma chamada por paciente, com o mesmo freio de 429 do resto do sync.
 */
export async function enriquecerServicoDeConsultas(
  admin: SupabaseClient,
  opts: { limit?: number; dias?: number } = {},
): Promise<{ pacientes: number; agendamentos: number; pendentes: number }> {
  if (shospIsRateLimited()) return { pacientes: 0, agendamentos: 0, pendentes: 0 }
  const limite = Math.min(40, Math.max(1, opts.limit ?? 15))
  const dias = Math.min(180, Math.max(1, opts.dias ?? 90))
  const desde = ymdOffset(-dias)
  const hoje = ymdOffset(0)

  // Só o passado: agendamento futuro ainda pode mudar de serviço, e o que a conversão precisa
  // é da consulta que já aconteceu.
  // Quem entra na fila são as CONSULTAS sem tipo, não qualquer agendamento. Cada chamada traz a
  // agenda inteira do paciente, então mirar num bloqueio ou numa lavagem gasta a mesma cota e não
  // move a conversão: com a fila geral, uma rodada de 12 pacientes acrescentava 2 consultas
  // tipadas em agosto.
  const { data: consultas } = await admin.rpc('crm_consultas_realizadas_tipadas', {
    p_de: desde,
    p_ate: hoje,
  })
  const semTipo = ((consultas ?? []) as Array<{ prontuario: string; codigo: string; tipo: string }>).filter(
    (c) => c.tipo === 'sem_tipo' && c.prontuario,
  )

  // Ordena pelo MENOS tentado. Nem toda consulta tem serviço na Shosp (encaixe, agendamento
  // antigo): sem esta ordem, os mesmos pacientes voltavam ao topo para sempre e a fila não andava
  // — quatro rodadas seguidas gastaram 48 chamadas e preencheram 3 agendamentos.
  const codigos = semTipo.map((c) => String(c.codigo)).filter(Boolean).slice(0, 300)
  const prontuarios: string[] = []
  if (codigos.length) {
    const { data: ordenados } = await admin
      .from('shosp_appointments')
      .select('prontuario, synced_at')
      .in('codigo_agendamento', codigos)
      .is('servico', null)
      .order('synced_at', { ascending: true, nullsFirst: true })
      .limit(300)
    for (const r of (ordenados ?? []) as Array<{ prontuario: string }>) {
      const p = String(r.prontuario)
      if (p && !prontuarios.includes(p)) prontuarios.push(p)
      if (prontuarios.length >= limite) break
    }
  }
  const pendentes = new Set(semTipo.map((c) => String(c.prontuario))).size

  let agendamentos = 0
  let pacientes = 0
  for (const pront of prontuarios) {
    if (shospIsRateLimited()) break
    let byDate: Record<string, Record<string, unknown>[]> = {}
    try {
      byDate = agendaByDate((await shospAgendaPorPaciente(pront)).data)
    } catch {
      continue
    }
    pacientes++
    for (const list of Object.values(byDate)) {
      for (const a of list) {
        const codigo = String(a.codigoAgendamento ?? '').trim()
        const servico = a.servico != null ? String(a.servico).trim() : ''
        if (!codigo || !servico) continue
        // `.is('servico', null)` na condição: nunca sobrescreve serviço já gravado.
        // O `.select()` faz o PostgREST devolver o que mudou — sem ele o contador somava
        // tentativa, não gravação, e a rodada dizia "207 agendamentos" tendo escrito 3.
        const { data: mudou } = await admin
          .from('shosp_appointments')
          .update({ servico, synced_at: nowIso() })
          .eq('codigo_agendamento', codigo)
          .is('servico', null)
          .select('codigo_agendamento')
        agendamentos += (mudou ?? []).length
      }
    }
    // Carimbo de TENTATIVA: o que continuou sem serviço vai para o fim da fila. Sem isto o
    // paciente cuja agenda a Shosp devolve sem serviço é sorteado para sempre.
    await admin
      .from('shosp_appointments')
      .update({ synced_at: nowIso() })
      .eq('prontuario', pront)
      .is('servico', null)
      .gte('data', desde)
      .lte('data', hoje)
  }
  return { pacientes, agendamentos, pendentes }
}

export async function runShospSync(
  admin: SupabaseClient,
  opts: {
    matchLimit?: number
    apptLimit?: number
    diasTotal?: number
    steps?: string[]
    agendaLimit?: number
    servicoLimit?: number
    servicoDias?: number
  } = {},
): Promise<Record<string, unknown>> {
  const steps = opts.steps ?? ['references', 'match', 'appointments']
  const result: Record<string, unknown> = {}
  shospResetCallStats()

  if (steps.includes('references')) result.references = await syncShospReferences(admin)
  if (steps.includes('match')) result.match = await matchLeadsToPatients(admin, opts.matchLimit ?? 15, opts.agendaLimit ?? 20)
  if (steps.includes('appointments')) result.appointments = await syncAppointments(admin, opts.apptLimit ?? 25)
  if (steps.includes('full_agenda')) result.full_agenda = await syncFullAgenda(admin, { diasTotal: opts.diasTotal })
  if (steps.includes('agenda_livre')) result.agenda_livre = await syncAgendaLivre(admin, { dias: opts.diasTotal })
  if (steps.includes('servicos')) {
    result.servicos = await enriquecerServicoDeConsultas(admin, { limit: opts.servicoLimit, dias: opts.servicoDias })
  }

  // Consumo e saúde da rodada vão na resposta E no estado — é o que faltava para
  // alguém perceber que a integração estava morta. `notes` é lido no painel.
  result.shosp_calls = shospCallCount()
  result.rate_limited = shospIsRateLimited()

  // Quantos agendamentos realmente entraram nesta rodada, somando os dois passos que
  // escrevem em `shosp_appointments`.
  const apptsIngeridos =
    Number((result.appointments as { appts?: number } | undefined)?.appts ?? 0) +
    Number((result.full_agenda as { appts?: number } | undefined)?.appts ?? 0)
  result.appts_ingeridos = apptsIngeridos

  // `notes` é o que a operação lê para saber se pode confiar no número. Antes só o 429
  // deixava rastro: uma rodada que terminava sem trazer nada limpava o campo e ficava
  // indistinguível de uma rodada saudável.
  const pediuAgendamento = steps.includes('appointments') || steps.includes('full_agenda')
  let notes: string | null = null
  if (shospIsRateLimited()) {
    console.error(`[shosp-sync] COTA ESTOURADA (HTTP 429) após ${shospCallCount()} chamadas, nada foi sincronizado`)
    // O número de chamadas até o 429 separa dois problemas MUITO diferentes: estourar
    // depois de dezenas de chamadas é ritmo (dá para espaçar), estourar na primeira é
    // conta bloqueada ou cota do período esgotada, e aí nenhum ajuste de código resolve.
    // Guarda a resposta LITERAL: é o que diferencia ritmo, cota do período e conta
    // bloqueada, e é o que se leva para a Shosp em vez de "está dando 429".
    const detalhe = shospRateLimitDetalhe()
    const extra = [
      detalhe.body ? `Resposta: ${detalhe.body}` : '',
      detalhe.headers ? `Cabeçalhos: ${detalhe.headers}` : '',
    ].filter(Boolean).join(' | ')
    notes = `rate_limited em ${nowIso()}: a API da Shosp devolveu 429 na chamada ${shospCallCount()} desta rodada. Nenhum dado novo entrou.${extra ? ` ${extra}` : ''}`
  } else if (pediuAgendamento && apptsIngeridos === 0) {
    console.error(`[shosp-sync] rodada sem ingestão após ${shospCallCount()} chamadas`)
    notes = `sem ingestão em ${nowIso()}: a rodada terminou sem 429, mas nenhum agendamento entrou em ${shospCallCount()} chamadas. O espelho continua com a data anterior.`
  }
  await admin.from('shosp_sync_state').update({ notes }).eq('id', 'default').then(() => {}, () => {})
  return result
}
