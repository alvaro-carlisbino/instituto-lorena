import { useState } from 'react'
import { CreditCard, Truck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CepInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import {
  CARD_KIT_AMOUNTS,
  KIT_MAX_INSTALLMENTS,
  PAGBANK_KIT_LABELS,
  type PagbankKit,
} from '@/services/crmPagbank'
import { generateRedeLink } from '@/services/crmRede'
import { quoteFrete, type FreteOption } from '@/services/crmFrete'

type Props = {
  /** Kit escolhido no menu do chat. `null` = diálogo fechado. */
  kitInicial: PagbankKit | null
  leadId: string
  /** Cadastro que a IA já coletou: usado para nome completo e CEP da entrega. */
  lead: { patientName: string; customFields?: Record<string, unknown> | null } | null
  onClose: () => void
  /** Devolve o link pronto para o rascunho da conversa. */
  onGerado: (payLink: string, amountCents: number) => void
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function centsFromReais(v: string): number | undefined {
  const t = v.trim()
  if (!t) return undefined
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined
}

/**
 * Parcelamento que o botão do chat sempre ofereceu: 1 frasco à vista, kits até 3x. Quem quiser
 * mais estica no próprio seletor (o teto do kit vai a 12x) — o padrão não muda sozinho.
 */
function parcelasPadrao(kit: PagbankKit): number {
  return kit === '1_mes' ? 1 : 3
}

/** CEP da entrega (ou do cadastro) que a IA já coletou, para a cotação começar preenchida. */
function cepDoCadastro(lead: Props['lead']): string {
  const cf = (lead?.customFields ?? {}) as Record<string, unknown>
  const cad = (cf.cadastro ?? {}) as Record<string, string>
  const ent = (cf.entrega ?? {}) as Record<string, string>
  const digits = String(ent.cep ?? cad.cep ?? '').replace(/\D/g, '')
  return digits.length === 8 ? digits : ''
}

/**
 * Link de pagamento pelo chat, com uma parada antes de gerar.
 *
 * Antes o menu do botão disparava a cobrança no clique do kit: saía sempre no valor seco do
 * kit, sem frete e sem jeito de digitar um valor à mão — quem precisava cobrar a entrega
 * tinha de abandonar a conversa e ir na página de links. Agora o mesmo menu abre esta caixa
 * com o kit já escolhido: dá para cotar o frete pelo CEP do cadastro, digitar o valor à mão
 * (praça local, cortesia, combinado) e ajustar o parcelamento antes de gerar.
 */
export function PaymentLinkDialog({ kitInicial, leadId, lead, onClose, onGerado }: Props) {
  const { tenant } = useTenant()
  const [kit, setKit] = useState<PagbankKit>(kitInicial ?? '3_meses')
  const [freightReais, setFreightReais] = useState('')
  const [maxInstallments, setMaxInstallments] = useState(() => parcelasPadrao(kitInicial ?? '3_meses'))
  const [cep, setCep] = useState(() => cepDoCadastro(lead))
  const [quoting, setQuoting] = useState(false)
  const [quoteOptions, setQuoteOptions] = useState<FreteOption[]>([])
  const [quoteMsg, setQuoteMsg] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  // Quem abre passa `key={kit}`: cada abertura monta a caixa de novo, já no kit clicado e sem
  // o frete da vez anterior pendurado.
  const aberto = kitInicial != null

  const freightCents = centsFromReais(freightReais)
  const totalCents = CARD_KIT_AMOUNTS[kit] + (freightCents ?? 0)

  const nomeCompleto = (() => {
    const cf = (lead?.customFields ?? {}) as Record<string, unknown>
    const cad = (cf.cadastro ?? {}) as Record<string, string>
    return (cad?.nomeCompleto || lead?.patientName || '').trim() || undefined
  })()

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
      // Com o kit, a cotação volta com o VALOR COBRADO (caixa + seguro + margem) — o mesmo
      // que o cliente paga. Sem kit vinha o custo cru e nunca batia com o Melhor Envio.
      const r = await quoteFrete({ toCep: digits, tenantId: tenant.id, kit })
      if (r.ok && r.options.length) {
        setQuoteOptions(r.options)
        setQuoteMsg(
          r.options.some((o) => o.internal)
            ? 'Maringá: entrega interna. Clique para aplicar.'
            : 'Valor já com seguro + margem. Clique para aplicar.',
        )
      } else {
        setQuoteMsg(r.debug === 'not_connected' ? 'Melhor Envio não conectado.' : 'Não foi possível cotar. Confira o CEP.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cotar frete')
    } finally {
      setQuoting(false)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await generateRedeLink({
        amountCents: CARD_KIT_AMOUNTS[kit],
        description: `Tricopill ${kit.replace('_', ' ')}`,
        leadId,
        installments: maxInstallments,
        freightCents,
        customerName: nomeCompleto,
      })
      // `amountCents` do cartão volta sem o frete (quem soma é o servidor); o aviso mostra o
      // total que o cliente vai ver de fato.
      onGerado(res.payLink, res.amountCents + (freightCents ?? 0))
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar link de pagamento')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-primary" aria-hidden /> Link de pagamento
          </DialogTitle>
          <DialogDescription>
            O link deixa o cliente escolher Pix (5% off) ou cartão. O frete entra na mesma cobrança.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plk-kit">Kit</Label>
            <Select
              value={kit}
              onValueChange={(v) => {
                const k = v as PagbankKit
                setKit(k)
                setMaxInstallments(parcelasPadrao(k))
              }}
            >
              <SelectTrigger id="plk-kit">
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

          <div className="space-y-1.5">
            <Label htmlFor="plk-freight">Frete (R$)</Label>
            <Input
              id="plk-freight"
              inputMode="decimal"
              value={freightReais}
              onChange={(e) => setFreightReais(e.target.value)}
              placeholder="Ex.: 15,00 (Maringá). Vazio = sem frete."
            />
          </div>

          <div className="space-y-2 rounded-lg border border-dashed border-border/60 p-3">
            <Label htmlFor="plk-cep" className="flex items-center gap-1.5">
              <Truck className="size-3.5 text-primary" aria-hidden /> Cotar frete por CEP
            </Label>
            <div className="flex gap-2">
              <CepInput
                id="plk-cep"
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
                  <Button
                    key={o.service}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFreightReais((o.priceCents / 100).toFixed(2).replace('.', ','))
                      toast.success(`Frete ${o.service} aplicado: ${formatBRL(o.priceCents)}`)
                    }}
                  >
                    {o.service} · {formatBRL(o.priceCents)}
                    {o.deliveryDays ? ` · ${o.deliveryDays}d` : ''}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plk-inst">Parcelas máximas no cartão</Label>
            <Select value={String(maxInstallments)} onValueChange={(v) => setMaxInstallments(Number(v))}>
              <SelectTrigger id="plk-inst">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: KIT_MAX_INSTALLMENTS[kit] }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 1 ? 'À vista (1x)' : `até ${n}x`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
            Cartão: <strong>{formatBRL(CARD_KIT_AMOUNTS[kit])}</strong>
            {freightCents ? (
              <>
                {' '}
                + frete {formatBRL(freightCents)} = <strong>{formatBRL(totalCents)}</strong>
              </>
            ) : (
              ' · sem frete'
            )}
            {nomeCompleto ? <span className="block text-muted-foreground">Cliente: {nomeCompleto}</span> : null}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={generating}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleGenerate()} disabled={generating}>
            {generating ? 'Gerando…' : 'Gerar link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
