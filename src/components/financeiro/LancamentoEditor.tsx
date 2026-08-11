// Edição de um lançamento do extrato: o que dá pra mexer, e o rateio.
//
// O que NÃO aparece aqui é decisão, não esquecimento: VALOR e DATA vêm do banco e não se editam.
// Se o extrato pudesse ser corrigido à mão, no dia que a conciliação discordasse ninguém saberia
// se o errado é o banco ou a nossa edição — e a única fonte confiável do sistema morre. O que se
// corrige é a LEITURA: quem é a contraparte, que categoria é, em que centro entra, e como o
// valor se divide.
//
// O rateio soma na tela em tempo real contra o valor do lançamento, porque a conta que não fecha
// é o erro mais comum aqui e descobrir isso só no "Salvar" é frustrante à toa.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  listSplits,
  saveSplits,
  updateTransaction,
  type CostCenter,
  type FinCategory,
  type FinTransaction,
  type Split,
} from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** "1.250,00" → 125000. Aceita o que a pessoa digitar, inclusive só "1250". */
function paraCentavos(v: string): number {
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const paraTexto = (c: number) => (c / 100).toFixed(2).replace('.', ',')

type ItemRateio = { amount: string; categoryId: string; costCenter: string }

export function LancamentoEditor({
  lancamento,
  categorias,
  centros,
  onSalvo,
}: {
  lancamento: FinTransaction
  categorias: FinCategory[]
  centros: CostCenter[]
  onSalvo: () => void
}) {
  const saida = lancamento.direction === 'out'
  const total = Math.abs(lancamento.amountCents)

  const [contraparte, setContraparte] = useState(lancamento.counterparty ?? '')
  const [nota, setNota] = useState(lancamento.note ?? '')
  const [centro, setCentro] = useState(lancamento.costCenter ?? '')
  const [itens, setItens] = useState<ItemRateio[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let vivo = true
    void listSplits(lancamento.id).then((s: Split[]) => {
      if (!vivo) return
      setItens(
        s.map((x) => ({
          amount: paraTexto(x.amountCents),
          categoryId: x.categoryId ?? '',
          costCenter: x.costCenter ?? '',
        })),
      )
    })
    return () => {
      vivo = false
    }
  }, [lancamento.id])

  const somaRateio = itens.reduce((s, i) => s + paraCentavos(i.amount), 0)
  const sobra = total - somaRateio
  const catsDoTipo = categorias.filter((c) => (saida ? c.kind === 'despesa' : c.kind === 'receita'))

  const salvar = async () => {
    if (somaRateio > total) {
      toast.error(`O rateio soma ${brl(somaRateio)} e o lançamento é ${brl(total)}.`)
      return
    }
    setBusy(true)
    try {
      await updateTransaction(lancamento.id, {
        counterparty: contraparte,
        note: nota,
        costCenter: centro || null,
      })
      await saveSplits(
        lancamento.id,
        itens
          .filter((i) => paraCentavos(i.amount) > 0)
          .map((i) => ({
            amountCents: paraCentavos(i.amount),
            categoryId: i.categoryId || null,
            costCenter: i.costCenter || null,
          })),
      )
      toast.success('Lançamento salvo.')
      onSalvo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Contraparte</Label>
          <Input
            value={contraparte}
            onChange={(e) => setContraparte(e.target.value)}
            placeholder="Quem recebeu / quem pagou"
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Centro de custo</Label>
          <Select value={centro} onValueChange={(v) => setCentro(v ?? '')}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {centros.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Observação</Label>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} className="h-8" />
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-xs">Rateio — quando um pagamento cobriu mais de uma coisa</Label>
          <span className="text-xs text-muted-foreground">
            {itens.length === 0
              ? `${brl(total)} numa categoria só`
              : sobra === 0
                ? `fecha em ${brl(total)}`
                : sobra > 0
                  ? `faltam ${brl(sobra)} — ficam sem categoria`
                  : `passou ${brl(-sobra)} do lançamento`}
          </span>
        </div>

        {itens.map((it, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input
              value={it.amount}
              onChange={(e) =>
                setItens((a) => a.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
              }
              placeholder="0,00"
              inputMode="decimal"
              className="h-8 w-[110px]"
            />
            <Select
              value={it.categoryId}
              onValueChange={(v) =>
                setItens((a) => a.map((x, j) => (j === i ? { ...x, categoryId: v ?? '' } : x)))
              }
            >
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                {catsDoTipo.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={it.costCenter}
              onValueChange={(v) =>
                setItens((a) => a.map((x, j) => (j === i ? { ...x, costCenter: v ?? '' } : x)))
              }
            >
              <SelectTrigger className="h-8 w-[170px] text-xs">
                <SelectValue placeholder="Centro de custo" />
              </SelectTrigger>
              <SelectContent>
                {centros.map((c) => (
                  <SelectItem key={c.id} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => setItens((a) => a.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}

        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setItens((a) => [
              ...a,
              // O primeiro pedaço já vem com o que sobra: ratear costuma ser "tira X do total",
              // e obrigar a digitar o valor cheio de novo é atrito à toa.
              { amount: paraTexto(Math.max(0, sobra)), categoryId: '', costCenter: centro },
            ])
          }
        >
          <Plus className="size-4" /> Dividir
        </Button>
      </div>

      <div className="flex gap-2 border-t border-border pt-3">
        <Button size="sm" disabled={busy} onClick={() => void salvar()}>
          Salvar
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          Valor e data não se editam — vêm do banco.
        </span>
      </div>
    </div>
  )
}
