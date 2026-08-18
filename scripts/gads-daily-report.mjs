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
// 27/07: PMax pausada, Busca religada em frase + maximizar cliques.
// 17/08: Busca reestruturada de novo — 1 grupo com 43 palavras (QS 1-3) virou 4 grupos
// temáticos com RSA própria, lance foi para MAXIMIZAR CONVERSÕES, orçamento R$100/dia.
const MARCO = '2026-08-17'
const PMAX_ID = '24022345891'
const BUSCA_ID = '24041701832'
const MARCA_ID = '24125006145'
// Grupo antigo da Busca. Fica ENABLED só até os 4 anúncios novos serem aprovados;
// depois deve ser PAUSADO (o relatório avisa quando chegar a hora).
const GRUPO_ANTIGO_ID = '197790938385'

// Ações de conversão. Só "Compras" é venda; "Lead WhatsApp" é sinal de volume.
// Somar as duas num número só foi o erro do relatório de 29/07: mostrou "4 conversões,
// CPA R$ 47" quando eram 4 cliques de WhatsApp e ZERO venda naquele recorte.
const ACAO_VENDA = 'Compras'

// A conta tem um LIMITE DE GASTO no nível da conta (account_budget). Foi isso que matou
// a veiculação de 02/08 a 16/08: o teto de ~R$880 esgotou e ninguém viu. Em 17/08 o
// teto subiu para ~R$2.380 (sobraram ~R$1.500) e a meta do Álvaro é gastar tudo até
// 31/08. O saldo vem da API, não de constante — se o Álvaro mexer no teto, o relatório
// acompanha sozinho.
const PRAZO_GASTO = '2026-08-31'

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
 * Pergunta pro próprio crm-gads-lead-upload em modo dry: ele devolve as contagens sem enviar
 * nada. Devolve null quando não dá pra consultar — o relatório segue sem essa linha.
 *
 * O que interessa é `gclids_unicos`, não a soma de eventos: a ação "Lead WhatsApp" é
 * ONE_PER_CLICK, então repetição do mesmo gclid nunca vira conversão nova.
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
    return {
      eventos: Number(j?.ja_subiu ?? 0) + Number(j?.enviados ?? 0),
      unicos: Number(j?.gclids_unicos ?? 0),
      semProtocolo: Number(j?.sem_protocolo ?? 0),
    }
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
    FROM campaign WHERE campaign.status != 'REMOVED'`)
  console.log('\n▸ CAMPANHAS')
  let orcamentoDia = 0
  for (const r of camps) {
    const c = r.campaign, b = r.campaignBudget ?? {}
    const teto = micros(c.targetSpend?.cpcBidCeilingMicros)
    if (c.status === 'ENABLED') orcamentoDia += micros(b.amountMicros)
    console.log(`  ${c.name} [${c.status}]`)
    console.log(`     ${c.primaryStatus ?? '-'} ${(c.primaryStatusReasons ?? []).join(', ')}`)
    console.log(`     ${c.biddingStrategyType} · orçamento ${brl(micros(b.amountMicros))}/dia` +
      (teto ? ` · teto CPC ${brl(teto)}` : ''))
    if (c.id === PMAX_ID && c.status !== 'PAUSED') console.log('     ⚠ PMax fora de PAUSED — alguém religou.')
    if (c.id === BUSCA_ID && c.biddingStrategyType !== 'MAXIMIZE_CONVERSIONS') {
      console.log('     ⚠ Busca fora de MAXIMIZE_CONVERSIONS — a estratégia de 17/08 foi trocada.')
    }
  }

  // ── 1b. Grupos da Busca: anúncios novos aprovados? grupo antigo ainda ligado? ──
  const grupos = await gaql(`
    SELECT ad_group.id, ad_group.name, ad_group.status, ad_group_ad.ad.id,
           ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
           ad_group_ad.ad_strength
    FROM ad_group_ad
    WHERE campaign.id = ${BUSCA_ID} AND ad_group_ad.status != 'REMOVED' AND ad_group.status != 'REMOVED'`)
  console.log('\n▸ GRUPOS DA BUSCA (anúncio · aprovação · força)')
  let antigoLigado = false, novosAprovados = 0, novosTotal = 0
  for (const r of grupos) {
    const g = r.adGroup, a = r.adGroupAd, ps = a.policySummary ?? {}
    const antigo = g.id === GRUPO_ANTIGO_ID
    if (antigo) antigoLigado = g.status === 'ENABLED'
    else { novosTotal++; if (ps.approvalStatus === 'APPROVED') novosAprovados++ }
    console.log(`  ${antigo ? '(antigo) ' : ''}${g.name} [${g.status}] · ${ps.approvalStatus ?? '?'}/${ps.reviewStatus ?? '?'} · força ${a.adStrength ?? '?'}`)
  }
  if (antigoLigado && novosTotal && novosAprovados === novosTotal) {
    console.log(`\n  ⚠ AÇÃO: os ${novosTotal} anúncios novos já estão APROVADOS e o grupo antigo (${GRUPO_ANTIGO_ID})`)
    console.log('     segue ENABLED. Ele só ficou ligado para não apagar a campanha durante a revisão.')
    console.log('     Pausar agora — as palavras dele duplicam as dos grupos novos e têm QS 1-3.')
  } else if (antigoLigado) {
    console.log(`\n  (grupo antigo segue ligado de propósito: ${novosAprovados}/${novosTotal} anúncios novos aprovados)`)
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
    // Comparar com gclid ÚNICO, não com evento. A ação "Lead WhatsApp" é ONE_PER_CLICK: a
    // mesma pessoa clicando 3x no botão do site vale 1 conversão. Em 18/08 a linha antiga
    // dizia "31 enviadas não apareceram" comparando 47 eventos com 16 conversões, e as duas
    // pontas estavam certas — o que estava errado era a régua.
    const repetidos = Math.max(0, enviados.eventos - enviados.unicos)
    console.log(`  enviados pelo CRM (30d): ${enviados.unicos} gclids únicos` +
      (repetidos ? ` (${enviados.eventos} cliques, ${repetidos} são repetição do mesmo gclid)` : ''))
    if (enviados.unicos > 0 && leadReg === 0) {
      console.log(`\n  ⚠ FURO DE TELEMETRIA: ${enviados.unicos} conversões enviadas, ZERO registradas pelo Google.`)
      console.log('     A ingestão do Data Manager é assíncrona; até ~24h de atraso é normal.')
      console.log('     Passou disso, o Google está recusando calado — conferir o requestId gravado')
      console.log('     em storefront_events.meta.gads_lead_request_id e o escopo do OAuth.')
    } else if (enviados.unicos > leadReg) {
      const falta = enviados.unicos - leadReg
      console.log(`  ${falta} ainda não apareceram no Google. O Google data a conversão no dia do`)
      console.log('     CLIQUE NO ANÚNCIO e a ingestão é assíncrona, então o do dia sempre fica em voo.')
      console.log('     Só vira problema se o mesmo gclid seguir ausente depois de ~24h.')
    }
    if (enviados.semProtocolo > 0) {
      console.log(`  ⚠ ${enviados.semProtocolo} evento(s) carimbado(s) como enviado SEM requestId.`)
      console.log('     É a assinatura do lote de 29/07/2026, que subiu quando HTTP 200 era lido como')
      console.log('     registro: fica marcado como enviado e o cron nunca retenta. Limpar')
      console.log('     meta.gads_lead_uploaded_at desses eventos para reenfileirar (janela: 30 dias')
      console.log('     do clique, passou disso o Google recusa).')
    }
  }

  // ── 4b. Desempenho por grupo da Busca no período ──
  const porGrupo = await gaql(`
    SELECT ad_group.name, ad_group.status, metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.ctr, metrics.average_cpc, metrics.all_conversions
    FROM ad_group WHERE campaign.id = ${BUSCA_ID} AND segments.date BETWEEN '${desde}' AND '${ate}'
    ORDER BY metrics.cost_micros DESC`)
  if (porGrupo.length) {
    console.log('\n▸ BUSCA POR GRUPO (o número de conversão aqui mistura lead e venda)')
    for (const r of porGrupo) {
      const m = r.metrics
      console.log(`  ${brl(micros(m.costMicros)).padStart(11)} · ${String(m.clicks ?? 0).padStart(4)} cl · CTR ${(Number(m.ctr ?? 0) * 100).toFixed(1)}% · CPC ${brl(micros(m.averageCpc))} · ${m.allConversions ?? 0} conv · ${r.adGroup.name} [${r.adGroup.status}]`)
    }
  }

  // ── 5. Saldo da conta e ritmo até o prazo ──
  // A conta tem teto de gasto (account_budget). O que sobrar depois do prazo é dinheiro
  // que o Álvaro quis gastar e ficou parado; gastar antes do prazo compra lixo mais rápido.
  const hoje = ymd(new Date())
  const ab = (await gaql(`
    SELECT account_budget.status, account_budget.adjusted_spending_limit_micros,
           account_budget.approved_spending_limit_micros, account_budget.amount_served_micros
    FROM account_budget WHERE account_budget.status = 'APPROVED'`))[0]?.accountBudget
  if (ab) {
    const teto = micros(ab.adjustedSpendingLimitMicros ?? ab.approvedSpendingLimitMicros)
    const servido = micros(ab.amountServedMicros)
    const saldo = Math.max(0, teto - servido)
    const diasRestantes = Math.max(1, Math.round((new Date(PRAZO_GASTO) - new Date(hoje)) / 864e5) + 1)
    const precisa = saldo / diasRestantes
    console.log(`\n▸ SALDO DA CONTA (teto ${brl(teto)} · já servido ${brl(servido)})`)
    console.log(`  saldo ${brl(saldo)} · ${diasRestantes} dia(s) até ${PRAZO_GASTO} · precisa gastar ${brl(precisa)}/dia`)
    console.log(`  orçamento diário somado das campanhas ativas: ${brl(orcamentoDia)}/dia` +
      (orcamentoDia >= precisa * 0.9 ? ' ✔' : ' ⚠ abaixo do necessário para zerar o saldo no prazo'))
    if (saldo <= 0) console.log('  ⚠ SALDO ZERADO: a conta parou de veicular. Foi assim de 02/08 a 16/08. Subir o teto no painel (Faturamento).')
    else if (hoje > PRAZO_GASTO) console.log(`  (prazo ${PRAZO_GASTO} passou; sobrou ${brl(saldo)})`)
  } else {
    console.log('\n▸ SALDO DA CONTA: não achei account_budget APPROVED — conferir Faturamento no painel.')
  }

  console.log('\n▸ LEMBRETE DE LEITURA')
  console.log('  O Google conta a conversão dele; o CRM conta a venda com gclid. Os dois números')
  console.log('  divergem por atraso de ingestão. Para o número de negócio, use a aba do relatório.')
  console.log('  Não julgar o canal antes de 20-30 conversões acumuladas.')
  console.log('')
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
