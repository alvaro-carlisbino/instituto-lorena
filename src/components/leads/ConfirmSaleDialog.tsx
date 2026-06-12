import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle } from 'phosphor-react'

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
import { PAGBANK_KIT_LABELS, type PagbankKit } from '@/services/crmPagbank'
import { confirmSale } from '@/services/crmConfirmSale'

type Props = {
  isOpen: boolean
  onClose: () => void
  leadId: string
  onConfirmed?: () => void
}

export function ConfirmSaleDialog({ isOpen, onClose, leadId, onConfirmed }: Props) {
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

  const handleConfirm = async () => {
    if (mode === 'custom') {
      const cents = Math.round(Number(amountReais.replace(/\./g, '').replace(',', '.')) * 100)
      if (!Number.isFinite(cents) || cents < 100) {
        toast.error('Informe um valor válido.')
        return
      }
    }
    setLoading(true)
    try {
      const res = await confirmSale({
        leadId,
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
      toast.success(`Venda confirmada: ${valor} (${res.method}).${res.blingNote ? ' ' + res.blingNote : ''}`)
      onConfirmed?.()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao confirmar venda')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="size-5 text-emerald-600" /> Confirmar venda
          </DialogTitle>
          <DialogDescription>
            Marca o lead como pago, registra a venda no faturamento e cria o pedido no Bling.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
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
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleConfirm()} disabled={loading}>
            {loading ? 'Confirmando…' : 'Confirmar venda'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
