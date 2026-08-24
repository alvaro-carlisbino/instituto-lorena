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
 *     Arredondamento meio-para-o-PAR, igual ao portal — ver `arredondaAbnt`.
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
   * Grupo da reforma tributária (IBS/CBS), do leiaute 1.01 da DPS. `null` = não manda, que foi o
   * estado das notas 314 a 320. **LIGADO em produção desde 21/ago/2026** (`focus.ibs_cbs` no
   * polo): CST 000 · cClassTrib 000001 · cIndOp 030101. Só ligar depois de provar em
   * homologação: CST/cClassTrib errados fazem a SEFIN rejeitar a nota inteira.
   *
   * **É ISTO que acende "Exclusões e Reduções da Base de Cálculo" no PDF da Focus.** O campo é
   * a soma de ISS + PIS + COFINS (confirmado pelo contador em 21/ago/2026) e não existe no XML
   * de nota nenhuma — nem na 272 do portal, nem na nossa 321: quem calcula é o desenhista do
   * PDF. O do portal calcula sempre; o da Focus só calcula quando a DPS leva este grupo, medido
   * na nota 10 de homologação: saiu "Exclusões R$ 36,72" e "Base após exclusões R$ 613,28",
   * exatamente ISS 13,00 + PIS 4,22 + COFINS 19,50.
   *
   * O preço é que o bloco é desenhado INTEIRO: junto vêm IBS R$ 0,61 e CBS R$ 5,52 (R$ 6,13
   * sobre R$ 650). Não existe meio-termo — o financeiro pediu só a linha das exclusões (Kauan,
   * 21/ago) e isso não é um botão que a gente tenha; a escolha era bloco inteiro ou nada, e o
   * financeiro escolheu o bloco. O CRM mostra a soma por conta própria de qualquer jeito, e é
   * o que salva as notas antigas; ver `lerValoresDoXml`.
   *
   * **`cIndOp` não é detalhe de preenchimento: ele decide duas coisas.** (1) Se o endereço do
   * tomador é obrigatório: 100301 ("domicílio do adquirente") faz a SEFIN recusar a DPS sem
   * endereço com **E0234**, e a tela emite sem endereço todo dia. (2) O município de incidência
   * do IBS/CBS: com 100301 a nota aponta a cidade do PACIENTE (medido em homologação, nota 12:
   * endereço em Londrina → "030101/4113700/Londrina"). O **Anexo VIII da Receita** (planilha de
   * correlação item × NBS × cIndOp × cClassTrib, em gov.br/nfse) manda **030101, "local da
   * prestação"**, para todos os itens 04.0x — clínica e serviço médico inclusive. 100301 é o
   * residual de "demais serviços", e foi o que o financeiro tinha lido de uma nota do portal.
   *
   * Pendente do contador: para o item 04.01 a mesma planilha traz cClassTrib **200029**
   * ("serviços de saúde humana", Anexo III), que exige **CST 200** (E0959 com CST 000) e imprime
   * redução de 60% — IBS/CBS cai de R$ 6,13 para R$ 2,46 (nota 13 de homologação). Trocar é
   * config, não deploy. Em 2026 nenhuma das duas cobra nada.
   *
   * Em 2027 o IBS/CBS deixa de ser ano de teste e aí o grupo passa a valer de verdade.
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

/**
 * Arredondamento meio-para-o-PAR (ABNT NBR 5891), que é o que o portal nacional usa.
 *
 * Só muda alguma coisa no empate exato, e o empate acontece: 0,65% de R$ 650 dá 4,225 e o
 * portal grava **4,22**, enquanto `Math.round` grava 4,23. Já 0,65% de R$ 150 dá 0,975 e o
 * portal grava **0,98** — as duas notas do Kauan, e as duas batem com "empate vai para o par",
 * nenhuma bate com "empate vai para cima". Um centavo de PIS não muda imposto nenhum, mas sai
 * IMPRESSO na nota que o financeiro compara lado a lado com a dele, e é o tipo de diferença que
 * faz ele desconfiar do resto.
 *
 * Recebe o produto já em centavos (valor × percentual) e devolve centavos.
 */
function arredondaAbnt(centavos: number): number {
  const piso = Math.floor(centavos)
  const resto = centavos - piso
  if (resto > 0.5) return piso + 1
  if (resto < 0.5) return piso
  return piso % 2 === 0 ? piso : piso + 1
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

  // Percentual sobre o bruto, em reais com 2 casas, arredondando IGUAL AO PORTAL — ver
  // `arredondaAbnt`. `Math.round` acertava por sorte e errava por um centavo no empate.
  const pctDoBruto = (pct: number) => arredondaAbnt(valorReais * pct) / 100

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

export type ValoresDaNota = {
  aliquota: number | null
  issCents: number | null
  pisCents: number | null
  cofinsCents: number | null
}

const VALORES_VAZIOS: ValoresDaNota = { aliquota: null, issCents: null, pisCents: null, cofinsCents: null }

/**
 * Os valores apurados não vêm no JSON da Focus — só no XML da nota. E são os números que o
 * financeiro precisa:
 *
 *   • ISS, porque a alíquota é decidida pelo MUNICÍPIO e não por nós: conferir o que foi
 *     cobrado é a única forma de saber que continua 2%.
 *   • PIS e COFINS, porque somados ao ISS são as **"Exclusões e Reduções da Base de Cálculo"**
 *     do IBS/CBS — o campo que o contador cobrou (Alex, 21/ago/2026) e que o PDF da Focus
 *     deixa em branco. Ele não existe no XML de ninguém: o portal nacional CALCULA a soma na
 *     hora de imprimir, e a Focus não calcula. Lendo daqui, o CRM mostra o número sem
 *     depender do desenhista do PDF.
 *
 * Tags conferidas no XML da nota 320 (produção, R$ 650): `pAliqAplic` 2.00, `vISSQN` 13.00,
 * `vPis` 4.22, `vCofins` 19.50 — e 13,00 + 4,22 + 19,50 = 36,72, que é o valor que o portal
 * imprime. Falha aqui não invalida a nota, por isso devolve null em vez de estourar.
 */
export async function lerValoresDoXml(urlXml: string): Promise<ValoresDaNota> {
  try {
    const res = await fetch(urlXml)
    if (!res.ok) return VALORES_VAZIOS
    const xml = await res.text()
    const tag = (t: string) => xml.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1]?.trim() ?? null
    const cents = (t: string) => {
      const v = tag(t)
      if (v == null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? Math.round(n * 100) : null
    }
    const aliq = tag('pAliqAplic')
    return {
      aliquota: aliq != null && aliq !== '' ? Number(aliq) : null,
      issCents: cents('vISSQN'),
      pisCents: cents('vPis'),
      cofinsCents: cents('vCofins'),
    }
  } catch {
    return VALORES_VAZIOS
  }
}

/** Estado que a SEFIN já carimbou e que resposta ruim nenhuma tem o direito de desmentir. */
const ESTADOS_FINAIS = new Set(['autorizado', 'cancelado'])

/**
 * Os campos que a resposta da Focus escreve na linha. Um só lugar: o gatilho e o painel
 * gravavam isto em dois códigos iguais, e por isso o mesmo defeito existia duas vezes.
 *
 * Duas regras que a versão anterior não tinha, e que são o resto do estrago de 22/ago:
 *
 *  1. **Não apaga o que a nota já provou.** O patch antigo fazia `numero: r.numero` sempre — e
 *     `r.numero` vem null em toda resposta que não seja a nota (429, 404, ambiente trocado).
 *     Nota autorizada perdia número, link do PDF e do XML por causa de um segundo ruim. Agora
 *     número e URLs só são escritos quando vêm preenchidos.
 *  2. **`nao_encontrado` não derruba nota autorizada.** Para linha pendente é a resposta que
 *     importa ("a emissão nunca chegou lá"); para linha com número seria apagar o que a SEFIN
 *     autorizou.
 *
 * Devolve `null` quando não há nada confiável a escrever — e `null` aqui significa NÃO TOQUE
 * NA LINHA, não "grave vazio".
 */
export async function patchDaResposta(
  r: FocusResposta,
  statusAtual?: string | null,
): Promise<Record<string, unknown> | null> {
  if (r.status === 'desconhecido') return null
  if (r.status === 'nao_encontrado' && ESTADOS_FINAIS.has(str(statusAtual))) return null

  // ISS, PIS e COFINS moram no XML, não no JSON — só vale buscar quando a nota autorizou.
  // Somados, são as "Exclusões e Reduções da Base de Cálculo" que o financeiro lança.
  const valores = r.status === 'autorizado' && r.urlXml ? await lerValoresDoXml(r.urlXml) : VALORES_VAZIOS

  return {
    status: r.status,
    ...(r.numero ? { numero: r.numero } : {}),
    ...(r.codigoVerificacao ? { codigo_verificacao: r.codigoVerificacao } : {}),
    ...(r.urlConsulta ? { url_consulta: r.urlConsulta } : {}),
    ...(r.urlXml ? { url_xml: r.urlXml } : {}),
    ...(r.urlPdf ? { url_pdf: r.urlPdf } : {}),
    ...(valores.issCents != null ? { valor_iss_cents: valores.issCents } : {}),
    ...(valores.pisCents != null ? { valor_pis_cents: valores.pisCents } : {}),
    ...(valores.cofinsCents != null ? { valor_cofins_cents: valores.cofinsCents } : {}),
    ...(valores.aliquota != null ? { aliquota_aplicada: valores.aliquota } : {}),
    erros: r.erros,
    updated_at: new Date().toISOString(),
  }
}

/**
 * A CHAMADA falhou — a NOTA não disse nada.
 *
 * É a distinção que faltava e que custou 31 notas em 22/ago/2026. A Focus limita a conta em
 * **100 requisições por minuto** e responde 429 com `{"codigo":"limite_excedido"}`. Isso passava
 * pelo `parseFocusResposta` como se fosse um estado da nota, e o chamador gravava
 * `status = "limite_excedido"` por cima do que a SEFIN tinha dito — apagando número e PDF de
 * nota autorizada, e tirando a linha do conjunto do reconciliador (que só relê
 * `autorizado`/`processando_autorizacao`). Um engarrafamento virava erro fiscal eterno.
 *
 * Quem recebe este erro tem UMA obrigação: não escrever status nenhum. A nota continua com o
 * estado que tinha; a resposta vem na próxima passada.
 */
export class FocusIndisponivelError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly codigo: string,
    /** Quantos segundos a Focus pediu para esperar. 0 = não disse. */
    readonly esperarSegundos: number,
    mensagem: string,
  ) {
    super(mensagem)
    this.name = 'FocusIndisponivelError'
  }
}

/**
 * Estados que NÃO são resposta da SEFIN e que vazaram para a coluna `status` antes de
 * `FocusIndisponivelError` existir. O reconciliador relê estas linhas de propósito: é assim
 * que as 31 notas carimbadas em 22/ago voltam a ter o estado de verdade sem SQL na mão.
 */
export const STATUS_TRANSITORIOS = ['limite_excedido', 'resposta_nao_json'] as const

/** "Tente novamente em 17 segundos" → 17. A Focus não manda `Retry-After`; o número vem na frase. */
function segundosDeEspera(raw: FocusRaw, header: string | null): number {
  const doHeader = Number(header ?? '')
  if (Number.isFinite(doHeader) && doHeader > 0) return Math.min(doHeader, 60)
  const m = str(raw.mensagem).match(/em\s+(\d+)\s*segundo/i)
  const n = m ? Number(m[1]) : 0
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 0
}

/**
 * Passo mínimo entre duas chamadas à Focus DENTRO da mesma instância da função.
 *
 * O teto da conta é 100/min. O laço do reconciliador rodava a ~2,2 por segundo (132/min, medido
 * na passada de 24/ago: 104 notas em 47s) — ou seja, estourava o teto sozinho por volta da
 * centésima nota, e tudo dali para frente tomava 429. 1 por segundo é 60/min e deixa a folga
 * para o painel e para o gatilho, que dividem a mesma conta.
 */
const PASSO_MINIMO_MS = 1000
let proximaVaga = 0

/** Reserva a vaga antes de bater na Focus. Chamadas concorrentes pegam vagas em fila, não juntas. */
async function aguardarVaga(): Promise<void> {
  const agora = Date.now()
  const alvo = Math.max(agora, proximaVaga)
  proximaVaga = alvo + PASSO_MINIMO_MS
  const espera = alvo - agora
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
}

/** Quantas vezes insistir quando a Focus diz "espera". Emitir é mais importante que ser rápido. */
const TENTATIVAS = 3

async function focusFetch(
  cfg: FocusConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: FocusRaw }> {
  let ultimo: FocusIndisponivelError | null = null

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    await aguardarVaga()

    let res: Response
    try {
      res = await fetch(`${BASES[cfg.ambiente]}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${btoa(`${cfg.token}:`)}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (e) {
      // Rede caiu antes de a Focus responder. Não dá para afirmar nada sobre a nota.
      ultimo = new FocusIndisponivelError(0, 'rede', 2, `Falha de rede ao falar com a Focus: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    const text = await res.text()
    let parsed: FocusRaw = {}
    try {
      parsed = text ? (JSON.parse(text) as FocusRaw) : {}
    } catch {
      // A Focus responde JSON em tudo que importa; corpo não-JSON é erro de borda (proxy, 502).
      parsed = { codigo: 'resposta_nao_json', mensagem: text.slice(0, 300) }
    }

    // 429 (teto de requisições) e 5xx são a INFRAESTRUTURA falando, nunca a nota. O 429 é o caso
    // conhecido: a Focus rejeita a requisição inteira, então um POST que toma 429 NÃO virou nota
    // lá — e um GET que toma 429 não desmente a nota que existe aqui.
    const limite = res.status === 429 || str(parsed.codigo) === 'limite_excedido'
    if (limite || res.status >= 500 || str(parsed.codigo) === 'resposta_nao_json') {
      const espera = segundosDeEspera(parsed, res.headers.get('retry-after'))
      ultimo = new FocusIndisponivelError(
        res.status,
        limite ? 'limite_excedido' : str(parsed.codigo) || `http_${res.status}`,
        espera,
        str(parsed.mensagem) || `A Focus respondeu ${res.status}.`,
      )
      // Só vale esperar se ela disse quanto, e se ainda há tentativa depois da espera.
      if (tentativa < TENTATIVAS) {
        await new Promise((r) => setTimeout(r, (espera || 2) * 1000))
        continue
      }
      break
    }

    return { status: res.status, body: parsed }
  }

  throw ultimo ?? new FocusIndisponivelError(0, 'desconhecido', 0, 'A Focus não respondeu.')
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
