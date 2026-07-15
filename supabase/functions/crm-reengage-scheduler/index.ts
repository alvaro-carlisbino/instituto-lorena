import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { isBlockedContact } from '../_shared/internalContacts.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Reengajamento "sem fim" do Tricopill — as duas trilhas que o followup-scheduler
// não cobre. Roda 1x/dia. Manda NO MÁXIMO uma mensagem por lead por execução, com
// frequência decrescente (parece infinito pro caixa, não vira spam pro cliente).
//
//   TRILHA A — reativação de quem A GENTE respondeu por último e sumiu (sem compra)
//     cadência (dias a partir do 1º toque): 0, 3, 10, 24, 45, depois mensal e,
//     mais pra frente, trimestral. Sem fim (cap de segurança em REACT_MAX_STEPS).
//
//   TRILHA B — recompra de quem JÁ COMPROU, ancorada no fim do frasco:
//     frasco ~30 dias. Kit define os frascos (1_mes=1, 3_meses=4, 5_meses=5).
//     toques: (fim-5d) acabando → (fim) reponha → (fim+10d) assinatura →
//     depois winback mensal. Fast-forward: se vários passos já venceram, manda
//     só o mais recente (não diz "tá acabando" pra quem acabou faz semanas).
//
// SEGURANÇA:
//   • Dry-run por padrão. Só envia de verdade com REENGAGE_ENABLED='true'.
//   • crm-send-message já recusa opt-out (leads.opted_out_at) e telefone sintético
//     888001…; tratamos 'lead_opted_out' como terminal (status='stopped').
//   • Gap mínimo de 20h entre toques do mesmo lead (anti-duplo por cron).
//
// Env:
//   REENGAGE_ENABLED       'true' liga o envio real (default: dry-run)
//   REENGAGE_CRON_SECRET   (opcional) casa com header x-cron-secret
//   REENGAGE_TENANT        (default 'tricopill')
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ENABLED = (Deno.env.get('REENGAGE_ENABLED') ?? '').trim().toLowerCase() === 'true'
const TENANT = (Deno.env.get('REENGAGE_TENANT') ?? 'tricopill').trim()
// Trava de volume: quantas mensagens REAIS no máximo por execução (aquece o número,
// evita rajada de N msgs de um zap só = cara de spam/ban). Backlog escoa nos dias seguintes.
const DAILY_CAP = Math.max(1, parseInt(Deno.env.get('REENGAGE_DAILY_CAP') ?? '25', 10) || 25)
const DAY = 86400_000
const MIN_GAP_MS = 20 * 3600_000 // 20h entre toques do mesmo lead

const REACT_MAX_STEPS = 24    // ~2+ anos de toques; trava de segurança, não é o "fim"
const RECOMPRA_MAX_STEPS = 12

const firstName = (s: unknown) => {
  const first = String(s ?? '').trim().split(/\s+/)[0] || ''
  return first.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '') || 'tudo bem' // tira emoji/símbolo das pontas
}

// ── Cadência Trilha A: dias a partir do 1º toque (anchor = 1º contato) ──────────
function reactDueDay(step: number): number {
  const fixed = [0, 3, 10, 24, 45] // steps 0..4
  if (step < fixed.length) return fixed[step]
  if (step <= 12) return 45 + (step - 4) * 30 // mensal: step5=75 … step12=285
  return 285 + (step - 12) * 90               // trimestral daí pra frente
}

// ── Cadência Trilha B: dias a partir do paid_at, em função do fim do frasco ─────
function frascosFromKit(kit: string | null): number {
  const k = String(kit ?? '').toLowerCase()
  if (k.includes('5')) return 5
  if (k.includes('3')) return 4 // kit 3+1 = 4 frascos
  return 1
}
function recompraDueDay(step: number, supplyDays: number): number {
  if (step === 0) return Math.max(supplyDays - 5, 3) // frasco acabando
  if (step === 1) return supplyDays                   // acabou
  if (step === 2) return supplyDays + 10              // assinatura
  return supplyDays + 10 + (step - 2) * 30            // winback mensal
}

const REACT_MSGS = [
  'Oi {nome}, tudo bem? 💚 Fiquei de te ajudar com o Tricopill e acho que ficou no ar. Quer que eu tire alguma dúvida ou já te mando as opções?',
  '{nome}, só não quero te deixar sem resposta 😊 Sobre o Tricopill, qualquer coisa (preço, frete, como funciona) é só me chamar que eu explico rapidinho.',
  'Oi {nome}! Muita gente começa o Tricopill justamente quando percebe a queda aumentando. Se quiser, te mostro o kit ideal pro seu caso 💚',
  '{nome}, o resultado no cabelo depende de constância, e quanto antes começar, antes aparece. Quer que eu monte uma opção que caiba no seu bolso? 🌿',
  'Oi {nome}! 💚 Ainda dá tempo de cuidar do seu cabelo. Se rolar interesse no Tricopill, é só responder que eu te ajudo.',
]
// step >= 5 alterna estas (toque leve de manutenção)
const REACT_MSGS_LOOP = [
  'Oi {nome}, tudo certo? 😊 Passando pra saber se você ainda quer cuidar do cabelo com o Tricopill. Qualquer coisa é só chamar 💚',
  '{nome}, tô por aqui caso queira retomar o Tricopill 🌿 Quando fizer sentido pra você, me dá um oi.',
]

const RECOMPRA_MSGS = [
  'Oi {nome}! 💚 Seu Tricopill deve estar acabando esses dias. Bora manter o resultado sem dar aquela paradinha? Já te passo a reposição rapidinho, quer no PIX (5% off) ou no cartão?',
  '{nome}, seu frasco já acabou? Pra não perder o progresso do tratamento, garanto sua reposição agora. É só me dizer *quero* que eu cuido de tudo 💚',
  '{nome}, pra você nunca mais ficar sem (e ainda economizar), dá pra deixar no automático: seu Tricopill chega todo mês na sua casa sem precisar pedir. Quer que eu ative? 🌿',
]
const RECOMPRA_MSGS_LOOP = [
  '{nome}, faz um tempinho que a gente não se fala 💚 Como está seu cabelo? Se quiser retomar o Tricopill, tô aqui pra fechar rapidinho pra você.',
  'Oi {nome}! Passando pra saber se você quer dar continuidade no Tricopill 🌿 Tenho condição boa pra sua volta, é só chamar.',
]

function reactMessage(step: number, nome: string): string {
  const base = step < REACT_MSGS.length
    ? REACT_MSGS[step]
    : REACT_MSGS_LOOP[(step - REACT_MSGS.length) % REACT_MSGS_LOOP.length]
  const foot = step >= 4 ? '\n\n(se preferir não receber mais, é só responder SAIR 💚)' : ''
  return base.replace(/\{nome\}/g, nome) + foot
}
function recompraMessage(step: number, nome: string): string {
  const base = step < RECOMPRA_MSGS.length
    ? RECOMPRA_MSGS[step]
    : RECOMPRA_MSGS_LOOP[(step - RECOMPRA_MSGS.length) % RECOMPRA_MSGS_LOOP.length]
  const foot = step >= 2 ? '\n\n(se preferir não receber mais, é só responder SAIR 💚)' : ''
  return base.replace(/\{nome\}/g, nome) + foot
}

const isSyntheticPhone = (phone: unknown): boolean => {
  const d = String(phone ?? '').replace(/[^0-9]/g, '')
  return d.length < 10 || d.startsWith('888001')
}

// Barra contato interno/parceiro/lixo — não pode receber oferta de venda.
// (clínica, recepção, marketing, comercial, spa, sócios, e nomes só de emoji)
// Lista compartilhada com o auto-reply da IA (_shared/internalContacts.ts).

type LeadRow = {
  lead_id: string
  patient_name: string | null
  phone: string | null
  opted_out_at: string | null
  last_inbound_at: string | null
  last_outbound_at: string | null
  last_paid_at: string | null
  last_kit: string | null
  situacao: string
  reactivation_step: number | null
  reactivation_status: string | null
  recompra_step: number | null
  recompra_status: string | null
}
type StateRow = { lead_id: string; track: string; step: number; anchor_at: string; last_sent_at: string | null; status: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('REENGAGE_CRON_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  if (cronSecret && provided !== cronSecret) return json({ error: 'unauthorized' }, 401)
  if (!url || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  const admin = createClient(url, serviceRole)
  const now = Date.now()

  // Só a trilha pedida (?track=A|B) ou ambas.
  const qtrack = new URL(req.url).searchParams.get('track')

  // Carrega leads Tricopill classificados + estados de reengajamento (view + tabela).
  const { data: leadsRaw, error: leadsErr } = await admin
    .from('tricopill_reengage_leads')
    .select('lead_id, patient_name, phone, opted_out_at, last_inbound_at, last_outbound_at, last_paid_at, last_kit, situacao, reactivation_step, reactivation_status, recompra_step, recompra_status')
    .in('situacao', ['silencioso', 'comprou'])
    .is('opted_out_at', null)
  if (leadsErr) return json({ error: 'query_failed', message: leadsErr.message }, 500)
  const leads = (leadsRaw ?? []) as LeadRow[]

  const { data: statesRaw } = await admin
    .from('crm_reengage_state')
    .select('lead_id, track, step, anchor_at, last_sent_at, status')
  const stateMap = new Map<string, StateRow>()
  for (const s of (statesRaw ?? []) as StateRow[]) stateMap.set(`${s.lead_id}:${s.track}`, s)

  const results: Array<Record<string, unknown>> = []
  let sent = 0

  // Envia via crm-send-message (resolve provider/opt-out/telefone sozinho).
  async function deliver(leadId: string, text: string, source: string): Promise<{ ok: boolean; optOut: boolean; note: string }> {
    try {
      const res = await fetch(`${url}/functions/v1/crm-send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ leadId, text, source }),
      })
      const b = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string }
      const note = b?.error || b?.message || ''
      const optOut = /opt|opted|parar de receber/i.test(note)
      return { ok: res.ok && b?.ok !== false, optOut, note }
    } catch (e) {
      return { ok: false, optOut: false, note: e instanceof Error ? e.message : String(e) }
    }
  }

  async function saveState(leadId: string, track: string, step: number, anchorIso: string, status: string) {
    await admin.from('crm_reengage_state').upsert({
      lead_id: leadId, track, step, anchor_at: anchorIso, status,
      last_sent_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
    })
  }

  let capped = 0
  for (const l of leads) {
    if (isSyntheticPhone(l.phone)) { results.push({ lead: l.lead_id, skip: 'phone_sintetico' }); continue }
    if (isBlockedContact(l.patient_name)) { results.push({ lead: l.lead_id, skip: 'contato_interno' }); continue }
    // Atingiu o teto de envios reais nesta execução: para de mandar, mas registra o backlog.
    if (ENABLED && sent >= DAILY_CAP) { capped++; continue }
    const nome = firstName(l.patient_name)

    // ── TRILHA B: recompra (comprou) ──────────────────────────────────────────
    if (l.situacao === 'comprou' && (qtrack === null || qtrack === 'B')) {
      const st = stateMap.get(`${l.lead_id}:recompra`)
      if (st && st.status === 'stopped') { continue }
      const paidAt = l.last_paid_at ? new Date(l.last_paid_at).getTime() : 0
      if (!paidAt) { continue }

      // Comprou de novo depois da âncora → novo ciclo (WIN), reancora.
      let anchor = st ? new Date(st.anchor_at).getTime() : paidAt
      let step = st ? st.step : 0
      if (st && paidAt > anchor + DAY) { anchor = paidAt; step = 0 }
      if (step >= RECOMPRA_MAX_STEPS) { continue }

      const supply = frascosFromKit(l.last_kit) * 30
      const daysSince = (now - anchor) / DAY

      // Fast-forward: maior step cujo vencimento já passou.
      let target = -1
      for (let s = step; s < RECOMPRA_MAX_STEPS; s++) {
        if (recompraDueDay(s, supply) <= daysSince) target = s; else break
      }
      if (target < 0) { continue } // frasco ainda longe de acabar

      // gap mínimo
      if (st?.last_sent_at && now - new Date(st.last_sent_at).getTime() < MIN_GAP_MS) { continue }

      const text = recompraMessage(target, nome)
      if (!ENABLED) { results.push({ lead: l.lead_id, track: 'B', step: target, dryRun: true, preview: text.slice(0, 80) }); continue }

      const d = await deliver(l.lead_id, text, 'reengage_recompra')
      if (d.optOut) { await saveState(l.lead_id, 'recompra', target, new Date(anchor).toISOString(), 'stopped'); results.push({ lead: l.lead_id, track: 'B', optOut: true }); continue }
      if (!d.ok) { results.push({ lead: l.lead_id, track: 'B', sent: false, note: d.note.slice(0, 120) }); continue }
      await saveState(l.lead_id, 'recompra', target + 1, new Date(anchor).toISOString(), 'active')
      // se estava em reativação, marca convertido
      if (stateMap.has(`${l.lead_id}:reactivation`)) {
        await admin.from('crm_reengage_state').update({ status: 'converted', updated_at: new Date(now).toISOString() })
          .eq('lead_id', l.lead_id).eq('track', 'reactivation')
      }
      sent++; results.push({ lead: l.lead_id, track: 'B', step: target, sent: true })
      continue
    }

    // ── TRILHA A: reativação (silencioso, sem compra) ─────────────────────────
    if (l.situacao === 'silencioso' && (qtrack === null || qtrack === 'A')) {
      const st = stateMap.get(`${l.lead_id}:reactivation`)
      if (st && (st.status === 'stopped' || st.status === 'converted')) { continue }

      const lastOut = l.last_outbound_at ? new Date(l.last_outbound_at).getTime() : now
      const lastIn = l.last_inbound_at ? new Date(l.last_inbound_at).getTime() : 0

      let anchor: number
      let step: number
      if (!st) {
        // 1º contato: ancora AGORA (evita "catch-up" burst de quem sumiu faz 20 dias)
        anchor = now
        step = 0
      } else {
        anchor = new Date(st.anchor_at).getTime()
        step = st.step
        // respondeu depois da âncora e voltou a sumir → reinicia a cadência
        if (lastIn > anchor && lastOut > lastIn) { anchor = lastOut; step = 0 }
      }
      if (step >= REACT_MAX_STEPS) { continue }
      if (st?.last_sent_at && now - new Date(st.last_sent_at).getTime() < MIN_GAP_MS) { continue }

      const dueDay = reactDueDay(step)
      const daysSince = (now - anchor) / DAY
      if (daysSince < dueDay) { continue } // ainda não venceu o próximo toque

      const text = reactMessage(step, nome)
      if (!ENABLED) { results.push({ lead: l.lead_id, track: 'A', step, dryRun: true, preview: text.slice(0, 80) }); continue }

      const d = await deliver(l.lead_id, text, 'reengage_reativacao')
      if (d.optOut) { await saveState(l.lead_id, 'reactivation', step, new Date(anchor).toISOString(), 'stopped'); results.push({ lead: l.lead_id, track: 'A', optOut: true }); continue }
      if (!d.ok) { results.push({ lead: l.lead_id, track: 'A', sent: false, note: d.note.slice(0, 120) }); continue }
      await saveState(l.lead_id, 'reactivation', step + 1, new Date(anchor).toISOString(), 'active')
      sent++; results.push({ lead: l.lead_id, track: 'A', step, sent: true })
      continue
    }
  }

  return json({ ok: true, enabled: ENABLED, tenant: TENANT, dailyCap: DAILY_CAP, candidates: leads.length, sent, capped, results, at: new Date(now).toISOString() })
})
