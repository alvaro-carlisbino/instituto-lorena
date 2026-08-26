import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  type NormalizedInboundMessage,
  type SendWhatsappImageInput,
  type SendWhatsappMessageInput,
  type SendWhatsappMessageResult,
  type WhatsappProvider,
  digitsOnly,
} from './types.ts'
import {
  guardAndRecord,
  marcarEnvioFalhou,
  recordWhatsappOutbound,
  type GuardDecision,
  type OutboundKind,
} from './antiBan.ts'

/**
 * Provider para a W-API (https://api.w-api.app). Diferente do Evolution/Official,
 * NÃO pega credenciais da env: cada linha em whatsapp_channel_instances guarda
 * seu próprio token + instanceId (W-API entrega 1 token por instância). Por isso
 * a config é injetada no construtor; veja wapiConfig.ts.
 *
 * IMPORTANTE — formato do webhook de entrada ainda não confirmado.
 * `normalizeInbound` tenta os caminhos mais comuns (W-API costuma seguir o mesmo
 * schema do Baileys/Evolution, mas pode usar root keys diferentes). Quando o
 * primeiro evento real chegar, comparar com `payload` no log e ajustar.
 */

export type WapiProviderConfig = {
  /** Base URL da W-API. Default: https://api.w-api.app/v1 (sem barra final). */
  baseUrl: string
  /** Token Bearer da instância (uma instância = um token na W-API). */
  token: string
  /** ID da instância no painel da W-API. Vai como ?instanceId= na URL. */
  instanceId: string
  /** Segredo opcional comparado contra header x-webhook-secret do webhook entrante. */
  webhookSecret: string
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * Leitura HONESTA do campo `error` de uma resposta da W-API. Ele vem de duas formas:
 *  • TEXTO com o motivo — `{"error":"instância desconectada"}`
 *  • BANDEIRA booleana com o motivo noutro campo — `{"error":true,"message":"…"}`
 *
 * Tratar a bandeira como texto custou duas vezes no mesmo dia (26/ago/26): ao apagar uma
 * mensagem o CRM mostrava **"true"** no lugar do motivo (`String(true)`), e um `error:false`
 * de sucesso viraria a string "false", que é TRUTHY — ou seja, uma ação que funcionou seria
 * reportada como falha. Quem lê a resposta chama isto, e nunca `safeString(...error)`.
 */
function leituraDeErroWapi(
  dataCru: unknown,
  raw = '',
  status = 0,
): { falhou: boolean; motivo: string } {
  const data = (dataCru ?? {}) as Record<string, unknown>
  const bruto = getByPath(data, 'error') ?? getByPath(data, 'data.error')
  const comoTexto = typeof bruto === 'string' ? bruto.trim() : ''
  const ehBandeira = bruto === true || comoTexto.toLowerCase() === 'true'
  const negativa = bruto === false || comoTexto.toLowerCase() === 'false'
  // Texto que não seja só a bandeira escrita por extenso já é o motivo.
  const motivoDireto = negativa || ehBandeira ? '' : comoTexto
  const falhou = ehBandeira || Boolean(motivoDireto)
  if (!falhou) return { falhou: false, motivo: '' }
  const motivo =
    motivoDireto ||
    safeString(getByPath(data, 'message')) ||
    safeString(getByPath(data, 'message_error')) ||
    safeString(getByPath(data, 'errorMessage')) ||
    raw.slice(0, 200) ||
    (status ? `http_${status}` : 'erro sem motivo')
  return { falhou: true, motivo }
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function firstString(obj: Record<string, unknown>, paths: string[]): string {
  for (const p of paths) {
    const v = safeString(getByPath(obj, p)).trim()
    if (v) return v
  }
  return ''
}

const DEFAULT_WAPI_BASE_URL = 'https://api.w-api.app/v1'

/**
 * Id da mensagem na resposta da W-API. Cada rota devolve num sítio diferente (`messageId`,
 * `data.messageId`, `key.id`…), e o id é o que permite depois RESPONDER citando, REAGIR,
 * EDITAR ou APAGAR aquela mensagem. Sem ele, a bolha nasce muda: aparece no chat e nenhuma
 * ação funciona nela. Só inventamos um id local quando a W-API não deu nenhum.
 */
function extractMessageId(parsed: Record<string, unknown>): string {
  return (
    safeString(getByPath(parsed, 'messageId')) ||
    safeString(getByPath(parsed, 'data.messageId')) ||
    safeString(getByPath(parsed, 'id')) ||
    safeString(getByPath(parsed, 'data.id')) ||
    safeString(getByPath(parsed, 'key.id')) ||
    safeString(getByPath(parsed, 'data.key.id')) ||
    `wapi-${crypto.randomUUID()}`
  )
}

/** Os tipos de mídia que a W-API envia, cada um na sua rota e com o seu nome de campo. */
export type WapiMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif' | 'ptv'

const WAPI_MEDIA_ROUTES: Record<WapiMediaKind, { endpoint: string; field: string; caption: boolean }> = {
  image: { endpoint: '/message/send-image', field: 'image', caption: true },
  video: { endpoint: '/message/send-video', field: 'video', caption: true },
  // Áudio não leva legenda: no WhatsApp a mensagem de voz é sozinha.
  audio: { endpoint: '/message/send-audio', field: 'audio', caption: false },
  document: { endpoint: '/message/send-document', field: 'document', caption: true },
  sticker: { endpoint: '/message/send-sticker', field: 'sticker', caption: false },
  gif: { endpoint: '/message/send-gif', field: 'gif', caption: true },
  ptv: { endpoint: '/message/send-ptv', field: 'ptv', caption: false },
}

export type SendWapiMediaInput = {
  to: string
  /** URL pública (link assinado do Storage) ou base64 com prefixo `data:<mime>;base64,`. */
  media: string
  caption?: string
  /** Só documento: extensão sem ponto. Se faltar, deduzimos do nome/mime. */
  extension?: string
  fileName?: string
  mimeType?: string
  leadId?: string
  /** Id W-API da mensagem CITADA — faz a resposta sair colada na pergunta. */
  replyToMessageId?: string
  typingDelaySeconds?: number
  metadata?: Record<string, unknown>
}

/** Extensão do documento a partir do nome do ficheiro ou, em último caso, do mime. */
function guessExtension(fileName?: string, mimeType?: string): string | null {
  const doNome = String(fileName ?? '').match(/\.([a-z0-9]{1,8})$/i)?.[1]
  if (doNome) return doNome.toLowerCase()
  const mime = String(mimeType ?? '').toLowerCase()
  const mapa: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/zip': 'zip',
  }
  return mapa[mime] ?? null
}

/**
 * Erro de envio RECUSADO pela guarda anti-ban — não é falha de rede nem da W-API. Quem
 * chama deve tratar como "não mandou de propósito": a rotina pula e tenta na próxima volta,
 * a tela mostra o motivo em português. `reason` é o código curto ('cap_frio_dia', 'ritmo'…).
 */
export class WapiBlockedError extends Error {
  readonly reason: string
  readonly kind: OutboundKind
  readonly retryAfterSeconds?: number
  constructor(decision: GuardDecision) {
    super(decision.message ?? `envio bloqueado pela guarda anti-ban (${decision.reason ?? 'sem motivo'})`)
    this.name = 'WapiBlockedError'
    this.reason = decision.reason ?? 'bloqueado'
    this.kind = decision.kind
    this.retryAfterSeconds = decision.retryAfterSeconds
  }
}

/** Contexto que liga a guarda anti-ban a este provider (ver attachAntiBanGuard). */
type AntiBanContext = {
  admin: SupabaseClient
  /** id da row em whatsapp_channel_instances — a LINHA no CRM, não o instanceId do painel. */
  instanceRowId: string
  tenantId: string | null
  defaultSource: string
}

export class WapiProvider implements WhatsappProvider {
  readonly name = 'wapi' as const
  private readonly baseUrl: string
  private readonly token: string
  private readonly instanceId: string
  private readonly webhookSecret: string
  private antiBan: AntiBanContext | null = null

  constructor(config: WapiProviderConfig) {
    this.baseUrl = (config.baseUrl?.trim() || DEFAULT_WAPI_BASE_URL).replace(/\/$/, '')
    this.token = config.token.trim()
    this.instanceId = config.instanceId.trim()
    this.webhookSecret = config.webhookSecret.trim()
    if (!this.token) throw new Error('missing_wapi_token')
    if (!this.instanceId) throw new Error('missing_wapi_instance_id')
  }

  /**
   * Liga a guarda anti-ban a este provider. A partir daqui, TODA mensagem de texto que sair
   * por ele passa pela guarda e entra no livro-caixa — inclusive as respostas da IA, que a
   * guarda deixa passar sempre, mas conta (é o que torna o painel do dia verdadeiro).
   *
   * Fica na própria classe, e não num invólucro, porque o `crm-wapi-webhook` faz
   * `provider instanceof WapiProvider` para baixar mídia: embrulhar o objeto quebraria isso.
   */
  attachAntiBanGuard(admin: SupabaseClient, instanceRowId: string, tenantId: string | null, defaultSource = 'wapi'): this {
    this.antiBan = { admin, instanceRowId, tenantId, defaultSource }
    return this
  }

  validateWebhookSignature(_rawBody: string, headers: Headers): boolean | Promise<boolean> {
    if (!this.webhookSecret) return true
    const headerSecret = headers.get('x-webhook-secret')?.trim() ?? ''
    return Boolean(this.webhookSecret && headerSecret === this.webhookSecret)
  }

  normalizeInbound(payload: Record<string, unknown>, _headers: Headers): NormalizedInboundMessage | null {
    // Formato REAL da W-API (confirmado nos logs de webhook 12/jun): chaves minúsculas
    // e flat — event="webhookReceived", instanceid, messageid, fromme, isgroup,
    // sender:{id,pushname}, chat:{id}, moment (epoch s), msgcontent:{conversation|...}.
    // Mantemos fallbacks p/ nomes camelCase/Baileys por robustez.
    const event = safeString(payload.event ?? payload.type).toLowerCase()
    // Só descarta se for claramente um evento de não-mensagem (status/conexão/presença).
    if (event && /(status|connect|disconnect|presence|qrcode|delivery|ack)/.test(event)) {
      if (!payload.msgcontent && !payload.message) return null
    }

    // Ignora mensagens de grupo (não viram lead/atendimento 1:1).
    const isGroup =
      payload.isGroup === true ||
      payload.isgroup === true ||
      safeString(getByPath(payload, 'chat.id')).toLowerCase().includes('@g.us') ||
      safeString(getByPath(payload, 'key.remoteJid')).toLowerCase().includes('@g.us')
    if (isGroup) return null

    const messageId = firstString(payload, [
      'messageid',
      'messageId',
      'message_id',
      'id',
      'data.messageId',
      'data.id',
      'data.key.id',
      'key.id',
    ])
    if (!messageId) return null

    const fromMe = Boolean(
      payload.fromme ?? getByPath(payload, 'fromMe') ?? getByPath(payload, 'data.fromMe') ?? getByPath(payload, 'data.key.fromMe'),
    )

    // Remetente: sender.id (formato real) ou variações. Pode vir com @c.us / @s.whatsapp.net.
    const remetenteRaw = firstString(payload, [
      'sender.id',
      'sender.phone',
      'phone',
      'data.phone',
      'from',
      'data.from',
      'data.key.remoteJid',
    ])
    // Em mensagem que a EQUIPE mandou (`fromMe`), `sender` é a própria clínica: seguir por ele
    // criaria um lead com o número do próprio consultório. Quem interessa aí é o `chat`, que em
    // conversa 1:1 é sempre a paciente. Para entrada nada muda, o caminho continua o `sender`.
    const contraparteRaw = firstString(payload, [
      'chat.id',
      'chatId',
      'chat_id',
      'data.chat.id',
      'key.remoteJid',
      'data.key.remoteJid',
    ])
    const fromRaw = fromMe ? (contraparteRaw || remetenteRaw) : remetenteRaw
    if (fromRaw.toLowerCase().includes('@g.us')) return null
    const fromPhone = digitsOnly(fromRaw)
    if (fromPhone.length < 10) return null

    const pushName = firstString(payload, [
      'sender.pushName',
      'sender.pushname',
      'senderName',
      'sender.name',
      'pushName',
      'data.pushName',
      'contact.name',
    ])
    // Em `fromMe` o pushName é o da própria clínica; não serve como nome de paciente.
    // O `upsertLeadByPhone` preserva nome bom que já exista, então o placeholder é seguro.
    const fromName = fromMe ? 'Contato WhatsApp' : (pushName || 'Contato WhatsApp')

    // Texto: msgcontent.conversation | extendedTextMessage.text | legenda de mídia.
    let text = firstString(payload, [
      'msgContent.conversation',
      'msgContent.extendedTextMessage.text',
      'msgContent.imageMessage.caption',
      'msgContent.videoMessage.caption',
      'msgContent.documentMessage.caption',
      'msgcontent.conversation',
      'msgcontent.extendedTextMessage.text',
      'msgcontent.imageMessage.caption',
      'msgcontent.videoMessage.caption',
      'msgcontent.documentMessage.caption',
      'message',
      'text',
      'body',
      'data.message',
      'data.text',
      'data.body',
      'data.message.conversation',
      'data.message.extendedTextMessage.text',
    ]).trim()

    // Mídia sem legenda: usa um marcador para não perder a mensagem no chat.
    if (!text) {
      const mc = (payload.msgContent ?? payload.msgcontent ?? payload.message ?? {}) as Record<string, unknown>
      if (mc.imageMessage) text = '📷 Imagem'
      else if (mc.audioMessage || mc.pttMessage) text = '🎤 Áudio'
      else if (mc.videoMessage) text = '🎥 Vídeo'
      else if (mc.documentMessage) text = '📎 Documento'
      else if (mc.stickerMessage) text = '🌟 Figurinha'
      else if (mc.locationMessage) text = '📍 Localização'
      else if (mc.contactMessage || mc.contactsArrayMessage) text = '👤 Contato'
    }
    if (!text) return null

    const tsRaw =
      Number(
        payload.moment ??
          getByPath(payload, 'timestamp') ??
          getByPath(payload, 'data.timestamp') ??
          getByPath(payload, 'data.messageTimestamp') ??
          0,
      ) || Math.floor(Date.now() / 1000)
    const tsMs = tsRaw > 1e12 ? tsRaw : tsRaw * 1000
    const happenedAtIso = new Date(tsMs).toISOString()

    const payloadInstanceId = firstString(payload, [
      'instanceid',
      'instanceId',
      'instance_id',
      'data.instanceId',
      'data.instance_id',
    ]) || this.instanceId

    return {
      provider: this.name,
      source: 'whatsapp',
      externalMessageId: messageId,
      fromPhone,
      fromName,
      text,
      direction: fromMe ? 'out' : 'in',
      happenedAt: happenedAtIso,
      wapiInstanceId: payloadInstanceId || undefined,
      raw: payload,
    }
  }

  /**
   * A guarda anti-ban, uma vez só, para TUDO o que sai desta linha — texto, imagem, áudio,
   * documento, figurinha. Antes vivia dentro de `sendMessage`, e por isso a imagem do QR do
   * Pix saía por fora do teto: o livro-caixa do dia contava menos mensagens do que a linha
   * realmente mandou, que é exatamente o número que o WhatsApp usa para decidir um ban.
   *
   * Devolve o `logId` (para devolver a cota se o envio morrer no caminho) e o `typing`
   * calculado. Lança `WapiBlockedError` quando a guarda recusa.
   */
  private async runGuard(input: {
    to: string
    /** Texto que a guarda usa para hash de repetição. Em mídia, use a legenda + marcador. */
    guardText: string
    leadId?: string
    metadata?: Record<string, unknown>
    typingDelaySeconds?: number
    /** 'composing' para texto, 'recording' para áudio/PTT. */
    presence?: 'composing' | 'recording'
  }): Promise<{ logId: string | null; typing: number }> {
    let typing = input.typingDelaySeconds ?? 0
    if (!this.antiBan) return { logId: null, typing }

    const meta = (input.metadata ?? {}) as Record<string, unknown>
    const guardInput = {
      instanceId: this.antiBan.instanceRowId,
      tenantId: this.antiBan.tenantId,
      leadId: input.leadId ?? null,
      phone: input.to,
      text: input.guardText,
      source: String(meta.antiBanSource ?? this.antiBan.defaultSource),
      kind: (meta.antiBanKind as OutboundKind | undefined) ?? undefined,
      humanOverride: meta.antiBanHumanOverride === true,
      coldOverride: meta.antiBanColdOverride === true,
    }
    const decision = await guardAndRecord(this.antiBan.admin, guardInput)
    const logId = decision.logId
    if (!decision.allow) throw new WapiBlockedError(decision)

    // CONTATO NOVO: confirma que o número existe no WhatsApp antes de bater na porta.
    // Disparar para número sem WhatsApp é uma das assinaturas mais caras que existem
    // numa sessão não-oficial — é o que denuncia lista comprada. Sem resposta da API,
    // não enviamos: o padrão aqui é o silêncio, não o palpite.
    //
    // `optin` entra junto desde 20/ago/2026, e isso importa mais do que `cold`: o primeiro
    // contato de formulário Meta é classificado como optin, e é justamente ele que carrega
    // número torto — a pessoa DIGITA o telefone e a Meta não valida contra o WhatsApp.
    // Com a checagem só em `cold`, a fila de leadform mandava para número morto sem nunca
    // perguntar. `reply`/`proactive`/`transactional` ficam de fora de propósito: ali a
    // pessoa já escreveu de volta, o número está provado, e a chamada extra só custa.
    if ((decision.kind === 'cold' || decision.kind === 'optin') && !guardInput.coldOverride) {
      const existe = await this.phoneExists(input.to)
      if (existe !== true) {
        const recusa: GuardDecision = {
          allow: false,
          kind: decision.kind,
          reason: existe === false ? 'numero_sem_whatsapp' : 'numero_nao_verificado',
          message:
            existe === false
              ? 'Este número não tem WhatsApp. Enviar para ele é exatamente o que queima a linha.'
              : 'Não deu para confirmar se o número tem WhatsApp. Em contato novo, na dúvida não se envia.',
          typingDelaySeconds: 0,
        }
        await recordWhatsappOutbound(this.antiBan.admin, { ...guardInput, decision: recusa })
        throw new WapiBlockedError(recusa)
      }
    }

    typing = input.typingDelaySeconds ?? decision.typingDelaySeconds
    // "digitando…"/"a gravar áudio…" no chat antes de a mensagem cair. Best-effort e sem
    // custo de tempo: quem segura o relógio é o servidor da W-API (`delayMessage`).
    if (typing > 0) void this.sendPresence(input.to, input.presence ?? 'composing', Math.min(typing, 8) * 1000)
    return { logId, typing }
  }

  /**
   * POST numa rota de envio da W-API + leitura HONESTA da resposta.
   *
   * A W-API às vezes devolve HTTP 200 com corpo de erro (instância desconectada, número
   * fora do WhatsApp, sessão expirada). Sem checar o body, o CRM marcava como enviado,
   * mostrava toast verde, e a paciente nunca recebia — sintoma "a Aline mandou e ela não
   * recebeu". Toda rota de envio passa por aqui para não repetir esse buraco em cada uma.
   */
  private async postAndParse(
    endpoint: string,
    body: Record<string, unknown>,
    logId: string | null,
  ): Promise<SendWhatsappMessageResult> {
    const url = `${this.baseUrl}${endpoint}?instanceId=${encodeURIComponent(this.instanceId)}`
    const limpo: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null || v === '') continue
      limpo[k] = v
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(limpo),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (e) {
      await this.devolverCota(logId, e instanceof Error ? e.message : String(e))
      throw e
    }

    const responseText = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {}
    } catch {
      parsed = { raw: responseText }
    }

    const rota = endpoint.replace(/^\/message\//, '')
    if (!res.ok) {
      await this.devolverCota(logId, `http_${res.status}`)
      throw new Error(`wapi_${rota}_failed_${res.status}: ${responseText.slice(0, 200)}`)
    }

    const leitura = leituraDeErroWapi(parsed, responseText, res.status)
    const apiStatusRaw = safeString(
      getByPath(parsed, 'status') ?? getByPath(parsed, 'data.status') ?? '',
    ).toLowerCase()
    const successFlagRaw = getByPath(parsed, 'success') ?? getByPath(parsed, 'data.success')
    const successFlagFalse = successFlagRaw === false || String(successFlagRaw).toLowerCase() === 'false'
    if (leitura.falhou || apiStatusRaw === 'error' || apiStatusRaw === 'failed' || successFlagFalse) {
      const detail = leitura.motivo || apiStatusRaw || 'unknown_api_error'
      await this.devolverCota(logId, detail)
      throw new Error(`wapi_${rota}_failed_api: ${detail} | body=${responseText.slice(0, 200)}`)
    }

    return {
      provider: this.name,
      externalMessageId: extractMessageId(parsed),
      status: 'queued',
      raw: parsed,
    }
  }

  async sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')

    // Figurinha tem rota própria na W-API (/message/send-sticker) e agora é atendida lá.
    if (input.stickerWebpBase64) {
      return await this.sendSticker({
        to,
        sticker: input.stickerWebpBase64,
        leadId: input.leadId,
        metadata: input.metadata,
        replyToMessageId: input.replyToMessageId,
      })
    }

    const text = input.text.trim()
    if (!text) throw new Error('empty_message')

    // ── Guarda anti-ban ────────────────────────────────────────────────────────
    // Este é o funil por onde passa tudo o que sai numa linha W-API: painel, IA,
    // reengajamento, carrinho, lembrete de cirurgia. O teto vive aqui, uma vez.
    const { logId, typing } = await this.runGuard({
      to,
      guardText: text,
      leadId: input.leadId,
      metadata: input.metadata,
      typingDelaySeconds: input.typingDelaySeconds,
    })

    return await this.postAndParse(
      '/message/send-text',
      {
        phone: to,
        message: text,
        // `messageId` na W-API é a mensagem CITADA: é assim que a resposta sai colada na
        // pergunta, como no telemóvel. Vazio = mensagem solta no fim da conversa.
        messageId: input.replyToMessageId,
        // "Digitando…" antes de a mensagem aparecer. O servidor da W-API segura, então não
        // custa tempo de execução aqui. Quem calcula o valor é a guarda anti-ban.
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /**
   * Autorizado mas não saiu: devolve a cota do dia. A guarda decide ANTES do envio (é assim
   * que ela segura duas rotinas ao mesmo tempo), então mensagem que morreu no caminho ficaria
   * contando como entregue — e o teto puniria o dia por nada.
   */
  private async devolverCota(logId: string | null, motivo: string): Promise<void> {
    if (!this.antiBan || !logId) return
    await marcarEnvioFalhou(this.antiBan.admin, logId, motivo)
  }

  /**
   * TODA mídia sai por aqui: uma rota da W-API por tipo, o mesmo corpo, a mesma guarda.
   *
   * `media` aceita link público OU base64 com prefixo data: — a W-API resolve os dois. O CRM
   * manda link assinado do Storage (o base64 de um vídeo de 12MB não cabe num JSON de Edge
   * Function sem estourar memória), e base64 só no que é pequeno, como figurinha.
   */
  private async sendMediaMessage(
    kind: WapiMediaKind,
    input: SendWapiMediaInput,
  ): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const media = String(input.media ?? '').trim()
    if (!media) throw new Error(`empty_${kind}`)

    const spec = WAPI_MEDIA_ROUTES[kind]
    const caption = (input.caption ?? '').trim()
    // A guarda mede repetição por texto. Mídia sem legenda entraria como string vazia e
    // duas fotos diferentes pareceriam a MESMA mensagem repetida — o teto de repetição
    // seguraria a segunda por engano. O marcador de tipo desempata.
    const guardText = caption || `[${kind}]`
    const { logId, typing } = await this.runGuard({
      to,
      guardText,
      leadId: input.leadId,
      metadata: input.metadata,
      typingDelaySeconds: input.typingDelaySeconds,
      presence: kind === 'audio' ? 'recording' : 'composing',
    })

    const body: Record<string, unknown> = {
      phone: to,
      [spec.field]: media,
      messageId: input.replyToMessageId,
      ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
    }
    if (spec.caption && caption) body.caption = caption
    if (kind === 'document') {
      // A W-API exige a extensão à parte; sem ela o ficheiro chega sem ícone nem nome e o
      // WhatsApp mostra "documento" cru, que ninguém abre.
      body.extension = (input.extension ?? guessExtension(input.fileName, input.mimeType) ?? 'pdf')
        .replace(/^\./, '')
        .toLowerCase()
      body.fileName = input.fileName || `arquivo.${body.extension}`
    }
    return await this.postAndParse(spec.endpoint, body, logId)
  }

  /** Imagem (jpg/png/webp). `media` = URL pública ou data:image/...;base64,… */
  sendImage(input: SendWapiMediaInput): Promise<SendWhatsappMessageResult> {
    return this.sendMediaMessage('image', input)
  }
  /** Vídeo (mp4). Cai como vídeo normal, com pré-visualização. */
  sendVideo(input: SendWapiMediaInput): Promise<SendWhatsappMessageResult> {
    return this.sendMediaMessage('video', input)
  }
  /** Áudio. Chega como MENSAGEM DE VOZ (a bolha de microfone), não como ficheiro. */
  sendAudio(input: SendWapiMediaInput): Promise<SendWhatsappMessageResult> {
    return this.sendMediaMessage('audio', input)
  }
  /** Documento — qualquer ficheiro. Precisa de `extension` (a W-API não adivinha). */
  sendDocument(input: SendWapiMediaInput): Promise<SendWhatsappMessageResult> {
    return this.sendMediaMessage('document', input)
  }
  /** Figurinha estática ou animada (webp). */
  sendSticker(input: { to: string; sticker: string } & Omit<SendWapiMediaInput, 'media'>): Promise<SendWhatsappMessageResult> {
    return this.sendMediaMessage('sticker', { ...input, media: input.sticker })
  }
  /** GIF — no WhatsApp é um mp4 curto em loop, não um .gif. */
  sendGif(input: SendWapiMediaInput): Promise<SendWhatsappMessageResult> {
    return this.sendMediaMessage('gif', input)
  }
  /** Vídeo redondo (PTV), o "recado em vídeo" do WhatsApp. */
  sendPtv(input: SendWapiMediaInput): Promise<SendWhatsappMessageResult> {
    return this.sendMediaMessage('ptv', input)
  }

  /** Envia uma IMAGEM por URL (W-API: /message/send-image). Usado p/ o QR do Pix. */
  async sendImageMessage(input: SendWhatsappImageInput): Promise<SendWhatsappMessageResult> {
    return await this.sendImage({
      to: input.to,
      media: input.imageUrl,
      caption: input.caption,
      leadId: input.leadId,
      // QR de Pix é resposta a quem acabou de pedir para pagar: a guarda trata como
      // transacional para não cair no teto de proativo e a pessoa ficar sem o código.
      metadata: { antiBanKind: 'transactional', antiBanSource: 'pix_qr' },
    })
  }

  /**
   * Link com pré-visualização (título, descrição e miniatura). Diferente de colar a URL no
   * texto: aqui o card vem montado por nós, e não pelo que o WhatsApp conseguir raspar.
   */
  async sendLink(input: {
    to: string
    message: string
    linkUrl: string
    title?: string
    linkDescription?: string
    image?: string
    leadId?: string
    metadata?: Record<string, unknown>
    replyToMessageId?: string
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `${input.message}\n${input.linkUrl}`.trim(),
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-link',
      {
        phone: to,
        message: input.message,
        linkUrl: input.linkUrl,
        title: input.title,
        linkDescription: input.linkDescription,
        image: input.image,
        messageId: input.replyToMessageId,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Localização (o mapinha). Usado para mandar o endereço da clínica. */
  async sendLocation(input: {
    to: string
    latitude: string | number
    longitude: string | number
    name?: string
    address?: string
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `[localizacao] ${input.name ?? ''} ${input.address ?? ''}`.trim(),
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-location',
      {
        phone: to,
        latitude: String(input.latitude),
        longitude: String(input.longitude),
        name: input.name,
        address: input.address,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Cartão de contato (vCard). Um contato. */
  async sendContact(input: {
    to: string
    contactName: string
    contactPhone: string
    contactBusinessDescription?: string
    leadId?: string
    metadata?: Record<string, unknown>
    replyToMessageId?: string
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `[contato] ${input.contactName}`,
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-contact',
      {
        phone: to,
        contactName: input.contactName,
        contactPhone: digitsOnly(input.contactPhone),
        contactBusinessDescription: input.contactBusinessDescription,
        messageId: input.replyToMessageId,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Vários cartões de contato de uma vez. */
  async sendContacts(input: {
    to: string
    contacts: Array<{ contactName: string; contactPhone: string; contactBusinessDescription?: string }>
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    if (!input.contacts?.length) throw new Error('empty_contacts')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `[contatos] ${input.contacts.map((c) => c.contactName).join(', ')}`,
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-contacts',
      {
        phone: to,
        contacts: input.contacts.map((c) => ({
          contactName: c.contactName,
          contactPhone: digitsOnly(c.contactPhone),
          contactBusinessDescription: c.contactBusinessDescription,
        })),
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Enquete. `poll` é a lista de opções em texto. */
  async sendPoll(input: {
    to: string
    message: string
    poll: string[]
    pollMaxOptions?: number
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const opcoes = (input.poll ?? []).map((o) => String(o).trim()).filter(Boolean)
    if (opcoes.length < 2) throw new Error('poll_needs_two_options')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `[enquete] ${input.message}`,
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-poll',
      {
        phone: to,
        message: input.message,
        poll: opcoes,
        pollMaxOptions: Math.min(Math.max(1, input.pollMaxOptions ?? 1), opcoes.length),
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /**
   * Botão de Pix nativo do WhatsApp: a pessoa toca e o app dela abre o pagamento com a
   * chave já preenchida. Não substitui o link do gateway (não confirma nada de volta) —
   * serve para quem só quer a chave sem copiar e colar.
   */
  async sendPix(input: {
    to: string
    merchantName: string
    pixKey: string
    type: 'cpf' | 'cnpj' | 'phone' | 'email' | 'random'
    amount?: number
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `[pix] ${input.merchantName} ${input.amount ?? ''}`.trim(),
      leadId: input.leadId,
      metadata: { antiBanKind: 'transactional', ...(input.metadata ?? {}) },
    })
    return await this.postAndParse(
      '/message/send-pix',
      {
        phone: to,
        merchantName: input.merchantName,
        pixKey: input.pixKey,
        type: input.type,
        amount: input.amount,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Código de verificação com botão "copiar". */
  async sendOtp(input: {
    to: string
    message: string
    code: string
    buttonText?: string
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `[otp] ${input.message}`,
      leadId: input.leadId,
      metadata: { antiBanKind: 'transactional', ...(input.metadata ?? {}) },
    })
    return await this.postAndParse(
      '/message/send-otp',
      {
        phone: to,
        message: input.message,
        code: input.code,
        buttonText: input.buttonText || 'Copiar código',
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Botões de resposta rápida (buttonId + label). */
  async sendButtonList(input: {
    to: string
    message: string
    buttons: Array<{ buttonId: string; label: string }>
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    if (!input.buttons?.length) throw new Error('empty_buttons')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: input.message,
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-button-list',
      {
        phone: to,
        message: input.message,
        buttons: input.buttons,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Botões de AÇÃO: abrir link, ligar, copiar. */
  async sendButtonsAction(input: {
    to: string
    message: string
    buttonActions: Array<{ type: string; buttonText: string; url?: string }>
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    if (!input.buttonActions?.length) throw new Error('empty_button_actions')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: input.message,
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-buttons-action',
      {
        phone: to,
        message: input.message,
        buttonActions: input.buttonActions,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Menu em lista (o "ver opções" com seções). */
  async sendList(input: {
    to: string
    title: string
    description: string
    buttonText: string
    footerText?: string
    sections: Array<{ title?: string; options: Array<{ title?: string; description?: string; rowId?: string }> }>
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: `${input.title}\n${input.description}`,
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-list',
      {
        phone: to,
        title: input.title,
        description: input.description,
        buttonText: input.buttonText,
        footerText: input.footerText,
        sections: input.sections,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  /** Carrossel de cards com imagem e botões. */
  async sendCarousel(input: {
    to: string
    message: string
    cards: Array<{
      text?: string
      image?: string
      buttonActions?: Array<{ type: string; buttonText: string; url?: string }>
    }>
    leadId?: string
    metadata?: Record<string, unknown>
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    if (!input.cards?.length) throw new Error('empty_cards')
    const { logId, typing } = await this.runGuard({
      to,
      guardText: input.message,
      leadId: input.leadId,
      metadata: input.metadata,
    })
    return await this.postAndParse(
      '/message/send-carousel',
      {
        phone: to,
        message: input.message,
        cards: input.cards,
        ...(typing > 0 ? { delayMessage: Math.round(typing) } : {}),
      },
      logId,
    )
  }

  // ── Ações sobre mensagens que JÁ existem ────────────────────────────────────
  // Nenhuma passa pela guarda anti-ban: reagir, apagar e editar não são mensagem nova
  // saindo para o número — não gastam cota nem contam para o teto do dia.
  //
  // Todas leem a resposta por `leituraDeErroWapi`, e não à mão: ver o comentário de lá.

  /** Emoji na bolha. Reagir de novo com outro emoji TROCA (é assim no WhatsApp). */
  async sendReaction(phone: string, messageId: string, reaction: string): Promise<boolean> {
    const res = await this.call('/message/send-reaction', 'POST', {
      phone: digitsOnly(phone),
      messageId,
      reaction,
    })
    return res.ok && !leituraDeErroWapi(res.data).falhou
  }

  /** Tira a reação. */
  async removeReaction(phone: string, messageId: string): Promise<boolean> {
    const res = await this.call('/message/remove-reaction', 'POST', {
      phone: digitsOnly(phone),
      messageId,
    })
    return res.ok && !leituraDeErroWapi(res.data).falhou
  }

  /**
   * Apaga a mensagem NO CHAT — some do telemóvel da pessoa, não só da nossa tela.
   *
   * A coleção da W-API não documenta onde vão `phone`/`messageId` num DELETE. Mandamos nos
   * dois sítios (query string e corpo): o que sobrar é ignorado, e assim não dependemos de
   * adivinhar. Devolve o corpo cru para quem chamar poder mostrar o motivo real da recusa
   * (o WhatsApp só deixa apagar para todos dentro de ~2 dias).
   */
  async deleteMessage(
    phone: string,
    messageId: string,
  ): Promise<{ ok: boolean; status: number; detail: string }> {
    const to = digitsOnly(phone)
    const res = await this.call('/message/delete-message', 'DELETE', { phone: to, messageId }, {
      phone: to,
      messageId,
    })
    const leitura = leituraDeErroWapi(res.data, res.raw, res.status)
    const ok = res.ok && !leitura.falhou
    return {
      ok,
      status: res.status,
      detail: ok ? '' : leitura.motivo || res.raw.slice(0, 200) || `http_${res.status}`,
    }
  }

  /** Edita uma mensagem já enviada (janela curta do WhatsApp: ~15 min). */
  async editMessage(
    phone: string,
    messageId: string,
    text: string,
  ): Promise<{ ok: boolean; status: number; detail: string }> {
    const res = await this.call('/message/edit-message', 'POST', {
      phone: digitsOnly(phone),
      messageId,
      text,
    })
    const leitura = leituraDeErroWapi(res.data, res.raw, res.status)
    const ok = res.ok && !leitura.falhou
    return {
      ok,
      status: res.status,
      detail: ok ? '' : leitura.motivo || res.raw.slice(0, 200) || `http_${res.status}`,
    }
  }

  /** Foto de perfil do contato (para o avatar no cabeçalho da conversa). */
  async contactProfilePicture(phone: string): Promise<string | null> {
    const res = await this.call('/contacts/profile-picture', 'GET', undefined, {
      phoneNumber: digitsOnly(phone),
      phone: digitsOnly(phone),
    })
    if (!res.ok) return null
    const url =
      safeString(getByPath(res.data, 'profilePicture')) ||
      safeString(getByPath(res.data, 'data.profilePicture')) ||
      safeString(getByPath(res.data, 'url')) ||
      safeString(getByPath(res.data, 'data.url')) ||
      safeString(getByPath(res.data, 'imgUrl'))
    return url || null
  }

  /** Bloqueia (ou desbloqueia) o contato na linha. */
  async blockContact(phone: string, block = true): Promise<boolean> {
    const res = await this.call('/contacts/block-contact', 'POST', {
      phone: digitsOnly(phone),
      block,
      action: block ? 'block' : 'unblock',
    })
    return res.ok
  }

  /** Confere vários números de uma vez (mais barato que um phoneExists por número). */
  async checkNumbers(phones: string[]): Promise<Record<string, boolean | null>> {
    const lista = phones.map((p) => digitsOnly(p)).filter((p) => p.length >= 10)
    if (!lista.length) return {}
    const res = await this.call('/contacts/check-numbers', 'POST', { phones: lista, numbers: lista })
    const out: Record<string, boolean | null> = {}
    for (const p of lista) out[p] = null
    if (!res.ok) return out
    const arr =
      (getByPath(res.data, 'data') as unknown[]) ??
      (getByPath(res.data, 'numbers') as unknown[]) ??
      (Array.isArray(res.data) ? (res.data as unknown[]) : [])
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue
        const rec = item as Record<string, unknown>
        const num = digitsOnly(safeString(rec.phone ?? rec.number ?? rec.phoneNumber))
        const exists = rec.exists ?? rec.isInWhatsapp ?? rec.numberExists
        if (num) out[num] = typeof exists === 'boolean' ? exists : null
      }
    }
    return out
  }

  /** Fila de envio da instância (o que ainda não saiu). */
  async fetchQueue(): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await this.call('/instance/quere/quere', 'GET')
    return { ok: res.ok, data: res.data }
  }

  /** Cancela UMA mensagem que ainda está na fila (antes de sair). */
  async deleteQueuedMessage(messageId: string): Promise<boolean> {
    const res = await this.call('/instance/quere/delete-message', 'DELETE', { messageId }, { messageId })
    return res.ok
  }

  /** Esvazia a fila inteira — o freio de mão quando uma rotina disparou o que não devia. */
  async clearQueue(): Promise<boolean> {
    const res = await this.call('/instance/quere/delete-quere', 'DELETE')
    return res.ok
  }

  /** Chamada crua na W-API, com o instanceId e o Bearer da linha já embutidos. */
  async call(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>,
    extraQuery?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; raw: string }> {
    const qs = new URLSearchParams({ instanceId: this.instanceId, ...(extraQuery ?? {}) })
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}?${qs.toString()}`
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(25_000),
      })
      const raw = await res.text()
      let parsed: Record<string, unknown> = {}
      try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        parsed = { raw }
      }
      return { ok: res.ok, status: res.status, data: parsed, raw }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, status: 0, data: { error: msg }, raw: msg }
    }
  }

  /**
   * A sessão está de pé? É a diferença entre "a função respondeu 200" e "o número existe".
   * `connected` null significa que a W-API respondeu algo que não sabemos ler — e nesse caso
   * NÃO afirmamos que está no ar.
   */
  async instanceStatus(): Promise<{ ok: boolean; connected: boolean | null; status: string; data: Record<string, unknown> }> {
    const res = await this.call('/instance/status-instance', 'GET')
    const d = res.data
    const flag =
      (getByPath(d, 'connected') ?? getByPath(d, 'data.connected') ?? getByPath(d, 'status.connected')) as
        | boolean
        | undefined
    const statusStr = (
      safeString(getByPath(d, 'status')) ||
      safeString(getByPath(d, 'data.status')) ||
      safeString(getByPath(d, 'connectionStatus')) ||
      ''
    ).toLowerCase()
    let connected: boolean | null = null
    if (typeof flag === 'boolean') connected = flag
    else if (/^(connected|open|online|conectado)$/.test(statusStr)) connected = true
    else if (/(disconnect|close|offline|desconect|banned|banido)/.test(statusStr)) connected = false
    return { ok: res.ok, connected, status: statusStr || (res.ok ? 'unknown' : `http_${res.status}`), data: d }
  }

  /**
   * O número tem WhatsApp? Antes de falar com CONTATO NOVO isto não é luxo: bater em número
   * que não existe é um dos sinais que derruba sessão não-oficial (a lista "comprada" clássica).
   * Devolve null quando a API não respondeu — nesse caso quem chama decide, e o padrão é NÃO enviar.
   */
  async phoneExists(phone: string): Promise<boolean | null> {
    const to = digitsOnly(phone)
    if (to.length < 10) return false
    // O caminho é `/contacts/phone-exists`. Estava escrito `/contacts/contacts/...` e a W-API
    // devolvia 404 em TODA chamada, então `phoneExists` só sabia responder `null` — o botão
    // "checar número" da tela /whatsapp nunca deu resposta desde que existe (provado em
    // 20/ago/2026 batendo nos dois caminhos com a linha da clínica).
    // A coleção deles não documenta o nome do parâmetro do número (só o instanceId aparece).
    // Mandamos os dois nomes usados na doc: o que sobrar é ignorado. A resposta ecoa o número
    // já sem o 9º dígito — isso é como o WhatsApp representa, não é recusa.
    const res = await this.call('/contacts/phone-exists', 'GET', undefined, {
      phoneNumber: to,
      phone: to,
    })
    if (!res.ok) return null
    const d = res.data
    const v =
      getByPath(d, 'exists') ??
      getByPath(d, 'data.exists') ??
      getByPath(d, 'isInWhatsapp') ??
      getByPath(d, 'data.isInWhatsapp') ??
      getByPath(d, 'numberExists')
    if (typeof v === 'boolean') return v
    const s = safeString(v).toLowerCase()
    if (s === 'true') return true
    if (s === 'false') return false
    return null
  }

  /** "digitando…" / "gravando áudio…" no chat. Best-effort: falhar aqui nunca impede o envio. */
  async sendPresence(phone: string, presence: 'composing' | 'recording' | 'available' | 'unavailable', delayMs = 0): Promise<void> {
    try {
      await this.call('/chats/send-presence', 'POST', {
        instanceId: this.instanceId,
        phone: digitsOnly(phone),
        presence,
        delay: Math.max(0, Math.round(delayMs)),
      })
    } catch {
      /* best-effort */
    }
  }

  /** Marca a mensagem como lida (dois tiques azuis). Comportamento de gente, não de robô mudo. */
  async markRead(phone: string, messageId: string): Promise<void> {
    try {
      await this.call('/message/read-message', 'POST', { phone: digitsOnly(phone), messageId })
    } catch {
      /* best-effort */
    }
  }

  /**
   * Baixa+descriptografa uma mídia INBOUND via W-API (/message/download-media). O body é
   * flat com os campos de descriptografia do WhatsApp (mediaKey/directPath/url/mimetype/...).
   * Devolve base64 + mimeType. `debug` sempre preenchido (status/erro) para diagnóstico.
   */
  async downloadMedia(
    messageId: string,
    type: 'image' | 'video' | 'audio' | 'document',
    media: Record<string, unknown>,
  ): Promise<{ ok: boolean; base64?: string; mimeType?: string; debug: string }> {
    // Body conforme a doc OFICIAL da W-API (/v1/message/download-media): só os 4 obrigatórios.
    // Mandar `url`/sha extras fazia o W-API devolver um fileLink (CDN que pendura >90s no
    // áudio) em vez do base64 direto. Com o body mínimo ele tende a devolver o base64 na hora.
    const body: Record<string, unknown> = {
      mediaKey: media.mediaKey,
      directPath: media.directPath,
      type,
      mimetype: media.mimetype ?? media.mimeType ?? (type === 'audio' ? 'audio/ogg' : undefined),
    }
    let status = 0
    let bodyText = ''
    try {
      const res = await fetch(`${this.baseUrl}/message/download-media?instanceId=${encodeURIComponent(this.instanceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        // 90s: a W-API demora MUITO pra preparar ÁUDIO (todos estouravam a 45s). O worker
        // dedicado crm-wapi-media-retry roda fora da requisição, então aguenta o tempo extra.
        signal: AbortSignal.timeout(Number(Deno.env.get('WAPI_MEDIA_TIMEOUT_MS') ?? '') || 90000),
      })
      status = res.status
      bodyText = await res.text()
      let parsed: Record<string, unknown> = {}
      try {
        parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {}
      } catch {
        parsed = {}
      }
      if (!res.ok || parsed.error) {
        return { ok: false, debug: `http_${status}:${bodyText.slice(0, 180)}` }
      }
      const mimeType =
        safeString(getByPath(parsed, 'mimetype')) ||
        safeString(getByPath(parsed, 'mimeType')) ||
        String(media.mimetype ?? media.mimeType ?? 'image/jpeg')
      // 1) base64 direto em algum campo comum.
      const b64raw =
        safeString(getByPath(parsed, 'fileBase64')) ||
        safeString(getByPath(parsed, 'base64')) ||
        safeString(getByPath(parsed, 'data')) ||
        safeString(getByPath(parsed, 'media')) ||
        safeString(getByPath(parsed, 'mediaBase64')) ||
        safeString(getByPath(parsed, 'data.base64')) ||
        safeString(getByPath(parsed, 'data.fileBase64'))
      if (b64raw && b64raw.length > 100) {
        const clean = b64raw.includes('base64,') ? b64raw.split('base64,')[1] : b64raw
        return { ok: true, base64: clean, mimeType, debug: `ok_base64_${status}` }
      }
      // 2) URL hospedada → baixa e converte. O W-API devolve `fileLink` (URL que EXPIRA),
      // então baixamos os bytes agora e guardamos em base64 (permanente).
      const mediaUrl =
        safeString(getByPath(parsed, 'fileLink')) ||
        safeString(getByPath(parsed, 'url')) ||
        safeString(getByPath(parsed, 'link')) ||
        safeString(getByPath(parsed, 'fileUrl')) ||
        safeString(getByPath(parsed, 'mediaUrl')) ||
        safeString(getByPath(parsed, 'data.fileLink')) ||
        safeString(getByPath(parsed, 'data.url'))
      if (mediaUrl && mediaUrl.startsWith('http')) {
        const mediaTimeout = Number(Deno.env.get('WAPI_MEDIA_TIMEOUT_MS') ?? '') || 90000
        // O fileLink vem SEMPRE da resposta autenticada do /message/download-media, logo é um
        // recurso do W-API → mandamos o Bearer SEMPRE. Sem ele o servidor não responde e a
        // conexão pendura até o timeout. Desde ~22/jun o W-API passou a devolver o link num nó
        // por IP cru (ex.: http://76.13.231.97:8080/...); a regex `wapi` antiga não casava, o
        // token não ia e TODO áudio/imagem/doc estourava `filelink_timeout`.
        // Fallback: o mesmo path no domínio oficial https://api.w-api.app (o que a doc documenta
        // como destino do fileLink) — cobre o caso do nó por IP cru estar inalcançável do Edge.
        const candidates: string[] = [mediaUrl]
        try {
          const u = new URL(mediaUrl)
          if (u.hostname !== 'api.w-api.app') candidates.push(`https://api.w-api.app${u.pathname}${u.search}`)
        } catch {
          /* mediaUrl malformado — segue só com o original */
        }
        let r: Response | null = null
        let lastErr = ''
        for (const target of candidates) {
          try {
            r = await fetch(target, {
              signal: AbortSignal.timeout(mediaTimeout),
              headers: { Authorization: `Bearer ${this.token}` },
            })
            break
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e)
            r = null
          }
        }
        if (!r) {
          const host = (() => { try { return new URL(mediaUrl).host } catch { return '?' } })()
          return { ok: false, debug: `filelink_timeout:${host}:${lastErr.slice(0, 60)}` }
        }
        if (!r.ok) return { ok: false, debug: `media_url_http_${r.status}` }
        const buf = await r.arrayBuffer()
        // Guarda de tamanho: base64 vai no DB (fetch global do chat) — pula arquivos grandes.
        if (buf.byteLength > 6_000_000) return { ok: false, debug: `too_large_${buf.byteLength}` }
        const bytes = new Uint8Array(buf)
        let bin = ''
        const ch = 0x8000
        for (let i = 0; i < bytes.length; i += ch) bin += String.fromCharCode(...bytes.subarray(i, i + ch))
        const ctype = safeString(r.headers.get('content-type')).split(';')[0].trim() || mimeType
        return { ok: true, base64: btoa(bin), mimeType: ctype, debug: `ok_url_${status}` }
      }
      return { ok: false, debug: `no_media_in_resp_${status}:${bodyText.slice(0, 180)}` }
    } catch (e) {
      return { ok: false, debug: `exception:${(e instanceof Error ? e.message : String(e)).slice(0, 150)}` }
    }
  }
}

/**
 * Extrai a mídia inbound do payload W-API (imagem/figurinha, áudio/ptt, vídeo, documento),
 * com os campos de descriptografia para o download-media. Devolve o tipo + objeto, ou null.
 */
export function extractInboundMedia(
  payload: Record<string, unknown>,
): { mediaType: 'image' | 'audio' | 'video' | 'document'; caption: string; media: Record<string, unknown> } | null {
  const mc = (payload?.msgContent ?? payload?.msgcontent ?? payload?.message ?? {}) as Record<string, unknown>
  const pick = (k: string) => (mc[k] && typeof mc[k] === 'object' ? (mc[k] as Record<string, unknown>) : null)
  const found =
    (pick('imageMessage') ?? pick('stickerMessage')) ? { mediaType: 'image' as const, media: (pick('imageMessage') ?? pick('stickerMessage'))! }
      : (pick('audioMessage') ?? pick('pttMessage')) ? { mediaType: 'audio' as const, media: (pick('audioMessage') ?? pick('pttMessage'))! }
        : pick('videoMessage') ? { mediaType: 'video' as const, media: pick('videoMessage')! }
          : pick('documentMessage') ? { mediaType: 'document' as const, media: pick('documentMessage')! }
            : null
  if (!found) return null
  const m = found.media
  const caption = typeof m.caption === 'string' ? m.caption : typeof m.fileName === 'string' ? m.fileName : ''
  return { mediaType: found.mediaType, caption, media: m }
}

/**
 * Marcadores de mídia SEM legenda — quando o cliente manda só uma foto/áudio/etc., o
 * texto inbound vira só "📷 Imagem". A IA não "vê" o conteúdo, então o bot NÃO deve
 * responder (em vez de dizer "não consigo ver"). Com legenda, o texto é a legenda real.
 */
const WAPI_MEDIA_ONLY_MARKERS = new Set([
  '📷 Imagem',
  '🎤 Áudio',
  '🎥 Vídeo',
  '📎 Documento',
  '🌟 Figurinha',
  '📍 Localização',
  '👤 Contato',
])
export function isMediaOnlyMarker(text: string): boolean {
  return WAPI_MEDIA_ONLY_MARKERS.has(String(text ?? '').trim())
}

/**
 * REAÇÃO que chegou de fora (a paciente pôs um ❤️ numa mensagem nossa).
 *
 * Não é mensagem: `normalizeInbound` devolve `null` para ela, e é por isso que até aqui a
 * reação simplesmente desaparecia — a paciente respondia com um 👍 e no CRM não acontecia
 * nada, dando a impressão de que ela tinha ficado calada. Devolve o id da mensagem
 * REAGIDA (não o desta), o emoji, e se foi para tirar a reação (emoji vazio = tirou).
 */
export function extractInboundReaction(
  payload: Record<string, unknown>,
): { targetMessageId: string; emoji: string; removed: boolean } | null {
  const mc = (payload?.msgContent ?? payload?.msgcontent ?? payload?.message ?? {}) as Record<string, unknown>
  const reaction = (mc.reactionMessage ?? mc.reaction) as Record<string, unknown> | undefined
  if (!reaction || typeof reaction !== 'object') return null
  const targetMessageId =
    safeString(getByPath(reaction, 'key.id')) ||
    safeString(getByPath(reaction, 'messageId')) ||
    safeString(getByPath(reaction, 'id'))
  if (!targetMessageId) return null
  const emoji = safeString(reaction.text ?? reaction.emoji ?? '').trim()
  return { targetMessageId, emoji, removed: emoji.length === 0 }
}

/**
 * A pessoa APAGOU uma mensagem no telemóvel dela ("apagar para todos"). Chega como
 * protocolMessage REVOKE citando o id da mensagem que sumiu. Sem tratar isto, o CRM
 * continuava a mostrar um texto que já não existe do outro lado — e a equipe respondia a
 * uma mensagem que a paciente já tinha retirado.
 */
/**
 * Mensagem EDITADA pelo contato no telemóvel dele. Não é mensagem nova: o WhatsApp manda um
 * `protocolMessage` a apontar para a mensagem antiga com o texto novo dentro. Sem tratar
 * isto, `normalizeInbound` devolve null (não há texto no sítio do costume), o evento é
 * descartado e o CRM segue a mostrar a frase que a pessoa já corrigiu — o atendimento
 * responde ao texto errado sem saber. Mesma família do buraco da reação e do apagar.
 *
 * O embrulho muda conforme quem serializa o evento, por isso procuramos o `protocolMessage`
 * em vários sítios em vez de fixar um caminho.
 */
export function extractInboundEdit(
  payload: Record<string, unknown>,
): { targetMessageId: string; text: string } | null {
  const mc = (payload?.msgContent ?? payload?.msgcontent ?? payload?.message ?? {}) as Record<string, unknown>
  const candidatos: unknown[] = [
    mc.protocolMessage,
    getByPath(mc, 'editedMessage.message.protocolMessage'),
    getByPath(mc, 'editedMessage.protocolMessage'),
    getByPath(payload, 'message.protocolMessage'),
    getByPath(payload, 'data.message.protocolMessage'),
  ]
  for (const candidato of candidatos) {
    if (!candidato || typeof candidato !== 'object') continue
    const proto = candidato as Record<string, unknown>
    // MESSAGE_EDIT, ou o 14 do enum quando vem como número.
    const tipo = safeString(proto.type ?? proto.protocolType).toUpperCase()
    if (tipo && !tipo.includes('EDIT') && tipo !== '14') continue
    const editada = proto.editedMessage as Record<string, unknown> | undefined
    if (!editada || typeof editada !== 'object') continue
    const texto = safeString(
      getByPath(editada, 'conversation') ??
        getByPath(editada, 'message.conversation') ??
        getByPath(editada, 'extendedTextMessage.text') ??
        getByPath(editada, 'message.extendedTextMessage.text') ??
        '',
    ).trim()
    const targetMessageId = safeString(getByPath(proto, 'key.id')) || safeString(proto.messageId)
    if (targetMessageId && texto) return { targetMessageId, text: texto }
  }
  return null
}

export function extractInboundRevoke(payload: Record<string, unknown>): { targetMessageId: string } | null {
  const mc = (payload?.msgContent ?? payload?.msgcontent ?? payload?.message ?? {}) as Record<string, unknown>
  const proto = mc.protocolMessage as Record<string, unknown> | undefined
  if (!proto || typeof proto !== 'object') return null
  const tipo = safeString(proto.type ?? proto.protocolType).toUpperCase()
  if (tipo && !tipo.includes('REVOKE')) return null
  const targetMessageId = safeString(getByPath(proto, 'key.id')) || safeString(proto.messageId)
  return targetMessageId ? { targetMessageId } : null
}

/**
 * Mensagem CITADA numa resposta que chegou. É o `contextInfo.stanzaId` do WhatsApp: sem
 * ele, a resposta "sim, pode ser" aparece solta e ninguém sabe a que pergunta responde.
 */
export function extractInboundReplyTo(payload: Record<string, unknown>): string {
  const mc = (payload?.msgContent ?? payload?.msgcontent ?? payload?.message ?? {}) as Record<string, unknown>
  for (const chave of Object.keys(mc)) {
    const bloco = mc[chave]
    if (!bloco || typeof bloco !== 'object') continue
    const id =
      safeString(getByPath(bloco as Record<string, unknown>, 'contextInfo.stanzaId')) ||
      safeString(getByPath(bloco as Record<string, unknown>, 'contextInfo.quotedMessageId'))
    if (id) return id
  }
  return (
    safeString(getByPath(payload, 'contextInfo.stanzaId')) ||
    safeString(getByPath(payload, 'quotedMsgId')) ||
    ''
  )
}
