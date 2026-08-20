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
 * devolveu 2,00% tanto para 040101 quanto para 040303). A gente lê o que voltou, não manda o
 * que quer.
 *
 * ── A receita do financeiro (Kauan, 19/ago/2026) ──────────────────────────────────────────
 * É o passo a passo que ele segue no portal nacional (nfse.gov.br, "Emissão completa") para a
 * clínica (lucro presumido), e é o que `buildDps()` reproduz campo a campo:
 *
 *   • Competência = dia da emissão. Nunca retroativa.
 *   • Tomador no Brasil, SEMPRE PESSOA FÍSICA. Para CNPJ muda a retenção (PIS/COFINS/CSLL
 *     retidos a partir de R$ 215,10; IRRF 1,5% a partir de R$ 666,67, "confirmar com a fonte
 *     pagadora") — isso ele faz À MÃO. Aqui a emissão para PJ é RECUSADA, não adivinhada.
 *   • Serviço: cTribNac 04.03.03 (Clínicas ou congêneres) + cTribMun 003, NBS 123012200,
 *     operação tributável, ISS não retido, sem benefício/redução. Descrição vem de uma lista
 *     fechada de 5 (`SERVICOS_CLINICA`), escolhida pelo tipo de atendimento.
 *   • Valor = bruto. Tributação federal sobre o bruto: CST 01 (alíquota básica),
 *     PIS 0,65% e COFINS 3,00% de apuração própria, "PIS/COFINS/CSLL Não Retidos" (tipo 0).
 *   • Valor aproximado dos tributos (Lei 12.741): Federal 11,33% · Estadual 0,00% ·
 *     Municipal 2,00%. Vai em `tenant_integrations.focus.tributos_aproximados`.
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
  /**
   * Código de tributação nacional do ISS (6 dígitos, lista nacional). Clínica em Maringá:
   * `040303` — "Clínicas ou congêneres". NÃO é `040101` ("Medicina."), que foi o que saiu na
   * nota 314 e o financeiro recusou: o manual do portal traz 04.01.01 no exemplo, mas a nota
   * que o Kauan emitiu à mão no portal (nº 313, 19/ago) está com 04.03.03 / 003.
   */
  codigoTributacaoNacional: string
  /**
   * Código de tributação MUNICIPAL (3 dígitos, lista da prefeitura). Opcional: a nota autoriza
   * sem ele. Maringá casa `003` com o nacional `040303`. Vazio = não informa.
   */
  codigoTributacaoMunicipal: string
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
  /**
   * Como a Lei da Transparência sai IMPRESSA. O leiaute aceita as duas formas e o número é o
   * mesmo: `valor` imprime "Federais: R$ 73,65" (o provado em produção) e `percentual` imprime
   * "Federais: 11,33 %", que é como sai a nota do portal. Cosmético, não muda tributo.
   */
  formatoTotalTributos: 'valor' | 'percentual'
  /** Código NBS do serviço. Serviços médicos especializados: 123012200. */
  codigoNbs: string
  /**
   * Telefone e e-mail do prestador na DPS (`prest/fone` e `prest/email`).
   *
   * **NÃO é isto que sai impresso na nota.** O rosto do DANFSe vem do `<emit>`, que a SEFIN
   * monta pelo CADASTRO NACIONAL DO CONTRIBUINTE e não pelo que a gente manda. Medido na nota 8
   * de homologação (20/ago/2026): mandamos `financeiro@` + `44991493656` aqui e o PDF saiu com
   * o e-mail do adm e o telefone antigo do cadastro, igual à nota 314 de produção. Trocar o
   * contato impresso é serviço no portal (nfse.gov.br), não no payload.
   *
   * Ficam vazios de propósito: preencher só faz a nota carregar DOIS contatos diferentes, um no
   * `<prest>` e outro no `<emit>`, o que é pior que carregar um contato velho.
   */
  telefonePrestador: string
  emailPrestador: string
  /**
   * Grupo da reforma tributária (IBS/CBS), do leiaute 1.01 da DPS. Sem ele a SEFIN não monta o
   * bloco IBS/CBS e a nota sai sem "Exclusões e Reduções da Base de Cálculo" — que é o valor
   * que ELA calcula (ISS + PIS + COFINS) e que aparece na nota do portal. `null` = não manda,
   * que é o estado provado em produção (a nota 314 autorizou assim). Só ligar depois de provar
   * em homologação: CST/cClassTrib errados fazem a SEFIN rejeitar a nota inteira.
   *
   * O grupo é indivisível e tem CINCO campos obrigatórios, não dois. Mandar só CST/cClassTrib
   * troca o XSD para o 1.01 e a DPS morre em `erro_validacao_schema` reclamando de `finNFSe`
   * — medido em homologação, 20/ago. Os três de contexto têm default porque só existe uma
   * resposta certa para a clínica: nota regular, paciente consumindo para si, sem terceiro.
   */
  ibsCbs: {
    cst: string
    classificacaoTributaria: string
    /** `finNFSe`. 0 = NFS-e regular (único valor da tabela hoje). */
    finalidadeEmissao: string
    /** `indFinal`. 1 = uso ou consumo pessoal. Paciente pagando consulta é isso. */
    consumidorFinal: string
    /** `indDest`. 0 = o destinatário é o próprio tomador da nota. */
    indicadorDestinatario: string
    /**
     * `cIndOp`, 6 dígitos do Anexo VII ("código indicador de operação"). É o que diz ao IBS/CBS
     * QUE tipo de fornecimento é e ONDE incide. Serviço feito no corpo do paciente cai no grupo
     * `0301xx` ("serviços executados fisicamente sobre pessoas"), mas QUAL dos quatro é decisão
     * do contador, não palpite daqui — sem ele o XSD 1.01 recusa a DPS.
     */
    indicadorOperacao: string
  } | null
  /**
   * Tributação federal de apuração própria (lucro presumido, cumulativo). `cst` 01 = operação
   * tributável com alíquota básica; alíquotas em %. Retenção NÃO entra aqui: para pessoa
   * física é sempre "não retidos", e para PJ a gente não emite (ver `TomadorPjError`).
   */
  pisCofins: { cst: string; aliquotaPis: number; aliquotaCofins: number }
}

/**
 * A lista fechada de descrições que o financeiro usa no portal — uma por tipo de atendimento.
 * A descrição é sempre o texto fixo; o "quando" é só orientação para quem escolhe na tela.
 * Texto livre na nota é o que deixava cada atendente escrever de um jeito.
 */
export const SERVICOS_CLINICA = [
  {
    key: 'cirurgia',
    descricao: 'Procedimento cirúrgico dermatológico',
    quando: 'Entrada ou restante do transplante capilar (TC). Não emitir para o que é transferência direta ao anestesista.',
  },
  {
    key: 'protocolo',
    descricao: 'Procedimento capilar dermatológico',
    quando: 'Todos os tipos de protocolo.',
  },
  {
    key: 'consulta',
    descricao: 'Consulta médica dermatológica',
    quando: 'Sinal e restante de consulta.',
  },
  {
    key: 'biopsia',
    descricao: 'Realização de biópsia',
    quando: 'Quando realiza uma biópsia.',
  },
  {
    key: 'vitaminas',
    descricao: 'Aplicação de vitaminas',
    quando: 'Quando realiza a aplicação de vitaminas.',
  },
] as const

export type ServicoClinicaKey = (typeof SERVICOS_CLINICA)[number]['key']

export function descricaoDoServico(key: string): string | null {
  return SERVICOS_CLINICA.find((s) => s.key === key)?.descricao ?? null
}

/**
 * Tomador pessoa jurídica: a nota muda de regra (retenções na fonte por faixa de valor, a
 * confirmar com quem paga) e o financeiro emite à mão. O erro existe para a tela avisar o
 * Kauan em vez de sair uma nota errada que não volta atrás.
 */
export class TomadorPjError extends Error {
  constructor() {
    super('Tomador CNPJ: a nota para pessoa jurídica tem retenção diferente e é emitida manualmente pelo financeiro (Kauan). Não emitir pelo CRM.')
    this.name = 'TomadorPjError'
  }
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
  opts: {
    /** Força o ambiente, ignorando `FOCUS_NFE_AMBIENTE`. Só o caminho de rotina passa isso. */
    ambiente?: FocusAmbiente
    /**
     * Sobrepõe campos do `tenant_integrations.focus` SÓ nesta chamada, sem gravar. É como se
     * prova um payload novo em homologação sem mexer na config que a produção está usando —
     * a alternativa (gravar, testar, destravar) deixa uma janela em que a nota real do
     * financeiro sai com campo não provado.
     */
    overrides?: FocusRaw
  } = {},
): Promise<FocusConfig | null> {
  const { data } = await admin
    .from('tenant_integrations')
    .select('focus')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const doBanco = ((data as { focus?: FocusRaw } | null)?.focus ?? {}) as FocusRaw
  const cfg = { ...doBanco, ...(opts.overrides ?? {}) } as FocusRaw

  const ambiente: FocusAmbiente = opts.ambiente
    ?? (str(Deno.env.get('FOCUS_NFE_AMBIENTE'), 'homologacao') === 'producao' ? 'producao' : 'homologacao')

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

  // Defaults = o que o financeiro configura no portal hoje (lucro presumido). Banco sobrepõe
  // sem deploy; um valor torto no banco (NaN, negativo) cai no default em vez de ir pra nota.
  const pc = (cfg.pis_cofins ?? null) as FocusRaw | null
  const pct = (v: unknown, fallback: number) => {
    const n = num(v)
    return n != null && Number.isFinite(n) && n >= 0 ? n : fallback
  }

  // Reforma tributária: os dois códigos andam juntos ou não vão. Meio grupo é rejeição certa.
  const rt = (cfg.ibs_cbs ?? null) as FocusRaw | null
  const rtCst = str(rt?.situacao_tributaria)
  const rtClasse = str(rt?.classificacao_tributaria)

  return {
    ambiente,
    token,
    cnpjPrestador,
    codigoMunicipio: str(cfg.codigo_municipio, '4115200'),
    codigoTributacaoNacional: str(cfg.codigo_tributacao_nacional, '040303'),
    codigoTributacaoMunicipal: str(cfg.codigo_tributacao_municipal),
    telefonePrestador: onlyDigits(cfg.telefone_prestador),
    emailPrestador: str(cfg.email_prestador),
    ibsCbs: rtCst && rtClasse
      ? {
          cst: rtCst,
          classificacaoTributaria: rtClasse,
          finalidadeEmissao: str(rt?.finalidade_emissao, '0'),
          consumidorFinal: str(rt?.consumidor_final, '1'),
          indicadorDestinatario: str(rt?.indicador_destinatario, '0'),
          indicadorOperacao: str(rt?.indicador_operacao),
        }
      : null,
    formatoTotalTributos: str(cfg.formato_total_tributos) === 'percentual' ? 'percentual' : 'valor',
    regimeEspecialTributacao: str(cfg.regime_especial_tributacao, '0'),
    opcaoSimplesNacional: str(cfg.opcao_simples_nacional, '1'),
    tributosAproximados: tributosOk
      ? { federal: federal!, estadual: estadual!, municipal: municipal! }
      : null,
    codigoNbs: onlyDigits(cfg.codigo_nbs) || '123012200',
    pisCofins: {
      cst: str(pc?.cst, '01').padStart(2, '0'),
      aliquotaPis: pct(pc?.aliquota_pis, 0.65),
      aliquotaCofins: pct(pc?.aliquota_cofins, 3.0),
    },
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
  /** ISO. Default: agora. A competência é SEMPRE o dia da emissão (regra do financeiro: nunca retroativa). */
  dataEmissao?: string
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

function enderecoTomador(t: DpsInput['tomador'], municipioPadrao: string): Record<string, unknown> {
  const cep = onlyDigits(t.cep)
  const logradouro = str(t.logradouro)
  const numero = str(t.numero)
  const bairro = str(t.bairro)
  if (!cep && !logradouro) return {}
  return {
    codigo_municipio_tomador: str(t.codigoMunicipio) || municipioPadrao,
    ...(cep ? { cep_tomador: cep } : {}),
    ...(logradouro ? { logradouro_tomador: logradouro } : {}),
    ...(numero ? { numero_tomador: numero } : {}),
    ...(bairro ? { bairro_tomador: bairro } : {}),
  }
}

export function buildDps(cfg: FocusConfig, input: DpsInput): Record<string, unknown> {
  const emissao = input.dataEmissao ?? isoLocalSaoPaulo(new Date())
  const competencia = emissao.slice(0, 10)
  const doc = onlyDigits(input.tomador.documento)
  // Só pessoa física. CNPJ muda a retenção e é nota manual do financeiro.
  if (doc.length !== 11) throw new TomadorPjError()

  const trib = cfg.tributosAproximados ?? { federal: 0, estadual: 0, municipal: 0 }
  const valorReais = Math.round(input.valorServicoCents) / 100

  // Percentual sobre o bruto, em reais com 2 casas (R$ 150 × 0,65% = 0,975 → 0,98, igual ao portal).
  const pctDoBruto = (pct: number) => Math.round(valorReais * pct) / 100

  return {
    data_emissao: emissao,
    data_competencia: competencia,
    codigo_municipio_emissora: cfg.codigoMunicipio,
    cnpj_prestador: cfg.cnpjPrestador,
    // Sem estes dois a nota sai com o contato do cadastro nacional, não com o nosso.
    ...(cfg.telefonePrestador ? { telefone_prestador: cfg.telefonePrestador } : {}),
    ...(cfg.emailPrestador ? { email_prestador: cfg.emailPrestador } : {}),
    codigo_opcao_simples_nacional: cfg.opcaoSimplesNacional,
    regime_especial_tributacao: cfg.regimeEspecialTributacao,   // pegadinha 1

    // CPF e CNPJ são campos DIFERENTES: mandar CNPJ no campo de CPF passa na validação de
    // parâmetro e só quebra lá na frente, no XSD.
    cpf_tomador: doc,
    razao_social_tomador: input.tomador.nome,
    // Endereço só quando existe: string vazia no campo é `erro_validacao_schema` na Focus
    // (medido 19/ago). O bloco inteiro é opcional para tomador pessoa física.
    ...enderecoTomador(input.tomador, cfg.codigoMunicipio),
    ...(input.tomador.email ? { email_tomador: input.tomador.email } : {}),

    codigo_municipio_prestacao: cfg.codigoMunicipio,
    codigo_tributacao_nacional_iss: cfg.codigoTributacaoNacional,
    ...(cfg.codigoTributacaoMunicipal ? { codigo_tributacao_municipal_iss: cfg.codigoTributacaoMunicipal } : {}),
    codigo_nbs: cfg.codigoNbs,
    descricao_servico: input.descricaoServico,
    valor_servico: valorReais,
    tributacao_iss: '1',      // operação tributável
    tipo_retencao_iss: '1',   // não retido

    // Tributação federal de apuração própria, sobre o bruto (tela "Valores" do portal).
    situacao_tributaria_pis_cofins: cfg.pisCofins.cst,
    base_calculo_pis_cofins: valorReais,
    aliquota_pis: cfg.pisCofins.aliquotaPis,
    aliquota_cofins: cfg.pisCofins.aliquotaCofins,
    valor_pis: pctDoBruto(cfg.pisCofins.aliquotaPis),
    valor_cofins: pctDoBruto(cfg.pisCofins.aliquotaCofins),
    tipo_retencao_pis_cofins: '0',   // PIS/COFINS/CSLL NÃO retidos — vale para pessoa física

    // pegadinha 2 — indicador FALSE + os três campos separados. `valor` é o formato provado
    // em produção; `percentual` é o que o portal imprime. Nunca os dois: o leiaute escolhe um.
    indicador_total_tributacao: false,
    ...(cfg.formatoTotalTributos === 'percentual'
      ? {
          percentual_total_tributos_federais: trib.federal,
          percentual_total_tributos_estaduais: trib.estadual,
          percentual_total_tributos_municipais: trib.municipal,
        }
      : {
          valor_total_tributos_federais: pctDoBruto(trib.federal),
          valor_total_tributos_estaduais: pctDoBruto(trib.estadual),
          valor_total_tributos_municipais: pctDoBruto(trib.municipal),
        }),

    // Reforma tributária. Grupo indivisível: os cinco campos ou nenhum — ver `ibsCbs`.
    ...(cfg.ibsCbs
      ? {
          finalidade_emissao: cfg.ibsCbs.finalidadeEmissao,
          consumidor_final: cfg.ibsCbs.consumidorFinal,
          ...(cfg.ibsCbs.indicadorOperacao ? { codigo_indicador_operacao: cfg.ibsCbs.indicadorOperacao } : {}),
          indicador_destinatario: cfg.ibsCbs.indicadorDestinatario,
          ibs_cbs_situacao_tributaria: cfg.ibsCbs.cst,
          ibs_cbs_classificacao_tributaria: cfg.ibsCbs.classificacaoTributaria,
        }
      : {}),
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
  const status = str(raw.status) || str(raw.codigo) || 'desconhecido'
  // Falha antes de virar nota (schema, permissão, empresa não habilitada) vem como
  // `codigo` + `mensagem`, sem array `erros`. Sem guardar a mensagem a tela só via
  // "erro_validacao_schema" e ninguém sabia qual campo.
  const mensagem = str(raw.mensagem)
  const errosOuMensagem = erros && erros.length
    ? erros
    : mensagem && status !== 'autorizado' && status !== 'processando_autorizacao' && status !== 'cancelado'
      ? [{ codigo: status, mensagem }]
      : null
  return {
    // `codigo` aparece quando a chamada falhou antes de virar nota (schema, permissão).
    status,
    numero: str(raw.numero) || null,
    codigoVerificacao: str(raw.codigo_verificacao) || null,
    urlConsulta: str(raw.url) || null,
    urlXml: caminhoXml ? `${XML_BUCKET}${caminhoXml}` : null,
    urlPdf: str(raw.url_danfse) || null,
    erros: errosOuMensagem,
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
