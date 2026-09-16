import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { applyLeadName, firstNameOrEmpty } from '../_shared/leadName.ts'
import { sendCartRecoveryEmail } from '../_shared/tricopillEmails.ts'
import { buildCheckoutUrl } from '../_shared/tenantBrand.ts'

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
// O domínio do link vem de tenants.brand_config do polo dono da cobrança (não é env).
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

const ENABLED = (Deno.env.get('CART_RECOVERY_ENABLED') ?? '').trim().toLowerCase() === 'true'
const COUPON = (Deno.env.get('RECOVERY_COUPON_CODE') ?? '').trim()
const COUPON_PCT = (Deno.env.get('RECOVERY_COUPON_PCT') ?? '5').trim()



type Row = {
  id: string
  lead_id: string
  tenant_id: string
  method: string | null
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
    .select('id, lead_id, tenant_id, method, amount_cents, description, customer_name, created_at, recovery_step, recovery_sent_at')
    .eq('status', 'pending')
    // rede_payments guarda os dois polos. Sem este filtro entrava na fila cobrança da
    // clínica (sinal de consulta) com texto de carrinho do Tricopill.
    .eq('tenant_id', 'tricopill')
    .not('lead_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) return json({ error: 'query_failed', message: error.message }, 500)
  const rows = (rowsRaw ?? []) as Row[]

  // O passo e o último envio são da PESSOA, não da cobrança. Antes, o "mais recente" era escolhido
  // só entre as cobranças com mais de 2h, e cada cobrança nascia com passo 0: quem gerou três numa
  // conversa levava três lembretes, um a cada rodada, conforme cada uma completava 2h. Eloísa
  // (16/09/2026): Pix 11:47, Pix 12:29 e cartão 12:47, lembrete às 14:00, 14:30 e 15:00, cada
  // um com um link diferente.
  const passoDoLead = new Map<string, { step: number; lastSentMs: number }>()
  for (const r of rows) {
    const cur = passoDoLead.get(r.lead_id) ?? { step: 0, lastSentMs: 0 }
    cur.step = Math.max(cur.step, r.recovery_step ?? 0)
    if (r.recovery_sent_at) cur.lastSentMs = Math.max(cur.lastSentMs, new Date(r.recovery_sent_at).getTime())
    passoDoLead.set(r.lead_id, cur)
  }

  // 1 link por lead = o pendente MAIS RECENTE de todos (evita spam p/ quem gerou vários, ex.:
  // Alecio). Se o mais recente ainda não tem 2h, a conversa está viva: ninguém recebe lembrete.
  const seen = new Set<string>()
  const candidates: Row[] = []
  for (const r of rows) {
    if (seen.has(r.lead_id)) continue
    seen.add(r.lead_id)
    if (new Date(r.created_at).getTime() > new Date(until).getTime()) continue
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

  // Nome de QUEM CONVERSA, não o do titular da cobrança. O `customer_name` é o nome da nota e
  // do cartão, e pode ser de outra pessoa: em 15/09/2026 a cliente fechou no nome do marido e
  // levou "Oi, Fábio!" no WhatsApp dela. O titular só entra quando o card não tem nome de gente.
  const nomeDoCard = new Map<string, string>()
  if (leadIds.length) {
    const { data: leadRows } = await admin.from('leads').select('id, patient_name').in('id', leadIds)
    for (const l of (leadRows ?? []) as Array<{ id: string; patient_name: string | null }>) {
      if (firstNameOrEmpty(l.patient_name)) nomeDoCard.set(l.id, String(l.patient_name))
    }
  }

  const results: Array<Record<string, unknown>> = []
  for (const r of candidates) {
    if (paid.has(r.lead_id)) continue
    const ageH = (now - new Date(r.created_at).getTime()) / 3600000
    const doLead = passoDoLead.get(r.lead_id) ?? { step: 0, lastSentMs: 0 }
    const step = doLead.step
    const lastSentH = doLead.lastSentMs ? (now - doLead.lastSentMs) / 3600000 : Infinity

    let target = 0
    if (step === 0 && ageH >= 2) target = 1
    else if (step === 1 && ageH >= 24 && lastSentH >= 20) target = 2
    if (!target) continue

    // Cliente ESPERANDO resposta nossa não recebe lembrete de carrinho. A última mensagem dela
    // é uma pergunta sem resposta, e "deu algum problema?" por cima disso é robô atropelando a
    // conversa: em 15/09/2026 a cliente escreveu "acho que não foi somado o gel" e 28 min depois
    // levou o lembrete com o mesmo link errado. Não avança o passo: quando alguém responder, o
    // lembrete volta a valer na rodada seguinte, se ela ainda não tiver pago.
    const { data: ultima } = await admin
      .from('interactions')
      .select('direction')
      .eq('lead_id', r.lead_id)
      .in('direction', ['in', 'out'])
      .order('happened_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if ((ultima as { direction?: string } | null)?.direction === 'in') {
      results.push({ id: r.id, lead: r.lead_id, tenant: r.tenant_id, target, skipped: 'cliente_aguardando_resposta' })
      continue
    }

    // Link no domínio do polo DONO da cobrança (era env global, sempre o da clínica).
    // Polo sem domínio configurado: pula a linha em vez de recuperar carrinho com a marca errada.
    let link: string
    try {
      link = await buildCheckoutUrl(admin, r.tenant_id, r.id)
    } catch (e) {
      results.push({ id: r.id, lead: r.lead_id, tenant: r.tenant_id, skipped: e instanceof Error ? e.message : String(e) })
      continue
    }
    const nome = nomeDoCard.get(r.lead_id) ?? String(r.customer_name ?? '')
    const desc = r.description ? ` (${r.description})` : ''
    let text: string
    // O nome entra por {nome} (e não por interpolação) pra que `applyLeadName` possa APAGAR
    // o vocativo quando o lead não tem nome de gente — senão sai "Oi, Contato!".
    // Pix da e.Rede vale 24h. Link de Pix vencido abre uma tela que só manda pedir outro, então
    // depois de ~23h o lembrete não leva link: convida a responder, e a IA gera um Pix novo.
    const pixVencido = r.method === 'pix' && ageH >= 23
    if (pixVencido) {
      text = applyLeadName(
        `Oi, {nome}! 😊 Vi aqui que o seu pedido${desc} ficou sem pagar e o Pix que te mandei já venceu. ` +
          `Se ainda quiser, é só responder aqui que eu gero um Pix novo na hora 💚`,
        nome,
      )
    } else if (target === 1) {
      text = applyLeadName(
        `Oi, {nome}! 😊 Vi aqui que você estava finalizando seu pedido${desc} mas o pagamento ainda não foi concluído. ` +
          `Deu algum problema? Tô por aqui pra te ajudar 💚`,
        nome,
      ) + `\n\nSe quiser finalizar, é rapidinho por este link:\n${link}`
    } else {
      const cupom = COUPON ? `\n\nE pra te ajudar a fechar hoje, responde aqui que eu garanto um *desconto de ${COUPON_PCT}%* no seu pedido 💚` : ''
      text = applyLeadName(`Oi, {nome}! Ainda dá tempo de garantir seu pedido${desc} 💚 Seu link de pagamento continua ativo:`, nome) +
        `\n${link}${cupom}`
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
        // Carrinho abandonado é assunto de VENDAS. `senderTenantId` escolhe a linha pelo
        // polo da cobrança (não pelo do lead, que pode ser paciente da clínica), e
        // `requireBotKind` recusa com 409 se ainda assim cair numa linha da clínica.
        body: JSON.stringify({
          leadId: r.lead_id,
          text,
          source: 'cart_recovery',
          senderTenantId: r.tenant_id,
          requireBotKind: 'sales',
        }),
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
          tenantId: r.tenant_id,
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
