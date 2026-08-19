import { supabase } from '@/lib/supabaseClient'
import { edgeErrorMessage } from '@/lib/edgeError'

/**
 * NFS-e da clínica pela Focus NFe (ambiente nacional) — o lado do painel.
 *
 * O backend (`crm-focus-nfse`) é quem sabe as regras do financeiro: só pessoa física,
 * descrição de uma lista fechada, PIS/COFINS não retidos, competência = hoje. Aqui a gente
 * só pergunta a config, emite, consulta, cancela e lista o que está em `nfse_notes`.
 *
 * A emissão é ASSÍNCRONA: o retorno normal é `processando_autorizacao`, e a SEFIN de
 * homologação levou ~8 minutos para autorizar em 19/ago. Quem chama não pode dizer ao
 * paciente que a nota saiu com base no retorno do `emitir` — só `autorizado` prova.
 */

export type NfseServico = { key: string; descricao: string; quando: string }

export type NfseConfig = {
  configured: boolean
  ambiente: 'homologacao' | 'producao' | null
  tributosPendentes: boolean
  servicos: NfseServico[]
  apenasPessoaFisica: boolean
}

export type NfseStatus = 'processando_autorizacao' | 'autorizado' | 'cancelado' | 'erro_autorizacao' | string

export type NfseNote = {
  id: string
  ref: string
  status: NfseStatus
  numero: string | null
  codigoVerificacao: string | null
  urlConsulta: string | null
  urlXml: string | null
  urlPdf: string | null
  valorServicoCents: number
  valorIssCents: number | null
  aliquotaAplicada: number | null
  tomadorDocumento: string | null
  tomadorNome: string | null
  descricaoServico: string | null
  erros: Array<{ codigo?: string; mensagem?: string }> | null
  ambiente: 'homologacao' | 'producao'
  leadId: string | null
  createdAt: string
  updatedAt: string
}

export type NfseTomador = {
  documento: string
  nome: string
  cep?: string
  logradouro?: string
  numero?: string
  bairro?: string
  codigoMunicipio?: string
  email?: string
}

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await assertClient().functions.invoke('crm-focus-nfse', { body })
  if (error) throw new Error(await edgeErrorMessage(error, 'Falha na NFS-e'))
  const p = (data ?? {}) as Record<string, unknown>
  if (p.error) {
    // O backend manda `error` (código) + `detail` (frase). A frase é o que a pessoa lê.
    throw new Error(String(p.detail || p.error))
  }
  return p
}

export async function nfseGetConfig(): Promise<NfseConfig> {
  const p = await invoke({ action: 'get_config' })
  return {
    configured: p.configured === true,
    ambiente: (p.ambiente as NfseConfig['ambiente']) ?? null,
    tributosPendentes: p.tributosPendentes === true,
    servicos: Array.isArray(p.servicos) ? (p.servicos as NfseServico[]) : [],
    apenasPessoaFisica: p.apenasPessoaFisica !== false,
  }
}

export type NfseEmitirResultado = {
  ok: boolean
  ref: string
  status: NfseStatus
  numero: string | null
  erros: Array<{ codigo?: string; mensagem?: string }> | null
}

export async function nfseEmitir(args: {
  valorCents: number
  servico: string
  tomador: NfseTomador
  leadId?: string | null
  ref?: string
}): Promise<NfseEmitirResultado> {
  const p = await invoke({
    action: 'emitir',
    valorCents: args.valorCents,
    servico: args.servico,
    tomador: args.tomador,
    ...(args.leadId ? { leadId: args.leadId } : {}),
    ...(args.ref ? { ref: args.ref } : {}),
  })
  return {
    ok: p.ok === true,
    ref: String(p.ref ?? ''),
    status: String(p.status ?? 'desconhecido'),
    numero: p.numero != null ? String(p.numero) : null,
    erros: Array.isArray(p.erros) ? (p.erros as NfseEmitirResultado['erros']) : null,
  }
}

export async function nfseConsultar(ref: string): Promise<{ status: NfseStatus; numero: string | null; urlPdf: string | null }> {
  const p = await invoke({ action: 'consultar', ref })
  return {
    status: String(p.status ?? 'desconhecido'),
    numero: p.numero != null ? String(p.numero) : null,
    urlPdf: p.urlPdf != null ? String(p.urlPdf) : null,
  }
}

export async function nfseCancelar(ref: string, justificativa: string): Promise<{ ok: boolean; status: NfseStatus; detail: string | null }> {
  const p = await invoke({ action: 'cancelar', ref, justificativa })
  return {
    ok: p.ok === true,
    status: String(p.status ?? 'desconhecido'),
    detail: p.detail != null ? String(p.detail) : null,
  }
}

/** Relê na Focus tudo que está pendente/autorizado nos últimos `dias` e reescreve o status. */
export async function nfseReconciliar(dias = 30): Promise<{ conferidas: number; mudou: Array<{ ref: string; de: string; para: string }> }> {
  const p = await invoke({ action: 'reconciliar', dias })
  return {
    conferidas: Number(p.conferidas ?? 0),
    mudou: Array.isArray(p.mudou) ? (p.mudou as Array<{ ref: string; de: string; para: string }>) : [],
  }
}

/**
 * Lista direto da tabela (RLS: staff do polo). A escrita é só da edge function; daqui é
 * leitura — o status é o que a SEFIN disse, nunca o que a tela achou.
 */
export async function nfseListar(args: { de: string; ate: string; status?: string | null; limite?: number }): Promise<NfseNote[]> {
  let q = assertClient()
    .from('nfse_notes')
    .select('id, ref, status, numero, codigo_verificacao, url_consulta, url_xml, url_pdf, valor_servico_cents, valor_iss_cents, aliquota_aplicada, tomador_documento, tomador_nome, descricao_servico, erros, ambiente, lead_id, created_at, updated_at')
    .gte('created_at', `${args.de}T00:00:00-03:00`)
    .lte('created_at', `${args.ate}T23:59:59-03:00`)
    .order('created_at', { ascending: false })
    .limit(args.limite ?? 500)
  if (args.status) q = q.eq('status', args.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    ref: String(r.ref),
    status: String(r.status ?? 'desconhecido'),
    numero: (r.numero as string) ?? null,
    codigoVerificacao: (r.codigo_verificacao as string) ?? null,
    urlConsulta: (r.url_consulta as string) ?? null,
    urlXml: (r.url_xml as string) ?? null,
    urlPdf: (r.url_pdf as string) ?? null,
    valorServicoCents: Number(r.valor_servico_cents ?? 0),
    valorIssCents: r.valor_iss_cents == null ? null : Number(r.valor_iss_cents),
    aliquotaAplicada: r.aliquota_aplicada == null ? null : Number(r.aliquota_aplicada),
    tomadorDocumento: (r.tomador_documento as string) ?? null,
    tomadorNome: (r.tomador_nome as string) ?? null,
    descricaoServico: (r.descricao_servico as string) ?? null,
    erros: Array.isArray(r.erros) ? (r.erros as NfseNote['erros']) : null,
    ambiente: (r.ambiente as NfseNote['ambiente']) ?? 'homologacao',
    leadId: (r.lead_id as string) ?? null,
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
  }))
}
