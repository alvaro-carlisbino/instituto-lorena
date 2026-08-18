// Relatório diário do Google Ads do Tricopill no WhatsApp do dono.
//
// Por que existe: o Álvaro pediu (17/08/2026) receber todo dia de manhã, no mesmo cano do
// comprovante de venda (W-API do Tricopill, DM 1:1), o resumo do Ads: gasto de ontem e desde
// a reestruturação, leads e vendas, grupos da Busca, aprovação dos anúncios e o SALDO da conta
// (foi o teto de gasto da conta que parou tudo de 02 a 16/08 sem ninguém ver).
//
// Lê a API do Google Ads com as credenciais do env (mesmas do crm-gads-backfill), monta um
// texto curto e manda pros números em tenant_integrations.notifications.gads_report_phones
// (fallback: sales_receipt_owner_phones — só o dono). Chamado 1x/dia por pg_cron.
//
// Única escrita na conta: pausar o grupo antigo da Busca (197790938385) quando os 4 anúncios
// novos estiverem APROVADOS — ele ficou ligado só pra campanha não apagar durante a revisão.
//
// Payload: {dry:true} monta e devolve o texto sem enviar. {phone:"55..."} manda só pra esse número.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { googleAdsAccessToken } from '../_shared/conversions.ts'
import { sendWapiDirectText } from '../_shared/saleReceipt.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const TENANT = 'tricopill'
const BUSCA_ID = '24041701832'
const MARCA_ID = '24125006145'
const PMAX_ID = '24022345891'
// Campanha do BROWSCULPT (18/08/2026). Nasceu com gel + shampoo, mas o Álvaro pausou o grupo
// do shampoo no mesmo dia: Ozoncare é revenda, e anúncio só roda nos 100% HB, que são o
// Tricopill e o gel. Orçamento IGUALADO ao do Tricopill (R$ 85) por decisão dele — orçamento
// é teto, não compromisso, então o gel gasta o que o leilão de sobrancelha der.
// Lance em maximizar CLIQUES: nasceu em maximizar conversões e ficou o dia em zero impressão,
// porque smart bidding sem histórico de conversão não entra no leilão.
const LOJA_ID = '24146028948'
const GRUPO_ANTIGO_ID = '197790938385'
// Reestruturação da Busca em 4 grupos + maximizar conversões. Acumulado começa aqui.
const MARCO = '2026-08-17'
// Meta do Álvaro: zerar o saldo da conta até este dia.
const PRAZO_GASTO = '2026-08-31'
const ACAO_VENDA = 'Compras'

const FUSO = 'America/Sao_Paulo'
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
const ymd = (d: Date) => fmtDia.format(d)
const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number) => Math.round(n).toLocaleString('pt-BR')
const micros = (v: unknown) => Number(v ?? 0) / 1e6

type Row = Record<string, any>

async function gads(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  const devToken = (Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') ?? '').trim()
  const customerId = (Deno.env.get('GOOGLE_ADS_CUSTOMER_ID') ?? '').replace(/\D/g, '')
  const loginCustomerId = (Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ?? '').replace(/\D/g, '')
  const apiVersion = (Deno.env.get('GOOGLE_ADS_API_VERSION') ?? 'v22').trim()
  if (!devToken || !customerId) throw new Error('GOOGLE_ADS_* não configurado')
  const accessToken = await googleAdsAccessToken()
  if (!accessToken) throw new Error('sem access token do Google Ads')
  const res = await fetch(`https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
      ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let parsed: any = text
  try { parsed = JSON.parse(text) } catch { /* texto cru */ }
  return { ok: res.ok, status: res.status, body: parsed }
}
async function gaql(query: string): Promise<Row[]> {
  const r = await gads('googleAds:search', { query })
  if (!r.ok) throw new Error(`GAQL ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`)
  return (r.body?.results ?? []) as Row[]
}

function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 864e5)
}
function diaLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  const s = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d)
  return s.replace('.', '')
}

type Periodo = { custo: number; cliques: number; imp: number; leads: number; vendas: number; receita: number }
function vazio(): Periodo { return { custo: 0, cliques: 0, imp: 0, leads: 0, vendas: 0, receita: 0 } }

async function periodo(desde: string, ate: string): Promise<Periodo> {
  const p = vazio()
  const perf = await gaql(`
    SELECT metrics.cost_micros, metrics.clicks, metrics.impressions
    FROM campaign WHERE segments.date BETWEEN '${desde}' AND '${ate}'`)
  for (const r of perf) { p.custo += micros(r.metrics.costMicros); p.cliques += Number(r.metrics.clicks ?? 0); p.imp += Number(r.metrics.impressions ?? 0) }
  // Venda e lead são ações diferentes: somar num número só já enganou o relatório uma vez.
  const conv = await gaql(`
    SELECT segments.conversion_action_name, metrics.all_conversions, metrics.conversions_value
    FROM campaign WHERE segments.date BETWEEN '${desde}' AND '${ate}' AND metrics.all_conversions > 0`)
  for (const r of conv) {
    const n = Number(r.metrics.allConversions ?? 0)
    if (r.segments.conversionActionName === ACAO_VENDA) { p.vendas += n; p.receita += Number(r.metrics.conversionsValue ?? 0) }
    else p.leads += n
  }
  return p
}

function linhaPeriodo(p: Periodo): string {
  const cpc = p.cliques ? p.custo / p.cliques : 0
  let s = `${brl(p.custo)} · ${num(p.cliques)} clique${p.cliques === 1 ? '' : 's'} · CPC ${brl(cpc)} · ${num(p.leads)} lead${p.leads === 1 ? '' : 's'} WhatsApp`
  s += p.vendas ? ` · ${num(p.vendas)} venda${p.vendas === 1 ? '' : 's'} (${brl(p.receita)})` : ' · 0 vendas'
  return s
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const cronSecret = (Deno.env.get('GADS_REPORT_CRON_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  if (cronSecret && provided !== cronSecret) return json({ error: 'unauthorized' }, 401)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, serviceRole)

  let payload: Record<string, unknown> = {}
  try { payload = await req.json() } catch { /* sem corpo */ }
  const dry = payload.dry === true
  const onlyPhone = typeof payload.phone === 'string' ? payload.phone.replace(/\D/g, '') : ''

  const hoje = ymd(new Date())
  const ontem = ymd(new Date(Date.now() - 864e5))
  const alertas: string[] = []
  const linhas: string[] = []

  try {
    // ── Campanhas: estado + orçamento ativo ──
    const camps = await gaql(`
      SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.bidding_strategy_type,
             campaign_budget.amount_micros
      FROM campaign WHERE campaign.status != 'REMOVED'`)
    let orcamentoDia = 0
    for (const r of camps) {
      const c = r.campaign
      if (c.status === 'ENABLED') orcamentoDia += micros(r.campaignBudget?.amountMicros)
      if (c.id === PMAX_ID && c.status !== 'PAUSED') alertas.push('PMax saiu de PAUSED, alguém religou.')
      if (c.id === BUSCA_ID) {
        if (c.status !== 'ENABLED') alertas.push('Campanha de Busca NÃO está ativa.')
        if (c.biddingStrategyType !== 'MAXIMIZE_CONVERSIONS') alertas.push('Busca saiu de Maximizar Conversões.')
      }
      if (c.id === MARCA_ID && c.status !== 'ENABLED') alertas.push('Campanha de Marca não está ativa.')
      if (c.id === LOJA_ID && c.status !== 'ENABLED') alertas.push('Campanha do BrowSculpt não está ativa.')
    }

    // ── Ontem e acumulado ──
    const pOntem = await periodo(ontem, ontem)
    const pAcum = await periodo(MARCO, hoje)
    linhas.push(`*Ontem (${diaLabel(ontem)}):* ${linhaPeriodo(pOntem)}`)
    let acum = `*Desde ${diaLabel(MARCO)}:* ${linhaPeriodo(pAcum)}`
    if (pAcum.vendas && pAcum.custo) acum += ` · CAC ${brl(pAcum.custo / pAcum.vendas)} · ROAS ${(pAcum.receita / pAcum.custo).toFixed(1)}x`
    linhas.push(acum)

    // Vendas com rastro do Google segundo o CRM (pagas ontem, lead com gclid). O Google data a
    // conversão no dia do CLIQUE, então "vendas de ontem" lá e aqui podem divergir; as duas valem.
    try {
      const { data: pagos } = await admin
        .from('rede_payments')
        .select('amount_cents, paid_at, lead_id, leads!inner(custom_fields)')
        .eq('status', 'paid')
        .gte('paid_at', `${ontem}T03:00:00Z`)
        .lt('paid_at', `${hoje}T03:00:00Z`)
      let n = 0, reais = 0
      for (const p of (pagos ?? []) as Row[]) {
        const attr = p.leads?.custom_fields?.attribution ?? {}
        const gclid = attr.gclid ?? attr.first?.gclid
        if (gclid) { n++; reais += Number(p.amount_cents ?? 0) / 100 }
      }
      if (n) linhas.push(`Vendas pagas ontem com clique do Google (CRM): ${n} · ${brl(reais)}`)
    } catch { /* best-effort */ }

    // ── Grupos da Busca (ontem) ──
    const grupos = await gaql(`
      SELECT ad_group.id, ad_group.name, ad_group.status, metrics.cost_micros, metrics.clicks, metrics.all_conversions
      FROM ad_group WHERE campaign.id = ${BUSCA_ID} AND ad_group.status != 'REMOVED'
        AND segments.date BETWEEN '${ontem}' AND '${ontem}' ORDER BY metrics.cost_micros DESC`)
    const gl = grupos.filter((r) => micros(r.metrics.costMicros) > 0 || Number(r.metrics.clicks ?? 0) > 0)
    if (gl.length) {
      linhas.push('*Grupos da Busca (ontem):*')
      for (const r of gl.slice(0, 5)) {
        const nome = r.adGroup.id === GRUPO_ANTIGO_ID ? 'Grupo antigo' : String(r.adGroup.name).replace('Vitamina para ', 'Vit. ').replace('Tratamento e remédio para queda', 'Tratamento/remédio')
        linhas.push(`• ${nome}: ${brl(micros(r.metrics.costMicros))} · ${num(Number(r.metrics.clicks ?? 0))} cl · ${num(Number(r.metrics.allConversions ?? 0))} conv`)
      }
    }

    // ── Anúncios: aprovação + grupo antigo ──
    const ads = await gaql(`
      SELECT ad_group.id, ad_group.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status
      FROM ad_group_ad WHERE campaign.id = ${BUSCA_ID} AND ad_group_ad.status != 'REMOVED' AND ad_group.status != 'REMOVED'`)
    let novos = 0, aprovados = 0, reprovados = 0, antigoLigado = false
    for (const r of ads) {
      if (r.adGroup.id === GRUPO_ANTIGO_ID) { antigoLigado = r.adGroup.status === 'ENABLED'; continue }
      novos++
      const st = r.adGroupAd?.policySummary?.approvalStatus
      if (st === 'APPROVED' || st === 'APPROVED_LIMITED') aprovados++
      if (st === 'DISAPPROVED') reprovados++
    }
    if (novos) {
      linhas.push(`Anúncios novos: ${aprovados}/${novos} aprovados` + (reprovados ? ` · ${reprovados} REPROVADO(S)` : '') + (aprovados < novos && !reprovados ? ' (resto em revisão)' : ''))
    }
    if (reprovados) alertas.push('Anúncio novo reprovado pelo Google. Ver no painel e ajustar o texto.')
    if (antigoLigado && novos && aprovados === novos && !dry) {
      // Momento certo: os novos entraram, o antigo (QS 1-3, palavras duplicadas) sai.
      const r = await gads('adGroups:mutate', { operations: [{ update: { resourceName: `customers/${(Deno.env.get('GOOGLE_ADS_CUSTOMER_ID') ?? '').replace(/\D/g, '')}/adGroups/${GRUPO_ANTIGO_ID}`, status: 'PAUSED' }, updateMask: 'status' }] })
      linhas.push(r.ok ? 'Grupo antigo da Busca pausado agora (os 4 novos já estão aprovados).' : 'Tentei pausar o grupo antigo e o Google recusou; pausar no painel.')
    } else if (antigoLigado && novos && aprovados < novos) {
      linhas.push('Grupo antigo segue ligado até os novos aprovarem.')
    }

    // ── Loja (gel + shampoo): aprovação por grupo ──
    // O bloco acima só enxerga a Busca. Sem isto, um anúncio da Loja reprovado ficaria invisível
    // e a campanha rodaria sem entregar, gastando a verba que deveria zerar o saldo.
    const adsLoja = await gaql(`
      SELECT ad_group.name, ad_group_ad.policy_summary.approval_status
      FROM ad_group_ad WHERE campaign.id = ${LOJA_ID} AND ad_group_ad.status != 'REMOVED' AND ad_group.status != 'REMOVED'`)
    if (adsLoja.length) {
      const reprovadosLoja = adsLoja.filter((r: Row) => r.adGroupAd?.policySummary?.approvalStatus === 'DISAPPROVED')
      const okLoja = adsLoja.filter((r: Row) => {
        const st = r.adGroupAd?.policySummary?.approvalStatus
        return st === 'APPROVED' || st === 'APPROVED_LIMITED'
      }).length
      linhas.push(`BrowSculpt (gel): ${okLoja}/${adsLoja.length} anúncios aprovados` + (reprovadosLoja.length ? ` · ${reprovadosLoja.length} REPROVADO(S)` : ''))
      for (const r of reprovadosLoja) alertas.push(`Anúncio reprovado no grupo "${r.adGroup?.name}" do BrowSculpt. Ajustar o texto no painel.`)
    }

    // ── Saldo da conta e ritmo ──
    const ab = (await gaql(`
      SELECT account_budget.adjusted_spending_limit_micros, account_budget.approved_spending_limit_micros, account_budget.amount_served_micros
      FROM account_budget WHERE account_budget.status = 'APPROVED'`))[0]?.accountBudget
    if (ab) {
      const teto = micros(ab.adjustedSpendingLimitMicros ?? ab.approvedSpendingLimitMicros)
      const servido = micros(ab.amountServedMicros)
      const saldo = Math.max(0, teto - servido)
      const dias = Math.max(1, diasEntre(hoje, PRAZO_GASTO) + 1)
      const precisa = saldo / dias
      let s = `*Saldo da conta:* ${brl(saldo)}`
      if (hoje <= PRAZO_GASTO) s += ` · ${dias} dia${dias === 1 ? '' : 's'} até 31/08 · precisa ${brl(precisa)}/dia · orçamento ativo ${brl(orcamentoDia)}/dia`
      linhas.push(s)
      if (saldo <= 0) alertas.push('SALDO DA CONTA ZERADO: os anúncios pararam. Subir o teto em Faturamento no painel do Google Ads.')
      else if (saldo < precisa) alertas.push('Saldo da conta acaba hoje. Se quiser continuar, subir o teto em Faturamento.')
      else if (hoje <= PRAZO_GASTO && orcamentoDia < precisa * 0.85) alertas.push(`Orçamento diário (${brl(orcamentoDia)}) abaixo do ritmo pra zerar o saldo até 31/08 (${brl(precisa)}/dia).`)
    } else {
      alertas.push('Não achei o teto de gasto da conta (account_budget). Conferir Faturamento.')
    }

    // ── Alertas de desempenho (só com volume) ──
    if (pOntem.custo > 0 && pOntem.custo < 30 && hoje > MARCO) alertas.push(`Ontem gastou só ${brl(pOntem.custo)}: a entrega travou (revisão, teto ou lance).`)
    if (pOntem.cliques >= 40 && pOntem.leads === 0) alertas.push(`${num(pOntem.cliques)} cliques ontem e ZERO lead: o problema é a /protocolo, não a campanha.`)
    if (pOntem.cliques >= 20 && pOntem.custo / pOntem.cliques > 2.5 && pOntem.leads / pOntem.cliques < 0.03) alertas.push('CPC acima de R$ 2,50 sem lead ontem. Se repetir 3 dias, voltar pra maximizar cliques.')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    linhas.push(`Não consegui ler a conta do Google Ads hoje: ${msg.slice(0, 160)}`)
  }

  const cab = `📊 *Google Ads Tricopill* · ${diaLabel(hoje)}`
  const texto = [
    cab,
    ...(alertas.length ? ['', ...alertas.map((a) => `⚠️ ${a}`)] : []),
    '',
    ...linhas,
    '',
    'Lead = clique no WhatsApp; venda = ação Compras (o Google data no dia do clique).',
  ].join('\n')

  if (dry) return json({ ok: true, dry: true, texto, alertas })

  // Destinatários: gads_report_phones ou, na falta, os donos do comprovante de venda.
  const { data: ti } = await admin.from('tenant_integrations').select('notifications').eq('tenant_id', TENANT).maybeSingle()
  const cfg = ((ti as Row | null)?.notifications ?? {}) as Row
  const configured = Array.isArray(cfg.gads_report_phones) && cfg.gads_report_phones.length
    ? cfg.gads_report_phones
    : (Array.isArray(cfg.sales_receipt_owner_phones) ? cfg.sales_receipt_owner_phones : [])
  const phones: string[] = (onlyPhone ? [onlyPhone] : configured).map((p: unknown) => String(p).replace(/\D/g, '')).filter((p: string) => p.length >= 12)
  if (!phones.length) return json({ ok: false, error: 'sem_destinatario', texto }, 200)

  const enviados: string[] = []
  for (const phone of phones) {
    if (await sendWapiDirectText(admin, TENANT, phone, texto)) enviados.push(phone)
  }
  return json({ ok: enviados.length > 0, enviados, alertas, texto })
})
