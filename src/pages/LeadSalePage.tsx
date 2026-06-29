import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CircleCheck, TriangleAlert, CheckCircle2, Plus, Minus, Trash2, Search } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'
import { PAGBANK_KIT_LABELS, type PagbankKit } from '@/services/crmPagbank'
import { confirmSale, fetchBlingCatalog, type CartItem, type CatalogProduct } from '@/services/crmConfirmSale'

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function LeadSalePage() {
  const crm = useCrm()
  const navigate = useNavigate()
  const { leadId } = useParams<{ leadId: string }>()

  // A tela seleciona o lead no contexto; selectedLead deriva de selectedLeadId.
  useEffect(() => {
    if (leadId) crm.setSelectedLeadId(leadId)
  }, [leadId, crm.setSelectedLeadId])

  const lead = crm.selectedLead ?? crm.leads.find((l) => l.id === leadId) ?? null
  const ready = !!lead && lead.id === leadId

  const [mode, setMode] = useState<'kit' | 'cart' | 'custom'>('kit')
  const [kit, setKit] = useState<PagbankKit>('3_meses')
  const [amountReais, setAmountReais] = useState('')
  const [description, setDescription] = useState('')
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [method, setMethod] = useState<'pix' | 'card' | 'other'>('pix')
  const [installments, setInstallments] = useState('1')
  const [coupon, setCoupon] = useState('')
  const [freight, setFreight] = useState('')
  const [createBling, setCreateBling] = useState(true)
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageSuccess, setPageSuccess] = useState<string | null>(null)

  const goBack = () => navigate(`/leads/${leadId}`)

  // Carrega o catálogo do Bling sob demanda (só quando abre o modo Carrinho).
  useEffect(() => {
    if (mode !== 'cart' || catalog.length || catalogLoading) return
    setCatalogLoading(true)
    setCatalogError(null)
    fetchBlingCatalog()
      .then(setCatalog)
      .catch((e) => setCatalogError(e instanceof Error ? e.message : 'Falha ao carregar o catálogo do Bling.'))
      .finally(() => setCatalogLoading(false))
  }, [mode, catalog.length, catalogLoading])

  const addToCart = (p: CatalogProduct) =>
    setCart((c) => {
      const i = c.findIndex((x) => x.id === p.id)
      if (i >= 0) {
        const n = [...c]
        n[i] = { ...n[i], qty: n[i].qty + 1 }
        return n
      }
      return [...c, { id: p.id, nome: p.nome, qty: 1, precoCents: p.precoCents }]
    })
  const setQty = (id: string, qty: number) => setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: Math.max(1, qty) } : x)))
  const removeFromCart = (id: string) => setCart((c) => c.filter((x) => x.id !== id))
  const cartTotalCents = cart.reduce((s, x) => s + x.qty * x.precoCents, 0)
  const q = search.trim().toLowerCase()
  const filteredCatalog = (q ? catalog.filter((p) => p.nome.toLowerCase().includes(q)) : catalog).slice(0, 12)

  const handleConfirm = async () => {
    setPageError(null)
    setPageSuccess(null)
    if (mode === 'custom') {
      const cents = Math.round(Number(amountReais.replace(/\./g, '').replace(',', '.')) * 100)
      if (!Number.isFinite(cents) || cents < 100) {
        setPageError('Informe um valor válido.')
        toast.error('Informe um valor válido.')
        return
      }
    }
    if (mode === 'cart' && cart.length === 0) {
      setPageError('Adicione ao menos um produto do Bling ao carrinho.')
      toast.error('Adicione ao menos um produto ao carrinho.')
      return
    }
    setLoading(true)
    try {
      const res = await confirmSale({
        leadId: leadId!,
        mode,
        kit: mode === 'kit' ? kit : undefined,
        amountCents:
          mode === 'custom' ? Math.round(Number(amountReais.replace(/\./g, '').replace(',', '.')) * 100) : undefined,
        description: mode === 'custom' ? description.trim() || 'Venda avulsa' : undefined,
        items: mode === 'cart' ? cart : undefined,
        paymentMethod: method,
        installments: method === 'card' ? Math.max(1, Math.min(12, Number(installments) || 1)) : undefined,
        couponCode: coupon.trim() || undefined,
        freightCents: freight.trim() ? Math.round(Number(freight.replace(/\./g, '').replace(',', '.')) * 100) : undefined,
        createBlingOrder: createBling,
      })
      const valor = (res.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const msg = `Venda confirmada: ${valor} (${res.method}).${res.blingNote ? ' ' + res.blingNote : ''}`
      toast.success(msg)
      setPageSuccess(msg)
      void crm.syncFromSupabase?.()
      navigate(`/leads/${leadId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao confirmar venda'
      setPageError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // Carregando / lead não encontrado.
  if (!ready || !lead) {
    return (
      <AppLayout title="Confirmar venda">
        <div className="space-y-4">
          <Link
            to="/leads"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ‹ Todos os leads
          </Link>
          <EmptyState
            title="Carregando lead…"
            description="Se o lead não aparecer, ele pode ter sido removido ou não está acessível com seu perfil."
          />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Confirmar venda">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/leads" />}>Leads</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to={`/leads/${leadId}`} />}>{lead.patientName}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Venda</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <section className="rounded-md border border-border bg-card p-3 sm:p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <CircleCheck className="size-5 text-emerald-600" /> Confirmar venda
          </h2>
          <p className="text-sm text-muted-foreground">
            Marca o lead como pago, registra a venda no faturamento e cria o pedido no Bling.
          </p>
        </div>

        {pageError ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
            <TriangleAlert className="size-4 shrink-0" /> {pageError}
          </div>
        ) : null}
        {pageSuccess ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="size-4 shrink-0" /> {pageSuccess}
          </div>
        ) : null}

        <div className="mt-4 space-y-4 sm:max-w-md">
          <div className="flex gap-2">
            {(['kit', 'cart', 'custom'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 text-muted-foreground',
                )}
              >
                {m === 'kit' ? 'Kit' : m === 'cart' ? 'Carrinho' : 'Valor avulso'}
              </button>
            ))}
          </div>

          {mode === 'kit' ? (
            <div className="space-y-1.5">
              <Label htmlFor="cs-kit">Kit</Label>
              <Select value={kit} onValueChange={(v) => setKit(v as PagbankKit)}>
                <SelectTrigger id="cs-kit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PAGBANK_KIT_LABELS) as PagbankKit[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {PAGBANK_KIT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[0.7rem] text-muted-foreground">
                No cartão usa o valor cheio; no Pix, com 5% de desconto.
              </p>
            </div>
          ) : mode === 'cart' ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Buscar produto do Bling…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {catalogError ? (
                <p className="text-xs text-destructive">{catalogError}</p>
              ) : catalogLoading ? (
                <p className="text-xs text-muted-foreground">Carregando catálogo do Bling…</p>
              ) : (
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border/40 p-1">
                  {filteredCatalog.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nenhum produto encontrado.</p>
                  ) : (
                    filteredCatalog.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addToCart(p)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                      >
                        {p.imagem ? (
                          <img src={p.imagem} alt="" className="size-7 rounded object-cover" />
                        ) : (
                          <div className="size-7 rounded bg-muted" />
                        )}
                        <span className="flex-1 truncate">{p.nome}</span>
                        <span className="shrink-0 text-muted-foreground">{brl(p.precoCents)}</span>
                        <Plus className="size-3.5 shrink-0 text-primary" />
                      </button>
                    ))
                  )}
                </div>
              )}
              {cart.length > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-border/40 p-2">
                  {cart.map((it) => (
                    <div key={it.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate">{it.nome}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setQty(it.id, it.qty - 1)} className="rounded border border-border/50 p-0.5">
                          <Minus className="size-3" />
                        </button>
                        <span className="w-5 text-center tabular-nums">{it.qty}</span>
                        <button type="button" onClick={() => setQty(it.id, it.qty + 1)} className="rounded border border-border/50 p-0.5">
                          <Plus className="size-3" />
                        </button>
                      </div>
                      <span className="w-16 shrink-0 text-right tabular-nums">{brl(it.qty * it.precoCents)}</span>
                      <button type="button" onClick={() => removeFromCart(it.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-border/40 pt-1.5 text-xs font-semibold">
                    <span>Total (produtos)</span>
                    <span className="tabular-nums">{brl(cartTotalCents)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[0.7rem] text-muted-foreground">
                  Busque e clique nos produtos para montar o carrinho. Cada item vai pro Bling com seu produto cadastrado.
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="cs-amount">Valor (R$)</Label>
                <Input
                  id="cs-amount"
                  inputMode="decimal"
                  value={amountReais}
                  onChange={(e) => setAmountReais(e.target.value)}
                  placeholder="Ex.: 350,00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-desc">Descrição</Label>
                <Input
                  id="cs-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: Combo especial"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cs-method">Forma de pagamento</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as 'pix' | 'card' | 'other')}>
                <SelectTrigger id="cs-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="card">Cartão</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method === 'card' ? (
              <div className="space-y-1.5">
                <Label htmlFor="cs-inst">Parcelas</Label>
                <Select value={installments} onValueChange={(v) => setInstallments(v ?? '1')}>
                  <SelectTrigger id="cs-inst">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="cs-coupon">Cupom (opcional)</Label>
                <Input
                  id="cs-coupon"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  placeholder="Ex.: BEMVINDO10"
                />
              </div>
            )}
          </div>

          {method === 'card' ? (
            <div className="space-y-1.5">
              <Label htmlFor="cs-coupon2">Cupom (opcional)</Label>
              <Input
                id="cs-coupon2"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                placeholder="Ex.: BEMVINDO10"
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="cs-freight">Frete (R$) — cobrado à parte</Label>
            <Input
              id="cs-freight"
              inputMode="decimal"
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              placeholder="Ex.: 15,00 (Maringá). Vazio = sem frete."
            />
            <p className="text-[0.7rem] text-muted-foreground">
              Somado ao total recebido. O Bling recebe só o valor do produto.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Criar pedido no Bling</p>
              <p className="text-[0.7rem] text-muted-foreground">Baixa estoque e gera o pedido de venda.</p>
            </div>
            <Switch checked={createBling} onCheckedChange={setCreateBling} />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button type="button" variant="outline" onClick={goBack} disabled={loading}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirm()} disabled={loading}>
              {loading ? 'Confirmando…' : 'Confirmar venda'}
            </Button>
          </div>
        </div>
      </section>
    </AppLayout>
  )
}
