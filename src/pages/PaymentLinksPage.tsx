import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy, CreditCard, RefreshCw, ExternalLink, QrCode } from 'lucide-react'

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
import { generateRedeLink } from '@/services/crmRede'

const NO_LEAD = '__none__'

// Preço CHEIO para cartão (Rede) — sem o desconto de 5% do Pix.
const REDE_KIT_AMOUNTS: Record<PagbankKit, number> = { '1_mes': 19900, '3_meses': 59700, '5_meses': 99900 }

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
  const [amountReais, setAmountReais] = useState('')
  const [description, setDescription] = useState('')
  const [freightReais, setFreightReais] = useState('')
  const [generating, setGenerating] = useState(false)
  const [lastLink, setLastLink] = useState<{ url: string; via: string } | null>(null)

  const freightCents = freightReais.trim()
    ? Math.round(Number(freightReais.replace(/\./g, '').replace(',', '.')) * 100)
    : undefined

  const [rows, setRows] = useState<PagbankCheckoutRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)

  const leadName = useMemo(() => {
    const map = new Map(crm.leads.map((l) => [l.id, l.patientName]))
    return (id: string | null) => (id ? map.get(id) ?? id : '—')
  }, [crm.leads])

  const loadRows = useMemo(
    () => async () => {
      if (!isSalesPolo) return
      setLoadingRows(true)
      try {
        setRows(await fetchPagbankCheckouts(50))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao carregar links')
      } finally {
        setLoadingRows(false)
      }
    },
    [isSalesPolo],
  )

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const selectedLeadId = leadId !== NO_LEAD ? leadId : undefined
  const selectedName = leadId === NO_LEAD && customerName.trim() ? customerName.trim() : undefined

  const handlePix = async () => {
    setGenerating(true)
    setLastLink(null)
    try {
      const res = await generatePagbankLink({ leadId: selectedLeadId, kit, customerName: selectedName, freightCents })
      setLastLink({ url: res.payLink, via: `Pix · ${formatBRL(res.amountCents)}` })
      toast.success(`Link Pix gerado (${formatBRL(res.amountCents)}).`)
      await loadRows()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link Pix')
    } finally {
      setGenerating(false)
    }
  }

  const handleCard = async (amountCents: number, desc: string) => {
    if (!Number.isFinite(amountCents) || amountCents < 100) {
      toast.error('Informe um valor válido.')
      return
    }
    setGenerating(true)
    setLastLink(null)
    try {
      const res = await generateRedeLink({ amountCents, description: desc, leadId: selectedLeadId, freightCents })
      setLastLink({ url: res.payLink, via: `Cartão · ${formatBRL(res.amountCents)}` })
      toast.success(`Link de cartão gerado (${formatBRL(res.amountCents)}).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link de cartão (Rede)')
    } finally {
      setGenerating(false)
    }
  }

  const leadField = (
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
    </div>
  )

  return (
    <AppLayout title="Links de pagamento">
      <PageHeader
        title="Links de pagamento"
        description={isSalesPolo ? 'Pix (PagBank) e cartão (Rede) para o Tricopill' : 'Link de pagamento por cartão (Rede)'}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,400px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CreditCard className="size-4 text-primary" /> Gerar novo link
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {leadField}
            {leadId === NO_LEAD ? (
              <div className="space-y-1.5">
                <Label htmlFor="pl-customer">Nome do cliente (opcional)</Label>
                <Input id="pl-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Ex.: Maria Silva" />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="pl-freight">Frete (R$) — cobrado à parte</Label>
              <Input
                id="pl-freight"
                inputMode="decimal"
                value={freightReais}
                onChange={(e) => setFreightReais(e.target.value)}
                placeholder="Ex.: 15,00 (Maringá). Vazio = sem frete."
              />
            </div>

            {isSalesPolo ? (
              <>
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
                  <p className="text-[0.7rem] text-muted-foreground">
                    Pix com 5% off (PagBank). Cartão no valor cheio ({formatBRL(REDE_KIT_AMOUNTS[kit])}, Rede).
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void handlePix()} disabled={generating}>
                    <QrCode className="mr-1.5 size-4" /> Pix (PagBank)
                  </Button>
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => void handleCard(REDE_KIT_AMOUNTS[kit], `Tricopill ${kit.replace('_', ' ')}`)}
                    disabled={generating}
                  >
                    <CreditCard className="mr-1.5 size-4" /> Cartão (Rede)
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-amount">Valor (R$)</Label>
                  <Input
                    id="pl-amount"
                    inputMode="decimal"
                    value={amountReais}
                    onChange={(e) => setAmountReais(e.target.value)}
                    placeholder="Ex.: 350,00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-desc">Descrição</Label>
                  <Input id="pl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Consulta / procedimento" />
                </div>
                <Button
                  className="w-full"
                  onClick={() => void handleCard(Math.round(Number(amountReais.replace(/\./g, '').replace(',', '.')) * 100), description.trim() || 'Pagamento')}
                  disabled={generating}
                >
                  <CreditCard className="mr-1.5 size-4" /> {generating ? 'Gerando…' : 'Gerar link de cartão (Rede)'}
                </Button>
              </>
            )}

            {lastLink ? (
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">{lastLink.via}</p>
                <p className="break-all font-mono text-xs">{lastLink.url}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copy(lastLink.url)}>
                    <Copy className="mr-1.5 size-3.5" /> Copiar
                  </Button>
                  <Button size="sm" variant="outline" render={<a href={lastLink.url} target="_blank" rel="noreferrer" />}>
                    <ExternalLink className="mr-1.5 size-3.5" /> Abrir
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isSalesPolo ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Links Pix gerados</CardTitle>
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
        ) : (
          <Card>
            <CardContent className="flex h-full flex-col items-center justify-center py-12 text-center text-sm text-muted-foreground">
              Gere um link de cartão (Rede) informando o valor. O Pix pelo PagBank é exclusivo do polo Tricopill.
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
