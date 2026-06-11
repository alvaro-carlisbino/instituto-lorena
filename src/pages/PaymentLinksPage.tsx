import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy, CreditCard, RefreshCw, ExternalLink } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import {
  fetchPagbankCheckouts,
  generatePagbankLink,
  PAGBANK_KIT_LABELS,
  type PagbankCheckoutRow,
  type PagbankKit,
} from '@/services/crmPagbank'

const NO_LEAD = '__none__'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Link copiado!')
  } catch {
    toast.error('Não foi possível copiar.')
  }
}

export function PaymentLinksPage() {
  const crm = useCrm()
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const [leadId, setLeadId] = useState<string>(NO_LEAD)
  const [customerName, setCustomerName] = useState('')
  const [kit, setKit] = useState<PagbankKit>('3_meses')
  const [generating, setGenerating] = useState(false)
  const [lastLink, setLastLink] = useState<string | null>(null)

  const [rows, setRows] = useState<PagbankCheckoutRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)

  const leadName = useMemo(() => {
    const map = new Map(crm.leads.map((l) => [l.id, l.patientName]))
    return (id: string | null) => (id ? map.get(id) ?? id : '—')
  }, [crm.leads])

  const loadRows = useMemo(
    () => async () => {
      setLoadingRows(true)
      try {
        setRows(await fetchPagbankCheckouts(50))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao carregar links')
      } finally {
        setLoadingRows(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    setLastLink(null)
    try {
      const res = await generatePagbankLink({
        leadId: leadId !== NO_LEAD ? leadId : undefined,
        kit,
        customerName: leadId === NO_LEAD && customerName.trim() ? customerName.trim() : undefined,
      })
      setLastLink(res.payLink)
      toast.success(`Link gerado (${formatBRL(res.amountCents)}).`)
      await loadRows()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link PagBank')
    } finally {
      setGenerating(false)
    }
  }

  if (!isSalesPolo) {
    return (
      <AppLayout title="Links de pagamento">
        <PageHeader title="Links de pagamento" />
        <Card className="mt-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Os links de pagamento são do polo de vendas. Troque para o polo <strong>Tricopill</strong> no seletor
            de polo (topo da barra lateral) para gerar e acompanhar links.
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Links de pagamento">
      <PageHeader
        title="Links de pagamento"
        description="Gere links PagBank (Pix + cartão) e acompanhe os pagamentos"
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Gerar novo link */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CreditCard className="size-4 text-primary" /> Gerar novo link
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pl-lead">Lead (opcional)</Label>
              <Select value={leadId} onValueChange={(v) => setLeadId(v ?? NO_LEAD)}>
                <SelectTrigger id="pl-lead">
                  <SelectValue placeholder="Sem lead (avulso)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LEAD}>Sem lead (avulso)</SelectItem>
                  {crm.leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.patientName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[0.7rem] text-muted-foreground">
                Com lead, o pagamento confirmado move o lead para “Pago”. Sem lead, é um link avulso.
              </p>
            </div>

            {leadId === NO_LEAD ? (
              <div className="space-y-1.5">
                <Label htmlFor="pl-customer">Nome do cliente (opcional)</Label>
                <Input
                  id="pl-customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Ex.: Maria Silva"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="pl-kit">Kit</Label>
              <Select value={kit} onValueChange={(v) => setKit(v as PagbankKit)}>
                <SelectTrigger id="pl-kit">
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
            </div>

            <Button className="w-full" onClick={() => void handleGenerate()} disabled={generating}>
              {generating ? 'Gerando…' : 'Gerar link de pagamento'}
            </Button>

            {lastLink ? (
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">Link gerado</p>
                <p className="break-all font-mono text-xs">{lastLink}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copy(lastLink)}>
                    <Copy className="mr-1.5 size-3.5" /> Copiar
                  </Button>
                  <Button size="sm" variant="outline" render={<a href={lastLink} target="_blank" rel="noreferrer" />}>
                    <ExternalLink className="mr-1.5 size-3.5" /> Abrir
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Links gerados */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Links gerados</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => void loadRows()} disabled={loadingRows}>
              <RefreshCw className={`mr-1.5 size-3.5 ${loadingRows ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {loadingRows ? 'Carregando…' : 'Nenhum link gerado ainda.'}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {rows.map((r) => (
                  <div key={r.checkoutId} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{leadName(r.leadId)}</span>
                        <Badge
                          variant={r.status === 'paid' ? 'default' : 'secondary'}
                          className={r.status === 'paid' ? 'bg-emerald-500/15 text-emerald-600' : ''}
                        >
                          {r.status === 'paid' ? 'Pago' : 'Aguardando'}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatBRL(r.amountCents)}
                        {r.kit ? ` · ${r.kit.replace('_', ' ')}` : ''}
                        {r.createdAt ? ` · ${new Date(r.createdAt).toLocaleDateString('pt-BR')}` : ''}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void copy(r.payLink)}>
                      <Copy className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" render={<a href={r.payLink} target="_blank" rel="noreferrer" />}>
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
