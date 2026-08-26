import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { setLineConversationMode } from '../_shared/conversationLineState.ts'
import { resolveOutboundProviderForLead } from '../_shared/whatsapp/resolveProvider.ts'
import type { SendWhatsappMessageResult, WhatsappProvider } from '../_shared/whatsapp/types.ts'
import { WapiProvider } from '../_shared/whatsapp/wapi.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Autor da interaction quando quem chama é uma ROTINA (service_role), não uma pessoa.
 * Sem isto o follow-up do cron era gravado como "Operador" e a rotina ainda inseria uma
 * segunda linha com o autor certo — o mesmo texto aparecia duas vezes no chat, uma delas
 * mentindo que um humano tinha respondido.
 */
const INTERNAL_SOURCE_AUTHORS: Record<string, string> = {
  followup_scheduler: 'Assistente IA (follow-up)',
  reengage_reativacao: 'Assistente IA (reengajamento)',
  reengage_recompra: 'Assistente IA (recompra)',
  cart_recovery: 'Assistente IA (carrinho)',
  // Confirmação de pagamento (rede.ts/finalizeRedePaid). Sem entrada aqui o autor sairia
  // como 'Operador' e a equipe leria como se alguém tivesse digitado a mensagem.
  confirmacao_pagamento: 'Confirmação de pagamento',
}

/** Bucket onde o painel sobe o que vai por anexo. Já existia (tarefas, comprovantes). */
const MEDIA_BUCKET = 'crm-lead-attachments'

type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif' | 'ptv'

/**
 * Que rota da W-API atende este ficheiro. O tipo manda mais do que parece: mandar um áudio
 * pela rota de documento faz a paciente receber um ficheiro que ela tem de baixar em vez da
 * bolha de voz que ela sabe tocar. Quando o painel declara `kind`, mandamos o que ele pediu.
 */
function inferMediaKind(mimeType: string, fileName: string, declared?: string): MediaKind {
  if (declared && ['image', 'video', 'audio', 'document', 'sticker', 'gif', 'ptv'].includes(declared)) {
    return declared as MediaKind
  }
  const mime = mimeType.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (!mime) {
    const ext = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? ''
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image'
    if (['mp4', 'mov', 'm4v', '3gp'].includes(ext)) return 'video'
    if (['ogg', 'opus', 'mp3', 'm4a', 'wav'].includes(ext)) return 'audio'
  }
  return 'document'
}

/** Marcador da bolha no histórico, quando a mídia vai sem legenda. */
const MEDIA_LABEL: Record<MediaKind, string> = {
  image: '📷 Foto',
  video: '🎬 Vídeo',
  audio: '🎤 Áudio',
  document: '📎 Documento',
  sticker: '🎭 Figurinha',
  gif: '🎞️ GIF',
  ptv: '🎥 Vídeo redondo',
}

/**
 * Link temporário para a W-API ir buscar o ficheiro. O bucket é privado, então URL pública
 * não existe: o link assinado é o que permite ao servidor deles baixar. 24h porque a
 * mensagem pode ficar na fila da instância antes de sair — link de 1h expirava no meio.
 */
async function signedUrlFor(
  admin: SupabaseClient,
  storagePath: string,
  baixarComoNome?: string,
): Promise<string> {
  const { data, error } = await admin.storage
    .from(MEDIA_BUCKET)
    // `download` põe o nome do ficheiro no FIM da URL (…&download=audio.ogg). A W-API lê a
    // extensão da URL para decidir se aceita o áudio, e o link assinado termina em
    // `?token=<jwt>` — quem confere com um `endsWith('.ogg')` cru reprovaria um ogg legítimo.
    .createSignedUrl(storagePath, 86_400, baixarComoNome ? { download: baixarComoNome } : undefined)
  if (error || !data?.signedUrl) {
    throw new Error(`media_signed_url_failed: ${error?.message ?? 'sem url'} (${storagePath})`)
  }
  return data.signedUrl
}

/**
 * A W-API só aceita áudio em `.ogg` ou `.mp3` — e reprova pela URL, antes de tentar
 * entregar. Quando o ficheiro não serve, dizer isso aqui vale mais do que repassar o 500
 * dela ("wapi_send-audio_failed_500"), que não diz a ninguém o que fazer a seguir.
 */
function audioServeParaWapi(media: string): boolean {
  return /\.(ogg|mp3)$/.test(media.split('?')[0].toLowerCase())
}

/**
 * Áudio que só existe em base64 (a voz que a paciente mandou vive assim, e é o que sai ao
 * ENCAMINHAR) vira ficheiro no bucket antes de sair. A W-API decide pela URL: um
 * `data:audio/ogg;base64,…` não tem extensão nenhuma e é recusado igual ao .webm foi.
 */
async function guardarAudioNoBucket(
  admin: SupabaseClient,
  leadId: string,
  base64: string,
  mimeType: string,
): Promise<string> {
  const cru = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const binario = Uint8Array.from(atob(cru), (c) => c.charCodeAt(0))
  const mp3 = /mpeg|mp3/i.test(mimeType)
  const caminho = `whatsapp/${leadId}/${crypto.randomUUID()}-audio.${mp3 ? 'mp3' : 'ogg'}`
  const { error } = await admin.storage.from(MEDIA_BUCKET).upload(caminho, binario, {
    contentType: mp3 ? 'audio/mpeg' : 'audio/ogg',
    upsert: false,
  })
  if (error) throw new Error(`audio_upload_failed: ${error.message}`)
  return caminho
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  // Chamadas server-to-server (cron de follow-up via admin.functions.invoke) chegam com a
  // própria service_role key no Authorization. auth.getUser() NÃO devolve usuário p/ um token
  // de service_role → dava 401 e os follow-ups de WhatsApp nunca saíam (sent:0). A plataforma
  // já validou o JWT (verify_jwt=true); aqui só liberamos o caminho de máquina confiável e
  // mantemos a exigência de usuário real para os envios vindos do painel.
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  const isServiceRole = bearer.length > 0 && bearer === serviceRole
  let user: { id?: string; email?: string | null } | null = null
  if (!isServiceRole) {
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: authData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !authData.user) return json({ error: 'unauthorized' }, 401)
    user = authData.user
  }

  let body: {
    leadId?: string
    to?: string
    text?: string
    channel?: string
    stickerWebpBase64?: string
    attachments?: Array<{ name?: string; mimeType?: string; base64?: string }>
    /**
     * URLs públicas a enviar como mídia. Em ManyChat, são acrescentadas ao texto da reply
     * (WhatsApp/Instagram renderizam preview). Em Evolution direto, é preferível usar
     * `attachments` com base64; URLs aqui são apenas anexadas ao texto para clicar.
     */
    mediaUrls?: Array<{ url: string; type?: 'image' | 'audio' | 'video' | 'document'; caption?: string }>
    /**
     * Override humano explícito após opt-out. Quando true, ignora `leads.opted_out_at`
     * e libera o envio (apenas via UI humana — IA tem checagem própria em crmAiAutoReply
     * e não passa por aqui). Registra interaction `system` de auditoria. Usuário precisa
     * confirmar no frontend ("assumo risco de ban").
     */
    manualOverride?: boolean
    /**
     * Polo que a rotina chamadora exige da linha de saída ('clinic' | 'sales'). Quando
     * a linha resolvida for de outro polo, o envio é recusado com 409 em vez de sair
     * pelo número errado. Use em toda rotina que fala de um assunto de um polo só.
     */
    requireBotKind?: string
    /**
     * Tenant do ASSUNTO, quando ele não é o tenant do lead. Lembrete de cirurgia é
     * conteúdo da clínica mesmo quando o paciente vive no polo Tricopill (Rodrigo Pupin
     * e Evandro Matos: cirurgia marcada, lead no Tricopill porque compraram suplemento
     * primeiro). Sem isso o envio resolvia pela linha de vendas. A linha do lead NÃO é
     * reescrita nesse caminho: onde a pessoa conversa continua sendo dela.
     */
    senderTenantId?: string
    /**
     * Origem do envio. `stage_automation` bloqueia automação para leads ManyChat fora
     * da janela 24h da Meta — o ManyChat aceita o sendFlow mas a Meta dropa em silêncio,
     * dando toast verde mentiroso. `followup_scheduler` é o cron de follow-up (já filtra
     * a janela do lado dele). Demais valores tratados como envio humano.
     */
    source?: string
    /**
     * Classificação anti-ban forçada. Só 'transactional' é aceito, e só de rotina interna
     * (service role): é a confirmação que a PRÓPRIA pessoa acabou de provocar — pagou, e
     * precisa conferir nome/CPF/endereço. Sem isto o guard classificaria a confirmação de
     * uma compra do site como contato novo ('cold') e a seguraria, porque o cliente nunca
     * escreveu naquela linha. Não fura opt-out (a checagem de opt-out é acima e continua).
     */
    antiBanKind?: string
    /**
     * MÍDIA DE VERDADE. Até 25/ago/2026 o compositor do CRM aceitava anexo, mostrava o
     * contador de ficheiros, dava toast verde — e não enviava nada: `attachments` só
     * virava linha em `crm_media_items` e a paciente nunca recebia. Agora cada item aqui
     * vira uma mensagem na rota certa da W-API (send-image/video/audio/document/sticker).
     *
     * Origem do ficheiro, por ordem de preferência:
     *  • `storagePath` — caminho no bucket `crm-lead-attachments` (o painel sobe o ficheiro
     *    e manda só o caminho). É o caminho normal: base64 de um vídeo de 12MB não passa
     *    pelo JSON de uma Edge Function.
     *  • `url` — link público já pronto (ex.: QR do Pix, etiqueta, imagem do catálogo).
     *  • `base64` — só para coisa pequena (figurinha). Precisa do prefixo `data:<mime>;base64,`.
     */
    media?: Array<{
      kind?: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif' | 'ptv'
      storagePath?: string
      url?: string
      base64?: string
      fileName?: string
      mimeType?: string
      caption?: string
      /**
       * Id de uma linha de `crm_media_items` que já existe — é assim que ENCAMINHAR
       * funciona. A W-API não tem rota de encaminhar: o CRM reenvia o conteúdo. Passando o
       * id, o ficheiro nunca sai do servidor (a foto que a paciente mandou está guardada em
       * base64; mandá-la ao browser e de volta seria pagar duas vezes pelos mesmos bytes).
       */
      mediaItemId?: string
    }>
    /** Id W-API da mensagem CITADA: faz a resposta sair colada na pergunta. */
    replyToMessageId?: string
    /** Interaction de origem, quando esta mensagem é um ENCAMINHAMENTO. */
    forwardedFromId?: string
    /**
     * Mensagem ESPECIAL do WhatsApp — as que não são texto nem ficheiro: o mapinha da
     * localização, o cartão de contato, a enquete, o botão de Pix nativo e o link com
     * pré-visualização montada por nós.
     *
     * Cada uma tem rota própria na W-API e nenhuma cabia no `text`: mandar o endereço
     * escrito não abre o mapa no telemóvel de quem recebe, e é justamente isso que a
     * paciente precisa na véspera da consulta.
     */
    special?:
      | { type: 'location'; latitude: string | number; longitude: string | number; name?: string; address?: string }
      | { type: 'contact'; contacts: Array<{ name: string; phone: string; description?: string }> }
      | { type: 'poll'; message: string; options: string[]; maxOptions?: number }
      | {
          type: 'pix'
          merchantName: string
          pixKey: string
          keyType: 'cpf' | 'cnpj' | 'phone' | 'email' | 'random'
          amount?: number
        }
      | { type: 'link'; message: string; linkUrl: string; title?: string; description?: string; image?: string }
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const sourceTag = String(body.source ?? '').trim()
  /** Pessoa logada > rotina interna conhecida > fallback histórico. */
  const outboundAuthor = user?.email || (isServiceRole ? INTERNAL_SOURCE_AUTHORS[sourceTag] : '') || 'Operador'

  const leadId = String(body.leadId ?? '').trim()
  const to = String(body.to ?? '').trim()
  const text = String(body.text ?? '').trim()
  const stickerWebpBase64 = typeof body.stickerWebpBase64 === 'string' ? body.stickerWebpBase64.trim() : ''
  const replyToMessageId = String(body.replyToMessageId ?? '').trim() || undefined
  // Compatibilidade com quem já chamava por `attachments` (base64) e `mediaUrls` (link):
  // ambos existiam, nenhum enviava nada. Agora entram na mesma fila da mídia nova, então
  // quem já mandava anexo passa a ver o anexo CHEGAR, sem mudar uma linha do lado de lá.
  const midiaLegada = [
    ...(Array.isArray(body.attachments) ? body.attachments : []).map((a) => ({
      kind: undefined as undefined,
      storagePath: '',
      url: '',
      base64: String(a?.base64 ?? '').trim(),
      fileName: String(a?.name ?? '').trim(),
      mimeType: String(a?.mimeType ?? '').trim(),
      caption: '',
    })),
    ...(Array.isArray(body.mediaUrls) ? body.mediaUrls : []).map((m) => ({
      kind: m?.type,
      storagePath: '',
      url: String(m?.url ?? '').trim(),
      base64: '',
      fileName: '',
      mimeType: '',
      caption: typeof m?.caption === 'string' ? m.caption.trim() : '',
    })),
  ].filter((m) => m.base64 || m.url)
  const forwardedFromId = String(body.forwardedFromId ?? '').trim() || undefined
  const mediaItems = (Array.isArray(body.media) ? body.media : [])
    .map((m) => ({
      kind: m?.kind,
      storagePath: String(m?.storagePath ?? '').trim(),
      url: String(m?.url ?? '').trim(),
      base64: String(m?.base64 ?? '').trim(),
      fileName: String(m?.fileName ?? '').trim(),
      mimeType: String(m?.mimeType ?? '').trim(),
      caption: typeof m?.caption === 'string' ? m.caption.trim() : '',
      mediaItemId: String(m?.mediaItemId ?? '').trim(),
    }))
    .filter((m) => m.storagePath || m.url || m.base64 || m.mediaItemId)
    .concat(midiaLegada.map((m) => ({ ...m, mediaItemId: '' })))

  if (!leadId) return json({ error: 'missing_fields', message: 'leadId obrigatório' }, 400)

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('id, patient_name, phone, whatsapp_instance_id, custom_fields, source, tenant_id, opted_out_at')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr || !lead) return json({ error: 'lead_not_found' }, 404)

  const row = lead as {
    id: string;
    patient_name: string;
    phone: string;
    whatsapp_instance_id: string | null;
    tenant_id: string;
    opted_out_at: string | null;
    custom_fields: Record<string, unknown>;
    source: string;
  }

  // Guardrail anti-banimento: bloqueia outbound se paciente optou por sair.
  // LGPD art. 18 IV + proteção contra denúncias no WhatsApp.
  // Override humano explícito (`manualOverride: true`) permite envio com auditoria —
  // operador assume risco de ban. IA continua bloqueada pois nem passa por aqui.
  const manualOverride = Boolean(body.manualOverride)
  if (row.opted_out_at && !manualOverride) {
    return json(
      {
        error: 'lead_opted_out',
        message: 'Este paciente solicitou parar de receber mensagens. Confirme o override em LeadDetail ou clique "Enviar mesmo assim" para assumir o risco de ban.',
        opted_out_at: row.opted_out_at,
      },
      403,
    )
  }
  if (row.opted_out_at && manualOverride) {
    try {
      await insertInteraction(admin, {
        leadId: row.id,
        patientName: row.patient_name,
        channel: 'system',
        direction: 'system',
        author: user?.email || 'Operador',
        content: `Override humano após opt-out (${new Date(row.opted_out_at).toISOString()}). Operador assumiu risco de ban.`,
        tenantId: row.tenant_id,
      })
    } catch (e) {
      console.warn('[crm-send-message] override audit interaction failed:', e instanceof Error ? e.message : String(e))
    }
  }

  // Quando o consultor humano responde, o lead deixa de "aguardar consultor" no Painel
  // de Atendimento Pendente (waiting_human → human_active). Escopo mínimo e seguro: só
  // transiciona quem está EXATAMENTE em waiting_human — não toca em 'new', leads de venda
  // (Tricopill) nem em estados finais. Best-effort: nunca derruba o envio.
  if (user?.email) {
    try {
      await admin
        .from('leads')
        .update({ conversation_status: 'human_active', last_interaction_at: nowIso() })
        .eq('id', row.id)
        .eq('conversation_status', 'waiting_human')
    } catch (e) {
      console.warn('[crm-send-message] clear waiting_human failed:', e instanceof Error ? e.message : String(e))
    }
  }

  const effectiveTo = to || String(row.phone ?? '').trim()
  const customFieldsProvider = String(
    (row.custom_fields as Record<string, unknown> | null)?.provider ?? '',
  ).toLowerCase()
  // `custom_fields.channel = 'whatsapp'` NÃO quer dizer ManyChat: o webhook da W-API
  // grava esse mesmo campo, então quem chegou pela linha direta caía no push do
  // ManyChat só por causa dele. Quem tem linha WhatsApp própria (instância vinculada ou
  // provider gravado no lead) é atendido pela linha, não pelo ManyChat.
  const hasDirectWhatsappLine =
    Boolean(row.whatsapp_instance_id) ||
    customFieldsProvider === 'wapi' ||
    customFieldsProvider === 'evolution' ||
    customFieldsProvider === 'official'

  // O POLO tem linha própria de WhatsApp? Depois que a clínica saiu do ManyChat (20/ago),
  // o vínculo por lead deixou de bastar: os 2.732 leads da clínica têm
  // `whatsapp_instance_id` NULO (quem conversava era o ManyChat), e sem esta pergunta cada
  // um deles continuava sendo empurrado para uma conta que não atende mais WhatsApp — o
  // toast dizia "configure MANYCHAT_SEND_FLOW_MESSAGE_TAG" para uma linha W-API no ar.
  // A linha resolvida é a mesma que `resolveOutboundProviderForLead` usaria como padrão.
  let poloTemLinhaPropria = hasDirectWhatsappLine
  if (!poloTemLinhaPropria && row.tenant_id) {
    const { data: linhaDoPolo } = await admin
      .from('whatsapp_channel_instances')
      .select('id')
      .eq('tenant_id', row.tenant_id)
      .eq('active', true)
      .neq('channel_provider', 'manychat')
      .limit(1)
      .maybeSingle()
    poloTemLinhaPropria = Boolean(linhaDoPolo)
  }
  // Telefone de verdade (não o sintético 888001… que o ManyChat inventava para quem só
  // existia no Instagram). Sem telefone real não há linha para onde mandar.
  const telefoneReal = /^\d{12,}$/.test(effectiveTo) && !effectiveTo.startsWith('888')
  // O polo do ASSUNTO manda na linha, não o polo da pessoa. Quando a rotina declara
  // senderTenantId diferente do tenant do lead, ignoramos a linha vinculada (ela é do
  // polo da pessoa) e resolvemos pela linha do assunto, sem reescrever o vínculo. O
  // ManyChat também fica de fora: ele é a conta do polo da pessoa.
  const senderTenantId = String(body.senderTenantId ?? '').trim()
  // Desde 24/ago/2026 quem declara o polo também é o PAINEL, não só a rotina interna: sem
  // isso o resolvedor caía no tenant do CADASTRO, e paciente da clínica que compra na linha
  // do Tricopill (cadastro `instituto-lorena`) fazia a resposta da vendedora sair pelo
  // número da CLÍNICA — o cliente respondia lá e ela não podia nem ler a própria conversa.
  //
  // Como o campo agora chega de uma PESSOA, ele deixa de ser aceito no escuro: sem esta
  // conferência, quem atende só um polo poderia declarar o outro e falar pelo número dele.
  // Rotina interna (service role) continua confiável — é ela que sabe de que polo é o
  // assunto (lembrete de cirurgia, confirmação de pagamento, NPS).
  if (senderTenantId && !isServiceRole) {
    const { data: membro } = await admin
      .from('tenant_members')
      .select('tenant_id')
      .eq('auth_user_id', String(user?.id ?? ''))
      .eq('tenant_id', senderTenantId)
      .maybeSingle()
    if (!membro) {
      return json(
        {
          error: 'wrong_sender_tenant',
          message: `Envio bloqueado: ${user?.email ?? 'este login'} não atende o polo '${senderTenantId}'.`,
        },
        403,
      )
    }
  }
  const assuntoDeOutroPolo = Boolean(senderTenantId) && senderTenantId !== row.tenant_id
  // ManyChat MORREU (25/ago/2026, decisão do negócio: "não usamos mais ManyChat, nunca
  // mais"). O ramo saiu daqui inteiro. Enquanto viveu, ele era o destino de todo lead sem
  // linha própria — e devolvia "Meta bloqueia DM sem janela de 24h aberta", o erro de uma
  // integração que já não existia, escrito no chat como se fosse o motivo real de a
  // mensagem não ter saído. Hoje só existe um caminho: a linha de WhatsApp do polo.
  //
  // Sem esse plano B, telefone sintético (888001…, inventado para quem só falou por DM)
  // não tem para onde ir. Falha AQUI, dizendo porquê, em vez de tentar entregar a um
  // número que não existe — o que é exatamente a assinatura que queima a linha.
  if (effectiveTo.startsWith('888001') || !telefoneReal) {
    return json(
      {
        error: 'no_real_phone',
        message:
          'Este lead não tem WhatsApp real (número sintético de Instagram/formulário). Responda pelo Instagram ou corrija o telefone no cadastro.',
        phone: effectiveTo,
      },
      400,
    )
  }
  if (!poloTemLinhaPropria) {
    return json(
      {
        error: 'provider_not_configured',
        message: `O polo '${senderTenantId || row.tenant_id}' não tem linha de WhatsApp ativa. Conecte uma instância em /whatsapp antes de enviar.`,
      },
      400,
    )
  }

  // --- WhatsApp Path ---
  // Roteamento por linha: o channel_provider da instância vinculada ao lead
  // sobrescreve a env WHATSAPP_PROVIDER (que segue sendo o default global).
  // Permite W-API conviver com Evolution/Official no mesmo tenant.
  let provider: WhatsappProvider
  let resolvedBotKind: string | null = null
  let resolvedInstanceId: string | null = null
  let resolvedLineTenantId: string | null = null
  try {
    ;({
      provider,
      botKind: resolvedBotKind,
      instanceId: resolvedInstanceId,
      lineTenantId: resolvedLineTenantId,
    } =
      await resolveOutboundProviderForLead(
        admin,
        {
          id: row.id,
          whatsapp_instance_id: assuntoDeOutroPolo ? null : row.whatsapp_instance_id,
          tenant_id: assuntoDeOutroPolo ? senderTenantId : row.tenant_id,
        },
        assuntoDeOutroPolo ? { bindDefault: false } : undefined,
      ))
  } catch (e) {
    return json({ error: 'provider_not_configured', message: e instanceof Error ? e.message : String(e) }, 500)
  }

  // Guarda de polo do CHAMADOR. Rotina de um polo declara o polo que espera, e um
  // lembrete de cirurgia nunca sai pela linha de vendas do Tricopill mesmo que o lead
  // esteja amarrado nela. Falha alto: melhor o paciente não receber e alguém ver o erro
  // do que receber pelo número errado.
  const requireBotKind = String(body.requireBotKind ?? '').trim().toLowerCase()
  if (requireBotKind && resolvedBotKind && resolvedBotKind !== requireBotKind) {
    return json(
      {
        error: 'wrong_bot_kind',
        message: `Envio bloqueado: a rotina pediu linha '${requireBotKind}' e o lead ${row.id} resolveu para a linha '${resolvedBotKind}' (${resolvedInstanceId}).`,
        expected: requireBotKind,
        resolved: resolvedBotKind,
        instanceId: resolvedInstanceId,
      },
      409,
    )
  }

  try {
    const hourlyCap = Math.max(
      30,
      Math.min(2000, Number(Deno.env.get('CRM_SEND_MESSAGE_HOURLY_CAP') ?? '180')),
    )
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: outboundLastHour } = await admin
      .from('webhook_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'whatsapp-webhook')
      .like('note', 'outbound:%')
      .gte('created_at', oneHourAgoIso)
    if ((outboundLastHour ?? 0) > hourlyCap) {
      return json(
        {
          error: 'rate_limited',
          message:
            'Limite horário de envios WhatsApp atingido. Aguarde ou ajuste CRM_SEND_MESSAGE_HOURLY_CAP (Edge Functions → Secrets). Para Instagram via ManyChat use sendFlow + record_outbound.',
        },
        429,
      )
    }

    const manualGapSeconds = Math.max(
      0,
      Math.min(600, Number(Deno.env.get('CRM_MANUAL_SEND_MIN_GAP_SECONDS') ?? '10')),
    )
    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('last_human_reply_at, ai_enabled')
      .eq('lead_id', leadId)
      .maybeSingle()
    const lastHumanAt = state?.last_human_reply_at ? new Date(String(state.last_human_reply_at)).getTime() : 0
    if (
      manualGapSeconds > 0 &&
      lastHumanAt > 0 &&
      (Date.now() - lastHumanAt) / 1000 < manualGapSeconds
    ) {
      return json(
        {
          error: 'cooldown',
          message: `Aguarde ${manualGapSeconds}s entre envios manuais neste lead (ou defina CRM_MANUAL_SEND_MIN_GAP_SECONDS=0 para desativar).`,
        },
        429,
      )
    }

    const especial = body.special
    if (!stickerWebpBase64 && !text.trim() && mediaItems.length === 0 && !especial) {
      return json({ error: 'missing_fields', message: 'Envie texto, mídia ou figurinha.' }, 400)
    }

    // Contexto da guarda anti-ban (só tem efeito em linha W-API/Evolution):
    //  • `antiBanHumanOverride` — pessoa na tela: fura teto de volume e janela de horário,
    //    porque quem está a olhar a conversa sabe o que está a fazer. NÃO fura contato novo.
    //  • `antiBanColdOverride` — o "assumo o risco" explícito, que também libera contato novo.
    const antiBanKind =
      isServiceRole && String(body.antiBanKind ?? '').trim() === 'transactional'
        ? 'transactional'
        : undefined
    const antiBanMeta = {
      antiBanSource: sourceTag || (isServiceRole ? 'rotina' : 'painel'),
      antiBanHumanOverride: !isServiceRole,
      antiBanColdOverride: body.manualOverride === true,
      ...(antiBanKind ? { antiBanKind } : {}),
    }

    // ── O que sai, e em que ordem ───────────────────────────────────────────────
    // Mídia primeiro, texto depois — a ordem do telemóvel: a foto chega e o comentário
    // vem a seguir. Cada peça é uma MENSAGEM própria na W-API, com o seu próprio id, e
    // cada uma vira uma linha em `interactions`. Isso é o que torna a bolha "viva": só com
    // um id por bolha dá para responder citando, reagir, editar ou apagar aquela e não
    // outra. Enquanto foi tudo uma interaction só, o chat era um registo, não um chat.
    const podeMidia = provider instanceof WapiProvider
    if (especial && !podeMidia) {
      return json(
        {
          error: 'special_not_supported',
          message: `A linha resolvida (${provider.name}) não envia localização, contato, enquete ou Pix por API.`,
        },
        400,
      )
    }
    if (mediaItems.length > 0 && !podeMidia) {
      return json(
        {
          error: 'media_not_supported',
          message: `A linha resolvida (${provider.name}) não envia mídia por API. Só linhas W-API suportam foto, áudio, vídeo e documento.`,
        },
        400,
      )
    }

    type Peca = {
      kind: MediaKind
      media: string
      caption: string
      fileName: string
      mimeType: string
      storagePath: string
    }
    const pecas: Peca[] = []
    for (const item of mediaItems) {
      let storagePath = item.storagePath
      let base64 = item.base64
      let mimeType = item.mimeType
      let fileName = item.fileName
      let declarado: MediaKind | undefined = item.kind as MediaKind | undefined

      // ENCAMINHAR: o ficheiro já está guardado, só precisamos de o buscar. A mídia que a
      // paciente mandou vive em `media_base64` (o webhook desencripta e guarda ali); a que
      // nós mandámos vive no Storage. Os dois caminhos servem, e nenhum passa pelo browser.
      if (item.mediaItemId) {
        const { data: origem } = await admin
          .from('crm_media_items')
          .select('media_type, mime_type, storage_path, media_base64, metadata')
          .eq('id', item.mediaItemId)
          .maybeSingle()
        if (!origem) {
          return json({ error: 'media_not_found', message: `Mídia ${item.mediaItemId} não encontrada.` }, 404)
        }
        storagePath = String(origem.storage_path ?? '')
        base64 = storagePath ? '' : String(origem.media_base64 ?? '')
        mimeType = mimeType || String(origem.mime_type ?? '')
        const meta = (origem.metadata ?? {}) as Record<string, unknown>
        fileName = fileName || String(meta.name ?? '')
        const kindGuardado = String(meta.kind ?? '').trim()
        if (!declarado && kindGuardado) declarado = kindGuardado as MediaKind
        if (!storagePath && !base64) {
          return json(
            {
              error: 'media_unavailable',
              message: 'Esta mídia não está guardada no CRM (só o registo dela). Baixe do WhatsApp e anexe à mão.',
            },
            400,
          )
        }
      }

      const kind = inferMediaKind(mimeType, fileName, declarado)
      if (kind === 'audio' && !storagePath && base64) {
        storagePath = await guardarAudioNoBucket(admin, leadId, base64, mimeType)
        base64 = ''
      }
      // Link assinado só na hora do envio: o bucket é privado e o link vive 24h. Guardamos
      // o CAMINHO (não o link) em crm_media_items, senão o chat mostraria mídia quebrada
      // depois de o link expirar.
      const nomeNoBucket = storagePath.split('/').pop() ?? ''
      const media = storagePath
        ? await signedUrlFor(admin, storagePath, kind === 'audio' ? nomeNoBucket : undefined)
        : item.url ||
          // Base64 vindo do banco chega cru; a W-API exige o prefixo data: para saber o que é.
          (base64.startsWith('data:') ? base64 : `data:${mimeType || 'application/octet-stream'};base64,${base64}`)
      if (kind === 'audio' && !audioServeParaWapi(media)) {
        return json(
          {
            error: 'audio_format_not_supported',
            message:
              'Mensagem de voz só sai em .ogg ou .mp3, e este áudio está noutro formato. Grave pelo microfone do chat (o CRM converte sozinho) ou anexe um .ogg/.mp3.',
          },
          400,
        )
      }
      pecas.push({
        kind,
        media,
        caption: item.caption,
        fileName,
        mimeType,
        storagePath,
      })
    }

    // Texto digitado junto com UMA foto é legenda dela — é o que a pessoa espera ao
    // escrever na caixa com a foto anexada. Com várias peças, a legenda cola na primeira
    // que ainda não tem uma; se todas tiverem, o texto sai como mensagem à parte.
    let textoAvulso = text
    if (textoAvulso && pecas.length > 0) {
      const alvo = pecas.find((p) => !p.caption && p.kind !== 'audio' && p.kind !== 'sticker' && p.kind !== 'ptv')
      if (alvo) {
        alvo.caption = textoAvulso
        textoAvulso = ''
      }
    }

    const wapi = podeMidia ? (provider as WapiProvider) : null
    const idsEnviados: string[] = []
    let ultimoStatus: SendWhatsappMessageResult['status'] = 'queued'
    // A citação vale para a PRIMEIRA peça que sai. Responder uma pergunta com três fotos
    // citando a pergunta três vezes seria ruído.
    let citar = replyToMessageId

    for (const peca of pecas) {
      const comum = {
        to: effectiveTo,
        media: peca.media,
        caption: peca.caption || undefined,
        fileName: peca.fileName || undefined,
        mimeType: peca.mimeType || undefined,
        leadId,
        replyToMessageId: citar,
        metadata: antiBanMeta,
      }
      let res: SendWhatsappMessageResult
      switch (peca.kind) {
        case 'image':
          res = await wapi!.sendImage(comum)
          break
        case 'video':
          res = await wapi!.sendVideo(comum)
          break
        case 'audio':
          res = await wapi!.sendAudio(comum)
          break
        case 'sticker':
          res = await wapi!.sendSticker({ ...comum, sticker: peca.media })
          break
        case 'gif':
          res = await wapi!.sendGif(comum)
          break
        case 'ptv':
          res = await wapi!.sendPtv(comum)
          break
        default:
          res = await wapi!.sendDocument(comum)
      }
      citar = undefined
      idsEnviados.push(res.externalMessageId)
      ultimoStatus = res.status

      const interactionId = await insertInteraction(admin, {
        leadId: String(lead.id),
        patientName: String(lead.patient_name ?? 'Lead'),
        channel: 'whatsapp',
        direction: 'out',
        author: outboundAuthor,
        content: peca.caption || MEDIA_LABEL[peca.kind],
        externalMessageId: res.externalMessageId,
        replyToExternalId: replyToMessageId && idsEnviados.length === 1 ? replyToMessageId : undefined,
        forwardedFromId,
        // Carimbo pela linha que REALMENTE enviou, não pelo vínculo do lead. Sem isto o
        // trigger `_stamp_tenant_id_from_lead` lê `leads.whatsapp_instance_id` — que é onde
        // a pessoa conversa, não por onde este envio saiu — e a mensagem cai no CRM do polo
        // errado nos dois sentidos: confirmação de venda do Tricopill dentro da clínica
        // (21/ago/26, caso Antonio) e lembrete de cirurgia dentro do Tricopill.
        tenantId: resolvedLineTenantId || row.tenant_id,
      })

      await admin.from('crm_media_items').insert({
        lead_id: leadId,
        interaction_id: interactionId,
        tenant_id: resolvedLineTenantId || row.tenant_id,
        direction: 'out',
        // crm_media_items só conhece cinco tipos; figurinha/gif são imagem e ptv é vídeo.
        media_type:
          peca.kind === 'sticker' || peca.kind === 'gif'
            ? 'image'
            : peca.kind === 'ptv'
              ? 'video'
              : peca.kind,
        mime_type: peca.mimeType || null,
        external_media_id: res.externalMessageId,
        storage_path: peca.storagePath || (peca.media.startsWith('http') ? peca.media : null),
        metadata: {
          source: 'crm-send-message',
          kind: peca.kind,
          name: peca.fileName || null,
          caption: peca.caption || null,
          outbound_mode: peca.storagePath ? 'storage' : peca.media.startsWith('http') ? 'url' : 'base64',
        },
      })
    }

    // Figurinha pelo campo antigo (`stickerWebpBase64`) continua a funcionar: agora vai
    // pela rota própria da W-API em vez de morrer em `wapi_sticker_not_implemented`.
    if (stickerWebpBase64) {
      const res = await provider.sendMessage({
        to: effectiveTo,
        text: '',
        leadId,
        stickerWebpBase64,
        replyToMessageId: citar,
        metadata: antiBanMeta,
      })
      citar = undefined
      idsEnviados.push(res.externalMessageId)
      ultimoStatus = res.status
      const interactionId = await insertInteraction(admin, {
        leadId: String(lead.id),
        patientName: String(lead.patient_name ?? 'Lead'),
        channel: 'whatsapp',
        direction: 'out',
        author: outboundAuthor,
        content: MEDIA_LABEL.sticker,
        externalMessageId: res.externalMessageId,
        tenantId: resolvedLineTenantId || row.tenant_id,
      })
      await admin.from('crm_media_items').insert({
        lead_id: leadId,
        interaction_id: interactionId,
        tenant_id: resolvedLineTenantId || row.tenant_id,
        direction: 'out',
        media_type: 'image',
        mime_type: 'image/webp',
        external_media_id: res.externalMessageId,
        media_base64: stickerWebpBase64,
        metadata: { source: 'crm-send-message', kind: 'sticker', outbound_mode: 'sticker_webp' },
      })
    }

    // ── Mensagens especiais ────────────────────────────────────────────────────
    // Localização, contato, enquete, Pix e link com prévia. Saem ANTES do texto avulso
    // porque, quando as duas coisas vão juntas, o texto é o comentário do que foi mandado
    // ("o endereço é esse aqui, ó") — e comentário vem depois, não antes.
    if (especial) {
      let res: SendWhatsappMessageResult
      let resumo: string
      switch (especial.type) {
        case 'location': {
          res = await wapi!.sendLocation({
            to: effectiveTo,
            latitude: especial.latitude,
            longitude: especial.longitude,
            name: especial.name,
            address: especial.address,
            leadId,
            metadata: antiBanMeta,
          })
          resumo = `📍 ${especial.name || 'Localização'}${especial.address ? ` — ${especial.address}` : ''}`
          break
        }
        case 'contact': {
          const contatos = (especial.contacts ?? []).filter((c) => c?.name && c?.phone)
          if (contatos.length === 0) {
            return json({ error: 'missing_fields', message: 'Informe nome e telefone do contato.' }, 400)
          }
          res =
            contatos.length === 1
              ? await wapi!.sendContact({
                  to: effectiveTo,
                  contactName: contatos[0].name,
                  contactPhone: contatos[0].phone,
                  contactBusinessDescription: contatos[0].description,
                  leadId,
                  metadata: antiBanMeta,
                })
              : await wapi!.sendContacts({
                  to: effectiveTo,
                  contacts: contatos.map((c) => ({
                    contactName: c.name,
                    contactPhone: c.phone,
                    contactBusinessDescription: c.description,
                  })),
                  leadId,
                  metadata: antiBanMeta,
                })
          resumo = `👤 Contato: ${contatos.map((c) => c.name).join(', ')}`
          break
        }
        case 'poll': {
          res = await wapi!.sendPoll({
            to: effectiveTo,
            message: especial.message,
            poll: especial.options ?? [],
            pollMaxOptions: especial.maxOptions,
            leadId,
            metadata: antiBanMeta,
          })
          resumo = `📊 Enquete: ${especial.message}\n${(especial.options ?? []).map((o) => `• ${o}`).join('\n')}`
          break
        }
        case 'pix': {
          res = await wapi!.sendPix({
            to: effectiveTo,
            merchantName: especial.merchantName,
            pixKey: especial.pixKey,
            type: especial.keyType,
            amount: especial.amount,
            leadId,
            metadata: antiBanMeta,
          })
          resumo = `💠 Pix ${especial.merchantName}${especial.amount ? ` — R$ ${(especial.amount / 100).toFixed(2)}` : ''}`
          break
        }
        default: {
          res = await wapi!.sendLink({
            to: effectiveTo,
            message: especial.message,
            linkUrl: especial.linkUrl,
            title: especial.title,
            linkDescription: especial.description,
            image: especial.image,
            leadId,
            metadata: antiBanMeta,
            replyToMessageId: citar,
          })
          resumo = especial.message ? `${especial.message}\n${especial.linkUrl}` : especial.linkUrl
          break
        }
      }
      citar = undefined
      idsEnviados.push(res.externalMessageId)
      ultimoStatus = res.status
      await insertInteraction(admin, {
        leadId: String(lead.id),
        patientName: String(lead.patient_name ?? 'Lead'),
        channel: 'whatsapp',
        direction: 'out',
        author: outboundAuthor,
        content: resumo,
        externalMessageId: res.externalMessageId,
        forwardedFromId,
        tenantId: resolvedLineTenantId || row.tenant_id,
      })
    }

    if (textoAvulso.trim()) {
      const res = await provider.sendMessage({
        to: effectiveTo,
        text: textoAvulso,
        leadId,
        replyToMessageId: citar,
        metadata: antiBanMeta,
      })
      idsEnviados.push(res.externalMessageId)
      ultimoStatus = res.status
      await insertInteraction(admin, {
        leadId: String(lead.id),
        patientName: String(lead.patient_name ?? 'Lead'),
        channel: 'whatsapp',
        direction: 'out',
        author: outboundAuthor,
        content: textoAvulso,
        externalMessageId: res.externalMessageId,
        replyToExternalId: citar ? replyToMessageId : undefined,
        forwardedFromId,
        tenantId: resolvedLineTenantId || row.tenant_id,
      })
    }

    const externalMessageId = idsEnviados.join('|').slice(0, 240)
    const sent = { status: ultimoStatus }

    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'done',
      note: `outbound:${provider.name}:${externalMessageId}`.slice(0, 500),
    })
    const preservedAiEnabled =
      state?.ai_enabled !== undefined && state?.ai_enabled !== null ? Boolean(state.ai_enabled) : true

    // "Assumi na mão" vale NA LINHA em que a equipe respondeu. A atendente da clínica
    // responder aqui não pode calar o bot de vendas do Tricopill pra mesma pessoa.
    await setLineConversationMode(admin, {
      leadId,
      instanceId: row.whatsapp_instance_id,
      ownerMode: 'human',
      aiEnabled: preservedAiEnabled,
      lastHumanReplyAt: nowIso(),
    })

    await admin.from('crm_conversation_states').upsert({
      lead_id: leadId,
      owner_mode: 'human',
      ai_enabled: preservedAiEnabled,
      last_human_reply_at: nowIso(),
      updated_at: nowIso(),
    })

    return json({
      ok: true,
      provider: provider.name,
      externalMessageId,
      status: sent.status,
    })
  } catch (e) {
    // Recusa da guarda anti-ban NÃO é falha de envio: foi decisão nossa. Devolvemos 429 com
    // o motivo em português, para a tela mostrar o porquê e a rotina apenas pular a vez —
    // um 502 aqui faria o cron tentar de novo, que é exatamente o que não se quer.
    const isBlocked = e instanceof Error && e.name === 'WapiBlockedError'
    if (isBlocked) {
      const err = e as Error & { reason?: string; kind?: string; retryAfterSeconds?: number }
      await admin.from('webhook_jobs').insert({
        source: 'whatsapp-webhook',
        status: 'done',
        note: `outbound_blocked:${err.reason ?? 'antiban'}:${leadId}`.slice(0, 500),
      })
      return json(
        {
          error: 'blocked_antiban',
          reason: err.reason ?? 'antiban',
          kind: err.kind ?? null,
          retryAfterSeconds: err.retryAfterSeconds ?? null,
          message: err.message,
        },
        429,
      )
    }
    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'retry',
      note: `outbound_error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    })
    return json({ error: 'send_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

