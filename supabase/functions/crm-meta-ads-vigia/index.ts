/**
 * crm-meta-ads-vigia — o vigia da conta de anúncio.
 *
 * A conta da clínica tem duas mãos no volante: a agência mexe, o CRM mexe. Em
 * 25/08/2026 o Vitor pausou dezesseis conjuntos às 16h31 e apagou os públicos
 * de intenção que tinham sido postos às 15h30. Ninguém agiu de má-fé: cada lado
 * viu a conta mudar e reagiu.
 *
 * Este vigia NÃO desfaz nada. Se ele corrigisse sozinho, viraria briga de
 * edição no automático, e toda edição zera o aprendizado do algoritmo — o
 * prejuízo seria maior que o problema. Ele só OLHA e AVISA, dizendo o que saiu
 * do combinado e quem mexeu na última hora.
 *
 * O que ele confere, e por que cada coisa está aqui:
 *
 *  1. ANÚNCIO COM DATA VENCIDA no ar. Foi o caso que originou o vigia: os
 *     criativos "Jaque 07/08" e "LORENA 07 DE AGOSTO" anunciavam consulta em
 *     Londrina no dia 7 de agosto e rodaram até 25/08. Deram 38 cliques e zero
 *     conversa: a pessoa clica, vê data vencida e sai. Anúncio de data performa
 *     bem ANTES e vira armadilha depois, então nunca se escolhe criativo por
 *     custo por resultado sem ler a copy.
 *
 *  2. VERBA acima do teto. A meta é R$ 10 mil por mês, R$ 328 por dia.
 *
 *  3. EXTERIOR na segmentação. Lisboa, Miami, Orlando, Paris e Dubai estavam
 *     nos conjuntos ativos, custando CPM de R$ 89,92 em praça onde a clínica
 *     não atende.
 *
 *  4. EXCLUSÃO DE PACIENTE removida. Sem ela a conta paga para alcançar quem
 *     já comprou.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { notifyOwnerWhatsapp } from '../_shared/saleReceipt.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const GRAPH = 'https://graph.facebook.com/v21.0'
const ACT = Deno.env.get('META_ADS_ACCOUNT_ID') ?? 'act_1279722182785466'
const TENANT = 'instituto-lorena'

/** R$ 328/dia é o combinado. A folga de 10% evita alarme por arredondamento da Meta. */
const TETO_DIA = Number(Deno.env.get('META_ADS_TETO_DIA') ?? '328')
const FOLGA = 1.10

/** Públicos de paciente que precisam estar excluídos em todo conjunto ativo. */
const EXCLUSOES = ['120206386372550061', '120210886808620061', '120210887715520061']

const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
}

/**
 * Acha data no texto e diz se já passou. Aceita "7/08", "07 de agosto",
 * "7 de ago". Sem ano na maioria dos criativos, então assume o ano corrente e
 * só reclama do que ficou para trás — data futura é campanha legítima.
 */
function dataVencida(texto: string, hoje: Date): string | null {
  const t = (texto ?? '').toLowerCase()
  const re = /\b(0?[1-9]|[12]\d|3[01])\s*(?:\/|\s+de\s+)\s*(0?[1-9]|1[0-2]|jan\w*|fev\w*|mar\w*|abr\w*|mai\w*|jun\w*|jul\w*|ago\w*|set\w*|out\w*|nov\w*|dez\w*)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const dia = Number(m[1])
    const bruto = m[2]
    const mes = /^\d+$/.test(bruto) ? Number(bruto) : MESES[bruto.slice(0, 3)]
    if (!mes || mes < 1 || mes > 12) continue
    const quando = new Date(Date.UTC(hoje.getUTCFullYear(), mes - 1, dia))
    // 3 dias de tolerância: anúncio do evento de ontem ainda pode estar sendo desligado.
    const limite = new Date(hoje.getTime() - 3 * 86400000)
    if (quando < limite) return `${dia}/${String(mes).padStart(2, '0')}`
  }
  return null
}

type Achado = { nivel: 'critico' | 'alto' | 'medio'; o_que: string }

async function g(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token })
  const res = await fetch(`${GRAPH}/${path}?${qs}`)
  return await res.json()
}

async function vigiar(token: string) {
  const hoje = new Date()
  const achados: Achado[] = []

  // ── 1. Anúncios que podem entregar, e o texto deles ───────────────────────
  const ads = await g(`${ACT}/ads`, {
    fields: 'id,name,effective_status,adset{name},creative{body,title,object_story_spec}',
    effective_status: JSON.stringify(['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS']),
    limit: '200',
  }, token)
  for (const a of (ads.data ?? []) as Array<Record<string, unknown>>) {
    const cr = (a.creative ?? {}) as Record<string, unknown>
    const oss = (cr.object_story_spec ?? {}) as Record<string, Record<string, string>>
    const texto = [
      a.name, cr.body, cr.title,
      oss.video_data?.message, oss.link_data?.message, oss.photo_data?.message,
    ].filter(Boolean).join(' ')
    const venceu = dataVencida(texto, hoje)
    if (venceu) {
      achados.push({
        nivel: 'critico',
        o_que: `anúncio no ar anunciando ${venceu}, que já passou: "${String(a.name).slice(0, 46)}"`,
      })
    }
  }

  // ── 2. Verba diária ───────────────────────────────────────────────────────
  const camps = await g(`${ACT}/campaigns`, {
    fields: 'id,name,effective_status,daily_budget', limit: '100',
  }, token)
  let diaria = 0
  for (const c of (camps.data ?? []) as Array<Record<string, unknown>>) {
    if (c.effective_status === 'ACTIVE' || c.effective_status === 'IN_PROCESS') {
      diaria += Number(c.daily_budget ?? 0) / 100
    }
  }
  if (diaria > TETO_DIA * FOLGA) {
    achados.push({
      nivel: 'critico',
      o_que: `verba em R$ ${diaria.toFixed(2)}/dia, acima do combinado de R$ ${TETO_DIA}/dia (daria R$ ${(diaria * 30).toFixed(0)}/mês)`,
    })
  }

  // ── 3 e 4. Segmentação dos conjuntos ativos ───────────────────────────────
  const sets = await g(`${ACT}/adsets`, {
    fields: 'id,name,effective_status,targeting',
    effective_status: JSON.stringify(['ACTIVE']),
    limit: '100',
  }, token)
  for (const s of (sets.data ?? []) as Array<Record<string, unknown>>) {
    const t = (s.targeting ?? {}) as Record<string, unknown>
    const geo = (t.geo_locations ?? {}) as Record<string, unknown>
    const paises = (geo.countries ?? []) as string[]
    const fora = [
      ...paises.filter((p) => p !== 'BR'),
      ...((geo.regions ?? []) as Array<Record<string, string>>).filter((r) => (r.country ?? 'BR') !== 'BR').map((r) => r.name),
      ...((geo.cities ?? []) as Array<Record<string, string>>).filter((c) => (c.country ?? 'BR') !== 'BR').map((c) => c.name),
    ]
    if (fora.length) {
      achados.push({
        nivel: 'alto',
        o_que: `conjunto "${String(s.name).slice(0, 34)}" voltou a mirar fora do Brasil: ${fora.slice(0, 4).join(', ')}`,
      })
    }
    const ex = ((t.excluded_custom_audiences ?? []) as Array<Record<string, string>>).map((c) => c.id)
    const faltando = EXCLUSOES.filter((id) => !ex.includes(id))
    if (faltando.length === EXCLUSOES.length) {
      achados.push({
        nivel: 'alto',
        o_que: `conjunto "${String(s.name).slice(0, 34)}" está sem nenhuma exclusão de paciente: paga para alcançar quem já comprou`,
      })
    }
  }

  // ── Quem mexeu na última hora ─────────────────────────────────────────────
  const desde = new Date(hoje.getTime() - 3600_000).toISOString().slice(0, 19)
  const act = await g(`${ACT}/activities`, {
    fields: 'event_type,event_time,actor_name,object_name', limit: '80', since: desde,
  }, token)
  const porAutor = new Map<string, number>()
  for (const a of (act.data ?? []) as Array<Record<string, string>>) {
    const quem = String(a.actor_name ?? 'desconhecido')
    porAutor.set(quem, (porAutor.get(quem) ?? 0) + 1)
  }
  // O próprio CRM aparece como "adsapi": não é novidade, não entra no aviso.
  const outros = [...porAutor.entries()].filter(([q]) => q.toLowerCase() !== 'adsapi')

  return { achados, diaria, mexeram: outros.map(([q, n]) => `${q} (${n} alterações)`) }
}

function montarTexto(r: Awaited<ReturnType<typeof vigiar>>): string | null {
  if (!r.achados.length) return null
  const ordem = { critico: 0, alto: 1, medio: 2 } as const
  const lista = [...r.achados].sort((a, b) => ordem[a.nivel] - ordem[b.nivel])
  const linhas = lista.slice(0, 8).map((a) => `${a.nivel === 'critico' ? '🔴' : '🟡'} ${a.o_que}`)
  let txt = `Vigia do Ads da clínica\n\n${linhas.join('\n\n')}`
  if (lista.length > 8) txt += `\n\n(mais ${lista.length - 8} pontos)`
  if (r.mexeram.length) txt += `\n\nMexeram na conta na última hora: ${r.mexeram.join(', ')}.`
  txt += `\n\nO vigia não desfaz nada sozinho, de propósito: cada edição zera o aprendizado da campanha.`
  return txt
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin: SupabaseClient = createClient(supabaseUrl, serviceRole)

  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  const { data: seg } = await admin
    .from('app_cron_secrets').select('secret').eq('key', 'meta_ads').maybeSingle()
  const esperado = String((seg as { secret?: string } | null)?.secret ?? '').trim()
  if (esperado && provided !== esperado) return json({ error: 'unauthorized' }, 401)

  const token = (Deno.env.get('META_ADS_TOKEN') ?? '').trim()
  if (!token) return json({ error: 'META_ADS_TOKEN ausente' }, 500)

  let corpo: { avisar?: boolean } = {}
  try { corpo = await req.json() } catch { /* vazio avisa */ }
  const avisar = corpo.avisar !== false

  try {
    const r = await vigiar(token)
    const texto = montarTexto(r)
    let enviado = false

    if (texto && avisar) {
      // Dedupe de 6h por conteúdo: o vigia roda de hora em hora e o mesmo
      // problema costuma levar um dia para alguém resolver. Sem isso, ele vira
      // ruído e a pessoa passa a ignorar o alerta inteiro.
      const chave = `ads-vigia:${texto.slice(0, 120)}`
      const seisHoras = new Date(Date.now() - 6 * 3600_000).toISOString()
      const { data: jaAvisou } = await admin
        .from('meta_ads_vigia_log').select('id')
        .eq('chave', chave).gte('created_at', seisHoras).limit(1).maybeSingle()
      if (!jaAvisou) {
        enviado = await notifyOwnerWhatsapp(admin, TENANT, 'ads', texto)
        await admin.from('meta_ads_vigia_log').insert({ chave, texto, enviado })
      }
    }

    return json({
      ok: true,
      achados: r.achados.length,
      criticos: r.achados.filter((a) => a.nivel === 'critico').length,
      verba_dia: r.diaria,
      mexeram: r.mexeram,
      avisado: enviado,
      detalhe: r.achados,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
