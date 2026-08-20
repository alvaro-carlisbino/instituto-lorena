import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { createWapiProviderForRow, loadWhatsappInstanceByWapiId } from '../_shared/whatsapp/wapiConfig.ts'
import type { WapiProvider } from '../_shared/whatsapp/wapi.ts'
import { pausarLinha, registrarSaudeDaLinha } from '../_shared/whatsapp/antiBan.ts'
import { sendWapiDirectText } from '../_shared/saleReceipt.ts'

/**
 * Webhook de EVENTOS da W-API: conectou, desconectou, status de mensagem, entrega.
 *
 * Separado de `crm-wapi-webhook` (que trata conversa) porque o assunto é outro: aqui não há
 * paciente nenhum, há a sessão. É este gancho que percebe o número cair — e cair sem ninguém
 * ver é como uma linha não-oficial morre em silêncio: o CRM segue devolvendo 200, a tela segue
 * verde, e as mensagens ficam paradas na fila do provedor.
 *
 * Quando a sessão cai, três coisas acontecem, nesta ordem:
 *   1. CONFIRMAMOS com a própria W-API (o evento chega sem assinatura; acreditar nele às cegas
 *      deixaria qualquer um que soubesse o instanceId parar a linha da clínica);
 *   2. a linha é PAUSADA na guarda — nada de proativo sai enquanto o número não voltar;
 *   3. o dono recebe um aviso pela OUTRA linha, que é a única que ainda funciona.
 *
 * Registar no painel da W-API (ou usar o botão "Apontar webhooks" em /whatsapp):
 *   https://<project>.supabase.co/functions/v1/crm-wapi-events
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** Minutos de pausa quando a sessão cai. Volta sozinho quando o evento "conectou" chegar. */
const PAUSA_QUEDA_MIN = 6 * 60

function extractInstanceId(payload: Record<string, unknown>): string {
  const cands = [
    payload.instanceid,
    payload.instanceId,
    payload.instance_id,
    (payload.data as Record<string, unknown> | undefined)?.instanceId,
    (payload.instance as Record<string, unknown> | undefined)?.id,
  ]
  for (const c of cands) if (typeof c === 'string' && c.trim()) return c.trim()
  return ''
}

/** Aviso ao dono pela linha do OUTRO polo — a linha caída não consegue avisar que caiu. */
async function avisarDono(admin: SupabaseClient, tenantAfetado: string, texto: string): Promise<void> {
  try {
    const tenantMensageiro = tenantAfetado === 'tricopill' ? 'instituto-lorena' : 'tricopill'
    const { data } = await admin
      .from('tenant_integrations')
      .select('notifications')
      .eq('tenant_id', tenantAfetado)
      .maybeSingle()
    const cfg = ((data as { notifications?: { sales_receipt_owner_phones?: string[]; owner_dm_kinds?: string[] } } | null)?.notifications) ?? {}
    // Linha fora do ar é `sistema_parado`: se o polo filtrou os assuntos e não pediu este,
    // respeitamos o silêncio — mas o alerta in-app continua saindo em quem chama.
    const permitidos = Array.isArray(cfg.owner_dm_kinds) ? cfg.owner_dm_kinds : null
    if (permitidos && !permitidos.includes('sistema_parado')) return
    const phones = (cfg.sales_receipt_owner_phones ?? []).filter(Boolean)
    for (const p of phones) {
      // Pela linha do OUTRO polo: a caída não consegue avisar que caiu.
      const ok = await sendWapiDirectText(admin, tenantMensageiro, String(p), texto)
      if (!ok) await sendWapiDirectText(admin, tenantAfetado, String(p), texto)
    }
  } catch (e) {
    console.warn('[wapi-events] aviso ao dono falhou:', e instanceof Error ? e.message : String(e))
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const rawBody = await req.text()
  let payload: Record<string, unknown>
  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const wapiInstanceId = extractInstanceId(payload)
  if (!wapiInstanceId) return json({ ok: true, skipped: 'no_instance_id' }, 202)

  const row = await loadWhatsappInstanceByWapiId(admin, wapiInstanceId)
  if (!row) return json({ ok: true, skipped: 'instance_not_registered' }, 202)

  // Segredo, quando a linha tiver um configurado. Sem ele seguimos em frente: este webhook
  // não grava conversa nem responde a ninguém, e a decisão que importa (parar a linha) é
  // sempre confirmada na API antes de valer.
  if (row.wapi_webhook_secret) {
    const header = req.headers.get('x-webhook-secret')?.trim() ?? ''
    if (header !== row.wapi_webhook_secret.trim()) return json({ error: 'unauthorized' }, 401)
  }

  const tenantId = row.tenant_id ? String(row.tenant_id) : 'instituto-lorena'
  const evento = String(payload.event ?? payload.type ?? '').toLowerCase()
  const provider = createWapiProviderForRow(row) as WapiProvider

  try {
    // ── Sessão conectou ────────────────────────────────────────────────────────
    if (/connect/.test(evento) && !/disconnect/.test(evento)) {
      await registrarSaudeDaLinha(admin, row.id, {
        tenantId,
        status: 'connected',
        connected: true,
        event: evento,
        detail: payload,
      })
      // Volta do freio de mão só se quem pausou foi a queda — pausa manual continua de pé.
      const { data: pol } = await admin
        .from('whatsapp_line_policy')
        .select('pausado_ate, pausa_motivo')
        .eq('instance_id', row.id)
        .maybeSingle()
      const motivo = String((pol as { pausa_motivo?: string } | null)?.pausa_motivo ?? '')
      if (motivo.startsWith('sessao_caiu')) {
        await admin
          .from('whatsapp_line_policy')
          .update({ pausado_ate: null, pausa_motivo: null, updated_at: new Date().toISOString() })
          .eq('instance_id', row.id)
      }
      return json({ ok: true, event: evento, instance: row.id, status: 'connected' })
    }

    // ── Sessão caiu ────────────────────────────────────────────────────────────
    if (/disconnect|logout|banned|banido/.test(evento)) {
      // Confirma na fonte antes de parar a operação. Evento é palpite; API é resposta.
      const st = await provider.instanceStatus()
      if (st.connected === true) {
        await registrarSaudeDaLinha(admin, row.id, {
          tenantId,
          status: 'connected',
          connected: true,
          event: `${evento}_desmentido_pela_api`,
          detail: { payload, status: st.status },
        })
        return json({ ok: true, event: evento, instance: row.id, status: 'connected', note: 'evento_desmentido' })
      }

      const banido = /ban/.test(evento) || /ban/.test(String(st.status))
      await registrarSaudeDaLinha(admin, row.id, {
        tenantId,
        status: banido ? 'banned' : 'disconnected',
        connected: false,
        event: evento,
        detail: { payload, status: st.status },
      })
      await pausarLinha(
        admin,
        row.id,
        banido ? 60 * 24 * 7 : PAUSA_QUEDA_MIN,
        `sessao_caiu: ${evento || 'disconnected'}`,
        tenantId,
      )
      await avisarDono(
        admin,
        tenantId,
        banido
          ? `🚨 A linha *${row.id}* (${tenantId}) foi marcada como BANIDA no WhatsApp. Nenhuma mensagem sai por ela. Não tente reconectar às pressas: confirme no painel da W-API primeiro.`
          : `⚠️ A linha *${row.id}* (${tenantId}) DESCONECTOU do WhatsApp. Envio automático está pausado. Reconecte pelo QR em /whatsapp; quando voltar, o envio volta sozinho.`,
      )
      return json({ ok: true, event: evento, instance: row.id, status: banido ? 'banned' : 'disconnected', paused: true })
    }

    // ── Status de mensagem / entrega ───────────────────────────────────────────
    // Uma falha isolada é rotina (número errado, aparelho desligado). O que interessa é a
    // SEQUÊNCIA: muita falha na mesma hora costuma ser o primeiro sintoma de linha marcada.
    if (/status|delivery|ack/.test(evento)) {
      const status = String(
        payload.status ?? (payload.data as Record<string, unknown> | undefined)?.status ?? '',
      ).toLowerCase()
      const falhou = /fail|error|erro|undeliver|reject/.test(status)
      if (!falhou) return json({ ok: true, event: evento, status, counted: false })

      const { data: h } = await admin
        .from('whatsapp_line_health')
        .select('fails_1h, last_event_at')
        .eq('instance_id', row.id)
        .maybeSingle()
      const anterior = (h as { fails_1h?: number; last_event_at?: string } | null) ?? null
      const dentroDaHora =
        anterior?.last_event_at && Date.now() - new Date(anterior.last_event_at).getTime() < 3_600_000
      const fails = (dentroDaHora ? Number(anterior?.fails_1h ?? 0) : 0) + 1

      await admin.from('whatsapp_line_health').upsert(
        {
          instance_id: row.id,
          tenant_id: tenantId,
          fails_1h: fails,
          last_event: `msg_status:${status}`,
          last_event_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'instance_id' },
      )

      if (fails >= 10) {
        await pausarLinha(admin, row.id, 60, `sessao_caiu: ${fails} falhas de entrega na última hora`, tenantId)
        await avisarDono(
          admin,
          tenantId,
          `⚠️ A linha *${row.id}* acumulou ${fails} falhas de entrega na última hora. Envio automático pausado por 1h por precaução — vale conferir a sessão em /whatsapp.`,
        )
        return json({ ok: true, event: evento, status, fails, paused: true })
      }
      return json({ ok: true, event: evento, status, fails })
    }

    return json({ ok: true, event: evento || 'desconhecido', skipped: 'evento_sem_tratamento' }, 202)
  } catch (e) {
    console.warn('[wapi-events] falhou:', e instanceof Error ? e.message : String(e))
    return json({ ok: false, error: 'processing_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
