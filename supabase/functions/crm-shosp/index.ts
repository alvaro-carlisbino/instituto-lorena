import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { runShospSync } from '../_shared/shospSync.ts'
import {
  shospAgendaPorPaciente,
  shospCancelAgendamento,
  shospConfigured,
  shospCreatePatient,
  shospGetAgenda,
  shospListEspecialidades,
  shospListPlanosSaude,
  shospListPrestadores,
  shospListServicos,
  shospListUnidades,
  shospSchedule,
  shospSearchPaciente,
  type ShospResult,
} from '../_shared/shosp.ts'

// Função de integração Shosp. Por enquanto só o modo `probe` (Fase 0): chama os
// endpoints de leitura reais e devolve os FORMATOS de resposta — o spec da Shosp
// não documenta os corpos, então precisamos ver o JSON real (em especial se a
// agenda traz status de comparecimento / no-show, que sustenta o funil).
//
// Próximas fases plugam aqui: mode:'sync' (espelha agenda+pacientes no Supabase),
// mode:'schedule' (POST /agenda/), mode:'cancel' (POST /agenda/cancelaragendamento).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** Resume o shape de uma resposta: keys + primeiros itens, truncado para leitura. */
function shape(data: unknown): unknown {
  if (Array.isArray(data)) {
    return {
      kind: 'array',
      length: data.length,
      firstItemKeys: data[0] && typeof data[0] === 'object' ? Object.keys(data[0] as object) : null,
      sample: data.slice(0, 2),
    }
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    // Muitas APIs embrulham a lista: { dados: [...] } / { result: [...] }
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        return {
          kind: 'wrapped_array',
          wrapperKey: k,
          objectKeys: Object.keys(obj),
          length: v.length,
          firstItemKeys: v[0] && typeof v[0] === 'object' ? Object.keys(v[0] as object) : null,
          sample: v.slice(0, 2),
        }
      }
      // A Shosp às vezes devolve { dados: { "1": {...}, "2": {...} } } (objeto por código).
      if (v && typeof v === 'object' && k.toLowerCase() === 'dados') {
        const inner = v as Record<string, unknown>
        const firstVal = Object.values(inner)[0]
        return {
          kind: 'wrapped_object_map',
          wrapperKey: k,
          objectKeys: Object.keys(obj),
          length: Object.keys(inner).length,
          firstItemKeys: firstVal && typeof firstVal === 'object' ? Object.keys(firstVal as object) : null,
          sample: Object.fromEntries(Object.entries(inner).slice(0, 2)),
        }
      }
    }
    return { kind: 'object', keys: Object.keys(obj), sample: obj }
  }
  return { kind: typeof data, sample: typeof data === 'string' ? data.slice(0, 300) : data }
}

function summarize(res: ShospResult): Record<string, unknown> {
  return { status: res.status, ok: res.ok, error: res.error ?? null, shape: shape(res.data) }
}

/** Tenta achar o código da primeira unidade varrendo o shape, sem conhecer o nome do campo. */
function guessFirstUnidadeCodigo(data: unknown): string | number | null {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (Object.values(data as Record<string, unknown>).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? []
      : []
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  for (const [k, v] of Object.entries(first as Record<string, unknown>)) {
    const key = k.toLowerCase()
    if ((key.includes('unidade') || key === 'codigo' || key === 'id' || key.includes('codigounidade')) && (typeof v === 'number' || /^\d+$/.test(String(v)))) {
      return v as string | number
    }
  }
  return null
}

/** Acha o codigoPaciente do primeiro paciente retornado pela busca, sem conhecer o shape. */
function guessFirstCodigoPaciente(data: unknown): string | number | null {
  let list: unknown[] = []
  if (Array.isArray(data)) list = data
  else if (data && typeof data === 'object') {
    const inner = Object.values(data as Record<string, unknown>).find((v) => v && typeof v === 'object')
    if (Array.isArray(inner)) list = inner
    else if (inner && typeof inner === 'object') list = Object.values(inner as Record<string, unknown>)
  }
  const first = list[0]
  if (!first || typeof first !== 'object') return null
  for (const [k, v] of Object.entries(first as Record<string, unknown>)) {
    const key = k.toLowerCase()
    if ((key.includes('codigopaciente') || key === 'codigo') && (typeof v === 'number' || /^\d+$/.test(String(v)))) {
      return v as string | number
    }
  }
  return null
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400000)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (!shospConfigured()) {
    return json(
      {
        error: 'shosp_not_configured',
        hint: 'Defina os secrets SHOSP_API_KEY e SHOSP_ID: supabase secrets set SHOSP_API_KEY=... SHOSP_ID=... --project-ref fgyfpmnvlkmyxtucbxbu',
      },
      400,
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const mode = String(body.mode ?? 'probe')

  // mode=sync (Fase 1): espelha referências + match lead↔paciente + agendamentos.
  if (mode === 'sync') {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
    const admin = createClient(supabaseUrl, serviceRole)
    try {
      const result = await runShospSync(admin, {
        matchLimit: body.matchLimit as number | undefined,
        apptLimit: body.apptLimit as number | undefined,
        steps: Array.isArray(body.steps) ? (body.steps as string[]) : undefined,
      })
      return json({ ok: true, mode: 'sync', syncedAt: new Date().toISOString(), result })
    } catch (e) {
      return json({ error: 'sync_failed', message: e instanceof Error ? e.message : String(e) }, 500)
    }
  }

  // --- Fase 4: leitura de disponibilidade + escrita (agendar/cancelar/paciente) ---
  if (mode === 'find_patient') {
    const nome = String(body.nome ?? '').trim()
    if (!nome) return json({ error: 'nome_required' }, 400)
    const res = await shospSearchPaciente({ nome, cpf: body.cpf as string | undefined, email: body.email as string | undefined })
    return json({ ok: res.ok, status: res.status, data: res.data })
  }

  if (mode === 'availability') {
    if (body.codigoPrestador === undefined && body.codigoEspecialidade === undefined) {
      return json({ error: 'codigoPrestador_or_codigoEspecialidade_required' }, 400)
    }
    const res = await shospGetAgenda({
      codigoUnidade: (body.codigoUnidade as string | number | undefined) ?? 1,
      dataInicial: String(body.dataInicial ?? new Date().toISOString().slice(0, 10)),
      diasMostrar: Math.min(Number(body.diasMostrar ?? 15), 31),
      codigoPrestador: body.codigoPrestador as number | undefined,
      codigoEspecialidade: body.codigoEspecialidade as number | undefined,
    })
    return json({ ok: res.ok, status: res.status, data: res.data })
  }

  if (mode === 'create_patient') {
    const res = await shospCreatePatient(body.paciente as Record<string, string | number | undefined>)
    return json({ ok: res.ok, status: res.status, data: res.data })
  }

  if (mode === 'schedule') {
    const f = body.agendamento as Record<string, unknown> | undefined
    if (!f) return json({ error: 'agendamento_required' }, 400)
    const res = await shospSchedule(f as Parameters<typeof shospSchedule>[0])
    return json({ ok: res.ok, status: res.status, data: res.data })
  }

  if (mode === 'extract_test') {
    const { extractCadastro } = await import('../_shared/cadastroExtract.ts')
    const fields = await extractCadastro(String(body.text ?? ''))
    return json({ ok: true, fields })
  }

  if (mode === 'ocr_test') {
    const { ocrImage } = await import('../_shared/visionOcr.ts')
    try {
      const text = await ocrImage({ base64: String(body.base64 ?? ''), mimeType: String(body.mimeType ?? 'image/png') })
      return json({ ok: true, text })
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200)
    }
  }

  if (mode === 'cancel') {
    const codigo = body.codigoAgendamento
    if (codigo === undefined || codigo === null) return json({ error: 'codigoAgendamento_required' }, 400)
    const res = await shospCancelAgendamento(codigo as string | number)
    return json({ ok: res.ok, status: res.status, data: res.data })
  }

  if (mode !== 'probe') {
    return json({
      error: 'mode_not_implemented',
      mode,
      available: ['probe', 'sync', 'find_patient', 'availability', 'create_patient', 'schedule', 'cancel'],
    }, 400)
  }

  const out: Record<string, unknown> = {}

  // 1) Tabelas de referência (só header id).
  const unidades = await shospListUnidades()
  out.unidade = summarize(unidades)
  out.especialidade = summarize(await shospListEspecialidades())
  out.prestador = summarize(await shospListPrestadores())
  out.planosaude = summarize(await shospListPlanosSaude())
  out.servico = summarize(await shospListServicos())

  // 2) Agenda — precisa de codigoUnidade. Usa o do body, ou tenta adivinhar.
  const codigoUnidade =
    (body.codigoUnidade as string | number | undefined) ?? guessFirstUnidadeCodigo(unidades.data) ?? undefined
  const dataInicial = String(body.dataInicial ?? isoDaysAgo(30))
  const diasMostrar = Number(body.diasMostrar ?? 60)

  // A agenda exige codigoPrestador OU codigoEspecialidade (mesmo sendo "opcional" no spec).
  const codigoPrestador = body.codigoPrestador as number | undefined
  const codigoEspecialidade = body.codigoEspecialidade as number | undefined

  if (codigoUnidade !== undefined && codigoUnidade !== null) {
    const agenda = await shospGetAgenda({ codigoUnidade, dataInicial, diasMostrar, codigoPrestador, codigoEspecialidade })
    out.agenda = { params: { codigoUnidade, dataInicial, diasMostrar, codigoPrestador, codigoEspecialidade }, ...summarize(agenda) }
  } else {
    out.agenda = { skipped: 'no_codigoUnidade — passe {"codigoUnidade": N} no body depois de ver o shape de unidade' }
  }

  // 3) Paciente — opcional. Busca por nome e, se achar, puxa a agenda do paciente
  //    (é AQUI que esperamos ver status de comparecimento / no-show).
  if (body.nome) {
    const pac = await shospSearchPaciente({ nome: String(body.nome) })
    out.paciente = { query: { nome: body.nome }, ...summarize(pac) }
    const codigoPaciente = guessFirstCodigoPaciente(pac.data) ?? (body.codigoPaciente as number | undefined)
    if (codigoPaciente !== undefined && codigoPaciente !== null) {
      const ag = await shospAgendaPorPaciente(codigoPaciente)
      out.agendaPorPaciente = { codigoPaciente, ...summarize(ag) }
    } else {
      out.agendaPorPaciente = { skipped: 'sem codigoPaciente no retorno da busca' }
    }
  } else if (body.codigoPaciente !== undefined) {
    const ag = await shospAgendaPorPaciente(body.codigoPaciente as number)
    out.agendaPorPaciente = { codigoPaciente: body.codigoPaciente, ...summarize(ag) }
  }

  console.log('[crm-shosp][probe]', JSON.stringify(out).slice(0, 4000))
  return json({ ok: true, mode: 'probe', probedAt: new Date().toISOString(), result: out })
})
