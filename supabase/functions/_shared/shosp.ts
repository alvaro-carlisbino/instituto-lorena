/**
 * Cliente da API Shosp (https://api.shosp.com.br/v1).
 *
 * Auth: dois headers — `x-api-key` (campo API_KEY na Shosp) e `id` (campo ID),
 * guardados como secrets da Edge Function (SHOSP_API_KEY, SHOSP_ID). NUNCA no
 * frontend: a chave dá acesso a dados de pacientes.
 *
 * O spec (api/docs/apishosp.json) não documenta os corpos de resposta — por isso
 * o módulo devolve o JSON cru (`data`) e quem chama interpreta. A Fase 0 (probe)
 * existe justamente para capturar o formato real.
 *
 * `formData` no spec é enviado como application/x-www-form-urlencoded (padrão de
 * APIs PHP). Se algum endpoint exigir multipart, o probe revela e a gente ajusta.
 */

const SHOSP_BASE = 'https://api.shosp.com.br/v1'

export function shospConfigured(): boolean {
  return Boolean((Deno.env.get('SHOSP_API_KEY') ?? '').trim() && (Deno.env.get('SHOSP_ID') ?? '').trim())
}

function shospHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-api-key': (Deno.env.get('SHOSP_API_KEY') ?? '').trim(),
    id: (Deno.env.get('SHOSP_ID') ?? '').trim(),
    ...extra,
  }
}

export type ShospResult = {
  ok: boolean
  status: number
  data: unknown
  error?: string
}

async function parseResult(res: Response): Promise<ShospResult> {
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // mantém texto cru (ex.: HTML de erro)
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : `http_${res.status}` }
}

type ParamValue = string | number | undefined | null

function buildQuery(params: Record<string, ParamValue>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export async function shospGet(
  path: string,
  query: Record<string, ParamValue> = {},
): Promise<ShospResult> {
  const url = `${SHOSP_BASE}${path}${buildQuery(query)}`
  const res = await fetch(url, { headers: shospHeaders({ Accept: 'application/json' }) })
  return parseResult(res)
}

export async function shospPostForm(
  path: string,
  fields: Record<string, ParamValue>,
): Promise<ShospResult> {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') form.set(k, String(v))
  }
  const res = await fetch(`${SHOSP_BASE}${path}`, {
    method: 'POST',
    headers: shospHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }),
    body: form.toString(),
  })
  return parseResult(res)
}

// ---- Endpoints de leitura (Cadastro) ----------------------------------------
export const shospListUnidades = () => shospGet('/cadastro/unidade')
export const shospListEspecialidades = () => shospGet('/cadastro/especialidade')
export const shospListPrestadores = () => shospGet('/cadastro/prestador')
export const shospListPlanosSaude = () => shospGet('/cadastro/planosaude')
export const shospListServicos = (query: Record<string, ParamValue> = {}) => shospGet('/cadastro/servico', query)
export const shospSearchPaciente = (query: Record<string, ParamValue>) => shospGet('/cadastro/paciente', query)
export const shospAgendaPorPaciente = (codigoPaciente: number | string) =>
  shospGet('/agenda/get/porpaciente', { codigoPaciente })

// ---- Agenda ------------------------------------------------------------------
export const shospGetAgenda = (fields: {
  codigoUnidade: string | number
  dataInicial: string
  diasMostrar: number
  codigoEspecialidade?: number
  codigoPrestador?: number
}) => shospPostForm('/agenda/get/', fields)
