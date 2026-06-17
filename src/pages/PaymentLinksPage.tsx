import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, CreditCard, ExternalLink, QrCode, Truck } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CepInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { PAGBANK_KIT_LABELS, type PagbankKit } from '@/services/crmPagbank'
import { generateAsaasCardLink, generateAsaasPix } from '@/services/crmAsaas'
import { quoteFrete, type FreteOption } from '@/services/crmFrete'
import { ClinicPaymentsPanel } from '@/components/payments/ClinicPaymentsPanel'

const NO_LEAD = '__none__'

// Preço CHEIO para cartão (Asaas) — sem o desconto de 5% do Pix.
const CARD_KIT_AMOUNTS: Record<PagbankKit, number> = { '1_mes': 19900, '3_meses': 59700, '5_meses': 99900 }
// Preço do Pix por kit (com 5% off) — mesma tabela do PAGBANK_KITS no backend.
const PIX_KIT_AMOUNTS: Record<PagbankKit, number> = { '1_mes': 19900, '3_meses': 56700, '5_meses': 94905 }
// Regra de parcelas por kit: 1 frasco = só à vista (1x); 3+ frascos = até 3x.
const KIT_MAX_INSTALLMENTS: Record<PagbankKit, number> = { '1_mes': 1, '3_meses': 3, '5_meses': 3 }

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
  // Clínica parcela até 12x; vendas (Tricopill) começa no teto do kit padrão.
  const [maxInstallments, setMaxInstallments] = useState(isSalesPolo ? KIT_MAX_INSTALLMENTS['3_meses'] : 12)
  const [freightReais, setFreightReais] = useState('')
  const [generating, setGenerating] = useState(false)
  const [lastLink, setLastLink] = useState<{ url: string; via: string; qrImage?: string; isPix?: boolean } | null>(null)

  // Cotação de frete por CEP (preenche o campo de frete acima).
  const [cep, setCep] = useState('')
  const [quoting, setQuoting] = useState(false)
  const [quoteOptions, setQuoteOptions] = useState<FreteOption[]>([])
  const [quoteMsg, setQuoteMsg] = useState<string | null>(null)

  const freightCents = freightReais.trim()
    ? Math.round(Number(freightReais.replace(/\./g, '').replace(',', '.')) * 100)
    : undefined

  const selectedLeadId = leadId !== NO_LEAD ? leadId : undefined
  // Nome digitado SEMPRE usado (mesmo com lead): vai pro contato do Bling/NF. Se vazio,
  // o servidor cai no nome do lead. Assim o operador garante o NOME COMPLETO certo no Bling.
  const selectedName = customerName.trim() || undefined

  const applyFreight = (o: FreteOption) => {
    setFreightReais((o.priceCents / 100).toFixed(2).replace('.', ','))
    toast.success(`Frete ${o.service} aplicado: ${formatBRL(o.priceCents)}`)
  }

  const handleQuote = async () => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) {
      toast.error('Informe um CEP com 8 dígitos.')
      return
    }
    setQuoting(true)
    setQuoteOptions([])
    setQuoteMsg(null)
    try {
      const r = await quoteFrete({ toCep: digits, tenantId: tenant.id })
      if (r.ok && r.options.length) {
        setQuoteOptions(r.options)
        setQuoteMsg(
          r.options.some((o) => o.internal)
            ? 'Maringá: entrega interna. Clique para aplicar.'
            : 'Clique numa opção para aplicar no frete.',
        )
      } else {
        setQuoteMsg(
          r.debug === 'not_connected'
            ? 'Melhor Envio não conectado.'
            : 'Não foi possível cotar — confira o CEP.',
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cotar frete')
    } finally {
      setQuoting(false)
    }
  }

  const handlePix = async () => {
    setGenerating(true)
    setLastLink(null)
    try {
      const res = await generateAsaasPix({
        leadId: selectedLeadId,
        amountCents: PIX_KIT_AMOUNTS[kit],
        description: `Tricopill ${kit.replace('_', ' ')}`,
        customerName: selectedName,
        freightCents,
      })
      setLastLink({ url: res.qrText, via: `Pix · ${formatBRL(res.amountCents)}`, qrImage: res.qrImageUrl, isPix: true })
      toast.success(`Pix gerado (${formatBRL(res.amountCents)}).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link Pix')
    } finally {
      setGenerating(false)
    }
  }

  const handleCard = async (amountCents: number, desc: string, installments?: number) => {
    if (!Number.isFinite(amountCents) || amountCents < 100) {
      toast.error('Informe um valor válido.')
      return
    }
    setGenerating(true)
    setLastLink(null)
    try {
      const res = await generateAsaasCardLink({ amountCents, description: desc, leadId: selectedLeadId, freightCents, installments, customerName: selectedName })
      setLastLink({ url: res.payLink, via: `Cartão · ${formatBRL(res.amountCents)}` })
      toast.success(`Link de cartão gerado (${formatBRL(res.amountCents)}).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link de cartão (Asaas)')
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
        description={isSalesPolo ? 'Pix e cartão (Asaas) para o Tricopill' : 'Link de pagamento por cartão (Asaas)'}
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
            <div className="space-y-1.5">
              <Label htmlFor="pl-customer">Nome completo do cliente</Label>
              <Input id="pl-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Ex.: Maria Silva Santos" />
              <p className="text-[0.7rem] text-muted-foreground">Vai pro pedido no Bling (e na nota fiscal). Se vazio, usa o nome do lead.</p>
            </div>

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

            <div className="space-y-2 rounded-lg border border-dashed border-border/60 p-3">
              <Label htmlFor="pl-cep" className="flex items-center gap-1.5">
                <Truck className="size-3.5 text-primary" /> Cotar frete por CEP
              </Label>
              <div className="flex gap-2">
                <CepInput
                  id="pl-cep"
                  value={cep}
                  onValueChange={(raw) => setCep(raw)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleQuote()
                  }}
                  placeholder="CEP do cliente"
                />
                <Button type="button" variant="outline" onClick={() => void handleQuote()} disabled={quoting}>
                  {quoting ? 'Cotando…' : 'Cotar'}
                </Button>
              </div>
              {quoteMsg ? <p className="text-[0.7rem] text-muted-foreground">{quoteMsg}</p> : null}
              {quoteOptions.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {quoteOptions.map((o) => (
                    <Button key={o.service} type="button" size="sm" variant="secondary" onClick={() => applyFreight(o)}>
                      {o.internal ? '🏠 ' : ''}
                      {o.service} · {formatBRL(o.priceCents)}
                      {o.deliveryDays ? ` · ${o.deliveryDays}d` : ''}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>

            {isSalesPolo ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-kit">Kit</Label>
                  <Select
                    value={kit}
                    onValueChange={(v) => {
                      const k = v as PagbankKit
                      setKit(k)
                      setMaxInstallments(KIT_MAX_INSTALLMENTS[k]) // 1 frasco→1x, kits maiores→3x (Ingrid pode ajustar)
                    }}
                  >
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
                    Pix com 5% off. Cartão no valor cheio ({formatBRL(CARD_KIT_AMOUNTS[kit])}). Tudo via Asaas.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pl-inst">Parcelas máximas no cartão</Label>
                  <Select value={String(maxInstallments)} onValueChange={(v) => setMaxInstallments(Number(v))}>
                    <SelectTrigger id="pl-inst">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n === 1 ? 'À vista (1x)' : `até ${n}x`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[0.7rem] text-muted-foreground">O cliente escolhe de 1x até esse máximo na hora de pagar.</p>
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void handlePix()} disabled={generating}>
                    <QrCode className="mr-1.5 size-4" /> Pix
                  </Button>
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => void handleCard(CARD_KIT_AMOUNTS[kit], `Tricopill ${kit.replace('_', ' ')}`, maxInstallments)}
                    disabled={generating}
                  >
                    <CreditCard className="mr-1.5 size-4" /> Cartão
                  </Button>
                </div>

                <div className="mt-1 space-y-2 rounded-lg border border-dashed border-border/60 p-3">
                  <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">Ou valor avulso (outros produtos)</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="pl-amount">Valor (R$)</Label>
                    <Input id="pl-amount" inputMode="decimal" value={amountReais} onChange={(e) => setAmountReais(e.target.value)} placeholder="Ex.: 250,00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pl-desc">Descrição</Label>
                    <Input id="pl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Shampoo / outro produto" />
                  </div>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() =>
                      void handleCard(
                        Math.round(Number(amountReais.replace(/\./g, '').replace(',', '.')) * 100),
                        description.trim() || 'Tricopill',
                        maxInstallments,
                      )
                    }
                    disabled={generating}
                  >
                    <CreditCard className="mr-1.5 size-4" /> Gerar link de cartão (valor avulso)
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
                <div className="space-y-1.5">
                  <Label htmlFor="pl-inst">Parcelas máximas no cartão</Label>
                  <Select value={String(maxInstallments)} onValueChange={(v) => setMaxInstallments(Number(v))}>
                    <SelectTrigger id="pl-inst">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n === 1 ? 'À vista (1x)' : `até ${n}x`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[0.7rem] text-muted-foreground">O cliente escolhe de 1x até esse máximo na hora de pagar.</p>
                </div>
                <Button
                  className="w-full"
                  onClick={() => void handleCard(Math.round(Number(amountReais.replace(/\./g, '').replace(',', '.')) * 100), description.trim() || 'Pagamento', maxInstallments)}
                  disabled={generating}
                >
                  <CreditCard className="mr-1.5 size-4" /> {generating ? 'Gerando…' : 'Gerar link de cartão (Asaas)'}
                </Button>
              </>
            )}

            {lastLink ? (
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground">
                  {lastLink.via}{lastLink.isPix ? ' — copia e cola' : ''}
                </p>
                {lastLink.qrImage ? (
                  <img src={lastLink.qrImage} alt="QR Code Pix" className="mx-auto size-40 rounded-md bg-white p-1" />
                ) : null}
                <p className="break-all font-mono text-xs">{lastLink.url}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void copy(lastLink.url)}>
                    <Copy className="mr-1.5 size-3.5" /> Copiar {lastLink.isPix ? 'código Pix' : 'link'}
                  </Button>
                  {!lastLink.isPix ? (
                    <Button size="sm" variant="outline" render={<a href={lastLink.url} target="_blank" rel="noreferrer" />}>
                      <ExternalLink className="mr-1.5 size-3.5" /> Abrir
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <ClinicPaymentsPanel />
      </div>
    </AppLayout>
  )
}
