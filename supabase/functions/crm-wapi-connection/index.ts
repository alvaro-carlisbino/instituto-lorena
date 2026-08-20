import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { WapiProvider } from '../_shared/whatsapp/wapi.ts'
import { createWapiProviderForRow, loadWapiInstanceByRowId } from '../_shared/whatsapp/wapiConfig.ts'
import { despausarLinha, pausarLinha, registrarSaudeDaLinha } from '../_shared/whatsapp/antiBan.ts'

/**
 * Painel de conexão das linhas W-API: QR code, estado da sessão, webhooks e blindagens.
 *
 * Existe para que ligar um número novo não dependa de alguém copiar cinco URLs à mão no
 * painel da W-API. `configure_webhooks` aponta TODOS os ganchos de uma vez para as funções
 * certas — o de mensagem recebida para `crm-wapi-webhook` (que já existia) e os de sessão
 * para `crm-wapi-events` (que é o que percebe a linha caindo e trava o envio antes de
 * alguém notar).
 *
 * O que este ecrã NÃO faz: criar a instância. A instância nasce no painel da W-API (é lá que
 * mora o plano LITE), e aqui se registram as credenciais dela.
 */

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

function env(name: string): string {
  return (Deno.env.get(name) ?? '').trim()
}

type Action =
  | 'status'
  | 'qrcode'
  | 'pairing_code'
  | 'restart'
  | 'disconnect'
  | 'configure_webhooks'
  | 'apply_settings'
  | 'webhook_logs'
  | 'check_number'
  | 'pause'
  | 'resume'

function pick(obj: Record<string, unknown>, ...paths: string[]): string {
  for (const p of paths) {
    const parts = p.split('.')
    let cur: unknown = obj
    for (const part of parts) {
      if (!cur || typeof cur !== 'object') {
        cur = undefined
        break
      }
      cur = (cur as Record<string, unknown>)[part]
    }
    if (typeof cur === 'string' && cur.trim()) return cur.trim()
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = env('SUPABASE_URL')
  const anonKey = env('SUPABASE_ANON_KEY')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ ok: false, error: 'server_misconfigured', message: 'Faltam secrets de Supabase nesta função.' }, 500)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ ok: false, error: 'unauthorized' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  let body: { action?: Action; instanceId?: string; phone?: string; settings?: Record<string, unknown>; minutes?: number; reason?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const action = String(body.action ?? '').trim() as Action
  const rowId = String(body.instanceId ?? '').trim()
  if (!action) return json({ ok: false, error: 'missing_action' }, 400)
  if (!rowId) return json({ ok: false, error: 'missing_instance', message: 'Escolha a linha primeiro.' }, 400)

  // A linha tem de ser do polo de quem está a pedir. `whatsapp_channel_instances` já tem RLS
  // por tenant, então perguntamos com o token do UTILIZADOR: se ele não a vê, não mexe nela.
  const { data: visivel } = await userClient
    .from('whatsapp_channel_instances')
    .select('id, label, tenant_id, channel_provider')
    .eq('id', rowId)
    .maybeSingle()
  if (!visivel) {
    return json({ ok: false, error: 'forbidden', message: 'Esta linha não pertence ao seu polo.' }, 403)
  }
  const tenantId = String((visivel as { tenant_id?: string }).tenant_id ?? '') || null

  // Pausa/retoma não falam com a W-API: mexem só na guarda local.
  if (action === 'pause') {
    const minutos = Math.max(5, Math.min(60 * 24 * 7, Number(body.minutes ?? 120)))
    await pausarLinha(admin, rowId, minutos, String(body.reason ?? 'pausa manual pelo painel'), tenantId)
    return json({ ok: true, action, paused_minutes: minutos })
  }
  if (action === 'resume') {
    await despausarLinha(admin, rowId)
    return json({ ok: true, action })
  }

  const row = await loadWapiInstanceByRowId(admin, rowId)
  if (!row) {
    return json(
      {
        ok: false,
        error: 'not_wapi_line',
        message: 'Esta linha não é W-API ativa (ou está sem instanceId/token). Preencha as credenciais e ative-a.',
      },
      400,
    )
  }
  const provider = createWapiProviderForRow(row) as WapiProvider

  const functionsBase = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`
  const urlRecebidas = `${functionsBase}/crm-wapi-webhook`
  const urlEventos = `${functionsBase}/crm-wapi-events`

  try {
    switch (action) {
      case 'status': {
        const st = await provider.instanceStatus()
        const dados = await provider.call('/instance/fetch-instance', 'GET')
        const phone =
          pick(dados.data, 'phone', 'data.phone', 'connectedPhone', 'data.connectedPhone', 'owner', 'data.owner') || null
        await registrarSaudeDaLinha(admin, rowId, {
          tenantId,
          status: st.connected === true ? 'connected' : st.connected === false ? 'disconnected' : 'unknown',
          connected: st.connected,
          phone,
          event: 'status_check',
          detail: { status: st.status, fetched: dados.data },
        })
        return json({
          ok: st.ok,
          action,
          connected: st.connected,
          status: st.status,
          phone,
          wapi_instance_id: row.wapi_instance_id,
          data: st.data,
        })
      }

      case 'qrcode': {
        const res = await provider.call('/instance/qr-code', 'GET')
        const qr =
          pick(res.data, 'qrcode', 'qrCode', 'data.qrcode', 'data.qrCode', 'base64', 'data.base64', 'image', 'data.image')
        return json({
          ok: res.ok && Boolean(qr),
          action,
          qrCode: qr,
          message: qr
            ? 'Leia o código no WhatsApp do telemóvel: Aparelhos ligados → Ligar um aparelho.'
            : 'A W-API não devolveu QR. Se a sessão já estiver ligada não há código: confirme em "Ver estado".',
          data: res.data,
        })
      }

      case 'pairing_code': {
        const phone = String(body.phone ?? '').replace(/[^0-9]/g, '')
        if (phone.length < 12) {
          return json({ ok: false, error: 'invalid_phone', message: 'Informe o número com país e DDD (ex.: 5544...).' }, 400)
        }
        const res = await provider.call('/instance/pairing-code', 'GET', undefined, {
          phoneNumber: phone,
          phone,
        })
        const code = pick(res.data, 'code', 'pairingCode', 'data.code', 'data.pairingCode')
        return json({ ok: res.ok && Boolean(code), action, code, data: res.data })
      }

      case 'restart': {
        const res = await provider.call('/instance/restart', 'GET')
        return json({ ok: res.ok, action, data: res.data })
      }

      case 'disconnect': {
        const res = await provider.call('/instance/disconnect', 'GET')
        await registrarSaudeDaLinha(admin, rowId, {
          tenantId,
          status: 'disconnected',
          connected: false,
          event: 'disconnect_manual',
        })
        return json({ ok: res.ok, action, data: res.data })
      }

      case 'configure_webhooks': {
        // Um clique aponta os cinco ganchos. Mensagem recebida vai para o webhook que já
        // trata conversa; sessão e entrega vão para o de eventos, que é quem trava a linha.
        const alvos: Array<{ nome: string; path: string; url: string }> = [
          { nome: 'recebidas', path: '/webhook/update-webhook-received', url: urlRecebidas },
          { nome: 'conectou', path: '/webhook/update-webhook-connected', url: urlEventos },
          { nome: 'desconectou', path: '/webhook/update-webhook-disconnected', url: urlEventos },
          { nome: 'status_mensagem', path: '/webhook/update-webhook-message-status', url: urlEventos },
          { nome: 'entrega', path: '/webhook/update-webhook-delivery', url: urlEventos },
        ]
        const resultados: Array<{ nome: string; ok: boolean; status: number; detail?: string }> = []
        for (const alvo of alvos) {
          const res = await provider.call(alvo.path, 'PUT', { value: alvo.url })
          resultados.push({
            nome: alvo.nome,
            ok: res.ok,
            status: res.status,
            detail: res.ok ? undefined : res.raw.slice(0, 160),
          })
        }
        const todosOk = resultados.every((r) => r.ok)
        return json({
          ok: todosOk,
          action,
          urls: { recebidas: urlRecebidas, eventos: urlEventos },
          resultados,
          message: todosOk
            ? 'Webhooks apontados para o CRM. Mande uma mensagem para o número e ela tem de aparecer no chat.'
            : 'Alguns webhooks falharam. Veja o detalhe e, se preciso, cole as URLs à mão no painel da W-API.',
        })
      }

      case 'apply_settings': {
        // Blindagens da instância. Nenhuma é ligada sozinha: cada uma tem um preço
        // (ignorar grupos mata o registo do grupo de comprovantes; leitura automática
        // esconde o "não lido" de quem também usa o WhatsApp Web do número).
        const s = (body.settings ?? {}) as Record<string, unknown>
        const feitos: Array<{ nome: string; ok: boolean; detail?: string }> = []
        const aplicar = async (nome: string, path: string, payload: Record<string, unknown>) => {
          const res = await provider.call(path, 'PUT', payload)
          feitos.push({ nome, ok: res.ok, detail: res.ok ? undefined : res.raw.slice(0, 160) })
        }
        if (typeof s.rejeitarLigacoes === 'boolean') {
          await aplicar('rejeitar_ligacoes', '/instance/update-call-reject-auto', { value: s.rejeitarLigacoes })
        }
        if (typeof s.mensagemLigacao === 'string' && s.mensagemLigacao.trim()) {
          await aplicar('mensagem_ligacao', '/instance/update-call-reject-message', { value: String(s.mensagemLigacao).trim() })
        }
        if (typeof s.ignorarGrupos === 'boolean') {
          await aplicar('ignorar_grupos', '/instance/update-ignore-groups', { value: s.ignorarGrupos })
        }
        if (typeof s.leituraAutomatica === 'boolean') {
          await aplicar('leitura_automatica', '/instance/update-auto-read-message', { value: s.leituraAutomatica })
        }
        if (feitos.length === 0) {
          return json({ ok: false, error: 'nothing_to_apply', message: 'Nenhuma opção foi enviada.' }, 400)
        }
        return json({ ok: feitos.every((f) => f.ok), action, resultados: feitos })
      }

      case 'webhook_logs': {
        const res = await provider.call('/webhook/fetch-webhook-logs', 'GET')
        return json({ ok: res.ok, action, data: res.data })
      }

      case 'check_number': {
        const phone = String(body.phone ?? '').replace(/[^0-9]/g, '')
        if (phone.length < 10) return json({ ok: false, error: 'invalid_phone' }, 400)
        const existe = await provider.phoneExists(phone)
        return json({
          ok: true,
          action,
          phone,
          exists: existe,
          message:
            existe === true
              ? 'Número tem WhatsApp.'
              : existe === false
                ? 'Este número NÃO tem WhatsApp — enviar para ele é justamente o que queima a sessão.'
                : 'A W-API não respondeu se o número existe. Na dúvida, não envie.',
        })
      }

      default:
        return json({ ok: false, error: 'unknown_action', action }, 400)
    }
  } catch (e) {
    return json(
      { ok: false, error: 'wapi_call_failed', action, message: e instanceof Error ? e.message : String(e) },
      500,
    )
  }
})
