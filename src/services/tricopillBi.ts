import { supabase } from '@/lib/supabaseClient'

// BI do Tricopill — funil (CRM) + checkout (PagBank/e.Rede) + faturamento Bling.
// Tudo agregado on-demand pela edge function crm-tricopill-bi para o polo ativo.

export type TricopillDayBucket = { dia: string; total_cents: number; count: number }

export type TricopillBi = {
  range: { start: string; end: string }
  funnel: {
    total_leads: number
    pagos: number
    conversao_pct: number
    por_stage: Array<{ stage_id: string; name: string; count: number }>
    etapas: Array<{ stage_id: string; name: string; count: number; atingiram: number; pct: number }>
    por_source: Array<{ source: string; count: number }>
  }
  checkout: {
    total_cents: number
    total_pagos: number
    ticket_medio_cents: number
    pix: { pagos: number; gerados: number; total_cents: number }
    cartao: { pagos: number; gerados: number; total_cents: number; parcelamento_medio: number }
    por_kit: Array<{ kit: string; count: number; total_cents: number }>
    por_dia: TricopillDayBucket[]
    desconto_total_cents: number
    por_cupom: Array<{ code: string; count: number; total_cents: number }>
  }
  bling: {
    connected: boolean
    faturamento_cents: number
    pedidos: number
    ticket_medio_cents: number
    por_dia: TricopillDayBucket[]
    estoque: Array<{ nome: string; codigo: string; estoque: number | null; preco: number }>
    error: string | null
  }
}

/** Busca o BI do Tricopill (polo ativo) no intervalo informado. */
export async function fetchTricopillBi(params: { start: Date; end: Date }): Promise<TricopillBi | null> {
  if (!supabase) return null
  const { data, error } = await supabase.functions.invoke('crm-tricopill-bi', {
    body: { start: params.start.toISOString(), end: params.end.toISOString() },
  })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    throw new Error(String(msg || 'Falha ao carregar o BI do Tricopill'))
  }
  const p = (data ?? {}) as { ok?: boolean; message?: string } & Partial<TricopillBi>
  if (!p.ok || !p.funnel || !p.checkout || !p.bling) {
    throw new Error(String(p.message || 'Falha ao carregar o BI do Tricopill'))
  }
  return {
    range: p.range ?? { start: params.start.toISOString(), end: params.end.toISOString() },
    funnel: p.funnel,
    checkout: p.checkout,
    bling: p.bling,
  }
}

/** Formata centavos como BRL. */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const KIT_LABELS: Record<string, string> = {
  '1_mes': '1 mês (1 frasco)',
  '3_meses': '3 meses (3+1)',
  '5_meses': '5 meses (5 frascos)',
  avulso: 'Avulso',
}
export function kitLabel(kit: string): string {
  return KIT_LABELS[kit] ?? kit
}
