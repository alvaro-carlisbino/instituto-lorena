// crm-clube-promo — posts automáticos no grupo "Promoções - Tricopill" (WhatsApp).
//
// Dois modos, ambos por cron (config em tenant_integrations.notifications.clube_promo):
//  • DIÁRIO (10h Maringá): template por dia da semana, links de 1 clique com CLUBE10.
//  • RELÂMPAGO {flash:true} (sexta 18h Maringá): CRIA um cupom novo na hora
//    (RELAMPAGO<DDMM>, % e limite configuráveis) válido só até as 22h do dia, e anuncia
//    no grupo. Prazo e limite são reais: a validação de cupom (shared/coupons.ts) recusa
//    expirado/esgotado, então a mensagem nunca promete o que o sistema não cumpre.
//
// Payload: { secret, flash?: true, dry?: true (só mostra, não envia nem cria cupom),
//            force?: true (ignora o dedupe do dia), message?: string (texto custom) }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

const LINK = (kit: string, cupom: string) => `https://tricopill.com.br/carrinho?kit=${kit}&cupom=${cupom}`

// Uma mensagem por dia da semana (0=domingo). Curtas, com link de 1 clique e cupom aplicado.
const MSGS = [
  `Bom domingo! 🌿 Não sabe qual kit Tricopill é o seu? Responde o diagnóstico em 1 minuto e descobre: https://tricopill.com.br/quiz\n\nE lembra: cupom *CLUBE10* dá 10% em qualquer pedido, sempre.`,
  `Segunda é dia de começar 💪 O kit mais escolhido: *Fortalecimento 3 meses*, leva 4 frascos e paga 3.\n\nCom o cupom do Clube sai por *R$ 537,30* (e no Pix tem 5% em cima).\n\nCompra em 1 clique, cupom já aplicado: ${LINK('3_meses', 'CLUBE10')}`,
  `Quer só experimentar? O kit *Ativação 1 mês* (60 cápsulas) com os 10% do Clube sai por *R$ 179,10*.\n\nLink com o cupom aplicado: ${LINK('1_mes', 'CLUBE10')}`,
  `Pra quem vai até o fim: *Evolução 5 meses*, 6 frascos (5+1 grátis), o ciclo completo do tratamento.\n\nCom CLUBE10: *R$ 895,50*. Em 1 clique: ${LINK('5_meses', 'CLUBE10')}`,
  `Além da Tricopill, a loja tem a linha Ozoncare e os queridinhos do cuidado capilar 🧴\n\nDá uma olhada: https://tricopill.com.br/loja\n\nCupom *CLUBE10* vale pra loja toda.`,
  `Nunca mais fique sem 🔁 No *Clube de Assinatura* seu Tricopill chega todo ciclo, sem precisar lembrar de pedir, e com desconto de assinante.\n\nConheça: https://tricopill.com.br/assinatura`,
  `É de Maringá? Dá pra *retirar na clínica* sem frete (Av. Nóbrega, 814, Zona 04). Pro resto do Brasil, envio expresso 📦\n\nMonta teu pedido com os 10% do Clube: ${LINK('3_meses', 'CLUBE10')}`,
]

function flashMessage(cupom: string, pct: number, maxUses: number): string {
  const preco3m = Math.round(59700 * (1 - pct / 100)) / 100
  const precoFmt = 'R$ ' + preco3m.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    `⚡ *RELÂMPAGO DO CLUBE* ⚡\n\n` +
    `Só HOJE até as 22h, e só pra quem está aqui no grupo: *${pct}% em qualquer pedido* com o cupom *${cupom}*.\n\n` +
    `Vale pros primeiros *${maxUses} pedidos*. Depois disso o cupom morre sozinho.\n\n` +
    `O mais escolhido (kit 3 meses, leva 4 frascos) sai por *${precoFmt}* no link, cupom já aplicado:\n${LINK('3_meses', cupom)}\n\n` +
    `Pra outro kit ou produto da loja, usa o cupom ${cupom} no carrinho 💚`
  )
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const p = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const { data } = await admin.from('tenant_integrations').select('notifications').eq('tenant_id', 'tricopill').maybeSingle()
  const notif = ((data as { notifications?: Record<string, unknown> } | null)?.notifications ?? {}) as Record<string, unknown>
  const cfg = (notif.clube_promo ?? {}) as Record<string, unknown>
  if (cfg.enabled !== true) return json({ ok: false, error: 'desligado' })
  if (!p.secret || p.secret !== cfg.secret) return json({ ok: false, error: 'secret_invalido' }, 401)
  const jid = String(cfg.group_jid ?? '').trim()
  if (!jid) return json({ ok: false, error: 'sem_grupo' })

  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now) // YYYY-MM-DD
  const weekday = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()
  const isFlash = p.flash === true

  let msg: string
  let flashCoupon: string | null = null

  if (isFlash) {
    if (cfg.flash_enabled === false) return json({ ok: false, error: 'flash_desligado' })
    if (p.force !== true && cfg.last_flash_date === today) return json({ ok: true, skipped: 'flash_ja_enviado_hoje' })

    const pct = Math.min(50, Math.max(5, Number(cfg.flash_pct ?? 15)))
    const maxUses = Math.min(100, Math.max(3, Number(cfg.flash_max_uses ?? 15)))
    const [, mm, dd] = today.split('-')
    flashCoupon = `RELAMPAGO${dd}${mm}`
    msg = typeof p.message === 'string' && p.message.trim() ? String(p.message) : flashMessage(flashCoupon, pct, maxUses)

    if (p.dry !== true) {
      // Expira às 22h de Maringá do próprio dia. O prazo anunciado É o prazo real.
      const validUntil = `${today}T22:00:00-03:00`
      const { error: cErr } = await admin.from('coupons').upsert({
        tenant_id: 'tricopill', code: flashCoupon, kind: 'percent', value: pct,
        active: true, valid_until: validUntil, max_uses: maxUses, min_amount_cents: 0,
        note: `Relâmpago automática do Clube (${today}). Expira 22h; ${maxUses} pedidos pagos. Criada pelo crm-clube-promo.`,
      }, { onConflict: 'tenant_id,code' })
      if (cErr) return json({ ok: false, error: 'cupom_falhou', detail: cErr.message }, 500)
    }
  } else {
    if (p.force !== true && cfg.last_sent_date === today) return json({ ok: true, skipped: 'ja_enviado_hoje' })
    msg = typeof p.message === 'string' && p.message.trim() ? String(p.message) : MSGS[weekday]
  }

  if (p.dry === true) return json({ ok: true, dry: true, today, weekday, flash: isFlash, coupon: flashCoupon, message: msg })

  // Credenciais W-API (mesma fonte do saleReceipt)
  const { data: w } = await admin.from('whatsapp_channel_instances')
    .select('wapi_instance_id, wapi_token, wapi_base_url')
    .eq('tenant_id', 'tricopill').eq('channel_provider', 'wapi').eq('active', true).limit(1).maybeSingle()
  const wr = w as { wapi_instance_id?: string; wapi_token?: string; wapi_base_url?: string | null } | null
  const inst = String(wr?.wapi_instance_id ?? '').trim()
  const tok = String(wr?.wapi_token ?? '').trim()
  if (!inst || !tok) return json({ ok: false, error: 'wapi_sem_credencial' }, 502)
  const base = ((wr?.wapi_base_url ? String(wr.wapi_base_url) : '').trim() || 'https://api.w-api.app/v1').replace(/\/$/, '')

  // Grupo: tenta o JID completo e cai pro id puro (mesma tática do saleReceipt)
  let sent = false
  let lastErr = ''
  for (const phone of [jid, jid.split('@')[0]]) {
    try {
      const res = await fetch(`${base}/message/send-text?instanceId=${encodeURIComponent(inst)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ phone, message: msg }),
      })
      const body = await res.text()
      let pj: Record<string, unknown> = {}
      try { pj = body ? JSON.parse(body) : {} } catch { /* não-JSON */ }
      const apiError = pj.error === true || Boolean(pj.errorMessage) || String(pj.status ?? '').toLowerCase() === 'error'
      if (res.ok && !apiError) { sent = true; break }
      lastErr = body.slice(0, 160)
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  if (!sent) return json({ ok: false, error: 'envio_falhou', detail: lastErr }, 502)

  const stamp = isFlash ? { last_flash_date: today } : { last_sent_date: today }
  await admin.from('tenant_integrations')
    .update({ notifications: { ...notif, clube_promo: { ...cfg, ...stamp } } })
    .eq('tenant_id', 'tricopill')
  return json({ ok: true, sent: true, today, weekday, flash: isFlash, coupon: flashCoupon })
})
