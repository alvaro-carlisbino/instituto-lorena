import { useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const toCents = (reais: string) => {
  const n = Number(String(reais).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/**
 * CAC & ROAS (Fase 4, métricas). Investimento em anúncios é digitado AO VIVO pro período
 * selecionado (não persiste — um valor fixo ficaria errado pra outro intervalo). CAC =
 * investimento / vendas pagas; ROAS = receita paga / investimento.
 */
export function TricopillCacCard({ paidCount, revenueCents }: { paidCount: number; revenueCents: number }) {
  const [spendInput, setSpendInput] = useState('')
  const spend = toCents(spendInput)

  const { cac, roas } = useMemo(() => {
    const cac = paidCount > 0 ? Math.round(spend / paidCount) : 0
    const roas = spend > 0 ? revenueCents / spend : 0
    return { cac, roas }
  }, [spend, paidCount, revenueCents])

  return (
    <div className="rounded-3xl border border-border/30 bg-card/40 p-6">
      <p className="mb-1 text-sm font-bold text-foreground/90">CAC &amp; ROAS</p>
      <p className="mb-4 text-[11px] text-muted-foreground">
        Digite quanto investiu em anúncios <b>neste período</b> pra ver o custo por venda e o retorno.
      </p>

      <div className="max-w-[240px] space-y-1">
        <label className="text-[11px] font-semibold text-foreground/80">Investimento em ads (período)</label>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">R$</span>
          <Input value={spendInput} onChange={(e) => setSpendInput(e.target.value)} inputMode="decimal" placeholder="0,00" className="h-8" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/20 pt-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">CAC</p>
          <p className="mt-0.5 text-lg font-black tabular-nums text-foreground">{spend > 0 ? brl(cac) : '—'}</p>
          <p className="text-[10px] text-muted-foreground">{paidCount} venda(s) paga(s)</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">ROAS</p>
          <p className="mt-0.5 text-lg font-black tabular-nums text-emerald-600">{spend > 0 ? `${roas.toFixed(1)}x` : '—'}</p>
          <p className="text-[10px] text-muted-foreground">receita ÷ investimento</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Receita paga</p>
          <p className="mt-0.5 text-lg font-black tabular-nums text-foreground">{brl(revenueCents)}</p>
        </div>
      </div>
    </div>
  )
}
