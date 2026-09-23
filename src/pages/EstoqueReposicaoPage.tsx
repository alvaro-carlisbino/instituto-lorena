import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Printer, ShoppingCart } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { formatFracao } from '@/components/kits/kitUi'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { diaLocal } from '@/lib/diaLocal'
import { escaparHtml, imprimirHtml } from '@/lib/exportar'
import { type LinhaDeCompra, consumoLiquido, diasEntre, sugerirCompra } from '@/lib/reposicao'
import { createPurchaseOrder, listMovementsInRange, listStockItems } from '@/services/estoqueCompras'
import { listItemLastCosts } from '@/services/estoqueKits'

// /estoque-reposicao: a relação de segunda-feira. Olha o que foi GASTO no período (kit menos a
// sobra, baixa avulsa; transferência entre setores não conta), projeta para os próximos dias e
// tira o que já tem em todos os setores. Vira ordem de compra "solicitada" para o financeiro.

const formatBRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const diasAtras = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return diaLocal(d)
}

const numeroDoCampo = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'))

export function EstoqueReposicaoPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [de, setDe] = useState(diasAtras(29))
  const [ate, setAte] = useState(diaLocal(new Date()))
  const [cobertura, setCobertura] = useState('30')
  const [linhas, setLinhas] = useState<LinhaDeCompra[]>([])
  const [carregando, setCarregando] = useState(false)
  const [busca, setBusca] = useState('')
  // Quantidade digitada e marcação por item; o que não foi mexido segue a sugestão.
  const [qtdEditada, setQtdEditada] = useState<Record<string, string>>({})
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)

  const diasCobertura = Math.max(1, Math.round(numeroDoCampo(cobertura) || 30))

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    setCarregando(true)
    Promise.all([listStockItems(), listMovementsInRange(de, ate), listItemLastCosts()])
      .then(([itens, movs, custos]) => {
        if (!vivo) return
        const sugestao = sugerirCompra({
          itens: itens
            .filter((i) => i.active && !i.replacedBy)
            .map((i) => ({ id: i.id, name: i.name, unit: i.unit, saldo: i.qty, minQty: i.minQty, lastCostCents: custos.get(i.id) ?? i.referenceCostCents ?? null })),
          consumo: consumoLiquido(movs),
          diasPeriodo: diasEntre(de, ate),
          diasCobertura,
        })
        setLinhas(sugestao)
        setQtdEditada({})
        setDesmarcados(new Set())
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao montar a lista de compra'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [de, ate, diasCobertura])

  const qtdDe = (l: LinhaDeCompra) => {
    const txt = qtdEditada[l.itemId]
    if (txt === undefined) return l.sugerido
    const n = numeroDoCampo(txt)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const escolhidas = linhas.filter((l) => !desmarcados.has(l.itemId) && qtdDe(l) > 0)
  const totalCents = escolhidas.reduce((s, l) => s + Math.round(qtdDe(l) * (l.lastCostCents ?? 0)), 0)
  const semCusto = escolhidas.filter((l) => l.lastCostCents == null).length

  const visiveis = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase('pt-BR')
    return q ? linhas.filter((l) => l.name.toLocaleLowerCase('pt-BR').includes(q)) : linhas
  }, [linhas, busca])

  const alternar = (id: string, marcado: boolean) =>
    setDesmarcados((s) => {
      const n = new Set(s)
      if (marcado) n.delete(id)
      else n.add(id)
      return n
    })

  const periodoTexto = `${new Date(`${de}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${ate}T12:00:00`).toLocaleDateString('pt-BR')}`

  const criarPedido = async () => {
    if (escolhidas.length === 0) {
      toast.error('Marque ao menos um item com quantidade.')
      return
    }
    setSalvando(true)
    try {
      await createPurchaseOrder({
        note: `Lista de compra: gasto de ${periodoTexto}, para ${diasCobertura} dias.`,
        items: escolhidas.map((l) => ({
          itemId: l.itemId,
          description: l.name,
          qty: qtdDe(l),
          unitCostCents: l.lastCostCents ?? 0,
        })),
      })
      toast.success(`Ordem de compra criada com ${escolhidas.length} ${escolhidas.length === 1 ? 'item' : 'itens'}. O financeiro aprova em Ordens de compra.`)
      navigate('/compras')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar a ordem de compra')
    } finally {
      setSalvando(false)
    }
  }

  const imprimir = () => {
    const corpo = escolhidas
      .map(
        (l) => `<tr><td>${escaparHtml(l.name)}</td><td class="n">${formatFracao(l.saldo)} ${escaparHtml(l.unit)}</td><td class="n">${formatFracao(l.gasto)}</td><td class="n"><b>${formatFracao(qtdDe(l))}</b></td><td class="n">${l.lastCostCents != null ? formatBRL(Math.round(qtdDe(l) * l.lastCostCents)) : '-'}</td></tr>`,
      )
      .join('')
    try {
      imprimirHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Lista de compra</title><style>
        :root{color-scheme:light} body{font:12px system-ui,sans-serif;margin:24px;color:#111}
        h1{font-size:16px;margin:0 0 4px} p{margin:0 0 12px;color:#555}
        table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left}
        th{font-size:11px;text-transform:uppercase;color:#555} .n{text-align:right;white-space:nowrap}
        tfoot td{font-weight:700;border-top:2px solid #111}
      </style></head><body>
        <h1>Lista de compra · ${escaparHtml(tenant.name ?? '')}</h1>
        <p>Gasto de ${periodoTexto}, comprando para ${diasCobertura} dias. Gerada em ${new Date().toLocaleString('pt-BR')}.</p>
        <table><thead><tr><th>Item</th><th class="n">Tem hoje</th><th class="n">Gastou</th><th class="n">Comprar</th><th class="n">Valor</th></tr></thead>
        <tbody>${corpo}</tbody><tfoot><tr><td colspan="4">Total estimado</td><td class="n">${formatBRL(totalCents)}</td></tr></tfoot></table>
      </body></html>`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao imprimir')
    }
  }

  return (
    <AppLayout
      title="Lista de compra"
      subtitle="O que foi gasto no período, quanto tem em todos os setores e quanto comprar. Vira ordem de compra para o financeiro."
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rp-de">Gasto de</Label>
          <Input id="rp-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rp-ate">até</Label>
          <Input id="rp-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rp-cob">Comprar para quantos dias</Label>
          <Input id="rp-cob" inputMode="numeric" value={cobertura} onChange={(e) => setCobertura(e.target.value)} className="h-9 w-24" />
        </div>
        {carregando ? <span className="pb-2 text-xs text-muted-foreground">Calculando…</span> : null}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <div>
            <p className="text-sm">
              <b>{escolhidas.length}</b> {escolhidas.length === 1 ? 'item marcado' : 'itens marcados'} · total estimado{' '}
              <b>{formatBRL(totalCents)}</b>
            </p>
            {semCusto > 0 ? (
              <p className="text-xs text-muted-foreground">
                {semCusto} {semCusto === 1 ? 'item sem preço de compra conhecido' : 'itens sem preço de compra conhecido'} (entra com R$ 0, o
                financeiro completa)
              </p>
            ) : null}
          </div>
          <div className="grid w-full gap-2 sm:flex sm:w-auto">
            <Button variant="outline" onClick={imprimir} disabled={escolhidas.length === 0}>
              <Printer className="size-4" /> Imprimir
            </Button>
            <Button onClick={() => void criarPedido()} disabled={salvando || escolhidas.length === 0}>
              <ShoppingCart className="size-4" /> {salvando ? 'Criando…' : 'Criar ordem de compra'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {linhas.length > 8 ? (
        <div className="mb-3 max-w-sm">
          <SearchField label="Buscar item" value={busca} onChange={setBusca} placeholder="Buscar item na lista" />
        </div>
      ) : null}

      {linhas.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={carregando ? 'Calculando…' : 'Nada para comprar'}
          description="Nenhum item gastou mais do que tem para os dias escolhidos. Aumente o período ou os dias de compra."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="hidden grid-cols-[2rem_1fr_6rem_5rem_6rem_7rem] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
            <span />
            <span>Item</span>
            <span className="text-right">Tem hoje</span>
            <span className="text-right">Gastou</span>
            <span className="text-right">Comprar</span>
            <span className="text-right">Valor</span>
          </div>
          {visiveis.map((l) => {
            const marcado = !desmarcados.has(l.itemId)
            const qtd = qtdDe(l)
            return (
              <div
                key={l.itemId}
                className="grid grid-cols-[2rem_1fr_6rem] items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2 last:border-b-0 lg:grid-cols-[2rem_1fr_6rem_5rem_6rem_7rem]"
              >
                <Checkbox checked={marcado} onCheckedChange={(v) => alternar(l.itemId, Boolean(v))} aria-label={`Comprar ${l.name}`} />
                <div className="min-w-0">
                  <p className={marcado ? 'truncate text-sm font-medium' : 'truncate text-sm text-muted-foreground line-through'} title={l.name}>
                    {l.name}
                  </p>
                  <p className="text-xs text-muted-foreground lg:hidden">
                    tem {formatFracao(l.saldo)} · gastou {formatFracao(l.gasto)} {l.unit}
                  </p>
                  {l.motivo === 'minimo' ? <p className="text-xs text-muted-foreground">abaixo do mínimo ({formatFracao(l.minQty)})</p> : null}
                </div>
                <span className={l.saldo < 0 ? 'hidden text-right text-sm text-destructive lg:block' : 'hidden text-right text-sm lg:block'}>
                  {formatFracao(l.saldo)} {l.unit}
                </span>
                <span className="hidden text-right text-sm text-muted-foreground lg:block">{formatFracao(l.gasto)}</span>
                <Input
                  aria-label={`Quantidade de ${l.name}`}
                  inputMode="decimal"
                  className="h-8 text-right"
                  value={qtdEditada[l.itemId] ?? String(l.sugerido)}
                  onChange={(e) => setQtdEditada((s) => ({ ...s, [l.itemId]: e.target.value }))}
                  disabled={!marcado}
                />
                <span className="hidden text-right text-sm lg:block">
                  {l.lastCostCents != null ? formatBRL(Math.round(qtd * l.lastCostCents)) : '-'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </AppLayout>
  )
}

export default EstoqueReposicaoPage
