import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CircleCheck, TriangleAlert, CheckCircle2 } from 'lucide-react'

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
import { confirmSale } from '@/services/crmConfirmSale'

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

  const [mode, setMode] = useState<'kit' | 'custom'>('kit')
  const [kit, setKit] = useState<PagbankKit>('3_meses')
  const [amountReais, setAmountReais] = useState('')
  const [description, setDescription] = useState('')
  const [method, setMethod] = useState<'pix' | 'card' | 'other'>('pix')
  const [installments, setInstallments] = useState('1')
  const [coupon, setCoupon] = useState('')
  const [freight, setFreight] = useState('')
  const [createBling, setCreateBling] = useState(true)
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageSuccess, setPageSuccess] = useState<string | null>(null)

  const goBack = () => navigate(`/leads/${leadId}`)

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
    setLoading(true)
    try {
      const res = await confirmSale({
        leadId: leadId!,
        mode,
        kit: mode === 'kit' ? kit : undefined,
        amountCents:
          mode === 'custom' ? Math.round(Number(amountReais.replace(/\./g, '').replace(',', '.')) * 100) : undefined,
        description: mode === 'custom' ? description.trim() || 'Venda avulsa' : undefined,
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
            {(['kit', 'custom'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 text-muted-foreground',
                )}
              >
                {m === 'kit' ? 'Kit' : 'Valor avulso'}
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
