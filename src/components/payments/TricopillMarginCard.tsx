import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { kitLabel } from '@/services/tricopillBi'

const KITS = ['1_mes', '3_meses', '5_meses'] as const

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const toReais = (cents: number) => (cents > 0 ? (cents / 100).toFixed(2).replace('.', ',') : '')
const toCents = (reais: string) => {
  const n = Number(String(reais).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/**
 * Custos por kit + Margem (Fase 4). Custo guardado em
 * crm_ai_configs.business_rules.custo_kits (centavos), editável aqui. Margem =
 * receita paga − Σ(qtd vendida do kit × custo do kit), usando checkout.por_kit do BI.
 * Margem só conta os kits que TÊM custo cadastrado (avisa quando falta).
 */
export function TricopillMarginCard({
  porKit,
  revenueCents,
  startIso,
  endIso,
}: {
  porKit: Array<{ kit: string; count: number; total_cents: number }>
  revenueCents: number
  /** Intervalo (yyyy-mm-dd) p/ somar o frete arrecadado (margem líquida). */
  startIso: string
  endIso: string
}) {
  const [costCents, setCostCents] = useState<Record<string, number>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [businessRules, setBusinessRules] = useState<Record<string, unknown>>({})
  const [freightCollected, setFreightCollected] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    void supabase
      .from('crm_ai_configs')
      .select('business_rules')
      .eq('id', 'default')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const br = ((data as { business_rules?: Record<string, unknown> } | null)?.business_rules ?? {}) as Record<string, unknown>
        setBusinessRules(br)
        const saved = (br.custo_kits ?? {}) as Record<string, number>
        const cents: Record<string, number> = {}
        const d: Record<string, string> = {}
        for (const k of KITS) {
          cents[k] = Number(saved[k] ?? 0)
          d[k] = toReais(cents[k])
        }
        setCostCents(cents)
        setDraft(d)
      })
      .then(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Frete arrecadado no período (pago) — pra descontar da margem (margem líquida).
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void supabase
      .from('asaas_payments')
      .select('freight_cents')
      .not('paid_at', 'is', null)
      .gte('paid_at', `${startIso}T00:00:00`)
      .lte('paid_at', `${endIso}T23:59:59`)
      .then(({ data }) => {
        if (cancelled) return
        const sum = (data ?? []).reduce((s, r) => s + Number((r as { freight_cents?: number }).freight_cents ?? 0), 0)
        setFreightCollected(sum)
      })
    return () => {
      cancelled = true
    }
  }, [startIso, endIso])

  const soldByKit = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of porKit) m[r.kit] = (m[r.kit] ?? 0) + r.count
    return m
  }, [porKit])

  const margin = useMemo(() => {
    let cost = 0
    let revenueWithCost = 0
    let kitsSemCusto = 0
    for (const r of porKit) {
      const c = costCents[r.kit] ?? 0
      if (c > 0) {
        cost += c * r.count
        revenueWithCost += r.total_cents
      } else if (r.count > 0) {
        kitsSemCusto += 1
      }
    }
    const lucro = revenueWithCost - cost
    const pct = revenueWithCost > 0 ? Math.round((lucro / revenueWithCost) * 100) : 0
    // Líquida: tira o frete arrecadado (não é lucro — cobre o custo do envio).
    const lucroLiq = lucro - freightCollected
    const baseLiq = Math.max(0, revenueWithCost - freightCollected)
    const pctLiq = baseLiq > 0 ? Math.round((lucroLiq / baseLiq) * 100) : 0
    return { cost, lucro, pct, revenueWithCost, kitsSemCusto, lucroLiq, pctLiq }
  }, [porKit, costCents, freightCollected])

  const save = async () => {
    if (!supabase) return
    setSaving(true)
    try {
      const custo_kits: Record<string, number> = {}
      for (const k of KITS) custo_kits[k] = toCents(draft[k] ?? '')
      const nextRules = { ...businessRules, custo_kits }
      const { error } = await supabase.from('crm_ai_configs').update({ business_rules: nextRules }).eq('id', 'default')
      if (error) throw new Error(error.message)
      setBusinessRules(nextRules)
      setCostCents(custo_kits)
      toast.success('Custos salvos.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar custos.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-3xl border border-border/30 bg-card/40 p-6">
      <p className="mb-1 text-sm font-bold text-foreground/90">Custos &amp; Margem</p>
      <p className="mb-4 text-[11px] text-muted-foreground">
        Informe o custo de cada kit pra ver a margem. A margem só conta os kits com custo cadastrado.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {KITS.map((k) => (
          <div key={k} className="space-y-1">
            <label className="text-[11px] font-semibold text-foreground/80">{kitLabel(k)}</label>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">R$</span>
              <Input
                value={draft[k] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                inputMode="decimal"
                placeholder="0,00"
                disabled={loading}
                className="h-8"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">{soldByKit[k] ?? 0} vendido(s) no período</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => void save()} disabled={loading || saving}>
          {saving ? 'Salvando…' : 'Salvar custos'}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/20 pt-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Custo (período)</p>
          <p className="mt-0.5 text-lg font-black tabular-nums text-rose-600">{brl(margin.cost)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Margem bruta</p>
          <p className="mt-0.5 text-lg font-black tabular-nums text-emerald-600">{brl(margin.lucro)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Margem %</p>
          <p className="mt-0.5 text-lg font-black tabular-nums text-foreground">{margin.pct}%</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2">
        <span className="text-[11px] font-semibold text-foreground/80">
          Margem líquida <span className="font-normal text-muted-foreground">(− frete {brl(freightCollected)})</span>
        </span>
        <span className="text-sm font-black tabular-nums text-emerald-700 dark:text-emerald-400">
          {brl(margin.lucroLiq)} <span className="text-muted-foreground">· {margin.pctLiq}%</span>
        </span>
      </div>
      {margin.kitsSemCusto > 0 ? (
        <p className="mt-2 text-[11px] text-amber-600">
          ⚠️ {margin.kitsSemCusto} kit(s) vendido(s) sem custo cadastrado ficam de fora da margem.
        </p>
      ) : null}
      <p className="mt-1 text-[10px] text-muted-foreground">Receita considerada (kits com custo): {brl(margin.revenueWithCost)} · receita total paga: {brl(revenueCents)}</p>
    </div>
  )
}
