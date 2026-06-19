import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchAsaasIntent, payAsaasCard, type AsaasIntentView } from '@/services/crmAsaas'

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function CheckoutPage() {
  const { id = '' } = useParams()
  const [intent, setIntent] = useState<AsaasIntentView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [number, setNumber] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [cvv, setCvv] = useState('')
  const [cpf, setCpf] = useState('')
  const [phone, setPhone] = useState('')
  const [cep, setCep] = useState('')
  const [addrNumber, setAddrNumber] = useState('')
  const [installments, setInstallments] = useState(1)
  const [paying, setPaying] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    fetchAsaasIntent(id)
      .then(setIntent)
      .catch((e) => setError(e instanceof Error ? e.message : 'Cobrança não encontrada'))
      .finally(() => setLoading(false))
  }, [id])

  const submit = async () => {
    setPaying(true)
    setResult(null)
    try {
      const out = await payAsaasCard(
        id,
        {
          cardholderName: name.trim(),
          cardNumber: number.replace(/\D/g, ''),
          expirationMonth: Number(month),
          expirationYear: Number(year.length === 2 ? `20${year}` : year),
          securityCode: cvv.trim(),
        },
        {
          cpf: cpf.replace(/\D/g, ''),
          phone: phone.replace(/\D/g, ''),
          postalCode: cep.replace(/\D/g, ''),
          addressNumber: addrNumber.trim(),
        },
        installments,
      )
      if (out.status === 'paid') {
        setResult({ ok: true, message: 'Pagamento aprovado! Obrigado 💚' })
        setIntent((p) => (p ? { ...p, status: 'paid' } : p))
      } else {
        setResult({ ok: false, message: out.message || 'Pagamento não aprovado. Confira os dados do cartão.' })
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Falha ao processar' })
    } finally {
      setPaying(false)
    }
  }

  const box: React.CSSProperties = { maxWidth: 420, margin: '0 auto', padding: '32px 20px' }

  if (loading) return <div style={box}>Carregando…</div>
  if (error || !intent) return <div style={box}>Cobrança não encontrada ou expirada.</div>

  const paid = intent.status === 'paid' || result?.ok
  // Plano de parcelas vindo do servidor (com juros). Fallback: à vista.
  const plan = intent.installmentPlan.length
    ? intent.installmentPlan
    : [{ n: 1, totalCents: intent.amountCents, perCents: intent.amountCents }]
  const selectedOpt = plan.find((o) => o.n === installments) ?? plan[0]

  return (
    <div style={box} className="text-foreground">
      <h1 className="text-xl font-semibold">Pagamento por cartão</h1>
      <p className="mt-1 text-sm text-muted-foreground">{intent.description}</p>
      <div className="my-4 rounded-xl border border-border/60 bg-muted/30 p-4">
        <span className="text-3xl font-semibold">{brl(intent.amountCents)}</span>
      </div>

      {paid ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-700">
          ✅ {result?.message ?? 'Pagamento já confirmado.'}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Nome no cartão</Label>
            <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como está no cartão" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-num">Número do cartão</Label>
            <Input id="cc-num" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" placeholder="0000 0000 0000 0000" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cc-mm">Mês</Label>
              <Input id="cc-mm" value={month} onChange={(e) => setMonth(e.target.value)} inputMode="numeric" placeholder="MM" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-yy">Ano</Label>
              <Input id="cc-yy" value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="AAAA" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-cvv">CVV</Label>
              <Input id="cc-cvv" value={cvv} onChange={(e) => setCvv(e.target.value)} inputMode="numeric" placeholder="123" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-phone">Celular do titular (com DDD)</Label>
            <Input id="cc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="(44) 99999-9999" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cc-cpf">CPF do titular</Label>
              <Input id="cc-cpf" value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="Somente números" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-cep">CEP</Label>
              <Input id="cc-cep" value={cep} onChange={(e) => setCep(e.target.value)} inputMode="numeric" placeholder="00000000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-addrnum">Nº</Label>
              <Input id="cc-addrnum" value={addrNumber} onChange={(e) => setAddrNumber(e.target.value)} inputMode="numeric" placeholder="123" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-inst">Parcelas</Label>
            <select
              id="cc-inst"
              value={installments}
              onChange={(e) => setInstallments(Number(e.target.value))}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              {plan.map((o) => (
                <option key={o.n} value={o.n}>
                  {o.n === 1
                    ? `À vista — ${brl(o.totalCents)}`
                    : `${o.n}x de ${brl(o.perCents)} — total ${brl(o.totalCents)}`}
                </option>
              ))}
            </select>
            {selectedOpt && selectedOpt.n > 1 ? (
              <p className="text-[0.7rem] text-muted-foreground">
                Parcelado com juros. À vista sai por {brl(intent.amountCents)}.
              </p>
            ) : null}
          </div>

          {result && !result.ok ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">{result.message}</div>
          ) : null}

          <Button className="w-full" onClick={() => void submit()} disabled={paying}>
            {paying ? 'Processando…' : `Pagar ${brl(selectedOpt.totalCents)}`}
          </Button>
          <p className="text-center text-[0.7rem] text-muted-foreground">Pagamento processado pelo Asaas.</p>
        </div>
      )}
    </div>
  )
}
