import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { resendMissingSaleReceipts } from '../_shared/saleReceipt.ts'

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
  if (leadIds.length === 0) return json({ ok: true, candidates: 0, alerted: 0, receipts })

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

  return json({ ok: true, candidates: leads.length, alerted, skipped: skipped.length, receipts })
})
