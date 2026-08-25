/**
 * crm-meta-ads-sync — o resultado volta para o anúncio.
 *
 * A conta de anúncio da clínica otimizava por "formulário preenchido". Em
 * julho e agosto isso rendeu 860 leads de formulário e 1 venda. O algoritmo
 * fez o que foi pedido; o pedido é que estava errado.
 *
 * Duas ações:
 *
 *   action=capi     (cron de 30 em 30 min)
 *     Devolve Contact / Schedule / Purchase para a Meta usando o `lead_id`
 *     dela própria como chave. Nenhum dado pessoal sai daqui: sem telefone,
 *     sem nome, sem CPF.
 *
 *   action=audience (cron diário, 06h40)
 *     Refaz o público de clientes com telefone em SHA-256. O hash é gerado
 *     DENTRO do Postgres (crm_meta_audience_seed), então número em claro não
 *     passa nem por esta função.
 *
 * PEGADINHA QUE DEFINE TUDO: o pixel recusa evento com mais de 7 dias
 * ("Event Timestamp Too Old", subcode 2804003). Não há backfill possível. Foi
 * assim que 44 eventos históricos viraram 17 na primeira carga manual.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Pixel que realmente dispara na conta CA - Dra Lorena Visentainer. */
const PIXEL_ID = Deno.env.get('META_ADS_PIXEL_ID') ?? '1191608098555930'
/** Público de clientes criado em 25/08/2026. */
const AUDIENCE_ID = Deno.env.get('META_ADS_AUDIENCE_ID') ?? '120249782280800061'
/** 'paciente' é o melhor sinal; 'conversa' inclui quem só respondeu, e é o que passa do mínimo da Meta. */
const AUDIENCE_LAYER = Deno.env.get('META_ADS_AUDIENCE_LAYER') ?? 'conversa'

/** A Meta aceita lotes grandes, mas lote menor deixa o erro localizável. */
const CAPI_BATCH = 40
const AUDIENCE_BATCH = 500

type Pendente = {
  lead_id: string
  leadgen_id: string
  event_name: string
  event_time: string
  value_reais: number | null
}

async function enviarCapi(admin: SupabaseClient, token: string, dias: number) {
  const { data, error } = await admin.rpc('crm_meta_capi_pendentes', { dias })
  if (error) return { ok: false, erro: `rpc: ${error.message}` }
  const pend = (data ?? []) as Pendente[]
  if (!pend.length) return { ok: true, pendentes: 0, enviados: 0, falhas: 0 }

  let enviados = 0
  let falhas = 0
  const detalhes: string[] = []

  for (let i = 0; i < pend.length; i += CAPI_BATCH) {
    const lote = pend.slice(i, i + CAPI_BATCH)
    const eventos = lote.map((p) => {
      const ev: Record<string, unknown> = {
        event_name: p.event_name,
        event_time: Math.floor(new Date(p.event_time).getTime() / 1000),
        action_source: 'system_generated',
        user_data: { lead_id: Number(p.leadgen_id) },
      }
      if (p.value_reais != null) ev.custom_data = { value: Number(p.value_reais), currency: 'BRL' }
      return ev
    })

    let corpo = ''
    let sucesso = false
    try {
      const body = new URLSearchParams({ data: JSON.stringify(eventos), access_token: token })
      const res = await fetch(`${GRAPH}/${PIXEL_ID}/events`, { method: 'POST', body })
      corpo = (await res.text()).slice(0, 500)
      sucesso = res.ok && !corpo.includes('"error"')
    } catch (e) {
      corpo = e instanceof Error ? e.message : String(e)
    }

    // Marca lote inteiro. Falha fica registrada com ok=false e volta na próxima
    // rodada — até a janela de 7 dias fechar, quando o evento se perde de vez.
    const linhas = lote.map((p) => ({
      lead_id: p.lead_id,
      event_name: p.event_name,
      leadgen_id: p.leadgen_id,
      event_time: p.event_time,
      sent_at: new Date().toISOString(),
      ok: sucesso,
      response: corpo,
    }))
    const { error: upErr } = await admin
      .from('meta_capi_events')
      .upsert(linhas, { onConflict: 'lead_id,event_name' })
    if (upErr) detalhes.push(`log: ${upErr.message}`)

    if (sucesso) enviados += lote.length
    else {
      falhas += lote.length
      detalhes.push(corpo.slice(0, 200))
    }
  }

  return { ok: falhas === 0, pendentes: pend.length, enviados, falhas, detalhes: detalhes.slice(0, 3) }
}

async function refazerPublico(admin: SupabaseClient, token: string) {
  // PostgREST corta em 1.000 linhas e NÃO avisa: a primeira carga subiu 1.000
  // de 1.600 e respondeu ok. Por isso a semente vem paginada, e o total vem
  // por fora para conferir se subiu tudo.
  const hashes: string[] = []
  for (let off = 0; ; off += AUDIENCE_BATCH) {
    const { data, error } = await admin.rpc('crm_meta_audience_seed', {
      camada: AUDIENCE_LAYER, lote: AUDIENCE_BATCH, deslocamento: off,
    })
    if (error) return { ok: false, erro: `rpc: ${error.message}` }
    const pagina = ((data ?? []) as Array<{ hash: string }>).map((r) => r.hash).filter(Boolean)
    hashes.push(...pagina)
    if (pagina.length < AUDIENCE_BATCH) break
    if (off > 50000) break // trava de laço
  }
  if (!hashes.length) return { ok: false, erro: 'semente vazia' }

  const { data: totalRow } = await admin.rpc('crm_meta_audience_seed_total', { camada: AUDIENCE_LAYER })
  const total = Number(totalRow ?? hashes.length)

  let recebidos = 0
  let invalidos = 0
  const erros: string[] = []

  for (let i = 0; i < hashes.length; i += AUDIENCE_BATCH) {
    const lote = hashes.slice(i, i + AUDIENCE_BATCH)
    const payload = { schema: ['PHONE'], data: lote.map((h) => [h]) }
    try {
      const body = new URLSearchParams({ payload: JSON.stringify(payload), access_token: token })
      const res = await fetch(`${GRAPH}/${AUDIENCE_ID}/users`, { method: 'POST', body })
      const txt = await res.text()
      const j = JSON.parse(txt) as { num_received?: number; num_invalid_entries?: number; error?: unknown }
      if (j.error) erros.push(txt.slice(0, 200))
      recebidos += j.num_received ?? 0
      invalidos += j.num_invalid_entries ?? 0
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e))
    }
  }

  // `completo` é a guarda contra o truncamento silencioso: se a semente que
  // subiu for menor que o total real, a resposta diz, em vez de dizer ok.
  const completo = hashes.length === total && recebidos === hashes.length
  return {
    ok: erros.length === 0 && completo,
    camada: AUDIENCE_LAYER, total, semente: hashes.length, recebidos, invalidos,
    completo, erros: erros.slice(0, 2),
  }
}

/**
 * Puxa gasto e entrega da conta e grava em `meta_ads_insights`.
 *
 * Dois níveis na mesma rodada: campanha (o que a tela mostra por padrão) e
 * anúncio (o que responde "qual criativo está pagando"). A janela volta alguns
 * dias de propósito: a Meta reprocessa número de ontem e de anteontem, e o
 * upsert por (dia, nível, chave) faz a correção entrar sem duplicar linha.
 */
async function puxarInsights(admin: SupabaseClient, token: string, dias: number) {
  const ate = new Date()
  const desde = new Date(ate.getTime() - Math.max(dias, 1) * 86400_000)
  const janela = JSON.stringify({
    since: desde.toISOString().slice(0, 10),
    until: ate.toISOString().slice(0, 10),
  })

  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  const niveis: Array<['campanha' | 'anuncio', string]> = [['campanha', 'campaign'], ['anuncio', 'ad']]
  const linhas: Array<Record<string, unknown>> = []
  const erros: string[] = []

  for (const [nivel, level] of niveis) {
    const qs = new URLSearchParams({
      level,
      time_range: janela,
      time_increment: '1',
      // `reach` sai no nível de anúncio: com time_increment diário ele pesa e é
      // o primeiro campo que a Meta derruba sob cota.
      fields: 'campaign_id,campaign_name,adset_name,ad_id,ad_name,spend,impressions,clicks,actions'
        + (nivel === 'campanha' ? ',reach' : ''),
      limit: '500',
      access_token: token,
    })
    // A Meta responde "Service temporarily unavailable" quando as duas chamadas
    // saem coladas: o nível de campanha e o de anúncio disputam a mesma cota.
    // Não é erro de parâmetro, é ritmo. Três tentativas com espera crescente
    // resolvem; sem isso o nível de anúncio simplesmente não entrava.
    let j: { data?: Array<Record<string, unknown>>; error?: { message?: string } } = {}
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const res = await fetch(`${GRAPH}/${conta}/insights?${qs}`)
      j = await res.json()
      if (!j.error) break
      const transitorio = /temporarily unavailable|rate limit|try again|reduce the amount/i
        .test(String(j.error.message ?? ''))
      if (!transitorio || tentativa === 3) break
      await new Promise((r) => setTimeout(r, tentativa * 4000))
    }
    try {
      if (j.error) { erros.push(`${nivel}: ${j.error.message}`); continue }
      for (const r of j.data ?? []) {
        const acoes = (r.actions ?? []) as Array<{ action_type: string; value: string }>
        const m = new Map(acoes.map((a) => [a.action_type, Number(a.value)]))
        const leads = (m.get('lead') ?? 0) + (m.get('leadgen.other') ?? 0) +
          (m.get('offsite_conversion.fb_pixel_lead') ?? 0)
        const conversas = m.get('onsite_conversion.messaging_conversation_started_7d') ?? 0
        const chave = nivel === 'anuncio' ? String(r.ad_id ?? '') : String(r.campaign_id ?? '')
        if (!chave) continue
        linhas.push({
          dia: r.date_start,
          nivel,
          chave,
          campaign_id: r.campaign_id ?? null,
          campaign_name: r.campaign_name ?? null,
          adset_name: r.adset_name ?? null,
          ad_id: r.ad_id ?? null,
          ad_name: r.ad_name ?? null,
          // Centavo, para casar com clinic_sales.value_cents e nunca somar float.
          spend_cents: Math.round(Number(r.spend ?? 0) * 100),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          reach: Number(r.reach ?? 0),
          leads,
          conversas,
          synced_at: new Date().toISOString(),
        })
      }
    } catch (e) {
      erros.push(`${nivel}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  let gravadas = 0
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await admin
      .from('meta_ads_insights')
      .upsert(linhas.slice(i, i + 500), { onConflict: 'dia,nivel,chave' })
    if (error) erros.push(`upsert: ${error.message}`)
    else gravadas += Math.min(500, linhas.length - i)
  }

  return { ok: erros.length === 0, dias, linhas: linhas.length, gravadas, erros: erros.slice(0, 3) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  // O segredo vive na tabela (o cron lê de lá), com env como alternativa.
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  const { data: seg } = await admin
    .from('app_cron_secrets').select('secret').eq('key', 'meta_ads').maybeSingle()
  const esperado = String((seg as { secret?: string } | null)?.secret ?? Deno.env.get('CRON_META_ADS_SECRET') ?? '').trim()
  if (esperado && provided !== esperado) return json({ error: 'unauthorized' }, 401)

  const token = (Deno.env.get('META_ADS_TOKEN') ?? '').trim()
  if (!token) return json({ error: 'META_ADS_TOKEN ausente' }, 500)

  let corpo: { action?: string; dias?: number } = {}
  try { corpo = await req.json() } catch { /* corpo vazio vira capi */ }
  const action = (corpo.action ?? 'capi').toLowerCase()

  try {
    if (action === 'audience') return json(await refazerPublico(admin, token))
    if (action === 'insights') return json(await puxarInsights(admin, token, Number(corpo.dias ?? 7)))
    if (action === 'capi') return json(await enviarCapi(admin, token, Number(corpo.dias ?? 6)))
    return json({ error: 'action_invalida', aceitas: ['capi', 'audience', 'insights'] }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
