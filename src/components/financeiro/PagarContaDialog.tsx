// Dar uma conta a pagar por paga, sem contar o mesmo dinheiro duas vezes.
//
// O botão antigo pedia "conta que pagou" e LANÇAVA uma saída nela. No Itaú, que entra sozinho
// pelo Open Finance, isso fazia o mesmo boleto aparecer duas vezes em Gastos: a saída lançada à
// mão e a que o banco trouxe. Aqui a ordem é a do dinheiro:
//
//   1. Procurar o pagamento no extrato. Achou, liga os dois (conciliação), com a data do banco.
//   2. Não passou pelo banco conectado (dinheiro, cartão, outra conta): marca como paga e, se
//      escolher uma conta SEM conexão (o caixa), lança a saída nela. Conta conectada nem aparece
//      como opção, porque o banco já traz esse lançamento sozinho.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Search } from 'lucide-react'

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
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import { confirmarConciliacao } from '@/services/conciliacaoAuto'
import { type Payable, setPayableStatus } from '@/services/estoqueCompras'
import { type FinAccount, type FinTransaction, listTransactions } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '')

function somaDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return diaLocal(d)
}

const SEM_CONTA = '__sem_conta__'

/** Abra com `key={parcela?.id}`: cada parcela começa com a busca e as escolhas limpas. */
export function PagarContaDialog({
  parcela,
  contas,
  onFechar,
  onPago,
}: {
  parcela: Payable | null
  contas: FinAccount[]
  onFechar: () => void
  onPago: () => void
}) {
  const [candidatos, setCandidatos] = useState<FinTransaction[] | null>(null)
  const [verProximos, setVerProximos] = useState(false)
  const [modo, setModo] = useState<'extrato' | 'fora'>('extrato')
  const [contaId, setContaId] = useState(SEM_CONTA)
  const [data, setData] = useState(hojeLocal())
  const [busy, setBusy] = useState(false)

  const semConexao = useMemo(() => contas.filter((c) => c.active && !c.ofAccountId), [contas])

  useEffect(() => {
    if (!parcela) return
    // O estado começa limpo porque quem abre passa `key` com o id da parcela (remonta).
    let vivo = true
    // Janela igual à do motor automático: boleto desta clínica cai com até 60 dias de atraso,
    // e ninguém paga com mais de 20 dias de antecedência.
    listTransactions({
      from: somaDias(parcela.dueDate, -20),
      to: somaDias(parcela.dueDate, 60),
      onlyUnreconciled: true,
      limit: 3000,
    })
      .then((tx) => {
        if (!vivo) return
        const saidas = tx.filter((t) => t.direction === 'out')
        setCandidatos(saidas)
        // Sem nada no extrato com o valor exato, abre direto no "pago fora".
        if (!saidas.some((t) => Math.abs(t.amountCents) === parcela.amountCents)) setModo('fora')
      })
      .catch(() => vivo && setCandidatos([]))
    return () => {
      vivo = false
    }
  }, [parcela])

  const exatos = useMemo(
    () => (candidatos ?? []).filter((t) => parcela && Math.abs(t.amountCents) === parcela.amountCents),
    [candidatos, parcela],
  )
  // Juros, multa e desconto mudam o valor: até 5% ou R$ 30 de diferença entra como "parecido".
  const proximos = useMemo(() => {
    if (!parcela) return []
    const tolerancia = Math.max(3000, Math.round(parcela.amountCents * 0.05))
    return (candidatos ?? [])
      .filter((t) => {
        const d = Math.abs(Math.abs(t.amountCents) - parcela.amountCents)
        return d > 0 && d <= tolerancia
      })
      .slice(0, 30)
  }, [candidatos, parcela])

  const ligar = async (t: FinTransaction) => {
    if (!parcela) return
    setBusy(true)
    try {
      const ok = await confirmarConciliacao(parcela.id, t.id)
      if (!ok) {
        toast.error('Esse lançamento do extrato já foi ligado a outra conta. Escolha outro.')
        return
      }
      toast.success(`Paga em ${dia(t.date)}, ligada ao extrato.`)
      onPago()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ligar ao extrato')
    } finally {
      setBusy(false)
    }
  }

  const pagarFora = async () => {
    if (!parcela) return
    setBusy(true)
    try {
      const conta = contaId === SEM_CONTA ? null : contaId
      await setPayableStatus(parcela.id, 'pago', {
        accountId: conta,
        paidOn: data,
        amountCents: parcela.amountCents,
        categoryId: parcela.categoryId,
        description: parcela.description,
        supplierName: parcela.supplierName,
      })
      toast.success(conta ? 'Paga, saída lançada no caixa.' : 'Marcada como paga.')
      onPago()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao marcar como paga')
    } finally {
      setBusy(false)
    }
  }

  const nome = parcela ? parcela.counterparty || parcela.supplierName || parcela.description : ''

  const linha = (t: FinTransaction) => (
    <div key={t.id} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0">
      <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{dia(t.date)}</span>
      <span className="min-w-0 flex-1 truncate text-sm" title={t.description ?? ''}>
        {t.description || t.counterparty || 'Lançamento'}
      </span>
      <span className="shrink-0 text-sm font-medium tabular-nums">{brl(Math.abs(t.amountCents))}</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void ligar(t)}>
        <Check className="size-3.5" /> É este
      </Button>
    </div>
  )

  return (
    <Dialog open={parcela != null} onOpenChange={(o) => (!o ? onFechar() : null)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Dar como paga</DialogTitle>
          <DialogDescription>
            {nome} · vence {parcela ? dia(parcela.dueDate) : ''} · {brl(parcela?.amountCents ?? 0)}
          </DialogDescription>
        </DialogHeader>

        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group">
          {(
            [
              ['extrato', 'Saiu do banco conectado'],
              ['fora', 'Paguei de outro jeito'],
            ] as const
          ).map(([m, rotulo]) => (
            <button
              key={m}
              type="button"
              aria-pressed={modo === m}
              onClick={() => setModo(m)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                modo === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {modo === 'extrato' ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Escolha o lançamento do extrato que pagou esta conta. Os dois ficam ligados e o gasto conta uma vez só.
            </p>
            {candidatos == null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <Search className="mr-1 inline size-3.5" /> Procurando no extrato…
              </p>
            ) : (
              <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border">
                {exatos.length > 0 ? (
                  <>
                    <div className="border-b border-border bg-muted/50 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Mesmo valor
                    </div>
                    {exatos.map(linha)}
                  </>
                ) : (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    Nenhuma saída de {brl(parcela?.amountCents ?? 0)} no extrato entre 20 dias antes e 60 depois do
                    vencimento que ainda não esteja ligada a outra conta.
                  </p>
                )}
                {proximos.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setVerProximos((v) => !v)}
                      className="w-full border-y border-border bg-muted/30 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {verProximos ? 'Esconder' : 'Ver'} {proximos.length} com valor parecido (juros, multa ou desconto)
                    </button>
                    {verProximos && proximos.map(linha)}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Para o que não passou pelo banco conectado: dinheiro, cartão ou outra conta. Pagamento pelo Itaú não se
              marca aqui, porque o extrato já traz a saída e ela contaria duas vezes.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Data do pagamento</Label>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Lançar a saída em</Label>
                <Select value={contaId} onValueChange={(v) => setContaId(v ?? SEM_CONTA)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CONTA}>Não lançar (só marcar como paga)</SelectItem>
                    {semConexao.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={busy}>
            Cancelar
          </Button>
          {modo === 'fora' && (
            <Button onClick={() => void pagarFora()} disabled={busy}>
              {busy ? 'Salvando…' : 'Marcar como paga'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
