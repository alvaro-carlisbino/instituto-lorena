import { useEffect, useMemo, useState } from 'react'
import { Download, MessageCircle, RefreshCw, ShoppingCart } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fetchAbandonedCarts, type AbandonedCart, type AbandonedCartsResult } from '@/services/abandonedCarts'
import { cn } from '@/lib/utils'

function brl(cents: number): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const min = Math.round(ms / 60000)
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.round(h / 24)
  return `há ${d}d`
}

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1'

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function downloadCsv(filename: string, rows: string[][]): void {
  const body = rows.map((r) => r.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// Mensagem de recuperação (sem travessão, tom humano). Cita o primeiro item do carrinho.
function recoveryMessage(c: AbandonedCart): string {
  const nome = (c.name ?? '').split(' ')[0] || ''
  const oi = nome ? `Oi ${nome}, tudo bem?` : 'Oi, tudo bem?'
  const item = c.items[0]?.nome ? ` do ${c.items[0].nome}` : ''
  return `${oi} Vi que você começou seu pedido${item} no site da Tricopill e não chegou a finalizar. Posso te ajudar a concluir agora? Se preferir, eu já deixo tudo separado pra você.`
}

function waLink(c: AbandonedCart): string | null {
  const d = String(c.phone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  const full = d.length <= 11 ? `55${d}` : d
  return `https://wa.me/${full}?text=${encodeURIComponent(recoveryMessage(c))}`
}

const PERIODS = [
  { v: 7, l: '7 dias' },
  { v: 30, l: '30 dias' },
  { v: 90, l: '90 dias' },
]

export function CarrinhosAbandonadosPage() {
  const [data, setData] = useState<AbandonedCartsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [reloadKey, setReloadKey] = useState(0)
  const [contacted, setContacted] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAbandonedCarts(days)
      .then((res) => { if (!cancelled) setData(res) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar carrinhos.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days, reloadKey])

  const carts = data?.carts ?? []
  const active = useMemo(() => carts.filter((c) => !c.alreadyCustomer), [carts])

  const exportCsv = () => {
    const header = ['Cliente', 'Telefone', 'Email', 'Itens', 'Valor', 'Origem', 'Google Ads', 'Última atividade', 'Já cliente']
    const body = carts.map((c) => [
      c.name ?? '', c.phone ?? '', c.email ?? '',
      c.items.map((i) => `${i.qty > 1 ? `${i.qty}x ` : ''}${i.nome}`).join(' | '),
      (c.valueCents / 100).toFixed(2).replace('.', ','),
      c.source ?? '', c.gclid ? 'sim' : '', c.lastSeen.slice(0, 16).replace('T', ' '), c.alreadyCustomer ? 'sim' : '',
    ])
    downloadCsv(`carrinhos-abandonados-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
  }

  return (
    <AppLayout
      title="Carrinhos abandonados"
      subtitle="Quem colocou no carrinho, deixou o contato e não finalizou. Recupere no WhatsApp."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-xl" onClick={exportCsv} disabled={carts.length === 0}>
            <Download className="size-3.5" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Atualizar
          </Button>
        </div>
      }
    >
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Recuperáveis" value={String(active.length)} tone="text-amber-600" hint="com contato e sem compra" />
        <KpiCard label="Valor em jogo" value={brl(data?.recoverableValueCents ?? 0)} hint="soma dos carrinhos" />
        <KpiCard label="Já viraram cliente" value={String(carts.length - active.length)} tone="text-emerald-600" hint="compraram por outro caminho" />
        <KpiCard label="Anônimos" value={String(data?.anonymousCount ?? 0)} hint="carrinho sem contato" />
      </section>

      <section className="flex items-center gap-2 border-b border-border/20 pb-4">
        <div className="inline-flex shrink-0 rounded-xl bg-muted/40 p-1">
          {PERIODS.map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setDays(o.v)}
              className={cn(
                'h-7 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wide transition-all duration-200',
                days === o.v ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold text-muted-foreground">{active.length} para recuperar</span>
      </section>

      {error ? <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Cliente</TableHead>
              <TableHead>Carrinho</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Última atividade</TableHead>
              <TableHead className="text-right">Recuperar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : carts.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">Nenhum carrinho abandonado no período. 🎉</TableCell></TableRow>
            ) : (
              carts.map((c) => {
                const link = waLink(c)
                const done = contacted.has(c.sessionId)
                return (
                  <TableRow key={c.sessionId} className={cn(c.alreadyCustomer && 'opacity-55')}>
                    <TableCell>
                      <div className="font-semibold text-foreground/90">{c.name ?? 'Sem nome'}</div>
                      {c.phone ? <div className="text-xs text-muted-foreground">{c.phone}</div> : null}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.alreadyCustomer ? <span className={cn(PILL, 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25')}>Já comprou</span> : null}
                        {done ? <span className={cn(PILL, 'bg-sky-500/10 text-sky-700 ring-sky-500/25')}>Contatado</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[280px] text-xs">
                      {c.items.length > 0 ? (
                        <ul className="space-y-0.5">
                          {c.items.map((it, i) => (
                            <li key={i} className="truncate text-foreground/80">{it.qty > 1 ? `${it.qty}× ` : ''}{it.nome}</li>
                          ))}
                        </ul>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{c.valueCents > 0 ? brl(c.valueCents) : '—'}</TableCell>
                    <TableCell className="text-xs">
                      <div className="text-foreground/80">{c.source ?? '—'}</div>
                      {c.gclid ? <div className="text-[10px] font-semibold text-emerald-600">Google Ads</div> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{relTime(c.lastSeen)}</TableCell>
                    <TableCell className="text-right">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => setContacted((s) => new Set(s).add(c.sessionId))}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-500/25 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
                        >
                          <MessageCircle className="size-3.5" /> WhatsApp
                        </a>
                      ) : <span className="text-xs text-muted-foreground">sem telefone</span>}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <ShoppingCart className="size-3" />
        O contato é capturado quando o cliente digita nome e WhatsApp no checkout do site. Carrinhos com menos de 30 min de inatividade ficam de fora (podem estar comprando agora).
      </p>
    </AppLayout>
  )
}

function KpiCard({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/60">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-bold tabular-nums', tone)}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground/70">{hint}</div> : null}
    </div>
  )
}
