import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { resolveOutboundProviderForLead } from '../_shared/whatsapp/resolveProvider.ts'
import { WapiProvider } from '../_shared/whatsapp/wapi.ts'

/**
 * Ações sobre mensagens que JÁ existem na conversa: reagir, tirar a reação, apagar (no
 * WhatsApp, não só na nossa tela), editar e marcar como lida.
 *
 * Vive fora do `crm-send-message` de propósito: ali tudo é mensagem NOVA saindo, e passa
 * por opt-out, cota anti-ban, cooldown e teto horário. Reagir e apagar não são mensagem
 * nova — não gastam cota nem contam para o teto do dia. Misturar as duas coisas faria a
 * atendente perder envio do dia por ter posto um 👍 numa bolha.
 *
 * O que "apagar" quer dizer, e por que são duas coisas:
 *  • `scope: 'everyone'` — apaga NO WHATSAPP. Some do telemóvel da paciente. O WhatsApp só
 *    permite dentro de ~2 dias; passado isso a W-API recusa e nós dizemos porquê.
 *  • `scope: 'crm'`      — some só da nossa tela. É limpeza de histórico, não apagar.
 * Antes do dia 25/ago/2026 o botão dizia "Apagar" e fazia sempre a segunda: a equipe achava
 * que tinha desfeito um envio errado e a paciente continuava a ver a mensagem.
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

type Action = 'react' | 'unreact' | 'delete' | 'edit' | 'read'

/** Janela em que o WhatsApp aceita editar uma mensagem já enviada. */
const EDIT_WINDOW_MINUTES = 15

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !serviceRole || !anon) return json({ error: 'server_misconfigured' }, 500)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const admin = createClient(supabaseUrl, serviceRole)
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: authData, error: authErr } = await userClient.auth.getUser()
  if (authErr || !authData.user) return json({ error: 'unauthorized' }, 401)
  const autor = authData.user.email ?? authData.user.id

  let body: {
    action?: Action
    /** Id da linha em `interactions`. Preferido: é o que a tela tem em mãos. */
    interactionId?: string
    /** Alternativa: o id da mensagem na W-API (quando a interaction ainda não existe). */
    externalMessageId?: string
    leadId?: string
    emoji?: string
    text?: string
    scope?: 'crm' | 'everyone'
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = String(body.action ?? '').trim() as Action
  if (!['react', 'unreact', 'delete', 'edit', 'read'].includes(action)) {
    return json({ error: 'invalid_action', message: `Ação desconhecida: '${action}'.` }, 400)
  }

  const interactionId = String(body.interactionId ?? '').trim()
  let externalMessageId = String(body.externalMessageId ?? '').trim()
  let leadId = String(body.leadId ?? '').trim()
  let direction: 'in' | 'out' = 'out'
  let happenedAt = ''
  let conteudoAtual = ''

  if (interactionId) {
    const { data: inter } = await admin
      .from('interactions')
      .select('id, lead_id, external_message_id, direction, happened_at, content')
      .eq('id', interactionId)
      .maybeSingle()
    if (!inter) return json({ error: 'interaction_not_found' }, 404)
    leadId = String(inter.lead_id)
    externalMessageId = externalMessageId || String(inter.external_message_id ?? '')
    direction = inter.direction === 'in' ? 'in' : 'out'
    happenedAt = String(inter.happened_at ?? '')
    conteudoAtual = String(inter.content ?? '')
  }
  if (!leadId) return json({ error: 'missing_fields', message: 'Informe interactionId ou leadId.' }, 400)

  const { data: lead } = await admin
    .from('leads')
    .select('id, phone, whatsapp_instance_id, tenant_id')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return json({ error: 'lead_not_found' }, 404)
  const row = lead as { id: string; phone: string; whatsapp_instance_id: string | null; tenant_id: string }

  // ── Apagar só no CRM não fala com o WhatsApp ────────────────────────────────
  // Sai antes de resolver a linha: limpar o nosso histórico tem de funcionar mesmo com a
  // instância desconectada. Marcamos em vez de apagar a linha — o histórico deixa de mentir
  // por omissão, e a auditoria continua a ver que ali existiu uma mensagem.
  if (action === 'delete' && body.scope === 'crm') {
    if (!interactionId) return json({ error: 'missing_fields', message: 'interactionId obrigatório.' }, 400)
    const { error } = await admin
      .from('interactions')
      .update({ deleted_at: new Date().toISOString(), deleted_by: autor, deleted_scope: 'crm' })
      .eq('id', interactionId)
    if (error) return json({ error: 'delete_failed', message: error.message }, 500)
    return json({ ok: true, action, scope: 'crm' })
  }

  if (!externalMessageId) {
    return json(
      {
        error: 'no_external_id',
        message:
          'Esta mensagem não tem id do WhatsApp (foi registada só no CRM, ou veio de antes da integração). Dá para removê-la do histórico, mas não do telemóvel da pessoa.',
      },
      400,
    )
  }

  let provider
  try {
    ;({ provider } = await resolveOutboundProviderForLead(admin, {
      id: row.id,
      whatsapp_instance_id: row.whatsapp_instance_id,
      tenant_id: row.tenant_id,
    }))
  } catch (e) {
    return json({ error: 'provider_not_configured', message: e instanceof Error ? e.message : String(e) }, 500)
  }
  if (!(provider instanceof WapiProvider)) {
    return json(
      {
        error: 'action_not_supported',
        message: `A linha desta conversa (${provider.name}) não suporta reagir/apagar/editar por API.`,
      },
      400,
    )
  }

  const telefone = String(row.phone ?? '')

  try {
    if (action === 'read') {
      await provider.markRead(telefone, externalMessageId)
      return json({ ok: true, action })
    }

    if (action === 'react' || action === 'unreact') {
      const emoji = String(body.emoji ?? '').trim()
      if (action === 'react' && !emoji) {
        return json({ error: 'missing_fields', message: 'Escolha um emoji.' }, 400)
      }
      const ok =
        action === 'react'
          ? await provider.sendReaction(telefone, externalMessageId, emoji)
          : await provider.removeReaction(telefone, externalMessageId)
      if (!ok) {
        return json({ error: 'reaction_failed', message: 'A W-API recusou a reação.' }, 502)
      }
      if (action === 'react') {
        // Reagir de novo TROCA o emoji (índice único por mensagem+autor), como no telemóvel.
        await admin.from('crm_message_reactions').upsert(
          {
            tenant_id: row.tenant_id,
            lead_id: leadId,
            interaction_id: interactionId || null,
            external_message_id: externalMessageId,
            emoji,
            direction: 'out',
            author: autor,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'external_message_id,direction,author' },
        )
      } else {
        await admin
          .from('crm_message_reactions')
          .delete()
          .eq('external_message_id', externalMessageId)
          .eq('direction', 'out')
          .eq('author', autor)
      }
      return json({ ok: true, action, emoji: action === 'react' ? emoji : null })
    }

    if (action === 'edit') {
      const texto = String(body.text ?? '').trim()
      if (!texto) return json({ error: 'missing_fields', message: 'O texto não pode ficar vazio.' }, 400)
      if (direction === 'in') {
        return json({ error: 'cannot_edit_inbound', message: 'Só dá para editar o que nós enviámos.' }, 400)
      }
      // Avisa ANTES de chamar a API: fora da janela a W-API devolve um erro genérico e a
      // tela mostraria "falha ao editar" sem dizer que o problema é o relógio.
      if (happenedAt) {
        const idadeMin = (Date.now() - new Date(happenedAt).getTime()) / 60_000
        if (idadeMin > EDIT_WINDOW_MINUTES) {
          return json(
            {
              error: 'edit_window_expired',
              message: `O WhatsApp só deixa editar nos primeiros ${EDIT_WINDOW_MINUTES} minutos (esta tem ${Math.round(idadeMin)} min). Dá para apagar para todos e reenviar.`,
            },
            409,
          )
        }
      }
      const res = await provider.editMessage(telefone, externalMessageId, texto)
      if (!res.ok) {
        return json({ error: 'edit_failed', message: res.detail || 'A W-API recusou a edição.' }, 502)
      }
      if (interactionId) {
        await admin
          .from('interactions')
          .update({ content: texto, edited_at: new Date().toISOString() })
          .eq('id', interactionId)
      }
      return json({ ok: true, action, content: texto, previousContent: conteudoAtual })
    }

    // action === 'delete' com scope 'everyone'
    const res = await provider.deleteMessage(telefone, externalMessageId)
    if (!res.ok) {
      return json(
        {
          error: 'delete_failed',
          message:
            res.detail ||
            'A W-API recusou apagar. O WhatsApp só permite apagar para todos por um tempo limitado depois do envio.',
        },
        502,
      )
    }
    if (interactionId) {
      await admin
        .from('interactions')
        .update({ deleted_at: new Date().toISOString(), deleted_by: autor, deleted_scope: 'everyone' })
        .eq('id', interactionId)
    }
    return json({ ok: true, action, scope: 'everyone' })
  } catch (e) {
    return json({ error: 'action_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})
