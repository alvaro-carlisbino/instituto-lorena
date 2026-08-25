import { supabase } from '@/lib/supabaseClient'

/**
 * Camada de leitura do Ads dentro do CRM.
 *
 * Tudo vem de `meta_ads_insights`, que o cron `crm-meta-ads-insights-job`
 * abastece às 05h10 com a janela dos últimos 7 dias. Nada aqui chama a Meta
 * ao vivo: a Graph API é lenta, tem teto de requisição e perde histórico
 * quando a campanha é apagada, o que é inaceitável para tela de gestão.
 */

export type AdsResumo = {
  gasto_cents: number
  impressoes: number
  cliques: number
  leads: number
  conversas: number
  dias: number
}

export type AdsCampanha = {
  campaign_id: string
  campaign_name: string
  gasto_cents: number
  impressoes: number
  cliques: number
  leads: number
  conversas: number
}

export type AdsDia = {
  dia: string
  gasto_cents: number
  impressoes: number
  cliques: number
  leads: number
  conversas: number
}

/** Do gasto da Meta até a venda do CRM, por campanha. */
export type AdsAteVenda = {
  campaign_id: string
  campaign_name: string | null
  spend_cents: number
  leads_meta: number
  conversas_meta: number
  leads_crm: number
  responderam: number
  agendaram: number
  vendas: number
  faturado_cents: number
}

type LinhaBruta = {
  dia: string
  campaign_id: string | null
  campaign_name: string | null
  spend_cents: number
  impressions: number
  clicks: number
  leads: number
  conversas: number
}

/** O client é nulo quando o app roda sem sessão; a tela não deve quebrar por isso. */
function db() {
  if (!supabase) throw new Error('sem conexão com o banco')
  return supabase
}

async function linhas(desde: string, ate: string): Promise<LinhaBruta[]> {
  const { data, error } = await db()
    .from('meta_ads_insights')
    .select('dia,campaign_id,campaign_name,spend_cents,impressions,clicks,leads,conversas')
    .eq('nivel', 'campanha')
    .gte('dia', desde)
    .lte('dia', ate)
    .order('dia', { ascending: true })
    .limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as LinhaBruta[]
}

export async function fetchAdsPeriodo(desde: string, ate: string): Promise<{
  resumo: AdsResumo
  porCampanha: AdsCampanha[]
  porDia: AdsDia[]
}> {
  const rows = await linhas(desde, ate)

  const resumo: AdsResumo = {
    gasto_cents: 0, impressoes: 0, cliques: 0, leads: 0, conversas: 0, dias: 0,
  }
  const camp = new Map<string, AdsCampanha>()
  const dias = new Map<string, AdsDia>()

  for (const r of rows) {
    resumo.gasto_cents += r.spend_cents
    resumo.impressoes += r.impressions
    resumo.cliques += r.clicks
    resumo.leads += r.leads
    resumo.conversas += r.conversas

    const cid = r.campaign_id ?? 'sem-campanha'
    const c = camp.get(cid) ?? {
      campaign_id: cid,
      campaign_name: r.campaign_name ?? 'Sem nome',
      gasto_cents: 0, impressoes: 0, cliques: 0, leads: 0, conversas: 0,
    }
    c.gasto_cents += r.spend_cents
    c.impressoes += r.impressions
    c.cliques += r.clicks
    c.leads += r.leads
    c.conversas += r.conversas
    camp.set(cid, c)

    const d = dias.get(r.dia) ?? {
      dia: r.dia, gasto_cents: 0, impressoes: 0, cliques: 0, leads: 0, conversas: 0,
    }
    d.gasto_cents += r.spend_cents
    d.impressoes += r.impressions
    d.cliques += r.clicks
    d.leads += r.leads
    d.conversas += r.conversas
    dias.set(r.dia, d)
  }

  resumo.dias = dias.size

  return {
    resumo,
    porCampanha: [...camp.values()].sort((a, b) => b.gasto_cents - a.gasto_cents),
    porDia: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
  }
}

/** Histórico completo por campanha, já cruzado com lead, agendamento e venda. */
export async function fetchAdsAteVenda(): Promise<AdsAteVenda[]> {
  const { data, error } = await db()
    .from('v_ads_campanha_ate_venda')
    .select('*')
    .order('spend_cents', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as AdsAteVenda[]
}

/** Quando o cron rodou pela última vez. Tela de gestão precisa dizer se o dado está velho. */
export async function fetchAdsUltimaCarga(): Promise<string | null> {
  const { data, error } = await db()
    .from('meta_ads_insights')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as { synced_at?: string } | null)?.synced_at ?? null
}
