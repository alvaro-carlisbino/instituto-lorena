import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { isBlockedContact } from '../_shared/internalContacts.ts'
import { applyLeadName } from '../_shared/leadName.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Reengajamento "sem fim" do Tricopill — as duas trilhas que o followup-scheduler
// não cobre. Roda 1x/dia. Manda NO MÁXIMO uma mensagem por lead por execução, com
// frequência decrescente (parece infinito pro caixa, não vira spam pro cliente).
//
//   TRILHA A — reativação de quem A GENTE respondeu por último e sumiu (sem compra)
//     cadência (dias a partir do 1º toque): 0, 3, 10, 24, 45, depois mensal e,
//     mais pra frente, trimestral. Sem fim (cap de segurança em REACT_MAX_STEPS).
//
//   TRILHA C — cross-sell da LOJA para quem já comprou (18/08/2026). A casa é a HB
//     Cosméticos e vende 68 produtos, mas a base só conhece o Tricopill: dos 111 clientes
//     pagantes, ZERO tinham levado o gel BrowSculpt e só 6 levaram o shampoo. Roda quando a
//     trilha B não tem o que dizer (frasco ainda longe de acabar) — repor o que acabou vem
//     antes de oferecer novidade, e nunca sai mais de uma mensagem pro mesmo lead no dia.
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

const ENV_ENABLED = (Deno.env.get('REENGAGE_ENABLED') ?? '').trim().toLowerCase() === 'true'
const TENANT = (Deno.env.get('REENGAGE_TENANT') ?? 'tricopill').trim()
// Trava de volume: quantas mensagens REAIS no máximo por execução (aquece o número,
// evita rajada de N msgs de um zap só = cara de spam/ban). Backlog escoa nos dias seguintes.
const DAILY_CAP = Math.max(1, parseInt(Deno.env.get('REENGAGE_DAILY_CAP') ?? '25', 10) || 25)
// Orçamento de TEMPO, além do teto de volume. A plataforma corta a requisição em 150s ociosos:
// 25 envios com o jitter anti-spam não cabem, então a rodada morria no fim, perdia a resposta
// HTTP e ninguém ficava sabendo quantos saíram (18/08: pedi 25, saíram 19, o retorno veio
// IDLE_TIMEOUT). Parar sozinho antes do corte faz a função devolver um número verdadeiro, e o
// que sobra fica na fila para a próxima rodada — o estado por lead já é idempotente.
const TIME_BUDGET_MS = Math.max(30_000, parseInt(Deno.env.get('REENGAGE_TIME_BUDGET_MS') ?? '110000', 10) || 110_000)
const T0 = Date.now()
const semTempo = () => Date.now() - T0 > TIME_BUDGET_MS
const DAY = 86400_000
const MIN_GAP_MS = 20 * 3600_000 // 20h entre toques do mesmo lead

const REACT_MAX_STEPS = 24    // ~2+ anos de toques; trava de segurança, não é o "fim"
const RECOMPRA_MAX_STEPS = 12
const LOJA_MAX_STEPS = 8
// Id do BrowSculpt no Bling (ver AI_ADDONS em _shared/rede.ts).
const BROWSCULPT_ID = '16691834812'

// Cadência da Trilha C, em dias a partir do PRIMEIRO TOQUE da régua (não da compra).
//
// A recompra ancora na compra e faz fast-forward, o que está certo lá: não se diz "seu frasco
// está acabando" para quem acabou faz dois meses. Aqui seria um desastre. Isto é LANÇAMENTO —
// o gel nasceu em 13/08 e ninguém da base conhece — então ancorar na compra mandava metade da
// base direto para o último passo: no primeiro teste, 50 de 96 pessoas receberiam o convite do
// Clube e nunca ouviriam falar do produto. Todo mundo entra pelo passo 0 e anda a escada.
function lojaDueDay(step: number): number {
  const fixed = [0, 5, 12]
  if (step < fixed.length) return fixed[step]
  return 12 + (step - 2) * 30 // mensal daí em diante
}
// Carência mínima depois da compra: deixa o pedido chegar antes de oferecer outra coisa.
const LOJA_CARENCIA_DIAS = 3



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

// Convite pro Clube (grupo de ofertas). Vai nos steps 2 e 4 da reativação: quem não respondeu
// 2 vezes provavelmente não quer conversar AGORA, mas entra num grupo pra ficar sabendo de
// oferta. É um pedido menor que "compra?" — converte o silêncio em audiência em vez de perder
// o lead. E dentro do grupo ele recebe promoção todo dia, sem custo e sem risco de ban.
const CLUBE_LINK = 'https://chat.whatsapp.com/GlRBbbwhjELGZ4u93VGviT';

// Promoção do kit 3+1 com frete grátis (decisão do dono, 17/08), ENCERRADA em 20/08 antes do
// fim de agosto: o envio externo do 3+1 saía com etiqueta de ~R$ 29 tirada da margem. Com a
// data no passado o gancho some sozinho das mensagens. Mesma data em `_shared/melhorEnvio.ts`
// (o servidor que zera o frete) e no `_shared/frete.ts` do repo do site.
const PROMO_FRETE_KIT3_ATE = '2026-08-19'
function diaLocalSP(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
function promoAgostoAtiva(d = new Date()): boolean {
  return diaLocalSP(d) <= PROMO_FRETE_KIT3_ATE
}
// Frase curta, uma só, pra não virar panfleto. Entra depois do texto normal.
const HOOK_AGOSTO_REATIVACAO = 'Ah, e só em agosto o kit 3+1 (4 frascos) vai com *frete grátis* pra todo o Brasil 🚚'
const HOOK_AGOSTO_RECOMPRA = 'E até o fim de agosto a reposição no kit 3+1 vai com *frete grátis* 🚚'

const REACT_MSGS = [
  // step 0 (na hora): abordagem direta, ainda tentando a venda 1:1
  'Oi {nome}, tudo bem? 💚 Fiquei de te ajudar com o Tricopill e acho que ficou no ar. Quer que eu tire alguma dúvida ou já te mando as opções?',
  // step 1 (dia 3): não respondeu uma vez → oferece o grupo. Pedido menor que "compra?":
  // converte o silêncio em audiência, e no grupo ele recebe oferta todo dia (custo zero).
  `{nome}, se agora não for a hora, tudo bem 😊 Mas entra no *Clube Tricopill*: é um grupo só de ofertas, e quem está lá ganha *10% em qualquer pedido* (cupom CLUBE10) além das promoções relâmpago.\n\n${CLUBE_LINK}`,
  // step 2 (dia 10): volta pra dor/venda
  'Oi {nome}! Muita gente começa o Tricopill justamente quando percebe a queda aumentando. Se quiser, te mostro o kit ideal pro seu caso 💚',
  // step 3 (dia 24): reforça o grupo pra quem ainda não entrou
  `{nome}, ainda dá tempo de cuidar do seu cabelo 🌿 E se preferir só acompanhar as ofertas por enquanto, o grupo do Clube é aqui (10% pra quem está dentro):\n\n${CLUBE_LINK}`,
  // step 4 (dia 45): último toque mais direto
  'Oi {nome}! 💚 Se rolar interesse no Tricopill, é só responder que eu monto uma opção que caiba no seu bolso.',
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
// Trilha C. Passo 0 é o gel: é marca 100% da casa, margem alta, categoria que ninguém da
// base tem, e não compete com o Tricopill que a pessoa já usa. Passo 1 abre a loja inteira.
const LOJA_MSGS = [
  'Oi {nome}! 💚 Saiu uma novidade nossa que acho que combina com você: o *BrowSculpt*, nosso gel de sobrancelha de alta fixação (R$ 129,90). Ele penteia, alinha e segura o fio o dia todo, é transparente e não craquela nem deixa resíduo. Quer que eu já separe um pro seu próximo pedido?',
  '{nome}, você sabia que além do Tricopill a gente tem a loja completa? 🌿 Shampoo, condicionador, máscara, óleo e finalizador das melhores linhas, com envio pra todo o Brasil. Me conta o que seu cabelo está pedindo agora que eu te indico o certo.',
  `{nome}, se preferir só acompanhar as ofertas por enquanto, entra no nosso Clube 😊 São *10% em qualquer pedido* (cupom CLUBE10) e promoção relâmpago.\n\n${CLUBE_LINK}`,
]
const LOJA_MSGS_LOOP = [
  'Oi {nome}, tudo bem? 😊 Chegou coisa nova na loja. Se quiser, te mando o que combina com o que você já usa 💚',
  '{nome}, tô por aqui se quiser repor o shampoo ou experimentar algo novo da nossa linha 🌿',
]

const RECOMPRA_MSGS_LOOP = [
  '{nome}, faz um tempinho que a gente não se fala 💚 Como está seu cabelo? Se quiser retomar o Tricopill, tô aqui pra fechar rapidinho pra você.',
  'Oi {nome}! Passando pra saber se você quer dar continuidade no Tricopill 🌿 Tenho condição boa pra sua volta, é só chamar.',
]

function lojaMessage(step: number, nome: string): string {
  const base = step < LOJA_MSGS.length
    ? LOJA_MSGS[step]
    : LOJA_MSGS_LOOP[(step - LOJA_MSGS.length) % LOJA_MSGS_LOOP.length]
  return base.replace(/\{nome\}/g, nome.split(' ')[0] || 'tudo bem')
}

function reactMessage(step: number, nome: string): string {
  const base = step < REACT_MSGS.length
    ? REACT_MSGS[step]
    : REACT_MSGS_LOOP[(step - REACT_MSGS.length) % REACT_MSGS_LOOP.length]
  // Gancho de agosto só nos toques de venda (0, 2, 4 e no loop); nos convites pro Clube (1, 3) não,
  // senão a mensagem vira duas ofertas de uma vez.
  const hook = promoAgostoAtiva() && step !== 1 && step !== 3 ? '\n\n' + HOOK_AGOSTO_REATIVACAO : ''
  const foot = step >= 4 ? '\n\n(se preferir não receber mais, é só responder SAIR 💚)' : ''
  return applyLeadName(base, nome) + hook + foot
}
function recompraMessage(step: number, nome: string): string {
  const base = step < RECOMPRA_MSGS.length
    ? RECOMPRA_MSGS[step]
    : RECOMPRA_MSGS_LOOP[(step - RECOMPRA_MSGS.length) % RECOMPRA_MSGS_LOOP.length]
  // Step 2 é a oferta de assinatura; misturar frete do kit 3+1 ali confunde. Nos outros entra.
  const hook = promoAgostoAtiva() && step !== 2 ? '\n\n' + HOOK_AGOSTO_RECOMPRA : ''
  const foot = step >= 2 ? '\n\n(se preferir não receber mais, é só responder SAIR 💚)' : ''
  return applyLeadName(base, nome) + hook + foot
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
  // ?dry=1 pré-visualiza SEM enviar, mesmo com REENGAGE_ENABLED='true'. Antes o modo seco só
  // existia desligando o envio da operação inteira por variável de ambiente, o que na prática
  // significava que ninguém conferia uma régua nova antes de ela sair para clientes reais.
  const soPreview = ['1', 'true', 'yes'].includes((new URL(req.url).searchParams.get('dry') ?? '').toLowerCase())
  const ENABLED = ENV_ENABLED && !soPreview

  // Carrega leads Tricopill classificados + estados de reengajamento (view + tabela).
  const { data: leadsRaw, error: leadsErr } = await admin
    .from('tricopill_reengage_leads')
    .select('lead_id, patient_name, phone, opted_out_at, last_inbound_at, last_outbound_at, last_paid_at, last_kit, situacao, reactivation_step, reactivation_status, recompra_step, recompra_status')
    .in('situacao', ['silencioso', 'comprou'])
    .is('opted_out_at', null)
  if (leadsErr) return json({ error: 'query_failed', message: leadsErr.message }, 500)
  const leads = (leadsRaw ?? []) as LeadRow[]

  // Quem JÁ comprou o gel não pode receber oferta do gel. Hoje são zero, mas a trilha existe
  // justamente para mudar isso — sem esta trava a campanha começaria a oferecer o produto
  // para quem acabou de comprar, que é o jeito mais rápido de queimar a confiança da base.
  const jaTemGel = new Set<string>()
  {
    const { data: gelRows } = await admin
      .from('rede_payments')
      .select('lead_id, items')
      .not('paid_at', 'is', null)
      .limit(5000)
    for (const r of (gelRows ?? []) as Array<Record<string, unknown>>) {
      if (JSON.stringify(r.items ?? '').includes(BROWSCULPT_ID)) jaTemGel.add(String(r.lead_id))
    }
  }

  const { data: statesRaw } = await admin
    .from('crm_reengage_state')
    .select('lead_id, track, step, anchor_at, last_sent_at, status')
  const stateMap = new Map<string, StateRow>()
  for (const s of (statesRaw ?? []) as StateRow[]) stateMap.set(`${s.lead_id}:${s.track}`, s)

  // QUEM JÁ COMPROU NÃO RECEBE "você sumiu". A view classifica por `tricopill_paid_leads`
  // (linha em rede_payments), e venda fechada NA MÃO pela consultora não gera essa linha —
  // o Bling recebe o pedido, o stage vai pra vd-pago, e a view continua achando que a pessoa
  // nunca comprou. Resultado em 18/ago: 11 clientes pagantes na trilha de REATIVAÇÃO, a
  // maioria já no step 4 ("ainda dá tempo de cuidar do seu cabelo" pra quem tinha acabado de
  // pagar). O Rodrigo Masi entrou nessa lista no dia seguinte ao pedido dele.
  //
  // O stage é a fonte que a consultora move na mão, então é ele que sabe da venda manual.
  // Mesma lista do crm-followup-scheduler. A trilha B (recompra) NÃO é barrada aqui: oferecer
  // reposição pra quem comprou é justamente o trabalho dela.
  const CONVERTED_STAGES = new Set(['fechado', 'consulta', 'tricopill__vd-pago'])
  const convertedLeadIds = new Set<string>()
  {
    const ids = leads.map((l) => l.lead_id)
    for (let i = 0; i < ids.length; i += 500) {
      const { data: stageRows } = await admin
        .from('leads')
        .select('id, stage_id')
        .in('id', ids.slice(i, i + 500))
      for (const r of (stageRows ?? []) as Array<{ id: string; stage_id: string | null }>) {
        if (CONVERTED_STAGES.has(String(r.stage_id ?? ''))) convertedLeadIds.add(String(r.id))
      }
    }
  }

  const results: Array<Record<string, unknown>> = []
  let sent = 0

  // Envia via crm-send-message (resolve provider/opt-out/telefone sozinho).
  async function deliver(leadId: string, text: string, source: string): Promise<{ ok: boolean; optOut: boolean; note: string }> {
    // ANTI-BAN (pedido do Álvaro, 16/jul): espaço aleatório de 4 a 9s entre envios. Rajada
    // de mensagens idênticas em sequência de segundos é a assinatura clássica de spam que
    // derruba número em API não-oficial. 15 envios × ~6s ≈ 90s, dentro do limite da function.
    await new Promise((r) => setTimeout(r, 4000 + Math.floor(Math.random() * 5000)))
    try {
      const res = await fetch(`${url}/functions/v1/crm-send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRole}` },
        // Polo do ASSUNTO declarado, mesmo a view já filtrando `tenant_id = 'tricopill'`:
        // reativação e recompra são conversa de LOJA e não podem sair pelo número da
        // clínica em hipótese nenhuma. Hoje o guard de polo do resolver acerta por
        // consequência (a linha da clínica é descartada por ser de outro polo); isto deixa
        // de depender disso, e um lead da clínica que entre na lista por mudança na view
        // vira 409 registrado em vez de mensagem no número errado.
        body: JSON.stringify({ leadId, text, source, senderTenantId: TENANT, requireBotKind: 'sales' }),
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

  // ── TRILHA C: cross-sell da loja ────────────────────────────────────────────
  // Chamada pela trilha B quando a recompra não tem o que dizer hoje. Devolve true se enviou.
  async function tentarLoja(l: LeadRow, nome: string): Promise<boolean> {
    if (qtrack !== null && qtrack !== 'C') return false
    if (jaTemGel.has(l.lead_id)) return false
    const st = stateMap.get(`${l.lead_id}:loja`)
    if (st && st.status === 'stopped') return false

    const paidAt = l.last_paid_at ? new Date(l.last_paid_at).getTime() : 0
    if (!paidAt) return false

    // Ainda não entrou na régua: só entra depois da carência, e a âncora vira AGORA — a escada
    // conta do primeiro toque, para todo mundo começar pela oferta e não pelo convite.
    const diasDesdeCompra = (now - paidAt) / DAY
    if (!st && diasDesdeCompra < LOJA_CARENCIA_DIAS) return false

    const anchor = st ? new Date(st.anchor_at).getTime() : now
    const step = st ? st.step : 0
    if (step >= LOJA_MAX_STEPS) return false

    // Sem fast-forward, de propósito: cada pessoa anda um passo por vez, na ordem.
    const target = step
    if (lojaDueDay(target) > (now - anchor) / DAY) return false
    if (st?.last_sent_at && now - new Date(st.last_sent_at).getTime() < MIN_GAP_MS) return false

    const text = lojaMessage(target, nome)
    if (!ENABLED) { results.push({ lead: l.lead_id, track: 'C', step: target, dryRun: true, preview: text.slice(0, 80) }); return false }

    const d = await deliver(l.lead_id, text, 'reengage_loja')
    if (d.optOut) { await saveState(l.lead_id, 'loja', target, new Date(anchor).toISOString(), 'stopped'); results.push({ lead: l.lead_id, track: 'C', optOut: true }); return false }
    if (!d.ok) { results.push({ lead: l.lead_id, track: 'C', sent: false, note: d.note.slice(0, 120) }); return false }
    await saveState(l.lead_id, 'loja', target + 1, new Date(anchor).toISOString(), 'active')
    results.push({ lead: l.lead_id, track: 'C', step: target, sent: true })
    return true
  }

  let capped = 0
  for (const l of leads) {
    if (isSyntheticPhone(l.phone)) { results.push({ lead: l.lead_id, skip: 'phone_sintetico' }); continue }
    if (isBlockedContact(l.patient_name)) { results.push({ lead: l.lead_id, skip: 'contato_interno' }); continue }
    // Atingiu o teto de envios reais nesta execução: para de mandar, mas registra o backlog.
    if (ENABLED && sent >= DAILY_CAP) { capped++; continue }
    // Sem tempo para outro envio: para agora e devolve o que realmente saiu.
    if (ENABLED && sent > 0 && semTempo()) { capped++; continue }
    const nome = String(l.patient_name ?? '')

    // Pedido explícito da trilha C: roda sozinha. Sem isto ela nunca executa em ?track=C,
    // porque a chamada dela mora dentro do bloco da recompra (que só roda em null|B).
    if (l.situacao === 'comprou' && qtrack === 'C') {
      if (await tentarLoja(l, nome)) sent++
      continue
    }

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
      // Frasco ainda longe de acabar: a recompra não tem o que dizer hoje, então a vez é da
      // trilha C. A ordem é proposital — repor o que acabou vem antes de oferecer novidade.
      if (target < 0) {
        if (await tentarLoja(l, nome)) sent++
        continue
      }

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
    if (l.situacao === 'silencioso' && convertedLeadIds.has(l.lead_id)) {
      results.push({ lead: l.lead_id, skip: 'ja_comprou_stage' })
      continue
    }

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

  return json({ ok: true, enabled: ENABLED, preview: soPreview, tempoEsgotado: semTempo(), duracaoMs: Date.now() - T0, envEnabled: ENV_ENABLED, tenant: TENANT, dailyCap: DAILY_CAP, candidates: leads.length, sent, capped, results, at: new Date(now).toISOString() })
})
