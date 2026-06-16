import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Package, Warning, Truck, Gear } from 'phosphor-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  createShipment,
  getShipConfig,
  saveShipSender,
  type MeAddress,
  type ShipConfig,
} from '@/services/crmFrete'

type Props = {
  isOpen: boolean
  onClose: () => void
  leadId: string
  /** Pré-preenche o destinatário (nome/telefone do lead). */
  defaultName?: string
  defaultPhone?: string
  onDone?: () => void
}

// Prefill de produto por kit (valores Pix oficiais Tricopill).
const KIT_PRESETS: Record<string, { name: string; qty: number; reais: string }> = {
  '1_mes': { name: 'Tricopill — 1 frasco', qty: 1, reais: '199,00' },
  '3_meses': { name: 'Tricopill — Kit 3+1 (4 frascos)', qty: 1, reais: '567,00' },
  '5_meses': { name: 'Tricopill — 5 frascos', qty: 1, reais: '949,05' },
}

const reaisToCents = (v: string) => Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100)
const onlyDigits = (v: string) => v.replace(/\D/g, '')

export function ShipLabelDialog({ isOpen, onClose, leadId, defaultName, defaultPhone, onDone }: Props) {
  // Destinatário
  const [name, setName] = useState(defaultName ?? '')
  const [phone, setPhone] = useState(defaultPhone ?? '')
  const [document, setDocument] = useState('')
  const [cep, setCep] = useState('')
  const [address, setAddress] = useState('')
  const [number, setNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [district, setDistrict] = useState('')
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')

  // Pedido / frete
  const [service, setService] = useState<'1' | '2'>('1') // 1=PAC, 2=SEDEX
  const [productName, setProductName] = useState(KIT_PRESETS['3_meses'].name)
  const [productQty, setProductQty] = useState('1')
  const [productReais, setProductReais] = useState(KIT_PRESETS['3_meses'].reais)
  const [finalize, setFinalize] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)

  // Remetente / config
  const [config, setConfig] = useState<ShipConfig | null>(null)
  const [showSender, setShowSender] = useState(false)
  const [sender, setSender] = useState<MeAddress>({})
  const [savingSender, setSavingSender] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    getShipConfig()
      .then((c) => {
        setConfig(c)
        setSender(c.sender ?? {})
        if (c.senderMissing.length) setShowSender(true)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao ler configuração do Melhor Envio'))
  }, [isOpen])

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
  }

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
    if (!name.trim()) return toast.error('Informe o nome do destinatário.')
    if (onlyDigits(cep).length !== 8) return toast.error('CEP do destinatário inválido.')
    if (!address.trim() || !number.trim() || !district.trim() || !city.trim() || !uf.trim()) {
      return toast.error('Endereço do destinatário incompleto.')
    }
    const valueCents = reaisToCents(productReais)
    if (!Number.isFinite(valueCents) || valueCents < 100) return toast.error('Valor do produto inválido.')
    if (config && config.senderMissing.length) {
      setShowSender(true)
      return toast.error(`Remetente incompleto: ${config.senderMissing.join(', ')}`)
    }

    setLoading(true)
    try {
      const res = await createShipment({
        leadId,
        serviceId: Number(service),
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
        insuranceCents: valueCents,
        finalize,
      })
      if (res.finalized) {
        toast.success(`Etiqueta gerada!${res.tracking ? ` Rastreio: ${res.tracking}` : ''}`)
        if (res.printUrl) window.open(res.printUrl, '_blank', 'noopener')
      } else {
        toast.success(`Adicionado ao carrinho do Melhor Envio (#${res.cartId}). Finalize a compra no painel.`)
      }
      onDone?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar envio')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-5 text-primary" /> Gerar envio (Melhor Envio)
          </DialogTitle>
          <DialogDescription>
            Cria o envio na conta Melhor Envio. Por padrão só adiciona ao carrinho — ligue a opção abaixo para já comprar e gerar a etiqueta.
          </DialogDescription>
        </DialogHeader>

        {config && !config.connected ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Warning className="size-4 shrink-0" /> Conta Melhor Envio não conectada neste polo.
          </div>
        ) : null}
        {config?.sandbox ? (
          <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-[0.7rem] text-sky-800">
            Ambiente <b>sandbox</b> — etiquetas de teste, não gera cobrança real.
          </div>
        ) : null}

        <div className="space-y-4 py-1">
          {/* Destinatário */}
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Package className="size-3.5" /> Destinatário
            </p>
            <div className="grid grid-cols-2 gap-2">
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
            <div className="grid grid-cols-2 gap-2">
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
                <Label htmlFor="sl-service">Serviço</Label>
                <Select value={service} onValueChange={(v) => setService(v as '1' | '2')}>
                  <SelectTrigger id="sl-service">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">PAC</SelectItem>
                    <SelectItem value="2">SEDEX</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="sl-pname">Descrição do produto</Label>
                <Input id="sl-pname" value={productName} onChange={(e) => setProductName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-qty">Qtd.</Label>
                <Input id="sl-qty" inputMode="numeric" value={productQty} onChange={(e) => setProductQty(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sl-val">Valor declarado (R$)</Label>
                <Input id="sl-val" inputMode="decimal" value={productReais} onChange={(e) => setProductReais(e.target.value)} />
              </div>
            </div>
            <p className="text-[0.7rem] text-muted-foreground">
              A caixa usa as dimensões padrão do polo. Ajuste no painel do Melhor Envio se precisar.
            </p>
          </div>

          {/* Finalizar */}
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
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
          <div className="rounded-lg border border-border/40">
            <button
              type="button"
              onClick={() => setShowSender((s) => !s)}
              className="flex w-full items-center justify-between px-3 py-2 text-left"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Gear className="size-3.5" /> Remetente
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
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={loading}>
            {loading ? 'Enviando…' : finalize ? 'Comprar e gerar etiqueta' : 'Adicionar ao carrinho'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
