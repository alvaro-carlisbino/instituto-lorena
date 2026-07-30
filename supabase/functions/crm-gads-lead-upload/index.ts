import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { uploadGoogleAdsConversion } from '../_shared/conversions.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Sobe os CLIQUES DE WHATSAPP com gclid pro Google Ads, na ação "Lead WhatsApp".
//
// Por que existe: a conta tinha uma única ação de conversão, "Compras", que só dispara
// quando alguém finaliza no checkout do site. Só que as vendas que o Google Ads gera
// fecham na CONVERSA: em 60 dias foram 3 vendas (R$ 1.902) e todas vieram de lead de
// WhatsApp com gclid, contra 2 conversões de compra no site. Com 2 conversões em 30 dias
// o algoritmo não aprende nada, e a campanha fica presa em "maximizar cliques" pra sempre.
// O clique no botão de WhatsApp é o primeiro sinal REAL de intenção que a gente consegue
// medir no mesmo dia, então é ele que sobe.
//
// Varredura em vez de disparo ao vivo de propósito: é idempotente, recupera o histórico
// que já está no banco e não depende de mudar nada no front do site.
//
// Dedupe em duas camadas: `meta.gads_lead_uploaded_at` no próprio evento (não relê o que
// já subiu) e `transactionId` = id do evento (o Google descarta reenvio do mesmo id).
//
// Env:
//   GOOGLE_ADS_LEAD_ACTION_ID   id da ação "Lead WhatsApp" (default: 7701358210)
//   GOOGLE_ADS_CUSTOMER_ID / GOOGLE_ADS_* (OAuth)  — já usados pelo backfill de compras
//
// Roda AO VIVO por padrão. Não tem trava *_ENABLED de propósito: subir conversão não fala
// com cliente nenhum, então o risco de rodar é zero e o de ficar em dry-run esquecido é
// alto (já aconteceu com o carrinho abandonado, que passou um mês sem enviar).
// Para inspecionar sem enviar: ?dry=1
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const LEAD_ACTION_ID = (Deno.env.get('GOOGLE_ADS_LEAD_ACTION_ID') ?? '7701358210').trim()

// Janela de clique do Google: conversão mais velha que isso é recusada.
const LOOKBACK_DIAS = 30

type Evento = {
  id: string
  created_at: string
  session_id: string | null
  attribution: Record<string, unknown> | null
  meta: Record<string, unknown> | null
}

/** O gclid é gravado em attribution.first.gclid; versões antigas gravavam na raiz. */
function acharGclid(attribution: Record<string, unknown> | null): string {
  if (!attribution) return ''
  const first = attribution.first as Record<string, unknown> | undefined
  const bruto = (first?.gclid ?? attribution.gclid ?? '') as unknown
  return typeof bruto === 'string' ? bruto.trim() : ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const dias = Math.min(LOOKBACK_DIAS, Number(url.searchParams.get('dias') ?? LOOKBACK_DIAS) || LOOKBACK_DIAS)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return json({ error: 'sem_credenciais_supabase' }, 500)
  const db = createClient(supabaseUrl, serviceKey)

  const desde = new Date(Date.now() - dias * 864e5).toISOString()

  const { data, error } = await db
    .from('storefront_events')
    .select('id, created_at, session_id, attribution, meta')
    .eq('type', 'whatsapp_click')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) return json({ error: 'consulta_falhou', detalhe: error.message }, 500)

  const eventos = (data ?? []) as Evento[]
  const resultado = { total: eventos.length, sem_gclid: 0, ja_subiu: 0, enviados: 0, falhas: 0 as number, erros: [] as string[] }

  for (const ev of eventos) {
    if (ev.meta?.gads_lead_uploaded_at) { resultado.ja_subiu++; continue }

    const gclid = acharGclid(ev.attribution)
    if (!gclid) { resultado.sem_gclid++; continue }

    if (dry) { resultado.enviados++; continue }

    // valor 0 de verdade desde 29/07/2026. Antes a ação "Lead WhatsApp" tinha
    // defaultValue R$ 200 + alwaysUseDefaultValue, e o Google carimbava esse valor por cima
    // do 0 daqui. Era receita fictícia: 4 leads viravam "R$ 800 de conversão" no painel.
    // Inofensivo em Maximizar Cliques, mas envenenaria Maximizar Valor de Conversão, onde
    // o R$ 200 falso disputa com o valor real das Compras. Lead é sinal de volume, não de
    // receita — quem tem valor é a ação "Compras".
    const r = await uploadGoogleAdsConversion({
      gclid,
      valueReais: 0,
      orderId: ev.id,
      when: new Date(ev.created_at),
      actionId: LEAD_ACTION_ID,
    })

    if (!r.ok) {
      resultado.falhas++
      if (resultado.erros.length < 5) resultado.erros.push(`${ev.id}: ${r.error ?? 'erro'}`)
      continue
    }

    resultado.enviados++
    // Carimba só depois do OK: se a marcação falhar, a próxima rodada tenta de novo e o
    // Google deduplica pelo transactionId. Perder o carimbo custa um reenvio, não uma venda.
    // Guarda o requestId junto: "enviado" só vira "registrado" quando a conversão aparece no
    // Google, e sem o protocolo não dá pra rastrear o que sumiu no meio do caminho.
    await db
      .from('storefront_events')
      .update({
        meta: {
          ...(ev.meta ?? {}),
          gads_lead_uploaded_at: new Date().toISOString(),
          ...(r.requestId ? { gads_lead_request_id: r.requestId } : {}),
        },
      })
      .eq('id', ev.id)
  }

  return json({ ok: true, dry, dias, acao: LEAD_ACTION_ID, ...resultado })
})
