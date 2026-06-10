import {
  shospConfigured,
  shospGetAgenda,
  shospListEspecialidades,
  shospListPlanosSaude,
  shospListPrestadores,
  shospListServicos,
  shospListUnidades,
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
    // Muitas APIs embrulham a lista: { data: [...] } / { result: [...] } / { agendas: [...] }
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

  if (mode !== 'probe') {
    return json({ error: 'mode_not_implemented', mode, available: ['probe'] }, 400)
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

  if (codigoUnidade !== undefined && codigoUnidade !== null) {
    const agenda = await shospGetAgenda({ codigoUnidade, dataInicial, diasMostrar })
    out.agenda = { params: { codigoUnidade, dataInicial, diasMostrar }, ...summarize(agenda) }
  } else {
    out.agenda = { skipped: 'no_codigoUnidade — passe {"codigoUnidade": N} no body depois de ver o shape de unidade' }
  }

  // 3) Paciente — opcional, só se passar um nome de teste.
  if (body.nome) {
    out.paciente = { query: { nome: body.nome }, ...summarize(await shospSearchPaciente({ nome: String(body.nome) })) }
  }

  console.log('[crm-shosp][probe]', JSON.stringify(out).slice(0, 4000))
  return json({ ok: true, mode: 'probe', probedAt: new Date().toISOString(), result: out })
})
