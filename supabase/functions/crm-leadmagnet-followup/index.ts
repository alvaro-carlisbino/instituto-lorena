import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { sendLeadMagnetFollowupEmail } from '../_shared/tricopillEmails.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Follow-up do LEAD MAGNET (popup "primeira compra" do site). Quem pegou o cupom
// CLUBE10 no popup e deixou e-mail mas NÃO comprou recebe UM lembrete por e-mail.
// Só e-mail (Resend) — nunca WhatsApp aqui: volume alto no zap não-oficial = ban.
//
// Fonte: storefront_events type='lead_capture' (meta.email/phone), gravado pela
//   rota /api/capture do site. Dedup e "já comprou" sem tabela nova:
//   • marcador: insere storefront_events type='lead_capture_followup' (session_id
//     = id do capture) → não reenvia pro mesmo capture.
//   • comprou?: rede_payments/asaas_payments status='paid' com o mesmo telefone.
//
// Janela: captures entre 24h e 7 dias atrás (deixa o cliente respirar 1 dia; some
//   depois de 1 semana pra não parecer perseguição).
//
// SEGURANÇA:
//   • Dry-run por padrão. Envia de verdade só com LEADMAGNET_FOLLOWUP_ENABLED='true'.
//   • Cap diário (default 60 e-mails/execução).
//   • x-cron-secret opcional (LEADMAGNET_CRON_SECRET). verify_jwt=false no config.
//
// Env:
//   LEADMAGNET_FOLLOWUP_ENABLED  'true' liga o envio real (default: dry-run)
//   LEADMAGNET_DAILY_CAP         máx e-mails por execução (default 60)
//   LEADMAGNET_CRON_SECRET       (opcional) casa com header x-cron-secret
//   LEADMAGNET_TENANT            (default 'tricopill')
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ENABLED = (Deno.env.get('LEADMAGNET_FOLLOWUP_ENABLED') ?? '').trim().toLowerCase() === 'true'
const TENANT = (Deno.env.get('LEADMAGNET_TENANT') ?? 'tricopill').trim()
const DAILY_CAP = Math.max(1, parseInt(Deno.env.get('LEADMAGNET_DAILY_CAP') ?? '60', 10) || 60)
const HOUR = 3600_000
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const firstName = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || ''
const last8 = (s: unknown) => digits(s).slice(-8)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const wantSecret = (Deno.env.get('LEADMAGNET_CRON_SECRET') ?? '').trim()
  if (wantSecret) {
    const got = (req.headers.get('x-cron-secret') ?? '').trim()
    if (got !== wantSecret) return json({ error: 'forbidden' }, 403)
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !sr) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, sr)

  const now = Date.now()
  const fromIso = new Date(now - 7 * 24 * HOUR).toISOString() // até 7 dias atrás
  const untilIso = new Date(now - 24 * HOUR).toISOString()    // deixou 1 dia respirar

  // 1) Capturas do popup na janela, com e-mail.
  const { data: caps, error: capErr } = await admin
    .from('storefront_events')
    .select('id, session_id, meta, created_at')
    .eq('tenant_id', TENANT)
    .eq('type', 'lead_capture')
    .gte('created_at', fromIso)
    .lte('created_at', untilIso)
    .order('created_at', { ascending: true })
    .limit(1000)
  if (capErr) return json({ error: 'query_failed', detail: capErr.message }, 500)

  const captures = (caps ?? [])
    .map((c) => {
      const meta = (c.meta ?? {}) as Record<string, unknown>
      return { id: String(c.id), email: String(meta.email ?? '').trim().toLowerCase(), phone: digits(meta.phone) }
    })
    .filter((c) => c.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email))

  if (captures.length === 0) return json({ ok: true, considered: 0, sent: 0, dryRun: !ENABLED })

  // 2) Já enviamos follow-up? (marcadores, por session_id = id do capture)
  const capIds = captures.map((c) => c.id)
  const { data: marks } = await admin
    .from('storefront_events')
    .select('session_id')
    .eq('tenant_id', TENANT)
    .eq('type', 'lead_capture_followup')
    .in('session_id', capIds)
  const alreadySent = new Set((marks ?? []).map((m) => String(m.session_id)))

  // 3) Telefones que já compraram (paid) — não incomodar quem virou cliente.
  const phones = [...new Set(captures.map((c) => c.phone).filter(Boolean))]
  const paidLast8 = new Set<string>()
  if (phones.length) {
    for (const table of ['rede_payments', 'asaas_payments']) {
      const { data: pays } = await admin
        .from(table)
        .select('phone, status')
        .eq('tenant_id', TENANT)
        .eq('status', 'paid')
        .limit(5000)
      for (const p of (pays ?? []) as Array<Record<string, unknown>>) {
        const l8 = last8(p.phone)
        if (l8) paidLast8.add(l8)
      }
    }
  }

  // Dedup por e-mail também (o mesmo e-mail pode ter 2 capturas na semana).
  const seenEmail = new Set<string>()
  let sent = 0
  let skippedBought = 0
  let skippedDup = 0
  const errors: string[] = []

  for (const c of captures) {
    if (sent >= DAILY_CAP) break
    if (alreadySent.has(c.id)) { skippedDup++; continue }
    if (seenEmail.has(c.email)) { skippedDup++; continue }
    if (c.phone && paidLast8.has(last8(c.phone))) { skippedBought++; continue }
    seenEmail.add(c.email)

    // Marca ANTES de enviar (idempotência: pior caso é não enviar, nunca enviar 2x).
    await admin.from('storefront_events').insert({
      tenant_id: TENANT,
      type: 'lead_capture_followup',
      session_id: c.id,
      path: '/cron/leadmagnet-followup',
      meta: { email: c.email, dryRun: !ENABLED },
    })

    if (!ENABLED) { sent++; continue } // dry-run: conta como "enviaria"

    const res = await sendLeadMagnetFollowupEmail({
      to: c.email,
      firstName: firstName((c as unknown as { name?: string }).name),
      couponCode: 'CLUBE10',
      couponPct: 10,
    })
    if (res.ok) sent++
    else errors.push(`${c.email}: ${res.error}`)
    // Espaça um tico pra não estourar rate limit do Resend.
    await new Promise((r) => setTimeout(r, 250))
  }

  return json({
    ok: true,
    dryRun: !ENABLED,
    considered: captures.length,
    sent,
    skippedBought,
    skippedDup,
    errors: errors.slice(0, 10),
  })
})
