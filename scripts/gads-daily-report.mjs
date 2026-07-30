#!/usr/bin/env node
/**
 * Relatório diário do Google Ads do Tricopill.
 *
 * Por que existe: em 27/07/2026 a conta foi reestruturada (PMax pausada, campanha
 * de Busca religada com correspondência de frase e maximizar cliques). O risco da
 * primeira semana é a Busca gastar em termo irrelevante antes de alguém olhar.
 * Este script puxa o essencial num relatório curto para revisar todo dia.
 *
 * Lê as credenciais via proxy do `crm-gads-backfill` (header x-reship-secret =
 * RESHIP_SECRET do .env.local). Só faz LEITURA — nunca altera a conta.
 *
 * Uso:  node scripts/gads-daily-report.mjs [dias]
 *       dias = janela de análise (padrão 7)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FN = 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-gads-backfill'

// Reestruturação da conta — antes disso os números não são comparáveis.
const MARCO = '2026-07-27'
const PMAX_ID = '24022345891'
const BUSCA_ID = '24041701832'

// Ações de conversão. Só "Compras" é venda; "Lead WhatsApp" é sinal de volume.
// Somar as duas num número só foi o erro do relatório de 29/07: mostrou "4 conversões,
// CPA R$ 47" quando eram 4 cliques de WhatsApp e ZERO venda naquele recorte.
const ACAO_VENDA = 'Compras'

// Promoção do Google: gastar META até FIM devolve o mesmo valor em crédito.
// Álvaro confirmou em 29/07/2026 que o código foi aplicado. INICIO é a data que
// assumimos para a contagem — se o crédito não bater no fim, é aqui que está o erro.
const PROMO = { inicio: '2026-07-27', fim: '2026-08-15', meta: 880 }

function secret() {
  try {
    const env = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const m = /^RESHIP_SECRET=(.*)$/m.exec(env)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch { /* cai no erro abaixo */ }
  throw new Error('RESHIP_SECRET não encontrado no .env.local da raiz do repo.')
}

async function gaql(query) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-reship-secret': secret() },
    body: JSON.stringify({ action: 'ads', path: 'googleAds:search', body: { query } }),
  })
  const json = await res.json().catch(() => ({}))
  if (json?.status !== 200) {
    const msg = JSON.stringify(json?.body ?? json).slice(0, 300)
    throw new Error(`Google Ads recusou a consulta: ${msg}`)
  }
  return json.body?.results ?? []
}

/**
 * Quantos cliques de WhatsApp com gclid o CRM já mandou pro Google (últimos 30 dias).
 * Pergunta pro próprio crm-gads-lead-upload em modo dry: ele devolve `ja_subiu` sem enviar
 * nada. Devolve null quando não dá pra consultar — o relatório segue sem essa linha.
 */
async function leadsEnviados() {
  try {
    const env = readFileSync(join(ROOT, '.env.local'), 'utf8')
    const anon = /^VITE_SUPABASE_ANON_KEY=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '')
    if (!anon) return null
    const res = await fetch('https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-gads-lead-upload?dry=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}` },
      body: '{}',
    })
    if (!res.ok) return null
    const j = await res.json()
    return Number(j?.ja_subiu ?? 0) + Number(j?.enviados ?? 0)
  } catch {
    return null
  }
}

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n) => Number(n ?? 0).toLocaleString('pt-BR')
const micros = (v) => Number(v ?? 0) / 1e6
// Dia LOCAL, não UTC. toISOString() vira o dia às 21h de Maringá e o relatório passaria
// a pedir ao Google um dia que ainda não começou. Mesma pegadinha de fuso do resto do CRM.
const FUSO = 'America/Sao_Paulo'
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
const ymd = (d) => fmtDia.format(d)

function janela(dias) {
  const fim = new Date()
  const ini = new Date(fim.getTime() - dias * 864e5)
  // nunca antes da reestruturação: misturar os dois períodos engana a leitura
  const desde = ymd(ini) < MARCO ? MARCO : ymd(ini)
  return { desde, ate: ymd(fim) }
}

async function main() {
  const dias = Number(process.argv[2] ?? 7) || 7
  const { desde, ate } = janela(dias)

  console.log('═'.repeat(72))
  console.log(`GOOGLE ADS TRICOPILL — ${desde} a ${ate}`)
  console.log(`(marco da reestruturação: ${MARCO})`)
  console.log('═'.repeat(72))

  // ── 1. Estado das campanhas ──
  const camps = await gaql(`
    SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status,
           campaign.primary_status_reasons, campaign.bidding_strategy_type,
           campaign.target_spend.cpc_bid_ceiling_micros, campaign_budget.amount_micros
    FROM campaign`)
  console.log('\n▸ CAMPANHAS')
  for (const r of camps) {
    const c = r.campaign, b = r.campaignBudget ?? {}
    const teto = micros(c.targetSpend?.cpcBidCeilingMicros)
    console.log(`  ${c.name} [${c.status}]`)
    console.log(`     ${c.primaryStatus ?? '-'} ${(c.primaryStatusReasons ?? []).join(', ')}`)
    console.log(`     ${c.biddingStrategyType} · orçamento ${brl(micros(b.amountMicros))}/dia` +
      (teto ? ` · teto CPC ${brl(teto)}` : ''))
  }

  // ── 2. Desempenho no período ──
  const perf = await gaql(`
    SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.clicks,
           metrics.impressions, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE segments.date BETWEEN '${desde}' AND '${ate}'`)
  // Conversões separadas por ação: venda e lead NÃO podem virar um número só.
  const convPorAcao = await gaql(`
    SELECT segments.conversion_action_name, metrics.conversions, metrics.all_conversions,
           metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${desde}' AND '${ate}' AND metrics.all_conversions > 0`)
  // `conversions` só conta o que entra no lance; `all_conversions` conta tudo que a conta
  // registrou. Em 29/07 uma venda apareceu como all=1 e conv=0 — reportar só a primeira
  // faria o relatório dizer "0 vendas" num dia em que houve venda.
  let vendas = 0, vendasTodas = 0, receita = 0, leads = 0
  for (const r of convPorAcao) {
    const qtd = Number(r.metrics.conversions ?? 0)
    const todas = Number(r.metrics.allConversions ?? 0)
    if (r.segments.conversionActionName === ACAO_VENDA) {
      vendas += qtd; vendasTodas += todas; receita += Number(r.metrics.conversionsValue ?? 0)
    } else leads += todas
  }

  console.log('\n▸ DESEMPENHO NO PERÍODO')
  let custoTotal = 0, cliquesTotal = 0
  if (!perf.length) console.log('  (nenhuma veiculação ainda)')
  for (const r of perf) {
    const m = r.metrics, custo = micros(m.costMicros)
    const cliques = Number(m.clicks ?? 0)
    custoTotal += custo; cliquesTotal += cliques
    const cpc = cliques ? custo / cliques : 0
    console.log(`  ${r.campaign.name}`)
    console.log(`     ${brl(custo)} · ${num(cliques)} cliques · ${num(m.impressions)} impressões · CPC ${brl(cpc)}`)
  }
  if (perf.length) {
    console.log(`  ── total: ${brl(custoTotal)} · ${num(cliquesTotal)} cliques`)
    console.log(`\n  VENDAS (ação "${ACAO_VENDA}"): ${vendasTodas}` +
      (vendasTodas !== vendas ? ` (${vendas} contam para o lance)` : '') +
      (receita ? ` · receita ${brl(receita)} · CAC ${brl(custoTotal / vendasTodas)} · ROAS ${(receita / custoTotal).toFixed(1)}x` : ''))
    console.log(`  Leads (WhatsApp e afins): ${leads}  ← sinal de volume, NÃO é venda`)
    if (!vendasTodas && leads) {
      console.log('     ⚠ Zero venda no período. Os leads acima não viram receita nenhuma.')
    }
    console.log('     Obs.: o Google data a conversão no dia do CLIQUE, não da compra. Uma venda de')
    console.log('     hoje pode aparecer numa data anterior — não casar "gasto de hoje x venda de hoje".')
  }

  // ── 3. Termos de pesquisa: onde o dinheiro da Busca está indo ──
  const termos = await gaql(`
    SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions
    FROM search_term_view
    WHERE segments.date BETWEEN '${desde}' AND '${ate}' AND campaign.id = ${BUSCA_ID}
    ORDER BY metrics.cost_micros DESC LIMIT 40`)
  console.log('\n▸ TERMOS DE PESQUISA DA BUSCA (o que as pessoas digitaram)')
  if (!termos.length) {
    console.log('  (ainda sem dados — o relatório de termos leva 1 a 2 dias para popular)')
  } else {
    for (const r of termos) {
      const custo = micros(r.metrics.costMicros), conv = Number(r.metrics.conversions ?? 0)
      const flag = conv > 0 ? '✔' : (custo >= 10 ? '⚠' : ' ')
      console.log(`  ${flag} ${brl(custo).padStart(11)} · ${String(r.metrics.clicks).padStart(3)} cl · ` +
        `${conv} conv · ${r.searchTermView.searchTerm}`)
    }
    const desperdicio = termos
      .filter((r) => Number(r.metrics.conversions ?? 0) === 0 && micros(r.metrics.costMicros) >= 10)
    if (desperdicio.length) {
      const soma = desperdicio.reduce((a, r) => a + micros(r.metrics.costMicros), 0)
      console.log(`\n  ⚠ ${desperdicio.length} termo(s) com R$ 10+ gastos e ZERO conversão (${brl(soma)}).`)
      console.log('     Revisar: se o termo não tem intenção de compra, adicionar como palavra negativa.')
    }
  }

  // ── 4. O que ENVIAMOS x o que o Google REGISTROU ──
  // Por que existe: em 29/07/2026 o CRM tinha 29 cliques de WhatsApp carimbados como
  // "enviado ao Google" e a conta mostrava ZERO conversão de lead. O envio devolvia HTTP 200
  // e ninguém conferia o outro lado. Enviado não é registrado: só a conta do Google prova.
  console.log('\n▸ CONVERSÕES: ENVIADO x REGISTRADO')
  const porAcao = await gaql(`
    SELECT segments.conversion_action_name, metrics.all_conversions
    FROM campaign WHERE segments.date DURING LAST_30_DAYS AND metrics.all_conversions > 0`)
  const registrado = new Map()
  for (const r of porAcao) {
    const nome = r.segments.conversionActionName
    registrado.set(nome, (registrado.get(nome) ?? 0) + Number(r.metrics.allConversions ?? 0))
  }
  if (registrado.size) {
    for (const [nome, qtd] of registrado) console.log(`  registrado no Google (30d): ${nome} — ${qtd}`)
  } else {
    console.log('  registrado no Google (30d): NENHUMA conversão de nenhuma ação.')
  }

  const enviados = await leadsEnviados()
  if (enviados === null) {
    console.log('  enviados pelo CRM: não deu para consultar (confira VITE_SUPABASE_ANON_KEY no .env.local).')
  } else {
    const leadReg = registrado.get('Lead WhatsApp') ?? 0
    console.log(`  enviados pelo CRM (30d): ${enviados} cliques de WhatsApp com gclid`)
    if (enviados > 0 && leadReg === 0) {
      console.log(`\n  ⚠ FURO DE TELEMETRIA: ${enviados} conversões enviadas, ZERO registradas pelo Google.`)
      console.log('     A ingestão do Data Manager é assíncrona; até ~24h de atraso é normal.')
      console.log('     Passou disso, o Google está recusando calado — conferir o requestId gravado')
      console.log('     em storefront_events.meta.gads_lead_request_id e o escopo do OAuth.')
    } else if (enviados > leadReg) {
      console.log(`  ⚠ ${enviados - leadReg} enviadas ainda não apareceram no Google (atraso ou recusa).`)
    }
  }

  // ── 5. Ritmo da promoção ──
  // Gastar de menos perde o crédito; gastar de mais só para bater a meta compra lixo.
  const hoje = ymd(new Date())
  if (hoje <= PROMO.fim) {
    const gastoPromo = (await gaql(`
      SELECT metrics.cost_micros FROM customer
      WHERE segments.date BETWEEN '${PROMO.inicio}' AND '${hoje}'`))
      .reduce((a, r) => a + micros(r.metrics.costMicros), 0)
    const falta = Math.max(0, PROMO.meta - gastoPromo)
    const diasRestantes = Math.max(1, Math.round((new Date(PROMO.fim) - new Date(hoje)) / 864e5))
    const precisa = falta / diasRestantes
    const ritmo = gastoPromo / Math.max(1, Math.round((new Date(hoje) - new Date(PROMO.inicio)) / 864e5) + 1)
    console.log(`\n▸ PROMOÇÃO (${brl(PROMO.meta)} de crédito até ${PROMO.fim})`)
    console.log(`  gasto desde ${PROMO.inicio}: ${brl(gastoPromo)} · falta ${brl(falta)} em ${diasRestantes} dia(s)`)
    console.log(`  precisa ${brl(precisa)}/dia · ritmo atual ${brl(ritmo)}/dia` +
      (ritmo >= precisa ? ' ✔ no ritmo' : ' ⚠ abaixo do necessário'))
    if (falta === 0) console.log('  ✔ meta batida.')
  }

  console.log('\n▸ LEMBRETE DE LEITURA')
  console.log('  O Google conta a conversão dele; o CRM conta a venda com gclid. Os dois números')
  console.log('  divergem por atraso de ingestão. Para o número de negócio, use a aba do relatório.')
  console.log('  Não julgar o canal antes de 20-30 conversões acumuladas.')
  console.log('')
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
