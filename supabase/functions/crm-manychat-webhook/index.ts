import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  disableAiOnHandoff,
  evaluateCrmAiAutoReplyGate,
  nowIso,
  runManychatAiAutoReply,
  stripManychatHandoffMarker,
  upsertConversationStateInboundOnly,
} from '../_shared/crmAiAutoReply.ts'
import {
  findLeadIdByManychatSubscriberId,
  findRealWhatsappLeadByName,
  insertInteraction,
  promoteManychatLeadToRealPhone,
  syntheticPhoneFromManychatSubscriberId,
  upsertLeadByPhone,
} from '../_shared/crm.ts'
import {
  pushManychatInstagramDmAfterReply,
  pushManychatWhatsappDmAfterReply,
  readManychatPushConfigForTenantChannel,
} from '../_shared/manychatPublicApi.ts'
import { resolveWhatsappLineInstanceId, sanitizeCrmInstanceKey } from '../_shared/manychatInstanceResolve.ts'
import {
  bodyHasUnDetectedMediaHints,
  extractManychatMedia,
  stripManybotUrlsFromText,
  type ExtractedMedia,
} from '../_shared/manychatMedia.ts'
import { enrichManychatMediaRows } from '../_shared/manychatMediaEnrich.ts'
import { captureCadastroForLead } from '../_shared/cadastroExtract.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { captureNpsInboundResponse, thankYouFor } from '../_shared/npsCapture.ts'
import { sendWapiDirectText } from '../_shared/saleReceipt.ts'
import { resolveTenantFromManychatBody } from '../_shared/tenantResolve.ts'
import { applyOptOutToLead, isOptOutMessage } from '../_shared/optOutDetect.ts'
import { attributionFromManychatBody, type LeadAttribution } from '../_shared/attribution.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-manychat-crm-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

async function ensureManychatLeadId(
  admin: ReturnType<typeof createClient>,
  input: { subscriberId: string; userName: string; text: string; phone?: string; channel?: string; tenantId?: string; attribution?: LeadAttribution | null },
): Promise<string> {
  const sid = input.subscriberId.trim()
  const digits = input.phone ? digitsOnly(input.phone) : ''
  const channel = String(input.channel ?? '').trim().toLowerCase()
  const defaultName = channel === 'instagram' ? 'Lead Instagram' : 'Lead WhatsApp'
  if (digits.length >= 10) {
    const { leadId } = await promoteManychatLeadToRealPhone(admin, {
      subscriberId: sid,
      patientName: input.userName || defaultName,
      realPhoneDigits: digits,
      summary: input.text.slice(0, 500),
      tenantId: input.tenantId,
      channel,
      attribution: input.attribution ?? null,
    })
    return leadId
  }

  const lead = await upsertLeadByPhone(admin, {
    patientName: input.userName || defaultName,
    phone: syntheticPhoneFromManychatSubscriberId(sid),
    summary: input.text.slice(0, 500),
    source: channel === 'instagram' ? 'meta_instagram' : 'meta_whatsapp',
    customFields: {
      manychat_subscriber_id: sid,
      channel: channel === 'instagram' ? 'instagram' : 'whatsapp',
    },
    attribution: input.attribution ?? null,
    tenantId: input.tenantId,
  })

  // Cross-channel: novo lead Instagram com nome igual a lead real de WhatsApp.
  // Até 2026-06-08 fazíamos merge automático aqui. Foi removido porque o critério
  // era só `ilike(patient_name)` — case-insensitive exato, sem segundo fator —
  // e dois pacientes diferentes com o mesmo nome (ex.: dois "Lucas") acabavam
  // unificados em um único lead, com mensagens se misturando no chat.
  // Agora deixamos os leads separados e adicionamos um aviso de sistema em cada
  // um, sugerindo merge manual via crm-merge-leads se realmente for a mesma pessoa.
  if (lead.status === 'created' && input.userName) {
    const waLeadId = await findRealWhatsappLeadByName(admin, input.userName)
    if (waLeadId && waLeadId !== lead.leadId) {
      try {
        await insertInteraction(admin, {
          leadId: lead.leadId,
          patientName: input.userName,
          channel: 'system',
          direction: 'system',
          author: 'CRM',
          content: `Existe outro lead com este mesmo nome no WhatsApp. Se for a mesma pessoa, use "Mesclar leads" para unificar. Lead WhatsApp candidato: ${waLeadId}.`,
          happenedAt: nowIso(),
        })
        await insertInteraction(admin, {
          leadId: waLeadId,
          patientName: input.userName,
          channel: 'system',
          direction: 'system',
          author: 'CRM',
          content: `Chegou um novo lead no Instagram com o mesmo nome desta paciente. Se for a mesma pessoa, use "Mesclar leads" para unificar. Lead Instagram candidato: ${lead.leadId}.`,
          happenedAt: nowIso(),
        })
      } catch { /* ignore */ }
    }
  }

  return lead.leadId
}

type AdminClient = ReturnType<typeof createClient>

type ManychatPipelineCtx = {
  jobRowId: string
  dedupKey: string
  subscriberId: string
  userName: string
  text: string
  phoneOpt?: string
  aiInboundUserText: string
  skipManychatPush: boolean
  /**
   * `true` quando este pipeline corre no caminho async (ack rápido + push no fundo).
   * Em modo síncrono o `reply` volta no JSON e o ManyChat já envia ao paciente —
   * fazer push nesse caso duplica a mensagem.
   */
  isAsyncPipeline: boolean
  /** Força o push mesmo em modo síncrono (raro: quando o flow ManyChat não usa o campo `reply`). */
  forceManychatPush: boolean
  channel?: string
  /** Linha CRM (`whatsapp_channel_instances`) para prompt IA por instância. */
  whatsappLineInstanceId: string | null
  /** Anexos extraídos do payload ManyChat (URLs S3 ou similares). */
  inboundMedia: ExtractedMedia[]
  /** Tenant resolvido do body (campo `tenant_slug`) ou fallback 'instituto-lorena'. */
  tenantId: string
  /** Atribuição de campanha Meta extraída do corpo (anúncios de conversa). */
  attribution?: LeadAttribution | null
}

type ManychatPipelineResult = {
  leadId: string
  reply: string
  handoff_suggested: boolean
  routing: string
  manychat_push: Record<string, unknown>
  media_persist?: { inserted: number; error: string | null }
  ai_skip_reasons?: string[]
  hint?: string | null
}

/**
 * Constrói o texto que vai no `content` da interaction quando o paciente envia mídia.
 * Se houver caption/texto, usamos. Senão deixamos uma marca legível por canal.
 */
function contentForInboundWithMedia(text: string, media: ExtractedMedia[]): string {
  const cleanText = stripManybotUrlsFromText(text, media.map((m) => m.url)).trim()
  if (cleanText) return cleanText
  if (media.length === 0) return ''
  const labels = media.map((m) => {
    if (m.type === 'image') return '🖼️ Foto'
    if (m.type === 'audio') return '🎙️ Áudio'
    if (m.type === 'video') return '🎬 Vídeo'
    if (m.type === 'document') return '📎 Documento'
    return '📁 Mídia'
  })
  return labels.join(' • ')
}

// Detecta a transferência da Sofia para a consultora humana (Dandara) a partir do TEXTO
// da resposta espelhada. Usado como rede quando o marcador [PRONTO_PARA_CONSULTOR] não
// chega ao CRM (a clínica roda a Sofia no ManyChat, com a IA do CRM desligada). Exige o
// nome "Dandara" + um verbo de encaminhamento, pra não disparar em menções soltas.
function looksLikeDandaraHandoff(text: string): boolean {
  const t = (text || '').toLowerCase()
  if (!t.includes('dandara')) return false
  return /encaminh|consultora|vou te passar|vou te chamar|vai te explicar|vai confirmar|seguir com o agendamento|passar (pra|para) (a )?dandara|chamar agora/.test(t)
}

/**
 * Grava os anexos extraídos do payload ManyChat em `crm_media_items`, linkando à
 * interaction recém-criada. A URL do S3 do ManyChat vai em `storage_path` (estável,
 * público o bastante para renderizar direto no chat sem precisar baixar).
 *
 * Devolve `{ inserted, error }` — o supabase-js NÃO lança em erro lógico (RLS,
 * check constraint, trigger). Sem capturar o `error` do retorno, falhas viravam
 * silenciosas e a UI ficava sem a mídia mesmo com o webhook respondendo 200.
 */
async function persistManychatMedia(
  admin: AdminClient,
  input: { leadId: string; interactionId: string; media: ExtractedMedia[]; tenantId: string },
): Promise<{ inserted: number; error: string | null; rowIds: string[] }> {
  if (input.media.length === 0) return { inserted: 0, error: null, rowIds: [] }
  try {
    const { data, error } = await admin
      .from('crm_media_items')
      .insert(
        input.media.map((m) => ({
          lead_id: input.leadId,
          interaction_id: input.interactionId,
          tenant_id: input.tenantId,
          direction: 'in',
          media_type: m.type === 'other' ? 'document' : m.type,
          mime_type: m.mimeType ?? null,
          storage_path: m.url,
          metadata: {
            source: 'manychat',
            original_url: m.url,
            caption: m.caption ?? null,
            name: m.name ?? null,
          },
        })),
      )
      .select('id')
    if (error) {
      console.warn(
        '[manychat-webhook] crm_media_items insert error:',
        JSON.stringify({
          message: error.message,
          code: (error as { code?: string }).code,
          details: (error as { details?: string }).details,
          leadId: input.leadId,
          interactionId: input.interactionId,
          tenantId: input.tenantId,
          mediaCount: input.media.length,
          mediaTypes: input.media.map((m) => m.type),
        }),
      )
      return { inserted: 0, error: error.message, rowIds: [] }
    }
    const rowIds = ((data ?? []) as Array<{ id: string }>).map((r) => String(r.id))
    return { inserted: input.media.length, error: null, rowIds }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[manychat-webhook] crm_media_items insert threw:', msg)
    return { inserted: 0, error: msg, rowIds: [] }
  }
}

function scheduleEdgeBackground(task: Promise<void>): void {
  try {
    const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil
    if (typeof wu === 'function') {
      wu(task)
      return
    }
  } catch {
    /* ignore */
  }
  void task
}

/**
 * Resposta `queued` só faz sentido quando há config para enviar DM via API ManyChat **neste canal**
 * (`MANYCHAT_API_KEY` + field + flow; WhatsApp reusa por omissão os mesmos secrets que Instagram).
 * Sem isso, devolve-se modo síncrono com `reply` no JSON (ManyChat mapeia no passo seguinte).
 * `manychat_sync: true` força síncrono; `manychat_async: true` só entra em fila se o push estiver configurado.
 */
async function isManychatAsyncAck(
  admin: AdminClient,
  tenantId: string,
  body: Record<string, unknown>,
  pushChannel: string,
): Promise<boolean> {
  if (body.manychat_sync === true || String(body.manychat_sync ?? '').trim().toLowerCase() === 'true') {
    return false
  }
  const pushCfg = await readManychatPushConfigForTenantChannel(admin, tenantId, pushChannel)

  const forcedAsync =
    body.manychat_async === true || String(body.manychat_async ?? '').trim().toLowerCase() === 'true'
  if (forcedAsync) {
    return pushCfg !== null
  }
  const v = (Deno.env.get('MANYCHAT_ASYNC_ACK') ?? '').trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'sync') return false
  if (v === 'true' || v === '1') {
    return pushCfg !== null
  }
  return pushCfg !== null
}

/**
 * Canal efectivo para push ManyChat (WA vs IG).
 *
 * Regra: respeitar o que vem (`body.channel` explícito, presença de
 * `whatsappLineInstanceId` ou telefone real ≥10 dígitos não-sintético).
 * WhatsApp e Instagram são distinguidos pelo que o ManyChat envia; quando
 * não há nenhum sinal, o default é WhatsApp (canal majoritário).
 */
function resolveEffectiveManychatChannel(
  body: Record<string, unknown>,
  whatsappLineInstanceId: string | null,
  phoneDigits: string,
): string {
  let c = String(body.channel ?? '').trim().toLowerCase()
  if (c === 'wa') c = 'whatsapp'
  if (c === 'ig') c = 'instagram'

  if (c === 'whatsapp' || c === 'instagram') return c

  if (whatsappLineInstanceId) return 'whatsapp'
  if (phoneDigits.length >= 10 && !phoneDigits.startsWith('888001')) return 'whatsapp'

  return 'whatsapp'
}

async function runManychatMessagePipeline(
  admin: AdminClient,
  ctx: ManychatPipelineCtx,
): Promise<ManychatPipelineResult> {
  try {
    const leadId = await ensureManychatLeadId(admin, {
      subscriberId: ctx.subscriberId,
      userName: ctx.userName,
      text: ctx.text,
      phone: ctx.phoneOpt,
      channel: ctx.channel,
      tenantId: ctx.tenantId,
      attribution: ctx.attribution ?? null,
    })

    let waInstForAi: string | null = ctx.whatsappLineInstanceId
    if (waInstForAi) {
      await admin
        .from('leads')
        .update({ whatsapp_instance_id: waInstForAi, updated_at: nowIso() })
        .eq('id', leadId)
    } else {
      const { data: lr } = await admin.from('leads').select('whatsapp_instance_id').eq('id', leadId).maybeSingle()
      const w = lr?.whatsapp_instance_id
      if (w) waInstForAi = String(w)
    }

    const inboundContent = contentForInboundWithMedia(ctx.text, ctx.inboundMedia)

    // Detector de opt-out: se paciente pediu pra parar, marca o lead e
    // bloqueia respostas automáticas downstream (guardrail anti-banimento).
    if (isOptOutMessage(ctx.text)) {
      await applyOptOutToLead(admin, leadId, 'manychat_inbound_opt_out')
    }

    const inboundInteractionId = await insertInteraction(admin, {
      leadId,
      patientName: ctx.userName,
      // Distingue WhatsApp via ManyChat de Instagram via ManyChat para badge correto no chat.
      channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'meta',
      direction: 'in',
      author: ctx.userName,
      content: inboundContent,
      happenedAt: nowIso(),
    })
    const mediaPersist = await persistManychatMedia(admin, {
      leadId,
      interactionId: inboundInteractionId,
      media: ctx.inboundMedia,
      tenantId: ctx.tenantId,
    })
    // Best-effort: baixa a mídia (hosts conhecidos), arquiva em base64 (render
    // durável) e transcreve/OCR. Nunca bloqueia a ingestão.
    if (mediaPersist.rowIds.length > 0) {
      try {
        await enrichManychatMediaRows(admin, { rowIds: mediaPersist.rowIds })
      } catch (e) {
        console.warn('[manychat-webhook] media enrich failed:', e instanceof Error ? e.message : String(e))
      }
    }

    // Captura passiva de dados de cadastro (nome/nascimento/sexo/email/cpf) p/ agendar
    // na Shosp sem digitação. Best-effort, gateado por pista de cadastro no texto
    // (o LLM só roda quando há sinal — no caminho comum é instantâneo).
    try {
      await captureCadastroForLead(admin, leadId, ctx.text)
    } catch {
      // best-effort
    }

    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle()
    // crm_ai_configs tem PK (tenant_id, id): filtrar por id='default' sozinho devolve
    // várias linhas (um 'default' por tenant) e o .maybeSingle() falha → system_prompt some.
    const { data: config } = ctx.tenantId
      ? await admin.from('crm_ai_configs').select('*').eq('id', 'default').eq('tenant_id', ctx.tenantId).maybeSingle()
      : { data: null }
    const statePrompt = String(state?.prompt_override ?? config?.system_prompt ?? '').trim()

    const { data: leadBefore } = await admin
      .from('leads')
      .select('conversation_status')
      .eq('id', leadId)
      .maybeSingle()
    const statusBefore = String((leadBefore as { conversation_status?: string | null } | null)?.conversation_status ?? '') as
      | 'new'
      | 'ai_triaging'
      | 'waiting_human'
      | 'human_active'
      | ''

    // Captura resposta NPS (0-10) antes da IA processar. Se capturado, devolve agradecimento
    // como `reply` e marca routing = nps_response_captured — nenhum push extra é feito.
    const npsResult = await captureNpsInboundResponse(admin, {
      leadId,
      inboundText: ctx.text,
      patientName: ctx.userName,
      tenantId: ctx.tenantId,
    })
    if (npsResult.captured) {
      await insertInteraction(admin, {
        leadId,
        patientName: ctx.userName,
        channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'meta',
        direction: 'out',
        author: 'NPS (Sofia)',
        content: npsResult.thankYouText,
        happenedAt: nowIso(),
        tenantId: ctx.tenantId,
      })
      await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', ctx.jobRowId)
      return {
        leadId,
        reply: npsResult.thankYouText,
        handoff_suggested: false,
        routing: 'nps_response_captured',
        manychat_push: { attempted: false, skipped_reason: 'nps_capture' },
      }
    }

    const gate = await evaluateCrmAiAutoReplyGate(admin, leadId, {
      directionIsInbound: true,
    })

    let reply = ''
    let handoffSuggested = false
    if (gate.canAutoReply) {
      const { replyText, handoffSuggested: ho } = await runManychatAiAutoReply(admin, {
        leadId,
        patientName: ctx.userName,
        aiInboundUserText: ctx.aiInboundUserText,
        inboundHappenedAt: nowIso(),
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        statePrompt,
        aiJobSource: 'manychat-webhook',
        whatsappInstanceId: waInstForAi,
      })
      reply = replyText ?? ''
      handoffSuggested = Boolean(ho)

      if (handoffSuggested) {
        await admin.from('leads').update({
          updated_at: nowIso(),
          last_interaction_at: nowIso(),
          conversation_status: 'waiting_human',
        }).eq('id', leadId)

        await disableAiOnHandoff(admin, leadId)

        await notifyAgents(admin, {
          leadId,
          kind: 'handoff',
          title: 'Triagem Finalizada',
          body: `A IA terminou a triagem de ${ctx.userName}. Pronto para assumir!`,
          includeOwner: true,
          tenantId: ctx.tenantId,
        })
      } else if (reply.trim().length > 0) {
        await admin.from('leads').update({ conversation_status: 'ai_triaging', updated_at: nowIso() }).eq('id', leadId)
      } else if (statusBefore === 'waiting_human' || statusBefore === 'human_active') {
        await notifyAgents(admin, {
          leadId,
          kind: 'urgent',
          title: 'Nova mensagem do paciente',
          body: `${ctx.userName} enviou uma nova mensagem e aguarda resposta.`,
          includeOwner: true,
          dedupeKey: 'unanswered_inbound',
          dedupeWindowMinutes: 3,
          tenantId: ctx.tenantId,
        })
      }
    } else {
      await upsertConversationStateInboundOnly(admin, {
        leadId,
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        inboundHappenedAt: nowIso(),
      })

      const isFirstHumanTouch = statusBefore === '' || statusBefore === 'new'
      if (isFirstHumanTouch) {
        await admin.from('leads').update({
          updated_at: nowIso(),
          last_interaction_at: nowIso(),
          conversation_status: 'waiting_human',
        }).eq('id', leadId)
      }

      await notifyAgents(admin, {
        leadId,
        kind: isFirstHumanTouch ? 'handoff' : 'urgent',
        title: isFirstHumanTouch ? 'Novo lead aguardando' : 'Nova mensagem do paciente',
        body: `${ctx.userName} ${isFirstHumanTouch ? 'iniciou uma conversa' : 'enviou uma nova mensagem'} e aguarda atendimento.`,
        includeOwner: true,
        dedupeKey: 'unanswered_inbound',
        dedupeWindowMinutes: isFirstHumanTouch ? 0 : 3,
        tenantId: ctx.tenantId,
      })
    }

    let manychatPush: Record<string, unknown> = { attempted: false, skipped_reason: 'empty_reply' }
    const replyTrimmed = reply.trim()
    const pushDisabledEnv =
      (Deno.env.get('MANYCHAT_PUSH_DISABLED') ?? '').trim().toLowerCase() === 'true'

    if (pushDisabledEnv) {
      manychatPush = { attempted: false, skipped_reason: 'MANYCHAT_PUSH_DISABLED' }
    } else if (ctx.skipManychatPush) {
      manychatPush = { attempted: false, skipped_reason: 'manychat_skip_push' }
    } else if (!ctx.isAsyncPipeline && !ctx.forceManychatPush && replyTrimmed) {
      // Modo síncrono: o reply é devolvido no JSON e o flow do ManyChat já envia ao paciente.
      // Pushar via API ManyChat aqui duplicaria a mensagem. Use `manychat_force_push: true`
      // se o flow não estiver configurado para usar o campo `reply`.
      manychatPush = { attempted: false, skipped_reason: 'sync_mode_reply_returned' }
    } else if (replyTrimmed) {
      const isWa = ctx.channel === 'whatsapp' || ctx.channel === 'wa'
      const mcCfg = await readManychatPushConfigForTenantChannel(admin, ctx.tenantId, String(ctx.channel ?? ''))
      
      if (!mcCfg) {
        manychatPush = { attempted: false, skipped_reason: 'no_manychat_api_key_or_config_missing' }
      } else {
        const pushArgs = {
          apiKey: mcCfg.apiKey,
          subscriberId: ctx.subscriberId,
          replyText: replyTrimmed,
          fieldId: mcCfg.fieldId,
          flowNs: mcCfg.flowNs,
          messageTag: mcCfg.messageTag || undefined,
        }
        
        const pushResult = isWa 
          ? await pushManychatWhatsappDmAfterReply(pushArgs)
          : await pushManychatInstagramDmAfterReply(pushArgs)
          
        manychatPush = {
          attempted: true,
          ok: pushResult.ok,
          set_field_ok: pushResult.set_field_ok,
          send_flow_ok: pushResult.send_flow_ok,
          skipped_send_flow: pushResult.skipped_send_flow,
          ...(pushResult.ok ? {} : { error: pushResult.error }),
        }
        if (!pushResult.ok) {
          console.warn(
            'crm-manychat-webhook manychat_push:',
            pushResult.error,
            JSON.stringify({
              set_field_ok: pushResult.set_field_ok,
              send_flow_ok: pushResult.send_flow_ok,
              skipped_send_flow: pushResult.skipped_send_flow,
            }),
          )
        }
      }
    }

    await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', ctx.jobRowId)

    const routing = gate.canAutoReply ? 'ai_auto_reply_attempted' : 'manual_handoff'
    return {
      leadId,
      reply,
      handoff_suggested: handoffSuggested,
      routing,
      manychat_push: manychatPush,
      media_persist: mediaPersist,
      ...(gate.canAutoReply
        ? {}
        : {
            ai_skip_reasons: gate.skipReasons,
            hint: gate.skipHint ?? null,
          }),
    }
  } catch (e) {
    await admin
      .from('webhook_jobs')
      .update({
        status: 'retry',
        note: `${ctx.dedupKey}|error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
      })
      .eq('id', ctx.jobRowId)
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // A verificação de secret do ManyChat foi removida a pedido do usuário
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = String(body.action ?? 'message').trim().toLowerCase()

  // ManyChat às vezes envia o subscriber payload completo em `data` (estilo `{{subscriber_data|to_json:true}}`).
  // Nesse caso `text`/`phone`/`user_name` podem vir vazios no topo, mas existem dentro de `data`.
  // Promovemos esses campos para o topo do body antes de seguir o fluxo normal.
  const dataField = body.data
  if (dataField && typeof dataField === 'object' && !Array.isArray(dataField)) {
    const d = dataField as Record<string, unknown>
    const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

    if (!pick(body.subscriber_id) && pick(d.id)) body.subscriber_id = pick(d.id)
    if (!pick(body.text) && !pick(body.message)) {
      const fromData = pick(d.last_input_text)
      if (fromData) body.text = fromData
    }
    if (!pick(body.user_name) && !pick(body.name)) {
      const full = pick(d.name)
      const first = pick(d.first_name)
      const last = pick(d.last_name)
      const composed = full || [first, last].filter(Boolean).join(' ').trim()
      if (composed) body.user_name = composed
    }
    if (!pick(body.phone)) {
      const fromData = pick(d.whatsapp_phone) || pick(d.phone)
      if (fromData) body.phone = fromData
    }
  }

  const subscriberId = String(body.subscriber_id ?? '').trim()
  const leadIdParam = String(body.lead_id ?? '').trim()

  if (action === 'get_thread') {
    if (!subscriberId && !leadIdParam) {
      return json(
        { error: 'missing_identifiers', message: 'Para get_thread envia subscriber_id ou lead_id.' },
        400,
      )
    }
    let resolvedLeadId = leadIdParam
    if (!resolvedLeadId && subscriberId) {
      resolvedLeadId = (await findLeadIdByManychatSubscriberId(admin, subscriberId)) ?? ''
    }
    if (!resolvedLeadId) {
      return json({
        ok: true,
        leadId: null,
        interactions: [],
        status: 'no_lead',
        hint: 'Ainda não existe lead — chama action ingest (ou message) antes.',
        action: 'get_thread',
      })
    }
    const limitRaw = Number(body.limit)
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 40
    const { data: rows, error: threadError } = await admin
      .from('interactions')
      .select('id, channel, direction, author, content, happened_at')
      .eq('lead_id', resolvedLeadId)
      .order('happened_at', { ascending: true })
      .limit(limit)
    if (threadError) {
      return json({ error: 'get_thread_failed', message: threadError.message }, 500)
    }
    return json({
      ok: true,
      leadId: resolvedLeadId,
      status: 'ok',
      interactions: rows ?? [],
      action: 'get_thread',
    })
  }

  if (!subscriberId) return json({ error: 'missing_subscriber_id' }, 400)

  // Resolve o tenant a partir do body (tenant_slug). Cada clínica configura este
  // valor no External Request do seu ManyChat. Sem tenant_slug, cai em fallback.
  const tenantId = await resolveTenantFromManychatBody(admin, body)

  if (action === 'merge_phone') {
    const phone = String(body.phone ?? '').trim()
    const digits = digitsOnly(phone)
    if (digits.length < 10) {
      return json({ error: 'invalid_phone', message: 'Telefone deve ter pelo menos 10 dígitos' }, 400)
    }
    try {
      const rawUserName = String(body.user_name ?? body.name ?? '').trim()
      const summary = String(body.summary ?? body.text ?? '').trim().slice(0, 500)
      const channelHint = String(body.channel ?? '').trim().toLowerCase()
      const mergeChannel = channelHint === 'instagram' || channelHint === 'ig' ? 'instagram' : 'whatsapp'
      const { leadId, merged } = await promoteManychatLeadToRealPhone(admin, {
        subscriberId,
        patientName: rawUserName || (mergeChannel === 'instagram' ? 'Lead Instagram' : 'Lead WhatsApp'),
        realPhoneDigits: digits,
        summary,
        tenantId,
        channel: mergeChannel,
      })
      return json({ ok: true, leadId, merged, action: 'merge_phone' })
    } catch (e) {
      return json({ error: 'merge_failed', message: e instanceof Error ? e.message : String(e) }, 400)
    }
  }

  // ── FEEDBACK / AVALIAÇÃO (nota por botão + comentário) ──
  // Quando o field 14768395=true, o ManyChat manda os botões de nota + pede o comentário,
  // e chama esta ação com { action:'feedback', subscriber_id, score, comment }. Grava em
  // survey_responses (reusa o painel de NPS) e avisa o time em nota baixa (detrator).
  if (action === 'feedback' || action === 'avaliacao' || action === 'nps_feedback') {
    // score pode chegar como string (ManyChat manda o merge field entre aspas). Vazio = sem nota
    // (Number('') seria 0 = falso detrator).
    const scoreStr = String(body.score ?? body.nota ?? body.rating ?? '').trim()
    const scoreRaw = scoreStr === '' ? NaN : Number(scoreStr)
    const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(10, Math.round(scoreRaw))) : null
    const comment = String(body.comment ?? body.comentario ?? body.feedback ?? body.text ?? '').trim().slice(0, 1000) || null
    if (score === null && !comment) return json({ error: 'missing_feedback', message: 'Envie score (0-10) e/ou comment.' }, 400)
    const fbLeadId = await findLeadIdByManychatSubscriberId(admin, subscriberId)
    if (!fbLeadId) return json({ ok: false, action: 'feedback', reason: 'lead_nao_encontrado' })
    const rand = Math.random().toString(36).slice(2, 8)
    const dispatchId = `disp-fb-${Date.now()}-${rand}`
    const respId = `resp-fb-${Date.now()}-${rand}`
    const nowIso = new Date().toISOString()
    try {
      await admin.from('survey_dispatches').insert({
        id: dispatchId, template_id: 'feedback-atendimento', lead_id: fbLeadId,
        channel: 'manychat', sent_at: nowIso, tenant_id: tenantId,
      })
      await admin.from('survey_responses').insert({
        id: respId, dispatch_id: dispatchId, score, comment, responded_at: nowIso, tenant_id: tenantId,
      })
    } catch (e) {
      return json({ error: 'feedback_insert_failed', message: e instanceof Error ? e.message : String(e) }, 500)
    }
    const nomeCliente = String(body.user_name ?? body.name ?? '').trim()
    await insertInteraction(admin, {
      leadId: fbLeadId, patientName: nomeCliente || 'Cliente', channel: 'system', direction: 'in', author: 'Feedback',
      content: `⭐ Avaliação recebida${score !== null ? `: nota ${score}` : ''}${comment ? `\n💬 "${comment}"` : ''}`,
      tenantId,
    }).catch(() => {})
    if (score !== null && score <= 6) {
      await notifyAgents(admin, {
        leadId: fbLeadId, kind: 'urgent', title: '⚠️ Avaliação baixa — recuperar cliente',
        body: `${nomeCliente || 'Cliente'} deu nota ${score}${comment ? `: "${comment.slice(0, 120)}"` : ''}. Vale um contato pra entender e reverter.`,
        includeOwner: true, tenantId, metadata: { dedupeKey: `feedback-low-${fbLeadId}` },
      }).catch(() => {})
      // Aviso no WhatsApp do dono (linha W-API que alcança o número dele) — só nota baixa.
      try {
        const { data: ti } = await admin.from('tenant_integrations').select('notifications').eq('tenant_id', 'tricopill').maybeSingle()
        const phones = (((ti as { notifications?: { sales_receipt_owner_phones?: string[] } } | null)?.notifications?.sales_receipt_owner_phones) ?? []).filter(Boolean)
        const dm = `⚠️ *Feedback baixo — clínica*\n${nomeCliente || 'Cliente'} avaliou o atendimento com nota *${score}*.${comment ? `\n💬 "${comment.slice(0, 200)}"` : ''}\n\nVale um contato pra entender e reverter.`
        for (const p of phones) await sendWapiDirectText(admin, 'tricopill', p, dm)
      } catch { /* best-effort */ }
    }
    const firstName = nomeCliente.split(/\s+/)[0] || ''
    return json({
      ok: true, action: 'feedback', leadId: fbLeadId, score, comment: comment ?? null,
      thankYou: score !== null ? thankYouFor(score, firstName) : 'Obrigada pelo seu retorno! 🙏',
    })
  }

  const text = String(body.text ?? body.message ?? '').trim()
  const replyOnly = String(body.reply ?? '').trim()
  const inboundMedia = extractManychatMedia(body)

  // Diagnóstico: ManyChat ocasionalmente entrega anexos em campos novos que o
  // detector não conhece. Quando o body tem pista de mídia (URL https no text ou
  // chaves `attachments*`/`media`) e o extractor não pegou nada, logamos o payload
  // bruto truncado pra ajustar `manychatMedia.ts` sem precisar repetir o caso.
  if (bodyHasUnDetectedMediaHints(body, inboundMedia)) {
    console.warn(
      '[manychat-webhook] possible media not detected — raw payload sample:',
      JSON.stringify(body).slice(0, 1500),
    )
  }

  // Aceitamos uma mensagem só com mídia (paciente envia foto/áudio sem caption).
  if (!text && inboundMedia.length === 0 && !(action === 'record_outbound' && replyOnly)) {
    return json({ error: 'missing_text' }, 400)
  }

  const contextAppend = String(body.context_append ?? body.user_context ?? '').trim()
  // Dá contexto à IA: além do texto e do `context_append`, lista os tipos/URLs de mídia
  // que vieram, para que o modelo saiba que o paciente mandou um anexo.
  const mediaContextLine =
    inboundMedia.length > 0
      ? '[Anexos recebidos: ' +
        inboundMedia
          .map((m) => `${m.type}${m.mimeType ? ` (${m.mimeType})` : ''}${m.url ? ` ${m.url}` : ''}`)
          .join(' | ') +
        ']'
      : ''
  const aiInboundUserText = [text, contextAppend, mediaContextLine]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n---\n')

  const rawUserName = String(body.user_name ?? body.name ?? '').trim()
  const phoneOpt = String(body.phone ?? '').trim() || undefined

  const instanceKeyRaw = sanitizeCrmInstanceKey(body.crm_instance_key ?? body.whatsapp_instance_id)
  let whatsappLineInstanceId: string | null = null
  if (instanceKeyRaw) {
    whatsappLineInstanceId = await resolveWhatsappLineInstanceId(admin, instanceKeyRaw)
  }

  const phoneDigitsBody = digitsOnly(String(phoneOpt ?? ''))
  const effectiveChannel = resolveEffectiveManychatChannel(body, whatsappLineInstanceId, phoneDigitsBody)
  const userName = rawUserName || (effectiveChannel === 'instagram' ? 'Lead Instagram' : 'Lead WhatsApp')
  const attribution = attributionFromManychatBody(body, effectiveChannel)

  if (action === 'ingest') {
    try {
      const leadId = await ensureManychatLeadId(admin, {
        subscriberId,
        userName,
        text,
        phone: phoneOpt,
        channel: effectiveChannel,
        tenantId,
        attribution,
      })
      const ingestContent = contentForInboundWithMedia(text, inboundMedia)
      const ingestInteractionId = await insertInteraction(admin, {
        leadId,
        patientName: userName,
        channel: effectiveChannel === 'whatsapp' ? 'whatsapp' : 'meta',
        direction: 'in',
        author: userName,
        content: ingestContent,
        happenedAt: nowIso(),
      })
      const ingestMediaPersist = await persistManychatMedia(admin, {
        leadId,
        interactionId: ingestInteractionId,
        media: inboundMedia,
        tenantId,
      })
      if (ingestMediaPersist.rowIds.length > 0) {
        try {
          await enrichManychatMediaRows(admin, { rowIds: ingestMediaPersist.rowIds })
        } catch (e) {
          console.warn('[manychat-webhook] media enrich failed (ingest):', e instanceof Error ? e.message : String(e))
        }
      }
      return json({
        ok: true,
        leadId,
        status: 'ingested',
        reply: '',
        handoff_suggested: false,
        routing: 'ingest_only',
        media_count: inboundMedia.length,
        media_persist: ingestMediaPersist,
      })
    } catch (e) {
      return json(
        { error: 'ingest_failed', message: e instanceof Error ? e.message : String(e) },
        500,
      )
    }
  }

  if (action === 'record_outbound') {
    const leadId = leadIdParam || (await findLeadIdByManychatSubscriberId(admin, subscriberId))
    if (!leadId) {
      return json(
        {
          error: 'lead_not_found',
          message: 'Não existe lead para este subscriber_id. Chame antes action ingest (ou merge_phone).',
        },
        400,
      )
    }
    const rawOutbound = String(body.reply ?? body.text ?? '').trim()
    if (!rawOutbound) return json({ error: 'missing_text' }, 400)
    const { clean: outboundText, handoffSuggested } = stripManychatHandoffMarker(rawOutbound)
    const author = String(body.author ?? 'Assistente IA').trim() || 'Assistente IA'
    try {
      await insertInteraction(admin, {
        leadId,
        patientName: userName,
        channel: effectiveChannel === 'whatsapp' ? 'whatsapp' : 'meta',
        direction: 'out',
        author,
        content: outboundText || rawOutbound,
        happenedAt: nowIso(),
      })

      // Painel "Atendimento Pendente": a Sofia roda no ManyChat (IA do CRM off), então é
      // AQUI, no espelho do outbound, que o handoff para a Dandara entra no CRM. Detecta
      // pelo marcador [PRONTO_PARA_CONSULTOR] (handoffSuggested) e, como rede, pelo texto
      // de apresentação da Dandara. Marca o lead como `waiting_human` pra acender o painel
      // e só notifica a equipe quando há transição real (evita spam a cada mensagem).
      try {
        const isAiAuthor = author === 'Assistente IA' || /assistente|sofia/i.test(author)
        const isHandoff = handoffSuggested || (isAiAuthor && looksLikeDandaraHandoff(outboundText || rawOutbound))
        if (isHandoff) {
          const { data: updated } = await admin
            .from('leads')
            .update({ conversation_status: 'waiting_human', last_interaction_at: nowIso() })
            .eq('id', leadId)
            .not('conversation_status', 'in', '(waiting_human,human_active,lost,closed,archived)')
            .select('id')
          if (updated && updated.length > 0) {
            await notifyAgents(admin, {
              leadId,
              kind: 'handoff',
              title: 'Triagem finalizada — assumir',
              body: `${userName} foi encaminhado(a) para a Dandara e aguarda atendimento.`,
              includeOwner: true,
              tenantId,
              dedupeKey: 'handoff_waiting',
              dedupeWindowMinutes: 30,
            })
          }
        }
      } catch (e) {
        console.warn('[manychat-webhook] record_outbound handoff status update failed:', e instanceof Error ? e.message : String(e))
      }

      return json({
        ok: true,
        leadId,
        status: 'outbound_recorded',
        handoff_suggested: handoffSuggested,
        routing: 'record_outbound',
      })
    } catch (e) {
      return json(
        { error: 'record_outbound_failed', message: e instanceof Error ? e.message : String(e) },
        500,
      )
    }
  }

  const externalMessageId = String(body.external_message_id ?? body.message_id ?? '').trim() ||
    `mc-${subscriberId}-${crypto.randomUUID()}`

  const dedupKey = `manychat:${subscriberId}:${externalMessageId}`
  const { data: existing } = await admin
    .from('webhook_jobs')
    .select('id')
    .eq('source', 'manychat-webhook')
    .eq('note', dedupKey)
    .maybeSingle()
  if (existing?.id) {
    return json({
      ok: true,
      status: 'already_processed',
      reply: '',
      handoff_suggested: false,
      routing: 'dedupe_hit',
      hint:
        'Este external_message_id já foi processado uma vez — a IA não volta a correr. Usa um id único por mensagem (ex. {{message.id}} ou timestamp) ou outro external_message_id para testar de novo. O Supabase não chama a API do ManyChat: no fluxo ManyChat, depois do External Request, tens de ter um passo (Send Message / Flow) que envie o campo reply ao cliente.',
    })
  }

  const { data: jobRow, error: jobInsertError } = await admin
    .from('webhook_jobs')
    .insert({
      source: 'manychat-webhook',
      status: 'processing',
      note: dedupKey,
    })
    .select('id')
    .single()
  if (jobInsertError) return json({ error: jobInsertError.message }, 400)

  const skipManychatPush =
    body.manychat_skip_push === true ||
    String(body.manychat_skip_push ?? '').trim().toLowerCase() === 'true'
  const forceManychatPush =
    body.manychat_force_push === true ||
    String(body.manychat_force_push ?? '').trim().toLowerCase() === 'true'
  const useAsyncPipeline = await isManychatAsyncAck(admin, tenantId, body, effectiveChannel)

  const pipelineCtx: ManychatPipelineCtx = {
    jobRowId: String(jobRow.id),
    dedupKey,
    subscriberId,
    userName,
    text,
    phoneOpt,
    aiInboundUserText,
    skipManychatPush,
    isAsyncPipeline: useAsyncPipeline,
    forceManychatPush,
    channel: effectiveChannel,
    whatsappLineInstanceId,
    inboundMedia,
    tenantId,
    attribution,
  }

  if (useAsyncPipeline) {
    scheduleEdgeBackground(
      runManychatMessagePipeline(admin, pipelineCtx).catch((err) => {
        console.error('crm-manychat-webhook async pipeline:', err)
      }),
    )
    return json({
      ok: true,
      accepted: true,
      routing: 'queued',
      external_message_id: externalMessageId,
      subscriber_id: subscriberId,
      reply: '',
      handoff_suggested: false,
      manychat_push: { attempted: false, skipped_reason: 'async_pending' },
      hint:
        'Modo fila: IA + envio DM via API ManyChat em segundo plano (evita timeout ~10s). Este JSON não inclui reply. Exige MANYCHAT_API_KEY e field/flow válidos para o canal (WhatsApp reusa por omissão MANYCHAT_DM_*). Sem push configurado o CRM responde sincronamente com reply; use manychat_sync: true ou não force manychat_async.',
    })
  }

  try {
    const r = await runManychatMessagePipeline(admin, pipelineCtx)
    return json({
      ok: true,
      leadId: r.leadId,
      reply: r.reply,
      handoff_suggested: r.handoff_suggested,
      routing: r.routing,
      manychat_push: r.manychat_push,
      ...(r.media_persist ? { media_persist: r.media_persist } : {}),
      ...(r.routing === 'manual_handoff'
        ? { ai_skip_reasons: r.ai_skip_reasons ?? [], hint: r.hint ?? null }
        : {}),
    })
  } catch (e) {
    return json({ error: 'processing_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
