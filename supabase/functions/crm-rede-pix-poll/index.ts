import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { checkRedePixStatus } from '../_shared/rede.ts'

// Poller dos PIX e.Rede pendentes: o PIX confirma de forma ASSÍNCRONA (cliente paga depois),
// então um cron chama esta função a cada poucos minutos pra consultar a e.Rede e finalizar
// (finalizeRedePaid) os que foram pagos. Idempotente: checkRedePixStatus só finaliza quem
// ainda está 'pending'. Também há o botão "Verificar" no painel (crm-rede-link check_pix).
//
// Auth: chamado pelo pg_cron com a anon key (verify_jwt aceita). NÃO fabrica pagamento — só
// finaliza o que a e.Rede confirmar como pago.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  // PIX pendentes ainda dentro da validade (a e.Rede expira o QR em ≤15 dias). Limita o lote
  // pra não estourar tempo/limite de requisições à e.Rede num tick.
  const cutoff = new Date(Date.now() - 15 * 24 * 3_600_000).toISOString()
  const { data, error } = await admin
    .from('rede_payments')
    .select('id')
    .eq('method', 'pix')
    .eq('status', 'pending')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return json({ ok: false, error: error.message }, 500)

  const ids = (data ?? []).map((r) => String((r as { id: unknown }).id))
  let paid = 0
  let failed = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const id of ids) {
    try {
      const out = await checkRedePixStatus(admin, id)
      if (out.status === 'paid') paid += 1
      else if (out.status === 'failed') failed += 1
    } catch (e) {
      errors.push({ id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // Quem chama é o pg_cron, que DESCARTA esta resposta. Enquanto os erros viviam só aqui, uma
  // credencial vencida ou a e.Rede fora do ar deixavam todo Pix pago preso em 'pending' sem
  // nenhum sinal — a rodada dizia "ok" para um cron que não lê. Agora fica rastro no banco.
  // Uma linha por rodada com falha, com a primeira causa: é o suficiente para achar o padrão
  // (`select * from webhook_jobs where source = 'crm-rede-pix-poll' order by created_at desc`).
  if (errors.length > 0) {
    const primeira = errors[0]!
    console.error('crm-rede-pix-poll erros', { checked: ids.length, errored: errors.length, primeira })
    await admin.from('webhook_jobs').insert({
      source: 'crm-rede-pix-poll',
      status: 'error',
      note: `pix_poll_falhou:${errors.length}/${ids.length}:${primeira.id}:${primeira.error}`.slice(0, 500),
    }).then(() => {}, () => {})
  }

  return json({ ok: true, checked: ids.length, paid, failed, errors })
})
