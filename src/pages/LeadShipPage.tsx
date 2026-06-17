import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Package, TriangleAlert, Truck, Settings, CheckCircle2 } from 'lucide-react'

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
import {
  createShipment,
  getShipConfig,
  quoteFrete,
  saveShipSender,
  type FreteOption,
  type MeAddress,
  type ShipConfig,
} from '@/services/crmFrete'

// Prefill de produto por kit (valores Pix oficiais Tricopill).
const KIT_PRESETS: Record<string, { name: string; qty: number; reais: string }> = {
  '1_mes': { name: 'Tricopill — 1 frasco', qty: 1, reais: '199,00' },
  '3_meses': { name: 'Tricopill — Kit 3+1 (4 frascos)', qty: 1, reais: '567,00' },
  '5_meses': { name: 'Tricopill — 5 frascos', qty: 1, reais: '949,05' },
}

const reaisToCents = (v: string) => Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100)
const onlyDigits = (v: string) => v.replace(/\D/g, '')

export function LeadShipPage() {
  const crm = useCrm()
  const navigate = useNavigate()
  const { leadId } = useParams<{ leadId: string }>()

  // A tela seleciona o lead no contexto; selectedLead deriva de selectedLeadId.
  useEffect(() => {
    if (leadId) crm.setSelectedLeadId(leadId)
  }, [leadId, crm.setSelectedLeadId])

  const lead = crm.selectedLead ?? crm.leads.find((l) => l.id === leadId) ?? null
  const ready = !!lead && lead.id === leadId

  const defaultName = lead?.patientName
  const defaultPhone = lead?.phone

  // Destinatário
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [document, setDocument] = useState('')
  const [cep, setCep] = useState('')
  const [address, setAddress] = useState('')
  const [number, setNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [district, setDistrict] = useState('')
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')

  // Pedido / frete
  const [productName, setProductName] = useState(KIT_PRESETS['3_meses'].name)
  const [productQty, setProductQty] = useState('1')
  const [productReais, setProductReais] = useState(KIT_PRESETS['3_meses'].reais)
  const [finalize, setFinalize] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageSuccess, setPageSuccess] = useState<string | null>(null)

  // Cotação real: só os serviços que ATENDEM aquele CEP (evita "transportadora não atende").
  const [quoteOptions, setQuoteOptions] = useState<FreteOption[]>([])
  const [serviceId, setServiceId] = useState<string>('') // serviceId escolhido (string p/ o Select)
  const [quoting, setQuoting] = useState(false)

  // Caixa (peso/dimensões) — vazio usa o padrão do polo. Importante para o preço bater.
  const [weight, setWeight] = useState('')
  const [boxL, setBoxL] = useState('')
  const [boxW, setBoxW] = useState('')
  const [boxH, setBoxH] = useState('')

  // Remetente / config
  const [config, setConfig] = useState<ShipConfig | null>(null)
  const [showSender, setShowSender] = useState(false)
  const [sender, setSender] = useState<MeAddress>({})
  const [savingSender, setSavingSender] = useState(false)

  // Pré-preenche destinatário com nome/telefone do lead assim que disponível.
  useEffect(() => {
    if (defaultName != null) setName((prev) => (prev ? prev : defaultName))
    if (defaultPhone != null) setPhone((prev) => (prev ? prev : defaultPhone))
  }, [defaultName, defaultPhone])

  useEffect(() => {
    getShipConfig()
      .then((c) => {
        setConfig(c)
        setSender(c.sender ?? {})
        if (c.senderMissing.length) setShowSender(true)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao ler configuração do Melhor Envio'))
  }, [])

  const goBack = () => navigate(`/leads/${leadId}`)

  const applyKit = (kit: string) => {
    const preset = KIT_PRESETS[kit]
    if (!preset) return
    setProductName(preset.name)
    setProductQty(String(preset.qty))
    setProductReais(preset.reais)
  }

  const lookupCep = async () => {
    const digits = onlyDigits(cep)
    if (digits.length !== 8) return
    setCepLoading(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = (await res.json()) as Record<string, string>
      if (data.erro) {
        toast.error('CEP não encontrado.')
        return
      }
      if (data.logradouro) setAddress(data.logradouro)
      if (data.bairro) setDistrict(data.bairro)
      if (data.localidade) setCity(data.localidade)
      if (data.uf) setUf(data.uf)
    } catch {
      // silencioso: deixa preencher manual
    } finally {
      setCepLoading(false)
    }
    void doQuote()
  }

  // Cota o frete real do CEP+caixa atuais e popula só os serviços que ATENDEM o trecho.
  const doQuote = async () => {
    const digits = onlyDigits(cep)
    if (digits.length !== 8) return
    setQuoting(true)
    try {
      const q = await quoteFrete({
        toCep: digits,
        tenantId: 'tricopill',
        weight: Number(weight.replace(',', '.')) || undefined,
        length: Number(boxL) || undefined,
        width: Number(boxW) || undefined,
        height: Number(boxH) || undefined,
      })
      const opts = q.options ?? []
      setQuoteOptions(opts)
      // Mantém a seleção se ainda válida; senão pega a primeira (mais barata).
      setServiceId((prev) => {
        if (prev && opts.some((o) => String(o.serviceId) === prev)) return prev
        return opts.length ? String(opts[0].serviceId) : ''
      })
      if (!q.ok || opts.length === 0) {
        toast.warning('Nenhuma transportadora cotou esse CEP/caixa. Confira o CEP e o peso.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cotar frete')
    } finally {
      setQuoting(false)
    }
  }

  const selectedOption = quoteOptions.find((o) => String(o.serviceId) === serviceId) ?? null

  const handleSaveSender = async () => {
    setSavingSender(true)
    try {
      const c = await saveShipSender(sender)
      setConfig(c)
      setSender(c.sender ?? {})
      if (c.senderMissing.length === 0) {
        toast.success('Remetente salvo.')
        setShowSender(false)
      } else {
        toast.warning(`Ainda faltam: ${c.senderMissing.join(', ')}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar remetente')
    } finally {
      setSavingSender(false)
    }
  }

  const handleCreate = async () => {
    setPageError(null)
    setPageSuccess(null)
    if (!name.trim()) {
      setPageError('Informe o nome do destinatário.')
      return toast.error('Informe o nome do destinatário.')
    }
    if (onlyDigits(cep).length !== 8) {
      setPageError('CEP do destinatário inválido.')
      return toast.error('CEP do destinatário inválido.')
    }
    if (!address.trim() || !number.trim() || !district.trim() || !city.trim() || !uf.trim()) {
      setPageError('Endereço do destinatário incompleto.')
      return toast.error('Endereço do destinatário incompleto.')
    }
    const valueCents = reaisToCents(productReais)
    if (!Number.isFinite(valueCents) || valueCents < 100) {
      setPageError('Valor do produto inválido.')
      return toast.error('Valor do produto inválido.')
    }
    if (!serviceId || !selectedOption) {
      setPageError('Cote o frete e escolha um serviço primeiro.')
      return toast.error('Cote o frete e escolha um serviço primeiro.')
    }
    if (selectedOption.internal) {
      setPageError('Maringá é entrega interna (local) — não gera etiqueta dos Correios.')
      return toast.error('Maringá é entrega interna (local) — não gera etiqueta dos Correios.')
    }
    if (config && config.senderMissing.length) {
      setShowSender(true)
      setPageError(`Remetente incompleto: ${config.senderMissing.join(', ')}`)
      return toast.error(`Remetente incompleto: ${config.senderMissing.join(', ')}`)
    }

    setLoading(true)
    try {
      const res = await createShipment({
        leadId: leadId!,
        serviceId: Number(serviceId),
        to: {
          name: name.trim(),
          phone: onlyDigits(phone),
          document: onlyDigits(document) || undefined,
          postalCode: onlyDigits(cep),
          address: address.trim(),
          number: number.trim(),
          complement: complement.trim() || undefined,
          district: district.trim(),
          city: city.trim(),
          stateAbbr: uf.trim().toUpperCase(),
        },
        products: [{ name: productName.trim() || 'Produto', quantity: Math.max(1, Number(productQty) || 1), unitaryValueCents: valueCents }],
        box: {
          weightKg: Number(weight.replace(',', '.')) || undefined,
          lengthCm: Number(boxL) || undefined,
          widthCm: Number(boxW) || undefined,
          heightCm: Number(boxH) || undefined,
        },
        insuranceCents: valueCents,
        finalize,
      })
      if (res.finalized) {
        const msg = `Etiqueta gerada!${res.tracking ? ` Rastreio: ${res.tracking}` : ''}`
        toast.success(msg)
        setPageSuccess(msg)
        if (res.printUrl) window.open(res.printUrl, '_blank', 'noopener')
      } else {
        const msg = `Adicionado ao carrinho do Melhor Envio (#${res.cartId}). Finalize a compra no painel.`
        toast.success(msg)
        setPageSuccess(msg)
      }
      void crm.refreshChatFromSupabase?.()
      navigate(`/leads/${leadId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao gerar envio'
      setPageError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // Carregando / lead não encontrado.
  if (!ready || !lead) {
    return (
      <AppLayout title="Gerar envio">
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
    <AppLayout title="Gerar envio">
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
            <BreadcrumbPage>Envio</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <section className="rounded-md border border-border bg-card p-3 sm:p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Truck className="size-5 text-primary" /> Gerar envio (Melhor Envio)
          </h2>
          <p className="text-sm text-muted-foreground">
            Cria o envio na conta Melhor Envio. Por padrão só adiciona ao carrinho — ligue a opção abaixo para já comprar e gerar a etiqueta.
          </p>
        </div>

        {config && !config.connected ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <TriangleAlert className="size-4 shrink-0" /> Conta Melhor Envio não conectada neste polo.
          </div>
        ) : null}
        {config?.sandbox ? (
          <div className="mt-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-[0.7rem] text-sky-800">
            Ambiente <b>sandbox</b> — etiquetas de teste, não gera cobrança real.
          </div>
        ) : null}

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

        <div className="mt-4 space-y-4">
          {/* Destinatário */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Package className="size-3.5" /> Destinatário
            </p>
            <div className="grid grid-cols-2 gap-2 sm:max-w-2xl">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="sl-name">Nome completo</Label>
                <Input id="sl-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-phone">Telefone</Label>
                <Input id="sl-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="DDD + número" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-doc">CPF (opcional)</Label>
                <Input id="sl-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-cep">CEP</Label>
                <Input
                  id="sl-cep"
                  value={cep}
                  onChange={(e) => setCep(e.target.value)}
                  onBlur={() => void lookupCep()}
                  placeholder={cepLoading ? 'Buscando…' : '00000-000'}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-uf">UF</Label>
                <Input id="sl-uf" value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="sl-addr">Rua</Label>
                <Input id="sl-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-num">Número</Label>
                <Input id="sl-num" value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-comp">Complemento</Label>
                <Input id="sl-comp" value={complement} onChange={(e) => setComplement(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-dist">Bairro</Label>
                <Input id="sl-dist" value={district} onChange={(e) => setDistrict(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-city">Cidade</Label>
                <Input id="sl-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Pedido + serviço */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Pedido e frete</p>
            <div className="grid grid-cols-2 gap-2 sm:max-w-2xl">
              <div className="space-y-1">
                <Label htmlFor="sl-kit">Kit (prefill)</Label>
                <Select value="" onValueChange={(v) => applyKit(String(v ?? ''))}>
                  <SelectTrigger id="sl-kit">
                    <SelectValue placeholder="Escolher kit…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1_mes">1 frasco</SelectItem>
                    <SelectItem value="3_meses">Kit 3+1 (4 frascos)</SelectItem>
                    <SelectItem value="5_meses">5 frascos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-val">Valor declarado (R$)</Label>
                <Input id="sl-val" inputMode="decimal" value={productReais} onChange={(e) => setProductReais(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="sl-pname">Descrição do produto</Label>
                <Input id="sl-pname" value={productName} onChange={(e) => setProductName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-qty">Qtd.</Label>
                <Input id="sl-qty" inputMode="numeric" value={productQty} onChange={(e) => setProductQty(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:max-w-2xl">
              <div className="space-y-1">
                <Label htmlFor="sl-wt" className="text-[0.7rem]">Peso (kg)</Label>
                <Input id="sl-wt" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} onBlur={() => void doQuote()} placeholder="0,3" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-l" className="text-[0.7rem]">Compr. (cm)</Label>
                <Input id="sl-l" inputMode="numeric" value={boxL} onChange={(e) => setBoxL(e.target.value)} placeholder="20" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-w" className="text-[0.7rem]">Larg. (cm)</Label>
                <Input id="sl-w" inputMode="numeric" value={boxW} onChange={(e) => setBoxW(e.target.value)} placeholder="20" className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-h" className="text-[0.7rem]">Alt. (cm)</Label>
                <Input id="sl-h" inputMode="numeric" value={boxH} onChange={(e) => setBoxH(e.target.value)} placeholder="10" className="h-8 text-xs" />
              </div>
            </div>
            <p className="text-[0.7rem] text-muted-foreground sm:max-w-2xl">
              Vazio = caixa padrão do polo (0,3 kg · 20×20×10). Pra <b>4 frascos</b> use o peso real (≈ 0,6–1 kg) pra o preço bater.
            </p>

            {/* Serviço — cotado de verdade; só aparece o que ATENDE o CEP/caixa */}
            <div className="space-y-1.5 rounded-lg border border-border/40 px-3 py-2.5 sm:max-w-2xl">
              <div className="flex items-center justify-between">
                <Label htmlFor="sl-service" className="text-xs font-semibold">Serviço (frete real)</Label>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[0.7rem]" disabled={quoting || onlyDigits(cep).length !== 8} onClick={() => void doQuote()}>
                  {quoting ? 'Cotando…' : 'Cotar'}
                </Button>
              </div>
              {quoteOptions.length > 0 ? (
                <>
                  <Select value={serviceId} onValueChange={(v) => setServiceId(v ?? '')}>
                    <SelectTrigger id="sl-service">
                      <SelectValue placeholder="Escolha o serviço" />
                    </SelectTrigger>
                    <SelectContent>
                      {quoteOptions.map((o) => (
                        <SelectItem key={o.serviceId} value={String(o.serviceId)}>
                          {o.service} — R$ {o.priceReais.toFixed(2)}
                          {o.deliveryDays != null ? ` · ${o.deliveryDays}d` : ''} ({o.company})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedOption ? (
                    selectedOption.internal ? (
                      <p className="text-[0.7rem] text-amber-700">Entrega interna (Maringá) — não gera etiqueta dos Correios.</p>
                    ) : (
                      <p className="text-[0.7rem] text-muted-foreground">
                        Custo real da etiqueta: <b>R$ {selectedOption.priceReais.toFixed(2)}</b>. (O que você cobra do cliente é à parte.)
                      </p>
                    )
                  ) : null}
                </>
              ) : (
                <p className="text-[0.7rem] text-muted-foreground">
                  {quoting ? 'Cotando os serviços que atendem esse CEP…' : 'Preencha o CEP e o peso e clique em "Cotar" para ver os serviços que atendem.'}
                </p>
              )}
            </div>
          </div>

          {/* Finalizar */}
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 sm:max-w-2xl">
            <div>
              <p className="text-sm font-medium">Comprar e gerar etiqueta agora</p>
              <p className="text-[0.7rem] text-muted-foreground">
                {finalize
                  ? '⚠️ Debita o saldo da carteira Melhor Envio e emite a etiqueta.'
                  : 'Desligado: só adiciona ao carrinho para você pagar no painel.'}
              </p>
            </div>
            <Switch checked={finalize} onCheckedChange={setFinalize} />
          </div>

          {/* Remetente */}
          <div className="rounded-lg border border-border/40 sm:max-w-2xl">
            <button
              type="button"
              onClick={() => setShowSender((s) => !s)}
              className="flex w-full items-center justify-between px-3 py-2 text-left"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Settings className="size-3.5" /> Remetente
                {config?.senderMissing.length ? (
                  <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-700">
                    incompleto
                  </span>
                ) : null}
              </span>
              <span className="text-[0.7rem] text-muted-foreground">{showSender ? 'ocultar' : 'editar'}</span>
            </button>
            {showSender ? (
              <div className="space-y-2 border-t border-border/40 px-3 py-3">
                <div className="grid grid-cols-2 gap-2">
                  <SenderField label="Nome / Razão" k="name" sender={sender} setSender={setSender} className="col-span-2" />
                  <SenderField label="Telefone" k="phone" sender={sender} setSender={setSender} />
                  <SenderField label="CPF" k="document" sender={sender} setSender={setSender} />
                  <SenderField label="CNPJ" k="companyDocument" sender={sender} setSender={setSender} />
                  <SenderField label="CEP" k="postalCode" sender={sender} setSender={setSender} />
                  <SenderField label="Rua" k="address" sender={sender} setSender={setSender} className="col-span-2" />
                  <SenderField label="Número" k="number" sender={sender} setSender={setSender} />
                  <SenderField label="Bairro" k="district" sender={sender} setSender={setSender} />
                  <SenderField label="Cidade" k="city" sender={sender} setSender={setSender} />
                  <SenderField label="UF" k="stateAbbr" sender={sender} setSender={setSender} />
                </div>
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void handleSaveSender()} disabled={savingSender}>
                  {savingSender ? 'Salvando…' : 'Salvar remetente'}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button type="button" variant="outline" onClick={goBack} disabled={loading}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleCreate()} disabled={loading}>
              {loading ? 'Enviando…' : finalize ? 'Comprar e gerar etiqueta' : 'Adicionar ao carrinho'}
            </Button>
          </div>
        </div>
      </section>
    </AppLayout>
  )
}

function SenderField({
  label,
  k,
  sender,
  setSender,
  className,
}: {
  label: string
  k: keyof MeAddress
  sender: MeAddress
  setSender: (fn: (prev: MeAddress) => MeAddress) => void
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label className="text-[0.7rem]">{label}</Label>
      <Input
        value={(sender[k] as string | undefined) ?? ''}
        onChange={(e) => setSender((prev) => ({ ...prev, [k]: e.target.value }))}
        className="h-8 text-xs"
      />
    </div>
  )
}
