import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { sendCartRecoveryEmail } from '../_shared/tricopillEmails.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Carrinho abandonado — recupera links de pagamento (rede_payments) que ficaram
// PENDENTES: o cliente pediu o link/Pix e não pagou. Manda 1–2 nudges pelo WhatsApp
// (via crm-send-message, que resolve telefone/canal e respeita opt-out), com o link
// que VOLTOU a funcionar (checkout e.Rede). É o dinheiro mais barato: cliente já decidiu.
//
// Cadência (por lead, no link pendente MAIS RECENTE):
//   step 1 — link com ≥ 2h e < 72h sem pagar → nudge gentil ("deu algum problema?")
//   step 2 — ≥ 24h e ≥ 20h após o step 1     → nudge final (+ convite a desconto, se houver)
// Para no step 2. Pula quem JÁ pagou qualquer link, quem não tem lead/telefone e opt-out
// (o crm-send-message recusa opt-out sozinho).
//
// SEGURANÇA: só dispara de verdade com CART_RECOVERY_ENABLED='true'. Sem isso roda em
// DRY-RUN (lista quem RECEBERIA, não envia) — pra revisar antes de mandar pra cliente real.
//
// Env:
//   CART_RECOVERY_ENABLED   'true' liga o envio real (default: dry-run)
//   APP_BASE_URL            base do link de pagamento (default vercel)
//   RECOVERY_COUPON_CODE    (opcional) se setado, o step 2 convida o cliente a responder
//                           pra ganhar desconto (o cupom é aplicado por quem regerar o link)
//   RECOVERY_COUPON_PCT     (opcional) % citada no convite (default 5)
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') ?? 'https://instituto-lorena.vercel.app').trim().replace(/\/$/, '')
const ENABLED = (Deno.env.get('CART_RECOVERY_ENABLED') ?? '').trim().toLowerCase() === 'true'
const COUPON = (Deno.env.get('RECOVERY_COUPON_CODE') ?? '').trim()
const COUPON_PCT = (Deno.env.get('RECOVERY_COUPON_PCT') ?? '5').trim()

const firstName = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || 'tudo bem'

type Row = {
  id: string
  lead_id: string
  tenant_id: string
  amount_cents: number
  description: string | null
  customer_name: string | null
  created_at: string
  recovery_step: number | null
  recovery_sent_at: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, serviceRole)

  const now = Date.now()
  // 7 dias, não 72h: com 72h a recuperação passava fome. O site produz ~1 carrinho/dia, então
  // quando ela ligou (16/07) só UMA pessoa estava dentro da janela — a Sylmara, que comprou
  // R$618. Os outros 11 carrinhos já tinham 4-34 dias e nunca seriam tocados. O link e.Rede
  // continua válido, e a 7 dias a mensagem ainda faz sentido; passou disso, quem fala é o
  // reengajamento (que já pega 9 desses 11).
  const since = new Date(now - 7 * 24 * 3600 * 1000).toISOString()
  const until = new Date(now - 2 * 3600 * 1000).toISOString() // dá 2h de "respiro" antes do 1º nudge

  const { data: rowsRaw, error } = await admin
    .from('rede_payments')
    .select('id, lead_id, tenant_id, amount_cents, description, customer_name, created_at, recovery_step, recovery_sent_at')
    .eq('status', 'pending')
    .not('lead_id', 'is', null)
    .gte('created_at', since)
    .lte('created_at', until)
    .order('created_at', { ascending: false })
  if (error) return json({ error: 'query_failed', message: error.message }, 500)
  const rows = (rowsRaw ?? []) as Row[]

  // 1 link por lead = o pendente MAIS RECENTE (evita spam p/ quem gerou vários, ex.: Alecio).
  const seen = new Set<string>()
  const candidates: Row[] = []
  for (const r of rows) {
    if (seen.has(r.lead_id)) continue
    seen.add(r.lead_id)
    candidates.push(r)
  }

  // Exclui leads que JÁ pagaram qualquer link (não nudgear quem virou cliente).
  const leadIds = candidates.map((r) => r.lead_id)
  const paid = new Set<string>()
  if (leadIds.length) {
    const { data: paidRows } = await admin
      .from('rede_payments')
      .select('lead_id')
      .in('lead_id', leadIds)
      .eq('status', 'paid')
    for (const p of (paidRows ?? []) as Array<{ lead_id: string }>) paid.add(p.lead_id)
  }

  const results: Array<Record<string, unknown>> = []
  for (const r of candidates) {
    if (paid.has(r.lead_id)) continue
    const ageH = (now - new Date(r.created_at).getTime()) / 3600000
    const step = r.recovery_step ?? 0
    const lastSentH = r.recovery_sent_at ? (now - new Date(r.recovery_sent_at).getTime()) / 3600000 : Infinity

    let target = 0
    if (step === 0 && ageH >= 2) target = 1
    else if (step === 1 && ageH >= 24 && lastSentH >= 20) target = 2
    if (!target) continue

    const link = `${APP_BASE_URL}/pagar/${r.id}`
    const nome = firstName(r.customer_name)
    const desc = r.description ? ` (${r.description})` : ''
    let text: string
    if (target === 1) {
      text =
        `Oi, ${nome}! 😊 Vi aqui que você estava finalizando seu pedido${desc} mas o pagamento ainda não foi concluído. ` +
        `Deu algum problema? Tô por aqui pra te ajudar 💚\n\nSe quiser finalizar, é rapidinho por este link:\n${link}`
    } else {
      const cupom = COUPON ? `\n\nE pra te ajudar a fechar hoje, responde aqui que eu garanto um *desconto de ${COUPON_PCT}%* no seu pedido 💚` : ''
      text = `Oi, ${nome}! Ainda dá tempo de garantir seu pedido${desc} 💚 Seu link de pagamento continua ativo:\n${link}${cupom}`
    }

    if (!ENABLED) {
      results.push({ id: r.id, lead: r.lead_id, tenant: r.tenant_id, target, dryRun: true })
      continue
    }

    let sent = false
    let note = ''
    try {
      const res = await fetch(`${url}/functions/v1/crm-send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ leadId: r.lead_id, text, source: 'cart_recovery' }),
      })
      const b = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string }
      note = b?.message || b?.error || ''
      sent = res.ok && b?.ok !== false
      // opt-out é terminal: marca o passo p/ não tentar de novo num loop.
      if (!sent && /opt|parar de receber|opted/i.test(note)) sent = true
    } catch (e) {
      note = e instanceof Error ? e.message : String(e)
    }

    // E-MAIL em paralelo (Resend): backup do WhatsApp, custo zero e sem risco de ban.
    // O e-mail vem do cadastro do lead (o checkout do site sempre pede). Best-effort:
    // não muda o avanço de step (o dedupe continua sendo o do WhatsApp).
    let emailSent = false
    try {
      const { data: l } = await admin.from('leads').select('custom_fields').eq('id', r.lead_id).maybeSingle()
      const cf = ((l as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>
      const cad = (cf.cadastro ?? {}) as Record<string, unknown>
      const email = String(cf.email ?? cad.email ?? '').trim()
      if (email.includes('@')) {
        const out = await sendCartRecoveryEmail({
          to: email,
          firstName: nome,
          payLink: link,
          step: (target === 1 ? 1 : 2) as 1 | 2,
          couponCode: target === 2 && COUPON ? COUPON : undefined,
          couponPct: COUPON_PCT ? Number(COUPON_PCT) : undefined,
        })
        emailSent = out.ok
      }
    } catch { /* e-mail nunca derruba a recuperação */ }

    if (sent || emailSent) {
      await admin
        .from('rede_payments')
        .update({ recovery_step: target, recovery_sent_at: new Date().toISOString() })
        .eq('id', r.id)
    }
    results.push({ id: r.id, lead: r.lead_id, tenant: r.tenant_id, target, sent, emailSent, note: note.slice(0, 120) })
  }

  return json({ ok: true, enabled: ENABLED, candidates: candidates.length, processed: results.length, results })
})
