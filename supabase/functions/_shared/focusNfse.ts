import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Focus NFe — NFS-e do AMBIENTE NACIONAL (`/v2/nfsen`).
 *
 * Maringá aderiu ao ambiente nacional, então o endpoint municipal (`/v2/nfse`, com payload
 * aninhado `prestador{}/servico{}`) NÃO serve: a própria Focus responde mandando trocar de
 * rota. Aqui é tudo o payload FLAT do nacional.
 *
 * Duas pegadinhas custaram as primeiras tentativas em homologação (14/ago/2026), e as duas
 * estão resolvidas no `buildDps()` abaixo — não desfaça sem reproduzir:
 *
 *   1. `regime_especial_tributacao` é obrigatório para quem NÃO é optante do Simples. Sem ele
 *      o XSD recusa antes de sair daqui: "regTrib: Missing child element(s)".
 *   2. `indicador_total_tributacao` tem que ir FALSE, e no lugar dele vão os três valores
 *      (`federais`/`estaduais`/`municipais`). Com o indicador ligado a SEFIN rejeita com
 *      E0713 — "para Não Optante do SN o indicador e o percentual do Simples não podem ser
 *      informados". Não existe um campo `valor_total_tributos` único; são três.
 *
 * A alíquota do ISS NÃO vai no payload: o ambiente nacional aplica a do município (Maringá
 * devolveu 2,00% para o código 040101). A gente lê o que voltou, não manda o que quer.
 */

export type FocusAmbiente = 'homologacao' | 'producao'

const BASES: Record<FocusAmbiente, string> = {
  homologacao: 'https://homologacao.focusnfe.com.br/v2',
  producao: 'https://api.focusnfe.com.br/v2',
}

/** O `caminho_xml_nota_fiscal` vem relativo a este bucket. */
const XML_BUCKET = 'https://focusnfe.s3.sa-east-1.amazonaws.com'

export type FocusConfig = {
  ambiente: FocusAmbiente
  token: string
  cnpjPrestador: string
  codigoMunicipio: string
  /** Código de tributação nacional do ISS. Consulta médica em Maringá: 040101. */
  codigoTributacaoNacional: string
  /** 0 = nenhum. Obrigatório para não-optante do Simples. */
  regimeEspecialTributacao: string
  /** 1 = não optante | 2 = MEI | 3 = ME/EPP. */
  opcaoSimplesNacional: string
  /**
   * Percentual aproximado de tributos (Lei da Transparência, 12.741/2012), por esfera.
   * `null` = o contador ainda não definiu. Ver `assertPodeEmitir()`: em PRODUÇÃO isso trava
   * a emissão de propósito. Declarar tributo zero numa nota real é informação fiscal errada,
   * e a nota autorizada não volta atrás.
   */
  tributosAproximados: { federal: number; estadual: number; municipal: number } | null
}

type FocusRaw = Record<string, unknown>

const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v).trim())
const onlyDigits = (v: unknown) => str(v).replace(/\D/g, '')

/**
 * Config do polo. Token vem de secret de ambiente — NUNCA do banco e nunca do repo, que é
 * público. O resto (CNPJ, município, códigos) é dado de cadastro e mora no polo.
 */
export async function readFocusConfig(
  admin: SupabaseClient,
  tenantId: string,
): Promise<FocusConfig | null> {
  const { data } = await admin
    .from('tenant_integrations')
    .select('focus')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const cfg = ((data as { focus?: FocusRaw } | null)?.focus ?? {}) as FocusRaw

  const ambiente: FocusAmbiente =
    str(Deno.env.get('FOCUS_NFE_AMBIENTE'), 'homologacao') === 'producao' ? 'producao' : 'homologacao'

  const token = str(
    ambiente === 'producao'
      ? Deno.env.get('FOCUS_NFE_TOKEN_PRODUCAO')
      : Deno.env.get('FOCUS_NFE_TOKEN_HOMOLOGACAO'),
  )
  const cnpjPrestador = onlyDigits(cfg.cnpj_prestador)
  if (!token || !cnpjPrestador) return null

  const trib = (cfg.tributos_aproximados ?? null) as FocusRaw | null
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
  const federal = num(trib?.federal)
  const estadual = num(trib?.estadual)
  const municipal = num(trib?.municipal)
  const tributosOk =
    federal != null && estadual != null && municipal != null &&
    Number.isFinite(federal) && Number.isFinite(estadual) && Number.isFinite(municipal)

  return {
    ambiente,
    token,
    cnpjPrestador,
    codigoMunicipio: str(cfg.codigo_municipio, '4115200'),
    codigoTributacaoNacional: str(cfg.codigo_tributacao_nacional, '040101'),
    regimeEspecialTributacao: str(cfg.regime_especial_tributacao, '0'),
    opcaoSimplesNacional: str(cfg.opcao_simples_nacional, '1'),
    tributosAproximados: tributosOk
      ? { federal: federal!, estadual: estadual!, municipal: municipal! }
      : null,
  }
}

/**
 * Porteiro do ambiente de produção.
 *
 * Em homologação a nota não vale nada e tributo zerado é irrelevante — deixa passar, senão
 * não dá pra testar. Em produção a nota é documento fiscal com ISS devido e prazo curto de
 * cancelamento: se o percentual da Lei da Transparência não foi definido pelo contador, a
 * emissão para AQUI, antes de virar papel. Erro de config tem que doer antes, não depois.
 */
export function assertPodeEmitir(cfg: FocusConfig): void {
  if (cfg.ambiente === 'producao' && !cfg.tributosAproximados) {
    throw new Error('focus_tributos_aproximados_nao_configurados')
  }
}

export type DpsInput = {
  /** Em centavos, como o resto do CRM. A Focus recebe em reais. */
  valorServicoCents: number
  descricaoServico: string
  tomador: {
    documento: string        // CPF ou CNPJ, só dígitos
    nome: string
    cep?: string
    logradouro?: string
    numero?: string
    bairro?: string
    codigoMunicipio?: string
    email?: string
  }
  /** ISO. Default: agora. */
  dataEmissao?: string
  /** AAAA-MM-DD. Default: o dia da emissão. */
  dataCompetencia?: string
}

/**
 * Data/hora local com offset EXPLÍCITO. A edge function roda em UTC; mandar o instante cru
 * joga a competência para o dia seguinte toda noite depois das 21h de Brasília. O offset fixo
 * -03:00 vale o ano inteiro desde o fim do horário de verão.
 */
function isoLocalSaoPaulo(d: Date): string {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d)
  return `${p.replace(' ', 'T')}-03:00`
}

export function buildDps(cfg: FocusConfig, input: DpsInput): Record<string, unknown> {
  const emissao = input.dataEmissao ?? isoLocalSaoPaulo(new Date())
  const competencia = input.dataCompetencia ?? emissao.slice(0, 10)
  const doc = onlyDigits(input.tomador.documento)
  const trib = cfg.tributosAproximados ?? { federal: 0, estadual: 0, municipal: 0 }
  const valorReais = Math.round(input.valorServicoCents) / 100

  // Lei da Transparência: os percentuais viram valor sobre o serviço.
  const tributoDe = (pct: number) => Math.round(valorReais * pct) / 100

  return {
    data_emissao: emissao,
    data_competencia: competencia,
    codigo_municipio_emissora: cfg.codigoMunicipio,
    cnpj_prestador: cfg.cnpjPrestador,
    codigo_opcao_simples_nacional: cfg.opcaoSimplesNacional,
    regime_especial_tributacao: cfg.regimeEspecialTributacao,   // pegadinha 1

    // CPF e CNPJ são campos DIFERENTES: mandar CNPJ no campo de CPF passa na validação de
    // parâmetro e só quebra lá na frente, no XSD.
    ...(doc.length > 11 ? { cnpj_tomador: doc } : { cpf_tomador: doc }),
    razao_social_tomador: input.tomador.nome,
    codigo_municipio_tomador: input.tomador.codigoMunicipio ?? cfg.codigoMunicipio,
    cep_tomador: onlyDigits(input.tomador.cep),
    logradouro_tomador: input.tomador.logradouro ?? '',
    numero_tomador: input.tomador.numero ?? '',
    bairro_tomador: input.tomador.bairro ?? '',
    ...(input.tomador.email ? { email_tomador: input.tomador.email } : {}),

    codigo_municipio_prestacao: cfg.codigoMunicipio,
    codigo_tributacao_nacional_iss: cfg.codigoTributacaoNacional,
    descricao_servico: input.descricaoServico,
    valor_servico: valorReais,
    tributacao_iss: '1',      // operação tributável
    tipo_retencao_iss: '1',   // não retido

    // pegadinha 2 — indicador FALSE + os três valores separados
    indicador_total_tributacao: false,
    valor_total_tributos_federais: tributoDe(trib.federal),
    valor_total_tributos_estaduais: tributoDe(trib.estadual),
    valor_total_tributos_municipais: tributoDe(trib.municipal),
  }
}

export type FocusResposta = {
  status: string
  numero: string | null
  codigoVerificacao: string | null
  urlConsulta: string | null
  urlXml: string | null
  urlPdf: string | null
  erros: Array<{ codigo?: string; mensagem?: string }> | null
  raw: FocusRaw
}

export function parseFocusResposta(raw: FocusRaw): FocusResposta {
  const caminhoXml = str(raw.caminho_xml_nota_fiscal)
  const erros = Array.isArray(raw.erros) ? (raw.erros as Array<{ codigo?: string; mensagem?: string }>) : null
  return {
    // `codigo` aparece quando a chamada falhou antes de virar nota (schema, permissão).
    status: str(raw.status) || str(raw.codigo) || 'desconhecido',
    numero: str(raw.numero) || null,
    codigoVerificacao: str(raw.codigo_verificacao) || null,
    urlConsulta: str(raw.url) || null,
    urlXml: caminhoXml ? `${XML_BUCKET}${caminhoXml}` : null,
    urlPdf: str(raw.url_danfse) || null,
    erros: erros && erros.length ? erros : null,
    raw,
  }
}

/**
 * O ISS não vem no JSON da Focus — só no XML da nota. E é o número que o financeiro precisa,
 * porque a alíquota é decidida pelo MUNICÍPIO e não por nós: conferir o que foi cobrado é a
 * única forma de saber que continua 2%. Falha aqui não invalida a nota, por isso devolve null
 * em vez de estourar.
 */
export async function lerValoresDoXml(
  urlXml: string,
): Promise<{ aliquota: number | null; issCents: number | null }> {
  try {
    const res = await fetch(urlXml)
    if (!res.ok) return { aliquota: null, issCents: null }
    const xml = await res.text()
    const tag = (t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim() ?? null
    const aliq = tag('pAliqAplic')
    const iss = tag('vISSQN')
    return {
      aliquota: aliq != null && aliq !== '' ? Number(aliq) : null,
      issCents: iss != null && iss !== '' ? Math.round(Number(iss) * 100) : null,
    }
  } catch {
    return { aliquota: null, issCents: null }
  }
}

async function focusFetch(
  cfg: FocusConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: FocusRaw }> {
  const res = await fetch(`${BASES[cfg.ambiente]}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${cfg.token}:`)}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let parsed: FocusRaw = {}
  try {
    parsed = text ? (JSON.parse(text) as FocusRaw) : {}
  } catch {
    // A Focus responde JSON em tudo que importa; corpo não-JSON é erro de borda (proxy, 502).
    parsed = { codigo: 'resposta_nao_json', mensagem: text.slice(0, 300) }
  }
  return { status: res.status, body: parsed }
}

/**
 * Emite. Devolve 202 + `processando_autorizacao` no caminho feliz — a autorização chega
 * depois, por webhook ou consulta. Reemitir com a MESMA ref não duplica: a Focus devolve a
 * nota que já existe, que é o que torna o retry seguro.
 */
export async function emitirNfse(
  cfg: FocusConfig,
  ref: string,
  dps: Record<string, unknown>,
): Promise<FocusResposta> {
  const { body } = await focusFetch(cfg, 'POST', `/nfsen?ref=${encodeURIComponent(ref)}`, dps)
  return parseFocusResposta(body)
}

export async function consultarNfse(cfg: FocusConfig, ref: string): Promise<FocusResposta> {
  const { body } = await focusFetch(cfg, 'GET', `/nfsen/${encodeURIComponent(ref)}`)
  return parseFocusResposta(body)
}

export async function cancelarNfse(
  cfg: FocusConfig,
  ref: string,
  justificativa: string,
): Promise<FocusResposta> {
  const { body } = await focusFetch(cfg, 'DELETE', `/nfsen/${encodeURIComponent(ref)}`, { justificativa })
  return parseFocusResposta(body)
}
