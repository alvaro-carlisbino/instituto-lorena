/**
 * crm-reship — religa o envio de leads PAGOS cujo envio foi pulado por endereço
 * incompleto (sem_numero / sem_cep / sem_rua / cep_nao_resolvido) e que depois
 * tiveram o endereço completado no painel (fora do fluxo de mensagem que dispara
 * o religamento automático). Resolve os "pagos órfãos" sem etiqueta.
 *
 * Reusa maybeReshipAfterAddressComplete (mesmo autoShipToCart do fechamento): ele
 * já checa se o último evento de envio foi um skip religável, se o endereço está
 * completo, se há pagamento pago, e é idempotente (não duplica etiqueta).
 *
 * Auth: chamada interna/manual — header `x-reship-secret` == env RESHIP_SECRET.
 * (verify_jwt=false no config.toml; a trava é o secret no handler.)
 *
 * Body: { "leadIds": ["lead-...", ...], "force"?: boolean }
 * `force: true` dispensa a exigência de skip retentável na timeline — pra leads pagos SEM
 * nenhum evento de ME (cartão do site, caso Roberta 14/07). As provas de envio existente
 * (rastreio no lead, carrinho já gerado, rastreio recente em lead irmão) continuam valendo.
 * Resposta: { ok, results: [{ leadId, lastShip }] } com o último evento de envio
 * de cada lead após a tentativa (pra confirmar se foi pro carrinho ou o motivo).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { reshipLead } from '../_shared/melhorEnvio.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reship-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  const secret = (Deno.env.get('RESHIP_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-reship-secret') ?? '').trim()
  if (!secret || provided !== secret) return json({ error: 'unauthorized' }, 401)

  let p: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    p = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const leadIds = Array.isArray(p.leadIds)
    ? (p.leadIds as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : []
  if (!leadIds.length) return json({ error: 'missing_leadIds' }, 400)
  const force = p.force === true

  const admin = createClient(supabaseUrl, serviceRole)
  const results: Array<{ leadId: string; lastShip: string | null }> = []
  for (const leadId of leadIds) {
    try {
      await reshipLead(admin, leadId, { force })
    } catch (e) {
      results.push({ leadId, lastShip: `erro: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }
    // Lê o último evento de envio pra reportar o desfecho (carrinho ok ou motivo do skip).
    const { data: last } = await admin
      .from('interactions')
      .select('content')
      .eq('lead_id', leadId)
      .in('author', ['Melhor Envio', 'Logística'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    results.push({ leadId, lastShip: (last as { content?: string } | null)?.content ?? null })
  }

  return json({ ok: true, results })
})
