import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { resendMissingSaleReceipts } from '../_shared/saleReceipt.ts'
import { sendManychatFlow } from '../_shared/manychatPublicApi.ts'
import { sendPostPurchaseEmail } from '../_shared/tricopillEmails.ts'

// Rede de segurança de confirmação de pagamento.
//
// Problema: quando o cliente paga por um meio que NÃO confirma sozinho — PIX manual
// (chave estática passada por um operador), ou um gateway que não atualizou — a venda
// fica "Aguardando" pra sempre e ninguém percebe. Caso real: Maynara pagou no Pix e
// mandou comprovante, mas o sistema seguiu pendente (cartão preso + Pix fora do gateway).
//
// Esta função roda por cron (1 min) e procura leads que DISSERAM que pagaram (texto no
// passado: "paguei", "comprovante", "fiz o pix"...) e que NÃO têm nenhum pagamento
// confirmado. Aí dispara uma notificação in-app para a equipe conferir e finalizar.
//
// NÃO confirma pagamento nem mexe em dinheiro — só alerta. Idempotente via dedupeKey.
//
// Auth: chamado pelo pg_cron com a anon key (verify_jwt aceita), igual ao crm-rede-pix-poll.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// Tenants com venda direta (checkout/Pix). Instituto-lorena é clínica (fluxo diferente),
// fica de fora pra não gerar ruído. Fácil de estender depois.
const WATCHED_TENANTS = ['tricopill']

// Frases de pagamento NO PASSADO (o cliente afirma que já pagou). Evita "vou pagar".
const CLAIM_PATTERNS = [
  'paguei',
  'ja paguei',
  'já paguei',
  'acabei de pagar',
  'fiz o pix',
  'fiz o pagamento',
  'fiz a transferencia',
  'fiz a transferência',
  'transferi',
  'comprovante',
  'efetuei o pagamento',
  'pagamento efetuado',
  'pagamento realizado',
  'pix feito',
  'segue o comprovante',
]

type LeadRow = { id: string; patient_name: string | null; tenant_id: string | null }

async function hasConfirmedPayment(
  admin: SupabaseClient,
  leadId: string,
): Promise<boolean> {
  const confirmed = 'status.eq.paid,status.eq.approved,status.eq.confirmed,status.eq.received,paid_at.not.is.null,bling_order_id.not.is.null'
  const [{ data: rede }, { data: asaas }] = await Promise.all([
    admin.from('rede_payments').select('id').eq('lead_id', leadId).or(confirmed).limit(1),
    admin.from('asaas_payments').select('id').eq('lead_id', leadId).or(confirmed).limit(1),
  ])
  return ((rede ?? []).length + (asaas ?? []).length) > 0
}

// Rede de segurança do FUNIL: venda paga cujo lead ficou preso numa etapa inicial do
// funil de vendas Tricopill vai pra "Pago". O finalize às vezes não move e o checkout do
// SITE (finalizeApproved) NUNCA move — então a venda não aparecia como fechada. Só promove
// (Novo/Qualificado/Link enviado → Pago); nunca mexe em Pós-venda/Perdido. Best-effort.
async function promotePaidTricopillToPago(admin: SupabaseClient): Promise<number> {
  const sinceIso = new Date(Date.now() - 15 * 86_400_000).toISOString()
  const ids = new Set<string>()
  const [{ data: rede }, { data: asaas }] = await Promise.all([
    admin.from('rede_payments').select('lead_id').eq('tenant_id', 'tricopill').eq('status', 'paid').gte('paid_at', sinceIso).not('lead_id', 'is', null),
    admin.from('asaas_payments').select('lead_id').eq('tenant_id', 'tricopill').in('status', ['paid', 'confirmed', 'received', 'approved']).gte('paid_at', sinceIso).not('lead_id', 'is', null),
  ])
  for (const r of [...((rede ?? []) as Array<{ lead_id?: unknown }>), ...((asaas ?? []) as Array<{ lead_id?: unknown }>)]) {
    const id = String(r.lead_id ?? '')
    if (id) ids.add(id)
  }
  if (!ids.size) return 0
  const { data, error } = await admin.from('leads')
    .update({ stage_id: 'tricopill__vd-pago', stage_entered_at: new Date().toISOString() })
    .eq('pipeline_id', 'tricopill__pipeline-vendas')
    .in('stage_id', ['tricopill__vd-novo', 'tricopill__vd-conversando', 'tricopill__vd-proposta'])
    .in('id', [...ids])
    .select('id')
  if (error) return 0
  return (data ?? []).length
}

// Pesquisa de satisfação da CLÍNICA: quando o lead entra em "Consulta agendada" (o 1º
// atendimento da Dandara/IA acabou), dispara o fluxo do ManyChat (sendFlow) pra colher a
// nota. Dedup por custom_fields.feedback_sent_at → uma pesquisa por lead. Best-effort.
async function dispatchClinicFeedbackOnStage(admin: SupabaseClient): Promise<number> {
  const { data: ti } = await admin.from('tenant_integrations').select('manychat').eq('tenant_id', 'instituto-lorena').maybeSingle()
  const mc = ((ti as { manychat?: Record<string, unknown> } | null)?.manychat) ?? {}
  const apiKey = String(mc.api_key ?? '').trim()
  const flowNs = String(mc.feedback_flow_ns ?? '').trim()
  if (!apiKey || !flowNs) return 0

  // RITMO: no máximo 25 pedidos de avaliação POR HORA. O backlog (600+) sai ao longo de
  // ~1 dia em vez de metralhar todo mundo numa noite (caso 16/jul: 24 de uma vez assustou).
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count: sentLastHour } = await admin.from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', 'instituto-lorena')
    .gte('custom_fields->>feedback_sent_at', hourAgo)
  if ((sentLastHour ?? 0) >= 25) return 0

  const batch = Math.max(0, 25 - (sentLastHour ?? 0))
  const { data: leads } = await admin.from('leads')
    .select('id, custom_fields')
    .eq('tenant_id', 'instituto-lorena')
    .eq('pipeline_id', 'pipeline-clinica')
    .in('stage_id', ['consulta', 'fechado']) // agendou OU fechou → pede avaliação (Álvaro, 16/jul)
    // Filtro NO SQL, não em JS: antes o limit pegava sempre os mesmos 25 já marcados e a
    // fila travava no primeiro lote (bug 16/jul: parou em 24 pra sempre).
    .is('custom_fields->feedback_sent_at', null)
    .order('stage_entered_at', { ascending: false })
    .limit(batch)

  let sent = 0
  for (const l of (leads ?? []) as Array<{ id: string; custom_fields: Record<string, unknown> | null }>) {
    const cf = (l.custom_fields ?? {}) as Record<string, unknown>
    const sid = String(cf.manychat_subscriber_id ?? '').trim()
    if (!sid) {
      // Sem subscriber não tem como enviar: carimba (data ISO, senão a conta por hora quebra)
      // + motivo, pra sair da fila de vez.
      await admin.from('leads').update({ custom_fields: { ...cf, feedback_sent_at: new Date().toISOString(), feedback_skipped: 'sem_manychat' } }).eq('id', l.id).then(() => {}, () => {})
      continue
    }
    // CLAIM ATÔMICO antes de enviar: só envia quem conseguiu gravar a marca. Duas execuções
    // simultâneas (cron + disparo manual) não duplicam mais — caso Ezequiel, que recebeu 2x
    // porque as duas leram a fila antes de qualquer marca ser gravada.
    const { data: claimed } = await admin.from('leads')
      .update({ custom_fields: { ...cf, feedback_sent_at: new Date().toISOString() } })
      .eq('id', l.id)
      .is('custom_fields->feedback_sent_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) continue // outra execução já pegou este lead

    const r = await sendManychatFlow(apiKey, sid, flowNs)
    if (r.ok) {
      sent++
    } else {
      // Envio falhou: solta a marca pra tentar de novo na próxima rodada.
      await admin.from('leads').update({ custom_fields: cf }).eq('id', l.id).then(() => {}, () => {})
    }
  }
  return sent
}

// E-mail pós-compra: toda venda paga do Tricopill nas últimas 48h que ainda não recebeu.
// Confirma o pedido, convida pro Clube (grupo) e planta o cupom da próxima compra.
// E-mail sai do cadastro do lead (custom_fields.email ou cadastro.email). Sem e-mail = pula.
async function sendPostPurchaseEmails(admin: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString()
  const { data: rows } = await admin
    .from('rede_payments')
    .select('id, lead_id, customer_name, amount_cents, description, paid_at')
    .eq('tenant_id', 'tricopill')
    .eq('status', 'paid')
    .is('post_purchase_email_at', null)
    .gte('paid_at', since)
    .not('lead_id', 'is', null)
    .limit(20)
  let sent = 0
  for (const r of (rows ?? []) as Array<{ id: string; lead_id: string; customer_name?: string; amount_cents?: number; description?: string }>) {
    const { data: l } = await admin.from('leads').select('custom_fields, patient_name').eq('id', r.lead_id).maybeSingle()
    const cf = ((l as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>
    const cad = (cf.cadastro ?? {}) as Record<string, unknown>
    const email = String(cf.email ?? cad.email ?? '').trim()
    if (!email || !email.includes('@')) {
      // Sem e-mail não tem o que mandar; carimba pra não re-verificar esse pedido a cada 2min.
      await admin.from('rede_payments').update({ post_purchase_email_at: new Date().toISOString() }).eq('id', r.id)
      continue
    }
    const firstName = String(r.customer_name ?? (l as { patient_name?: string } | null)?.patient_name ?? 'tudo bem').trim().split(/\s+/)[0] || 'tudo bem'
    const amountFmt = 'R$ ' + ((Number(r.amount_cents) || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    const out = await sendPostPurchaseEmail({ to: email, firstName, amountFmt, description: r.description ?? null })
    if (out.ok) {
      await admin.from('rede_payments').update({ post_purchase_email_at: new Date().toISOString() }).eq('id', r.id)
      sent++
    }
  }
  return sent
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole) as unknown as SupabaseClient

  // "SEMPRE ENVIAR": rede de segurança do COMPROVANTE no grupo. Reenvia toda venda paga
  // que ficou sem comprovante (envio inline falhou no W-API). Dedupe por receipt_group_sent_at,
  // então nunca duplica. Best-effort — nunca derruba o resto do vigia.
  const receipts = await resendMissingSaleReceipts(admin).catch(() => ({ checked: 0, resent: 0 }))

  // Rede de segurança do funil: venda paga presa em etapa inicial → "Pago".
  const promovidosPago = await promotePaidTricopillToPago(admin).catch(() => 0)

  // Pesquisa de satisfação da clínica: lead entrou em "Consulta agendada" → dispara o fluxo.
  const feedbackClinica = await dispatchClinicFeedbackOnStage(admin).catch(() => 0)

  // E-mail pós-compra (Resend): confirmação + convite pro Clube + cupom da próxima.
  // Dedupe por post_purchase_email_at; e-mail vem do cadastro do lead (o checkout do site
  // sempre captura). Venda de bot sem e-mail é pulada em silêncio. Best-effort.
  const emailsPosCompra = await sendPostPurchaseEmails(admin).catch(() => 0)

  // Janela: mensagens de 12h atrás até 4 min atrás. O atraso de 4 min dá tempo do gateway
  // (poller PIX / webhook) confirmar sozinho antes de incomodarmos a equipe. 12h cobre
  // claims feitos no fim do dia que só seriam vistos na manhã seguinte. O dedupe (6h)
  // garante no máximo ~2 alertas por lead enquanto seguir sem confirmação.
  const since = new Date(Date.now() - 12 * 3_600_000).toISOString()
  const until = new Date(Date.now() - 4 * 60_000).toISOString()

  const orClaims = CLAIM_PATTERNS.map((p) => `content.ilike.%${p}%`).join(',')
  const { data: claims, error: claimsErr } = await admin
    .from('interactions')
    .select('lead_id')
    .eq('direction', 'in')
    .gte('happened_at', since)
    .lte('happened_at', until)
    .or(orClaims)
    .limit(500)
  if (claimsErr) return json({ ok: false, error: claimsErr.message }, 500)

  const leadIds = [...new Set((claims ?? []).map((r) => String((r as { lead_id: unknown }).lead_id)).filter(Boolean))]
  if (leadIds.length === 0) return json({ ok: true, candidates: 0, alerted: 0, receipts, promovidosPago, feedbackClinica, emailsPosCompra })

  // Só leads dos tenants observados.
  const { data: leadsData } = await admin
    .from('leads')
    .select('id, patient_name, tenant_id')
    .in('id', leadIds)
    .in('tenant_id', WATCHED_TENANTS)
  const leads = (leadsData ?? []) as LeadRow[]

  let alerted = 0
  const skipped: string[] = []
  for (const lead of leads) {
    // Já tem pagamento confirmado? Então a venda fechou — nada a alertar.
    if (await hasConfirmedPayment(admin, lead.id)) {
      skipped.push(lead.id)
      continue
    }
    const name = (lead.patient_name ?? '').trim() || 'Cliente'
    const n = await notifyAgents(admin, {
      leadId: lead.id,
      tenantId: lead.tenant_id ?? undefined,
      kind: 'urgent',
      title: '💸 Pagamento não confirmado',
      body: `${name} disse que pagou, mas nada confirmou no sistema. Confira o comprovante e finalize a venda.`,
      includeOwner: true,
      dedupeKey: 'payment_claim_unconfirmed',
      dedupeWindowMinutes: 360,
    })
    if (n > 0) alerted += 1
  }

  return json({ ok: true, candidates: leads.length, alerted, skipped: skipped.length, receipts, promovidosPago, feedbackClinica, emailsPosCompra })
})
