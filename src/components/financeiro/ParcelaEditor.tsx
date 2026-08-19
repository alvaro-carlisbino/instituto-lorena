// Edição de uma parcela de conta a pagar — o compromisso que ainda não virou dinheiro saindo.
//
// Até aqui a parcela só tinha o botão "Pago": nascia da NF-e, da planilha ou do formulário, e
// depois disso nome errado, centro errado ou vencimento remarcado pelo fornecedor não tinham
// conserto em tela nenhuma. Como /gastos soma parcela em aberto junto com o extrato, o erro
// aparecia no relatório por centro de custo sem ter onde ser corrigido.
//
// VALOR e VENCIMENTO só se mexem enquanto a parcela está ABERTA. É a mesma regra do extrato por
// outro caminho: parcela aberta é previsão nossa; parcela paga por uma conta já virou saída no
// caixa com aquele valor naquele dia, e mexer aqui deixaria as duas metades discordando sem
// ninguém saber qual é a certa. Em parcela paga se corrige a LEITURA, não o dinheiro.

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type Payable, updatePayable } from '@/services/estoqueCompras'
import type { CostCenter, FinCategory } from '@/services/financeiro'

/** Sentinela do Select: base-ui não aceita item de valor vazio, e "sem centro" é uma escolha. */
const NENHUM = '__none__'

/** "1.250,00" → 125000. Aceita o que a pessoa digitar, inclusive só "1250". */
function paraCentavos(v: string): number {
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const paraTexto = (c: number) => (c / 100).toFixed(2).replace('.', ',')

export function ParcelaEditor({
  parcela,
  categorias,
  centros,
  onSalvo,
  onCancelar,
}: {
  parcela: Payable
  categorias: FinCategory[]
  centros: CostCenter[]
  onSalvo: () => void
  onCancelar?: () => void
}) {
  const paga = parcela.status === 'pago'

  const [descricao, setDescricao] = useState(parcela.description)
  const [contraparte, setContraparte] = useState(parcela.counterparty ?? '')
  const [vencimento, setVencimento] = useState(parcela.dueDate)
  const [valor, setValor] = useState(paraTexto(parcela.amountCents))
  const [centro, setCentro] = useState(parcela.costCenter ?? '')
  const [categoria, setCategoria] = useState(parcela.categoryId ?? '')
  const [subcategoria, setSubcategoria] = useState(parcela.subcategory ?? '')
  const [forma, setForma] = useState(parcela.paymentMethod ?? '')
  const [nota, setNota] = useState(parcela.note ?? '')
  const [busy, setBusy] = useState(false)

  const despesas = categorias.filter((c) => c.kind === 'despesa')

  const salvar = async () => {
    setBusy(true)
    try {
      await updatePayable(parcela.id, {
        description: descricao,
        counterparty: contraparte,
        costCenter: centro || null,
        categoryId: categoria || null,
        subcategory: subcategoria,
        paymentMethod: forma,
        note: nota,
        // Parcela paga nem manda os dois campos: o servidor recusaria, e mandar pra tomar erro
        // é pedir pra alguém achar que o sistema quebrou.
        ...(paga ? {} : { dueDate: vencimento, amountCents: paraCentavos(valor) }),
      })
      toast.success('Parcela salva.')
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
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Descrição</Label>
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Razão social</Label>
          <Input
            value={contraparte}
            onChange={(e) => setContraparte(e.target.value)}
            placeholder={parcela.supplierName ?? 'Quem recebe'}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vencimento</Label>
          <Input
            type="date"
            value={vencimento}
            disabled={paga}
            onChange={(e) => setVencimento(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor</Label>
          <Input
            value={valor}
            disabled={paga}
            inputMode="decimal"
            onChange={(e) => setValor(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Centro de custo</Label>
          <Select
            value={centro || NENHUM}
            onValueChange={(v) => setCentro(!v || v === NENHUM ? '' : String(v))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>— sem centro</SelectItem>
              {centros.map((c) => (
                <SelectItem key={c.id} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Categoria</Label>
          <Select
            value={categoria || NENHUM}
            onValueChange={(v) => setCategoria(!v || v === NENHUM ? '' : String(v))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>— sem categoria</SelectItem>
              {despesas.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Subcategoria</Label>
          <Input
            value={subcategoria}
            onChange={(e) => setSubcategoria(e.target.value)}
            placeholder="NF, VT, diarista…"
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Forma de pagamento</Label>
          <Input value={forma} onChange={(e) => setForma(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Observação</Label>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} className="h-8" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" disabled={busy} onClick={() => void salvar()}>
          Salvar
        </Button>
        {onCancelar && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancelar}>
            Cancelar
          </Button>
        )}
        {paga && (
          <span className="text-xs text-muted-foreground">
            Parcela paga: valor e vencimento não se editam, a saída já foi lançada no caixa.
          </span>
        )}
      </div>
    </div>
  )
}
