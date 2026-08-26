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
  async function g(caminho: string, params: Record<string, string>) {
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

/** Estados do Nordeste e do Norte. A clínica opera em Maringá e Londrina; a
 * cirurgia é presencial em Maringá de qualquer jeito. Em 60 dias, 104 leads
 * vieram destes DDDs e deram ZERO venda e ZERO agendamento (o Norte teve 2
 * agendamentos, nenhum virou cirurgia), contra 78 vendas em 927 leads do Paraná. */
const ESTADOS_BARRADOS = [
  'Maranhão', 'Piauí', 'Ceará', 'Rio Grande do Norte', 'Paraíba', 'Pernambuco',
  'Alagoas', 'Sergipe', 'Bahia',
  'Acre', 'Amapá', 'Amazonas', 'Pará', 'Rondônia', 'Roraima', 'Tocantins',
]

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

/** Resolve o `key` numérico que a Meta usa para cada estado. */
async function chavesDosEstados(token: string): Promise<Array<{ key: string; nome: string }>> {
  const achados: Array<{ key: string; nome: string }> = []
  for (const nome of ESTADOS_BARRADOS) {
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
      cidades: ((geo.cities ?? []) as Array<Record<string, string>>).map((r) => r.name ?? r.key),
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
    if (action === 'anuncios') return json(await inspecionarAnuncios(token, String((corpo as Record<string, unknown>).ad_id ?? '')))
    if (action === 'extrato') return json(await extratoDaConta(token, Number(corpo.dias ?? 7)))
    if (action === 'geo') {
      const c = corpo as Record<string, unknown>
      return json(await barrarGeo(token, c.barrar === true, c.dry !== false))
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
    return json({ error: 'action_invalida', aceitas: ['capi', 'audience', 'insights', 'anuncios', 'extrato', 'atribuir', 'reamarrar_form'] }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
