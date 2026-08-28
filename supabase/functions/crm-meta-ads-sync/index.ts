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

async function refazerPublico(
  admin: SupabaseClient,
  token: string,
  // O cron continua chamando sem argumento e cai no público de conversa. A
  // chamada à mão escolhe a camada, que foi o que permitiu subir a semente de
  // COMPRADORES sem tocar no público que já roda.
  opts: { camada: string; publico: string } = { camada: AUDIENCE_LAYER, publico: AUDIENCE_ID },
) {
  const { camada: CAMADA, publico: PUBLICO } = opts
  // PostgREST corta em 1.000 linhas e NÃO avisa: a primeira carga subiu 1.000
  // de 1.600 e respondeu ok. Por isso a semente vem paginada, e o total vem
  // por fora para conferir se subiu tudo.
  const hashes: string[] = []
  for (let off = 0; ; off += AUDIENCE_BATCH) {
    const { data, error } = await admin.rpc('crm_meta_audience_seed', {
      camada: CAMADA, lote: AUDIENCE_BATCH, deslocamento: off,
    })
    if (error) return { ok: false, erro: `rpc: ${error.message}` }
    const pagina = ((data ?? []) as Array<{ hash: string }>).map((r) => r.hash).filter(Boolean)
    hashes.push(...pagina)
    if (pagina.length < AUDIENCE_BATCH) break
    if (off > 50000) break // trava de laço
  }
  if (!hashes.length) return { ok: false, erro: 'semente vazia' }

  const { data: totalRow } = await admin.rpc('crm_meta_audience_seed_total', { camada: CAMADA })
  const total = Number(totalRow ?? hashes.length)

  let recebidos = 0
  let invalidos = 0
  const erros: string[] = []

  for (let i = 0; i < hashes.length; i += AUDIENCE_BATCH) {
    const lote = hashes.slice(i, i + AUDIENCE_BATCH)
    const payload = { schema: ['PHONE'], data: lote.map((h) => [h]) }
    try {
      const body = new URLSearchParams({ payload: JSON.stringify(payload), access_token: token })
      const res = await fetch(`${GRAPH}/${PUBLICO}/users`, { method: 'POST', body })
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
    camada: CAMADA, publico: PUBLICO, total, semente: hashes.length, recebidos, invalidos,
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

/**
 * Lista os anúncios que podem entregar e diz QUAL FORMULÁRIO cada um usa.
 *
 * Nasceu em 25/08/2026: um anúncio renomeado para "form qualificado" continuou
 * mandando lead para o formulário antigo, e o teste do formulário novo ficou
 * parecendo que existia sem existir. O id do formulário mora no call_to_action
 * do criativo, não no anúncio nem no conjunto, então olhar a tela não resolve.
 * Só lê, não muda nada.
 */
async function inspecionarAnuncios(token: string, cru = '') {
  if (cru === 'imagens') {
    // Imagens já enviadas para a conta: é delas que sai o `image_hash` de um
    // criativo novo. Sem isso, anúncio novo só nasce reaproveitando post
    // existente, e post existente carrega o formulário ANTIGO junto.
    const qs = new URLSearchParams({
      fields: 'hash,name,created_time,permalink_url',
      limit: '40',
      access_token: token,
    })
    const conta0 = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
    const r = await fetch(`${GRAPH}/${conta0}/adimages?${qs}`)
    return { ok: r.ok, imagens: await r.json() }
  }
  if (cru) {
    // Modo cru: um anúncio só, criativo inteiro. Serve para achar onde a Meta
    // escondeu o formulário quando o criativo veio de post existente.
    const qs = new URLSearchParams({
      fields: 'id,name,effective_status,preview_shareable_link,creative{id,name,object_story_id,effective_object_story_id,object_story_spec,asset_feed_spec,object_type,link_url,url_tags,image_hash,image_url,thumbnail_url,body,title}',
      access_token: token,
    })
    const r = await fetch(`${GRAPH}/${cru}?${qs}`)
    return { ok: r.ok, cru: await r.json() }
  }
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  const qs = new URLSearchParams({
    fields: 'id,name,effective_status,adset{name},creative{id,object_story_spec,asset_feed_spec}',
    effective_status: JSON.stringify(['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS']),
    limit: '200',
    access_token: token,
  })
  const res = await fetch(`${GRAPH}/${conta}/ads?${qs}`)
  const body = await res.json() as Record<string, unknown>
  if (!res.ok) return { ok: false, erro: body }
  const anuncios = ((body.data ?? []) as Array<Record<string, unknown>>).map((a) => {
    const cr = (a.creative ?? {}) as Record<string, unknown>
    const oss = (cr.object_story_spec ?? {}) as Record<string, Record<string, unknown>>
    const afs = (cr.asset_feed_spec ?? {}) as Record<string, unknown>
    // O formulário pode estar em qualquer um destes três lugares, conforme o
    // anúncio tenha sido montado por link, por vídeo ou por criativo dinâmico.
    const cta = (oss.link_data?.call_to_action ?? oss.video_data?.call_to_action ?? {}) as Record<string, Record<string, string>>
    const dinamico = ((afs.call_to_actions ?? []) as Array<Record<string, Record<string, string>>>)[0] ?? {}
    const form = cta.value?.lead_gen_form_id ?? dinamico.value?.lead_gen_form_id ?? null
    return {
      id: String(a.id ?? ''),
      nome: String(a.name ?? ''),
      status: String(a.effective_status ?? ''),
      conjunto: String((a.adset as Record<string, string> | undefined)?.name ?? ''),
      formulario: form,
    }
  })
  return { ok: true, total: anuncios.length, anuncios }
}

/**
 * Reamarra um anúncio de lead a OUTRO formulário.
 *
 * Existe por causa de 25/08/2026: o anúncio "form qualificado" continuava
 * entregando no formulário de 3 campos porque ele é SHARE de um post, e o
 * formulário de um post mora no botão do POST. Trocar o nome do anúncio, ou
 * escolher o formulário na criação, não muda nada enquanto o criativo vier de
 * post existente.
 *
 * O caminho que funciona é nascer criativo próprio: pega a imagem do post que
 * o anúncio já usa (não adianta escolher no escuro entre as 40 imagens sem
 * nome da conta), sobe como imagem de anúncio, monta o criativo com
 * `lead_gen_form_id` e troca o criativo do anúncio.
 *
 * `dry: true` faz só a leitura e devolve o que achou, sem escrever nada.
 */
async function reamarrarFormulario(
  token: string,
  opts: { adId: string; formId: string; dry: boolean; imagemUrl?: string; mensagem?: string },
) {
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  const g = async (path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ ...params, access_token: token })
    const r = await fetch(`${GRAPH}/${path}?${qs}`)
    return { ok: r.ok, body: await r.json() as Record<string, unknown> }
  }

  const ad = await g(opts.adId, {
    fields: 'id,name,adset_id,creative{id,effective_object_story_id,image_hash,body}',
  })
  if (!ad.ok) return { ok: false, passo: 'ler_anuncio', erro: ad.body }
  const cr = (ad.body.creative ?? {}) as Record<string, string>

  // ATALHO QUE RESOLVEU: mesmo em criativo do tipo SHARE, que não devolve
  // `object_story_spec`, a Meta devolve `image_hash` e `body`. Ou seja, a
  // imagem JÁ está na conta e o texto está à mão: não precisa ler o post (o
  // token de anúncio não tem `pages_read_engagement`) nem escolher no escuro
  // entre as 40 imagens sem nome da conta.
  let hash = String(cr.image_hash ?? '')
  const mensagem = String(opts.mensagem || cr.body || '')

  if (opts.dry) {
    return {
      ok: true,
      dry: true,
      anuncio: { id: ad.body.id, nome: ad.body.name, adset_id: ad.body.adset_id },
      image_hash: hash || null,
      tem_texto: mensagem.length,
      formulario_destino: opts.formId,
    }
  }
  if (!hash) {
    // Sem hash: cai para a imagem informada de fora, subindo os bytes na conta.
    const imagemUrl = String(opts.imagemUrl ?? '')
    if (!imagemUrl) return { ok: false, passo: 'imagem', erro: 'criativo sem image_hash e sem imagem_url' }
    const img = await fetch(imagemUrl)
    if (!img.ok) return { ok: false, passo: 'baixar_imagem', erro: `HTTP ${img.status}` }
    const fd = new FormData()
    fd.append('access_token', token)
    fd.append('imagem.jpg', new Blob([new Uint8Array(await img.arrayBuffer())]), 'imagem.jpg')
    const up = await fetch(`${GRAPH}/${conta}/adimages`, { method: 'POST', body: fd })
    const upBody = await up.json() as Record<string, unknown>
    const imagens = (upBody.images ?? {}) as Record<string, Record<string, string>>
    hash = imagens[Object.keys(imagens)[0]]?.hash ?? ''
    if (!hash) return { ok: false, passo: 'subir_imagem', erro: upBody }
  }

  const pageId = Deno.env.get('META_PAGE_ID') ?? '100416712888754'
  const criativo = await fetch(`${GRAPH}/${conta}/adcreatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${String(ad.body.name ?? 'anúncio')} · form ${opts.formId}`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          image_hash: hash,
          // PEGADINHA: anúncio de lead EXIGE link externo. Apontar para a página
          // do Facebook devolve "Lead Ad Creative Does Not Use External URL"
          // (subcode 1815316). Quem abre o formulário nem chega a ver este link,
          // mas ele precisa existir e ser de fora da Meta.
          link: Deno.env.get('META_ADS_LINK_EXTERNO') ?? 'https://institutolorenavisentainer.com.br',
          message: mensagem,
          call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: opts.formId } },
        },
      },
      access_token: token,
    }),
  })
  const criativoBody = await criativo.json() as Record<string, unknown>
  if (!criativo.ok) return { ok: false, passo: 'criar_criativo', erro: criativoBody, hash }

  const troca = await fetch(`${GRAPH}/${opts.adId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creative: { creative_id: criativoBody.id }, access_token: token }),
  })
  const trocaBody = await troca.json() as Record<string, unknown>
  if (!troca.ok) return { ok: false, passo: 'trocar_criativo', erro: trocaBody, criativo_id: criativoBody.id }

  return { ok: true, anuncio: opts.adId, criativo_novo: criativoBody.id, image_hash: hash, formulario: opts.formId }
}

/**
 * atribuir — o formulário SABE de qual anúncio veio; quem não conseguia
 * perguntar era o webhook.
 *
 * `GET /{leadgen_id}?fields=ad_id,adset_id,campaign_id` devolve **200 e omite os
 * três campos** quando quem pergunta é o token de PÁGINA (que só tem
 * `leads_retrieval`). Não dá erro, não avisa: o campo simplesmente some da
 * resposta. Conferido em 26/08/2026 no leadgen 1044515165234922, que voltou com
 * `is_organic:false` — veio de anúncio — e nenhum id de anúncio junto.
 *
 * O estrago: `v_ads_campanha_ate_venda` casa gasto com resultado por
 * `attribution_campaign`. Com esse campo nulo, TODO lead de formulário ficava
 * fora da conta — 105 leads pagos em 14 dias que o painel de ROI não enxergava.
 *
 * Aqui quem pergunta é o token de ANÚNCIOS (system user, `ads_read`), que
 * enxerga os três. Roda pelo cron e é idempotente: só olha lead que ainda está
 * sem campanha, então passar duas vezes não reescreve nada.
 */
async function atribuirLeadform(
  admin: SupabaseClient,
  token: string,
  dias: number,
  dry: boolean,
) {
  const desde = new Date(Date.now() - Math.max(1, dias) * 86_400_000).toISOString()

  // PostgREST corta em 1.000 linhas e não avisa (já mordeu na carga de público).
  // Paginar de 500 em 500 e dizer no fim se sobrou fila.
  const pendentes: Array<{ id: string; leadgenId: string; atr: Record<string, unknown> }> = []
  for (let pagina = 0; pagina < 8; pagina++) {
    const de = pagina * 500
    const { data, error } = await admin
      .from('leads')
      .select('id, attribution')
      .eq('tenant_id', 'instituto-lorena')
      .is('deleted_at', null)
      .is('attribution_campaign', null)
      .not('attribution', 'is', null)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .range(de, de + 499)
    if (error) throw new Error(error.message)
    const linhas = (data ?? []) as Array<Record<string, unknown>>
    for (const l of linhas) {
      const atr = (l.attribution ?? {}) as Record<string, unknown>
      const lg = String(atr.leadgen_id ?? '').trim()
      if (lg) pendentes.push({ id: String(l.id), leadgenId: lg, atr })
    }
    if (linhas.length < 500) break
  }

  if (dry) return { ok: true, dry: true, pendentes: pendentes.length, amostra: pendentes.slice(0, 5) }

  let carimbados = 0
  let semAnuncio = 0
  const erros: string[] = []

  for (const p of pendentes) {
    try {
      const qs = new URLSearchParams({
        fields: 'ad_id,adset_id,campaign_id,is_organic',
        access_token: token,
      })
      const res = await fetch(`${GRAPH}/${p.leadgenId}?${qs}`)
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) {
        if (erros.length < 5) erros.push(`${p.leadgenId}: ${JSON.stringify(body).slice(0, 200)}`)
        continue
      }
      const campanha = String(body.campaign_id ?? '').trim()
      const anuncio = String(body.ad_id ?? '').trim()
      // Lead orgânico (formulário aberto por um post, não por anúncio) não tem
      // campanha e não é erro: contar à parte para não virar "falhou".
      if (!campanha && !anuncio) { semAnuncio++; continue }

      const conjunto = String(body.adset_id ?? '').trim()
      const { error } = await admin
        .from('leads')
        .update({
          attribution_campaign: campanha || null,
          attribution_ad_id: anuncio || null,
          attribution: {
            ...p.atr,
            campaign_id: campanha || null,
            ad_id: anuncio || null,
            adset_id: conjunto || null,
            campanha_recuperada_em: new Date().toISOString(),
          },
        })
        .eq('id', p.id)
      if (error) { if (erros.length < 5) erros.push(`${p.id}: ${error.message}`); continue }
      carimbados++
    } catch (e) {
      if (erros.length < 5) erros.push(`${p.leadgenId}: ${e instanceof Error ? e.message : String(e)}`)
    }
    // A Graph aguenta bem mais que isso, mas o teto de 100 req/min já queimou
    // a Focus antes; 80ms deixa a rotina em ~12 req/s e ninguém reclama.
    await new Promise((r) => setTimeout(r, 80))
  }

  return { ok: true, pendentes: pendentes.length, carimbados, sem_anuncio: semAnuncio, erros }
}

/**
 * Leitura crua da Graph, com a disciplina que o extrato já usava: a Meta
 * responde "temporarily unavailable" quando as chamadas saem coladas, e isso
 * não é erro de parâmetro. Erro que sobra vai para `erros`, não derruba.
 */
async function graphLer(
  token: string,
  caminho: string,
  params: Record<string, string>,
  erros: string[],
) {
  const qs = new URLSearchParams({ ...params, access_token: token })
  let j: { data?: Array<Record<string, unknown>>; error?: { message?: string } } = {}
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const res = await fetch(`${GRAPH}/${caminho}?${qs}`)
    j = await res.json()
    if (!j.error) break
    const transitorio = /temporarily unavailable|rate limit|try again|reduce the amount/i
      .test(String(j.error.message ?? ''))
    if (!transitorio || tentativa === 3) break
    await new Promise((r) => setTimeout(r, tentativa * 4000))
  }
  if (j.error) { erros.push(`${caminho}: ${j.error.message}`); return [] }
  return (j.data ?? []) as Array<Record<string, unknown>>
}

/**
 * Leitura de extrato: a conta inteira numa resposta só, do jeito que a equipe
 * pergunta — "quais campanhas estão ativas, quanto está indo por dia, e para
 * quem". Só lê.
 *
 * A pergunta que motivou: "80% do nosso público é homem de 35 a 55" — sem a
 * quebra por idade e sexo, isso é palpite. Ela vem em `demografia`.
 */
async function extratoDaConta(token: string, dias: number) {
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  const ate = new Date()
  const desde = new Date(ate.getTime() - Math.max(dias, 1) * 86400_000)
  const janela = { since: desde.toISOString().slice(0, 10), until: ate.toISOString().slice(0, 10) }

  // Mesma disciplina do puxarInsights: a Meta responde "temporarily
  // unavailable" quando as chamadas saem coladas. Não é erro de parâmetro.
  const erros: string[] = []
  const g = (caminho: string, params: Record<string, string>) => graphLer(token, caminho, params, erros)

  const reais = (centavos: unknown) => Math.round(Number(centavos ?? 0)) / 100
  function contar(r: Record<string, unknown>) {
    const acoes = (r.actions ?? []) as Array<{ action_type: string; value: string }>
    const m = new Map(acoes.map((a) => [a.action_type, Number(a.value)]))
    return {
      gasto: Number(r.spend ?? 0),
      impressoes: Number(r.impressions ?? 0),
      cliques: Number(r.clicks ?? 0),
      alcance: Number(r.reach ?? 0),
      leads: (m.get('lead') ?? 0) + (m.get('leadgen.other') ?? 0) +
        (m.get('offsite_conversion.fb_pixel_lead') ?? 0),
      conversas: m.get('onsite_conversion.messaging_conversation_started_7d') ?? 0,
    }
  }

  const campanhas = await g(`${conta}/campaigns`, {
    fields: 'id,name,effective_status,objective,daily_budget,lifetime_budget,start_time,created_time',
    limit: '200',
  })
  const conjuntos = await g(`${conta}/adsets`, {
    fields: 'id,name,campaign_id,effective_status,daily_budget,optimization_goal,destination_type,targeting',
    limit: '200',
  })
  const anuncios = await g(`${conta}/ads`, {
    fields: 'id,name,adset_id,campaign_id,effective_status,creative{body,title}',
    limit: '300',
  })
  const insights = await g(`${conta}/insights`, {
    level: 'campaign',
    time_range: JSON.stringify(janela),
    fields: 'campaign_id,spend,impressions,clicks,reach,actions',
    limit: '200',
  })
  const demo = await g(`${conta}/insights`, {
    level: 'account',
    time_range: JSON.stringify(janela),
    breakdowns: 'age,gender',
    fields: 'spend,impressions,clicks,actions',
    limit: '200',
  })

  const porCampanha = new Map(insights.map((r) => [String(r.campaign_id ?? ''), contar(r)]))
  const vivo = (s: unknown) => s === 'ACTIVE' || s === 'IN_PROCESS' || s === 'PENDING_REVIEW'

  const linhas = campanhas.map((c) => {
    const id = String(c.id ?? '')
    const meus = conjuntos.filter((s) => String(s.campaign_id ?? '') === id)
    const n = porCampanha.get(id) ?? { gasto: 0, impressoes: 0, cliques: 0, alcance: 0, leads: 0, conversas: 0 }
    return {
      id,
      nome: String(c.name ?? ''),
      status: String(c.effective_status ?? ''),
      objetivo: String(c.objective ?? ''),
      // Verba pode morar na campanha (CBO) ou nos conjuntos. Somar os dois
      // lugares e dizer QUAL deles é o que manda.
      verba_dia: reais(c.daily_budget) ||
        meus.filter((s) => vivo(s.effective_status)).reduce((t, s) => t + reais(s.daily_budget), 0),
      verba_onde: Number(c.daily_budget ?? 0) > 0 ? 'campanha' : 'conjunto',
      ...n,
      custo_por_conversa: n.conversas ? Number((n.gasto / n.conversas).toFixed(2)) : null,
      custo_por_lead: n.leads ? Number((n.gasto / n.leads).toFixed(2)) : null,
      conjuntos: meus.map((s) => {
        const t = (s.targeting ?? {}) as Record<string, unknown>
        const geo = (t.geo_locations ?? {}) as Record<string, unknown>
        const nomeDe = (v: unknown) => ((v ?? []) as Array<Record<string, string>>).map((x) => x.name ?? x.key)
        const gen = (t.genders ?? []) as number[]
        return {
          id: String(s.id ?? ''),
          nome: String(s.name ?? ''),
          status: String(s.effective_status ?? ''),
          verba_dia: reais(s.daily_budget),
          otimiza: String(s.optimization_goal ?? ''),
          destino: String(s.destination_type ?? ''),
          idade: `${t.age_min ?? '?'}-${t.age_max ?? '?'}`,
          // A Meta manda [] quando é "todos", 1 = homens, 2 = mulheres.
          sexo: !gen.length ? 'todos' : gen.map((x) => (x === 1 ? 'homens' : 'mulheres')).join('+'),
          onde: [
            ...((geo.countries ?? []) as string[]),
            ...nomeDe(geo.regions), ...nomeDe(geo.cities),
          ].slice(0, 8),
          publicos: nomeDe(t.custom_audiences),
          exclui: nomeDe(t.excluded_custom_audiences),
          interesses: (((t.flexible_spec ?? []) as Array<Record<string, unknown>>)
            .flatMap((f) => nomeDe(f.interests))).slice(0, 10),
          anuncios: anuncios.filter((a) => String(a.adset_id ?? '') === String(s.id ?? ''))
            .map((a) => ({
              id: String(a.id ?? ''),
              nome: String(a.name ?? ''),
              status: String(a.effective_status ?? ''),
              texto: String(((a.creative ?? {}) as Record<string, string>).body ?? '').slice(0, 300),
            })),
        }
      }),
    }
  })

  const ativas = linhas.filter((l) => vivo(l.status))
  const demografia = demo.map((r) => ({
    faixa: String(r.age ?? ''),
    sexo: String(r.gender ?? ''),
    ...contar(r),
  })).sort((a, b) => b.gasto - a.gasto)

  return {
    ok: true,
    conta,
    janela,
    verba_dia_ativa: Number(ativas.reduce((t, l) => t + l.verba_dia, 0).toFixed(2)),
    gasto_janela: Number(linhas.reduce((t, l) => t + l.gasto, 0).toFixed(2)),
    ativas: ativas.sort((a, b) => b.verba_dia - a.verba_dia),
    pausadas_com_gasto: linhas.filter((l) => !vivo(l.status) && l.gasto > 0)
      .map((l) => ({ nome: l.nome, status: l.status, gasto: l.gasto })),
    demografia,
    erros,
  }
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

/** Estado -> macrorregião. PEGADINHA: a Meta devolve o nome COM acento e às
 * vezes com sufixo ("São Paulo (state)", "Acre (state)"), e o Distrito Federal
 * vem em inglês. Por isso a chave é o nome normalizado, não o cru. */
const MACRO: Record<string, string> = Object.fromEntries([
  ...['maranhao', 'piaui', 'ceara', 'rio grande do norte', 'paraiba', 'pernambuco',
    'alagoas', 'sergipe', 'bahia'].map((e) => [e, 'NORDESTE']),
  ...['acre', 'amapa', 'amazonas', 'para', 'rondonia', 'roraima', 'tocantins']
    .map((e) => [e, 'NORTE']),
  ...['parana'].map((e) => [e, 'PARANA']),
  ...['santa catarina', 'rio grande do sul'].map((e) => [e, 'SUL (SC/RS)']),
  ...['sao paulo'].map((e) => [e, 'SAO PAULO']),
  ...['rio de janeiro', 'minas gerais', 'espirito santo'].map((e) => [e, 'SUDESTE (RJ/MG/ES)']),
  ...['goias', 'distrito federal', 'federal district', 'mato grosso', 'mato grosso do sul']
    .map((e) => [e, 'CENTRO-OESTE']),
])

/** "São Paulo (state)" -> "sao paulo". */
const chaveDoEstado = (nome: string) =>
  semAcento(String(nome).replace(/\s*\(state\)\s*$/i, ''))

/** Fora do Brasil não é macrorregião nenhuma — é verba vazando. */
const macroDe = (pais: string, estado: string) =>
  pais && pais !== 'BR' ? `EXTERIOR (${pais})` : (MACRO[chaveDoEstado(estado)] ?? 'BR - OUTRO')

/**
 * entrega — a conta responde ONDE o dinheiro caiu, por região.
 *
 * `geo` lê o targeting, que é a intenção. Esta lê a entrega, que é o fato: o
 * conjunto pode mirar "Brasil menos 16 estados" e ainda assim gastar 40% em
 * praça que nunca comprou. Sem esta quebra, "nosso tráfego pega onde?" só tem
 * resposta de palpite. Só lê.
 */
async function entregaPorRegiao(token: string, dias: number) {
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  const ate = new Date()
  const desde = new Date(ate.getTime() - Math.max(dias, 1) * 86400_000)
  const janela = { since: desde.toISOString().slice(0, 10), until: ate.toISOString().slice(0, 10) }
  const erros: string[] = []

  const num = (r: Record<string, unknown>) => {
    const acoes = (r.actions ?? []) as Array<{ action_type: string; value: string }>
    const m = new Map(acoes.map((a) => [a.action_type, Number(a.value)]))
    return {
      gasto: Number(Number(r.spend ?? 0).toFixed(2)),
      impressoes: Number(r.impressions ?? 0),
      cliques: Number(r.clicks ?? 0),
      leads: (m.get('lead') ?? 0) + (m.get('leadgen.other') ?? 0) +
        (m.get('offsite_conversion.fb_pixel_lead') ?? 0),
      conversas: m.get('onsite_conversion.messaging_conversation_started_7d') ?? 0,
    }
  }

  const campos = 'spend,impressions,clicks,actions'
  const base = { time_range: JSON.stringify(janela), fields: campos, limit: '500' }

  const porRegiao = await graphLer(token, `${conta}/insights`,
    { ...base, level: 'account', breakdowns: 'country,region' }, erros)
  const porPais = await graphLer(token, `${conta}/insights`,
    { ...base, level: 'account', breakdowns: 'country' }, erros)
  const porCampanha = await graphLer(token, `${conta}/insights`,
    { ...base, level: 'campaign', fields: `campaign_name,${campos}`, breakdowns: 'country,region' }, erros)

  const estados = porRegiao.map((r) => ({
    estado: String(r.region ?? '?'),
    pais: String(r.country ?? '?'),
    macro: macroDe(String(r.country ?? ''), String(r.region ?? '')),
    ...num(r),
  })).sort((a, b) => b.gasto - a.gasto)

  const macro = new Map<string, { gasto: number; impressoes: number; cliques: number; leads: number; conversas: number }>()
  for (const e of estados) {
    const t = macro.get(e.macro) ?? { gasto: 0, impressoes: 0, cliques: 0, leads: 0, conversas: 0 }
    macro.set(e.macro, {
      gasto: t.gasto + e.gasto, impressoes: t.impressoes + e.impressoes,
      cliques: t.cliques + e.cliques, leads: t.leads + e.leads, conversas: t.conversas + e.conversas,
    })
  }
  const total = [...macro.values()].reduce((t, m) => t + m.gasto, 0)

  return {
    ok: true,
    conta,
    janela,
    gasto_total: Number(total.toFixed(2)),
    por_macrorregiao: [...macro.entries()]
      .map(([regiao, m]) => ({
        regiao,
        gasto: Number(m.gasto.toFixed(2)),
        fatia: total ? `${((m.gasto / total) * 100).toFixed(1)}%` : '0%',
        impressoes: m.impressoes, cliques: m.cliques, leads: m.leads, conversas: m.conversas,
      }))
      .sort((a, b) => b.gasto - a.gasto),
    por_estado: estados,
    // Sobrou verba fora do Brasil? Lisboa, Miami, Orlando, Paris e Dubai saíram
    // do targeting em 25/08; aqui é a conferência de que saíram mesmo.
    por_pais: porPais.map((r) => ({ pais: String(r.country ?? '?'), ...num(r) }))
      .sort((a, b) => b.gasto - a.gasto),
    por_campanha_e_estado: porCampanha.map((r) => ({
      campanha: String(r.campaign_name ?? ''),
      estado: String(r.region ?? '?'),
      macro: macroDe(String(r.country ?? ''), String(r.region ?? '')),
      ...num(r),
    })).filter((r) => r.gasto > 0).sort((a, b) => b.gasto - a.gasto),
    erros,
  }
}

/** Estados do Nordeste e do Norte. A clínica opera em Maringá e Londrina; a
 * cirurgia é presencial em Maringá de qualquer jeito. Em 60 dias, 104 leads
 * vieram destes DDDs e deram ZERO venda e ZERO agendamento (o Norte teve 2
 * agendamentos, nenhum virou cirurgia), contra 78 vendas em 927 leads do Paraná. */
const ESTADOS_BARRADOS = [
  'Maranhão', 'Piauí', 'Ceará', 'Rio Grande do Norte', 'Paraíba', 'Pernambuco',
  'Alagoas', 'Sergipe', 'Bahia',
  'Acre', 'Amapá', 'Amazonas', 'Pará', 'Rondônia', 'Roraima', 'Tocantins',
]

/** Resolve o `key` numérico que a Meta usa para cada estado. */
async function chavesDosEstados(
  token: string,
  nomes: string[] = ESTADOS_BARRADOS,
): Promise<Array<{ key: string; nome: string }>> {
  const achados: Array<{ key: string; nome: string }> = []
  for (const nome of nomes) {
    const qs = new URLSearchParams({
      type: 'adgeolocation',
      location_types: JSON.stringify(['region']),
      country_code: 'BR',
      q: nome,
      limit: '10',
      access_token: token,
    })
    const r = await fetch(`${GRAPH}/search?${qs}`)
    const b = await r.json() as { data?: Array<Record<string, string>> }
    const hit = (b.data ?? []).find((x) =>
      String(x.country_code ?? '') === 'BR' && semAcento(String(x.name ?? '')) === semAcento(nome)
    )
    if (hit) achados.push({ key: String(hit.key), nome })
    await new Promise((r) => setTimeout(r, 60))
  }
  return achados
}

/**
 * geo — para de pagar por lead que a clínica não consegue atender.
 *
 * Os conjuntos de remarketing miram o BRASIL inteiro. Excluir região é melhor
 * que trocar para "só Paraná": São Paulo deu 7 vendas em 201 leads e não pode
 * cair junto. Então a mudança é cirúrgica — entra `excluded_geo_locations`, o
 * resto do targeting volta INTEIRO como estava.
 *
 * PEGADINHA (mordeu em 25/08): ao reescrever `targeting` pela API, dropar
 * `targeting_automation` derruba o conjunto em HARD_ERROR "Invalid Optimization
 * Goal". Por isso aqui o objeto é lido, recebe uma chave a mais, e volta como
 * veio. Depois de todo POST confere `effective_status` e `issues_info`.
 */
async function barrarGeo(token: string, barrar: boolean, dry: boolean) {
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  const qs = new URLSearchParams({
    fields: 'id,name,effective_status,campaign{id,name},targeting',
    effective_status: JSON.stringify(['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS']),
    limit: '100',
    access_token: token,
  })
  const res = await fetch(`${GRAPH}/${conta}/adsets?${qs}`)
  const body = await res.json() as Record<string, unknown>
  if (!res.ok) return { ok: false, erro: body }

  const conjuntos = (body.data ?? []) as Array<Record<string, unknown>>
  const leitura = conjuntos.map((c) => {
    const t = (c.targeting ?? {}) as Record<string, unknown>
    const geo = (t.geo_locations ?? {}) as Record<string, unknown>
    const ex = (t.excluded_geo_locations ?? {}) as Record<string, unknown>
    return {
      id: String(c.id ?? ''),
      nome: String(c.name ?? ''),
      campanha: String((c.campaign as Record<string, string> | undefined)?.name ?? ''),
      status: String(c.effective_status ?? ''),
      paises: (geo.countries ?? []) as string[],
      regioes: ((geo.regions ?? []) as Array<Record<string, string>>).map((r) => r.name ?? r.key),
      // Cidade sem raio não responde a pergunta: "Maringá" pode ser 17km ou 80km.
      cidades: ((geo.cities ?? []) as Array<Record<string, unknown>>).map((r) =>
        `${r.name ?? r.key}${r.radius ? ` ${r.radius}${r.distance_unit ?? 'km'}` : ''}`
      ),
      ja_excluidas: ((ex.regions ?? []) as Array<Record<string, string>>).map((r) => r.name ?? r.key),
    }
  })
  if (!barrar) return { ok: true, conjuntos: leitura }

  const estados = await chavesDosEstados(token)
  if (estados.length < ESTADOS_BARRADOS.length) {
    return { ok: false, erro: 'nem todo estado resolveu chave', achados: estados.map((e) => e.nome) }
  }

  // Só mexe em conjunto que mira o Brasil inteiro. Conjunto por raio (Maringá e
  // Londrina 50km) já não alcança o Nordeste, e editar à toa reinicia aprendizado.
  const alvos = conjuntos.filter((c) => {
    const t = (c.targeting ?? {}) as Record<string, unknown>
    const geo = (t.geo_locations ?? {}) as Record<string, unknown>
    return ((geo.countries ?? []) as string[]).includes('BR')
  })

  if (dry) {
    return {
      ok: true, dry: true,
      estados: estados.map((e) => e.nome),
      alvos: alvos.map((c) => ({ id: String(c.id), nome: String(c.name) })),
      intactos: conjuntos.filter((c) => !alvos.includes(c)).map((c) => String(c.name)),
    }
  }

  const feitos: Array<Record<string, unknown>> = []
  for (const c of alvos) {
    const id = String(c.id ?? '')
    const t = { ...(c.targeting ?? {}) as Record<string, unknown> }
    const exAtual = { ...(t.excluded_geo_locations ?? {}) as Record<string, unknown> }
    const jaTem = new Set(((exAtual.regions ?? []) as Array<Record<string, string>>).map((r) => String(r.key)))
    exAtual.regions = [
      ...((exAtual.regions ?? []) as Array<Record<string, string>>),
      ...estados.filter((e) => !jaTem.has(e.key)).map((e) => ({ key: e.key })),
    ]
    t.excluded_geo_locations = exAtual

    const post = await fetch(`${GRAPH}/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targeting: t, access_token: token }),
    })
    const pb = await post.json() as Record<string, unknown>
    if (!post.ok) { feitos.push({ id, nome: String(c.name), ok: false, erro: pb }); continue }

    // Conjunto que volta ACTIVE mas com issues_info é conjunto quebrado calado.
    const conf = await fetch(
      `${GRAPH}/${id}?fields=name,effective_status,issues_info&access_token=${encodeURIComponent(token)}`,
    )
    const cb = await conf.json() as Record<string, unknown>
    feitos.push({
      id, nome: String(c.name), ok: true,
      status: cb.effective_status ?? '?',
      issues: cb.issues_info ?? null,
    })
  }
  return { ok: true, estados_barrados: estados.length, conjuntos: feitos }
}

/**
 * cercar — põe um conjunto na praça que a clínica atende, copiando a cerca de um conjunto que
 * já está certo.
 *
 * Existe por causa do conjunto `remarketing` (120249690540870061): apesar do nome, ele estava
 * SEM público salvo, SEM interesse, mirando o BRASIL inteiro e 18-65, otimizando por conversa
 * mais barata. Era o maior volume da conta (41 conversas em 4 dias a R$ 8,24) e a fonte do
 * lead frio de 28/08: só 29% dos leads de clique-no-anúncio tinham DDD 43-46, e 42,6% da verba
 * caía fora do Paraná. Conversa barata em rede nacional não é conversa boa quando a consulta
 * custa R$ 800 e a cirurgia é presencial em Maringá.
 *
 * A cerca vem COPIADA de `modelo` em vez de montada aqui: os outros conjuntos já usam
 * "Maringá 50km + Londrina 50km" com chaves de cidade que a Graph resolveu, e reproduzir isso
 * à mão erraria o raio ou a chave. Idade idem — a base diz homem 30-60 e mulher 35-60, então
 * 18 não vende.
 *
 * PEGADINHA (a mesma do barrarGeo, mordeu em 25/08): ao reescrever `targeting` pela API,
 * dropar `targeting_automation` derruba o conjunto em HARD_ERROR. Aqui o objeto do ALVO é lido
 * e volta inteiro, com duas chaves trocadas. `excluded_geo_locations` fica como está de
 * propósito: dentro de um raio de 50km a exclusão de estado é inofensiva, e remover chave é
 * justamente o que quebra.
 */
async function cercarConjunto(
  token: string,
  p: { adset: string; modelo: string; idadeMin: number; idadeMax: number; dry: boolean },
) {
  if (!p.adset || !p.modelo) return { ok: false, erro: 'informe adset e modelo' }

  const ler = async (id: string) => {
    const r = await fetch(
      `${GRAPH}/${id}?fields=id,name,effective_status,targeting&access_token=${encodeURIComponent(token)}`,
    )
    return { ok: r.ok, body: await r.json() as Record<string, unknown> }
  }

  const [alvo, modelo] = await Promise.all([ler(p.adset), ler(p.modelo)])
  if (!alvo.ok) return { ok: false, erro: 'alvo', detalhe: alvo.body }
  if (!modelo.ok) return { ok: false, erro: 'modelo', detalhe: modelo.body }

  const tModelo = (modelo.body.targeting ?? {}) as Record<string, unknown>
  const geoModelo = tModelo.geo_locations as Record<string, unknown> | undefined
  const cidades = (geoModelo?.cities ?? []) as Array<Record<string, unknown>>
  // Cerca sem cidade não é cerca: seguir daqui deixaria o conjunto no Brasil inteiro achando
  // que foi cercado, que é pior do que falhar.
  if (!cidades.length) return { ok: false, erro: 'modelo_sem_cidades', modelo: String(modelo.body.name ?? '') }

  const antes = (alvo.body.targeting ?? {}) as Record<string, unknown>
  const geoAntes = (antes.geo_locations ?? {}) as Record<string, unknown>
  const depois = { ...antes, geo_locations: geoModelo, age_min: p.idadeMin, age_max: p.idadeMax }

  const resumo = {
    conjunto: String(alvo.body.name ?? ''),
    de: {
      paises: (geoAntes.countries ?? []) as string[],
      cidades: ((geoAntes.cities ?? []) as Array<Record<string, unknown>>).map((c) =>
        `${c.name ?? c.key}${c.radius ? ` ${c.radius}${c.distance_unit ?? 'km'}` : ''}`
      ),
      idade: `${antes.age_min ?? '?'}-${antes.age_max ?? '?'}`,
    },
    para: {
      cidades: cidades.map((c) => `${c.name ?? c.key}${c.radius ? ` ${c.radius}${c.distance_unit ?? 'km'}` : ''}`),
      idade: `${p.idadeMin}-${p.idadeMax}`,
      copiado_de: String(modelo.body.name ?? ''),
    },
  }
  if (p.dry) return { ok: true, dry: true, ...resumo }

  const post = await fetch(`${GRAPH}/${p.adset}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targeting: depois, access_token: token }),
  })
  const pb = await post.json() as Record<string, unknown>
  if (!post.ok) return { ok: false, erro: pb, ...resumo }

  // Conjunto que volta ACTIVE mas com issues_info é conjunto quebrado calado.
  const conf = await fetch(
    `${GRAPH}/${p.adset}?fields=name,effective_status,issues_info,targeting{geo_locations,age_min,age_max}&access_token=${encodeURIComponent(token)}`,
  )
  const cb = await conf.json() as Record<string, unknown>
  return {
    ok: true,
    ...resumo,
    status: cb.effective_status ?? '?',
    issues: cb.issues_info ?? null,
    conferido: cb.targeting ?? null,
  }
}

/**
 * conjuntos — lê TUDO que decide quem vê o anúncio, sem mudar nada.
 *
 * Nasceu em 28/08/2026. A leitura de `geo` mostrava a praça de cada conjunto e
 * só isso, então duas alavancas de qualidade ficavam invisíveis: se o conjunto
 * ainda exclui quem já é paciente, e se o Audience Network está ligado. As duas
 * filtram o lead sem tocar em criativo, que é o que o Álvaro pediu.
 *
 * O id de público não diz nada para humano, então os públicos da conta são
 * lidos uma vez e o id vira nome na resposta.
 */
async function inspecionarConjuntos(token: string) {
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  const erros: string[] = []

  const publicos = new Map<string, string>()
  {
    const qs = new URLSearchParams({
      fields: 'id,name,approximate_count_lower_bound,delivery_status',
      limit: '200',
      access_token: token,
    })
    const r = await fetch(`${GRAPH}/${conta}/customaudiences?${qs}`)
    const b = await r.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } }
    if (b.error) erros.push(`publicos: ${b.error.message}`)
    for (const p of b.data ?? []) {
      const n = Number((p.approximate_count_lower_bound ?? -1) as number)
      const estado = ((p.delivery_status ?? {}) as Record<string, unknown>).description
      publicos.set(String(p.id), `${p.name}${n >= 0 ? ` (~${n})` : ''}${estado ? ` [${estado}]` : ''}`)
    }
  }
  const nomeDoPublico = (v: unknown) =>
    ((v ?? []) as Array<Record<string, string>>).map((a) =>
      publicos.get(String(a.id)) ?? `id ${a.id}`
    )

  const qs = new URLSearchParams({
    fields: 'id,name,effective_status,daily_budget,optimization_goal,destination_type,'
      + 'billing_event,campaign{name},targeting',
    effective_status: JSON.stringify(['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS']),
    limit: '100',
    access_token: token,
  })
  const res = await fetch(`${GRAPH}/${conta}/adsets?${qs}`)
  const body = await res.json() as Record<string, unknown>
  if (!res.ok) return { ok: false, erro: body }

  const conjuntos = ((body.data ?? []) as Array<Record<string, unknown>>).map((c) => {
    const t = (c.targeting ?? {}) as Record<string, unknown>
    const geo = (t.geo_locations ?? {}) as Record<string, unknown>
    const nomeDe = (v: unknown) => ((v ?? []) as Array<Record<string, string>>).map((x) => x.name ?? x.key)
    // `publisher_platforms` ausente NÃO quer dizer desligado: quer dizer que a
    // Meta escolhe sozinha, e aí o Audience Network entra por padrão. Por isso
    // a resposta diz "automático (inclui Audience Network)" em vez de vazio.
    const plataformas = (t.publisher_platforms ?? null) as string[] | null
    return {
      id: String(c.id ?? ''),
      nome: String(c.name ?? ''),
      campanha: String((c.campaign as Record<string, string> | undefined)?.name ?? ''),
      status: String(c.effective_status ?? ''),
      verba_dia: Math.round(Number(c.daily_budget ?? 0)) / 100,
      meta: String(c.optimization_goal ?? ''),
      destino: String(c.destination_type ?? ''),
      idade: `${t.age_min ?? '?'}-${t.age_max ?? '?'}`,
      genero: (t.genders as number[] | undefined)?.map((g) => (g === 1 ? 'homens' : 'mulheres')) ?? ['todos'],
      praca: {
        paises: (geo.countries ?? []) as string[],
        regioes: nomeDe(geo.regions),
        cidades: ((geo.cities ?? []) as Array<Record<string, unknown>>).map((r) =>
          `${r.name ?? r.key}${r.radius ? ` ${r.radius}${r.distance_unit ?? 'km'}` : ''}`
        ),
        excluidas: nomeDe((t.excluded_geo_locations as Record<string, unknown> | undefined)?.regions),
      },
      publicos_incluidos: nomeDoPublico(t.custom_audiences),
      publicos_excluidos: nomeDoPublico(t.excluded_custom_audiences),
      plataformas: plataformas ?? ['automático (inclui Audience Network)'],
      posicionamentos: (t.facebook_positions as string[] | undefined) ?? 'automático',
      expansao_de_publico:
        ((t.targeting_automation ?? {}) as Record<string, unknown>).advantage_audience ?? null,
    }
  })
  // A lista inteira de públicos vai junto de propósito: um semelhante recém
  // criado não aparece em conjunto nenhum, e é justamente o `delivery_status`
  // dele que diz se a semente passou do mínimo da Meta ou ficou "too small".
  const todosOsPublicos = [...publicos.entries()].map(([id, nome]) => ({ id, nome }))
  return { ok: erros.length === 0, total: conjuntos.length, conjuntos, publicos: todosOsPublicos, erros }
}

/**
 * praca — troca a praça de UM conjunto, sem encostar no resto do targeting.
 *
 * Existe porque o conjunto de remarketing de R$105/dia (32% da verba) mirava o
 * Brasil inteiro enquanto 85% de quem compra transplante mora em Maringá e
 * Londrina, e 96% em PR + SP. Restringir por ESTADO, e não por raio, é de
 * propósito: raio de 50km sobre uma base que já é nacional pode zerar a
 * entrega, e São Paulo sozinho responde por 7% dos compradores.
 *
 * PEGADINHA de 25/08, que continua valendo: `targeting` volta INTEIRO no POST,
 * com `targeting_automation` junto. Dropar esse campo derruba o conjunto em
 * HARD_ERROR "Invalid Optimization Goal". Aqui o objeto é lido, tem só
 * `geo_locations` trocado, e volta como veio.
 */
async function restringirPraca(
  token: string,
  opts: { conjunto: string; estados: string[]; dry: boolean },
) {
  const { conjunto, estados, dry } = opts
  if (!conjunto) return { ok: false, erro: 'informe o id do conjunto' }
  if (!estados.length) return { ok: false, erro: 'informe os estados' }

  const chaves = await chavesDosEstados(token, estados)
  if (chaves.length !== estados.length) {
    return { ok: false, erro: 'nem todo estado resolveu chave', achados: chaves.map((c) => c.nome) }
  }

  const lerQs = new URLSearchParams({
    fields: 'id,name,effective_status,targeting',
    access_token: token,
  })
  const lido = await fetch(`${GRAPH}/${conjunto}?${lerQs}`)
  const atual = await lido.json() as Record<string, unknown>
  if (!lido.ok) return { ok: false, erro: atual }

  const t = { ...(atual.targeting ?? {}) as Record<string, unknown> }
  const geoAntes = { ...(t.geo_locations ?? {}) as Record<string, unknown> }
  const geoDepois: Record<string, unknown> = { ...geoAntes }
  delete geoDepois.countries
  geoDepois.regions = chaves.map((c) => ({ key: c.key }))
  t.geo_locations = geoDepois

  const antes = {
    paises: (geoAntes.countries ?? []) as string[],
    regioes: ((geoAntes.regions ?? []) as Array<Record<string, string>>).map((r) => r.name ?? r.key),
  }
  if (dry) {
    return {
      ok: true, dry: true, conjunto, nome: String(atual.name ?? ''),
      antes, depois: chaves.map((c) => c.nome),
    }
  }

  const post = await fetch(`${GRAPH}/${conjunto}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targeting: t, access_token: token }),
  })
  const pb = await post.json() as Record<string, unknown>
  if (!post.ok) return { ok: false, erro: pb }

  // Conjunto que volta ACTIVE mas com issues_info é conjunto quebrado calado.
  const conf = await fetch(
    `${GRAPH}/${conjunto}?fields=name,effective_status,issues_info,targeting{geo_locations}`
      + `&access_token=${encodeURIComponent(token)}`,
  )
  const cb = await conf.json() as Record<string, unknown>
  const geoFinal = ((cb.targeting as Record<string, unknown> | undefined)?.geo_locations ?? {}) as Record<string, unknown>
  return {
    ok: true, conjunto, nome: String(cb.name ?? ''), antes,
    status: cb.effective_status ?? '?',
    issues: cb.issues_info ?? null,
    praca_agora: {
      paises: (geoFinal.countries ?? []) as string[],
      regioes: ((geoFinal.regions ?? []) as Array<Record<string, string>>).map((r) => r.name ?? r.key),
    },
  }
}

/**
 * criar_publico / criar_lal — a semente do lookalike passa a ser quem PAGOU.
 *
 * Em 28/08/2026 a leitura de `conjuntos` mostrou que 3 dos 5 conjuntos ativos
 * rodam no "Semelhante (BR, 1%) - FORMULÁRIO PREENCHIDO TC CONSULTA". Ou seja,
 * o pedido à Meta é "ache gente parecida com quem preenche formulário" — e
 * formulário rendeu 1 venda em 801 leads. O algoritmo está entregando
 * exatamente o que foi pedido.
 *
 * `customer_file_source: PARTNER_PROVIDED_ONLY` é o que descreve a origem real:
 * a lista sai do CRM e do Shosp, não de um formulário que a pessoa preencheu
 * para a Meta.
 */
async function criarPublico(token: string, nome: string, descricao: string) {
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  if (!nome) return { ok: false, erro: 'informe o nome' }
  const body = new URLSearchParams({
    name: nome,
    description: descricao,
    subtype: 'CUSTOM',
    customer_file_source: 'PARTNER_PROVIDED_ONLY',
    access_token: token,
  })
  const r = await fetch(`${GRAPH}/${conta}/customaudiences`, { method: 'POST', body })
  const b = await r.json() as Record<string, unknown>
  return r.ok ? { ok: true, publico: String(b.id ?? ''), nome } : { ok: false, erro: b }
}

/**
 * O semelhante só nasce se a semente for grande o bastante DEPOIS do casamento
 * com contas reais. Uma semente de 520 já voltou "too small" nesta conta, e uma
 * de 1.600 passou. Por isso a resposta devolve `delivery_status` cru: é ele que
 * diz se o público vai entregar ou se ficou parado esperando gente.
 */
async function criarLookalike(token: string, origem: string, razao: number, nome: string) {
  const conta = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
  if (!origem) return { ok: false, erro: 'informe o público de origem' }
  const body = new URLSearchParams({
    name: nome,
    subtype: 'LOOKALIKE',
    origin_audience_id: origem,
    lookalike_spec: JSON.stringify({ ratio: razao, country: 'BR', type: 'similarity' }),
    access_token: token,
  })
  const r = await fetch(`${GRAPH}/${conta}/customaudiences`, { method: 'POST', body })
  const b = await r.json() as Record<string, unknown>
  if (!r.ok) return { ok: false, erro: b }

  const id = String(b.id ?? '')
  const conf = await fetch(
    `${GRAPH}/${id}?fields=id,name,delivery_status,operation_status,approximate_count_lower_bound`
      + `&access_token=${encodeURIComponent(token)}`,
  )
  return { ok: true, publico: id, detalhe: await conf.json() }
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
    if (action === 'audience') {
      const c = corpo as Record<string, unknown>
      return json(await refazerPublico(admin, token, {
        camada: c.camada ? String(c.camada) : AUDIENCE_LAYER,
        publico: c.publico ? String(c.publico) : AUDIENCE_ID,
      }))
    }
    if (action === 'conjuntos') return json(await inspecionarConjuntos(token))
    if (action === 'criar_publico') {
      const c = corpo as Record<string, unknown>
      return json(await criarPublico(token, String(c.nome ?? ''), String(c.descricao ?? '')))
    }
    if (action === 'criar_lal') {
      const c = corpo as Record<string, unknown>
      return json(await criarLookalike(
        token, String(c.origem ?? ''), Number(c.razao ?? 0.01), String(c.nome ?? ''),
      ))
    }
    if (action === 'praca') {
      const c = corpo as Record<string, unknown>
      return json(await restringirPraca(token, {
        conjunto: String(c.conjunto ?? ''),
        estados: (c.estados ?? []) as string[],
        dry: c.dry !== false,
      }))
    }
    if (action === 'insights') return json(await puxarInsights(admin, token, Number(corpo.dias ?? 7)))
    if (action === 'capi') return json(await enviarCapi(admin, token, Number(corpo.dias ?? 6)))
    if (action === 'anuncios') return json(await inspecionarAnuncios(token, String((corpo as Record<string, unknown>).ad_id ?? '')))
    if (action === 'extrato') return json(await extratoDaConta(token, Number(corpo.dias ?? 7)))
    if (action === 'entrega') return json(await entregaPorRegiao(token, Number(corpo.dias ?? 30)))
    if (action === 'geo') {
      const c = corpo as Record<string, unknown>
      return json(await barrarGeo(token, c.barrar === true, c.dry !== false))
    }
    if (action === 'cercar') {
      const c = corpo as Record<string, unknown>
      return json(await cercarConjunto(token, {
        adset: String(c.adset ?? ''),
        modelo: String(c.modelo ?? ''),
        idadeMin: Number(c.idade_min ?? 30),
        idadeMax: Number(c.idade_max ?? 60),
        dry: c.dry !== false,
      }))
    }
    if (action === 'atribuir') {
      const c = corpo as Record<string, unknown>
      return json(await atribuirLeadform(admin, token, Number(corpo.dias ?? 30), c.dry === true))
    }
    if (action === 'reamarrar_form') {
      const c = corpo as Record<string, unknown>
      return json(await reamarrarFormulario(token, {
        adId: String(c.ad_id ?? ''),
        formId: String(c.form_id ?? ''),
        dry: c.dry !== false,
        imagemUrl: String(c.imagem_url ?? ''),
        mensagem: String(c.mensagem ?? ''),
      }))
    }
    return json({ error: 'action_invalida', aceitas: ['capi', 'audience', 'insights', 'anuncios', 'extrato', 'entrega', 'geo', 'cercar', 'atribuir', 'reamarrar_form'] }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
