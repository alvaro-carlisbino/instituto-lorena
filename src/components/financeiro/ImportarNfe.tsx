// Importar NF-e pelo XML: fornecedor, itens com lote e validade, entrada no estoque e parcelas.
// NFS-e (nota de serviço) entra pelo mesmo botão, só no financeiro: não tem produto.
//
// Saiu de dentro de ContasPagarPage (redesenho de 14/set/2026) sem mudar o comportamento: a
// página tinha 1.100 linhas e este fluxo era metade delas.

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileCode } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { gerarBoletos } from '@/lib/boletosDaNota'
import { converterPorEmbalagem } from '@/lib/nfeEmbalagem'
import { type StockItem, type Supplier, findInvoiceByNfeKey } from '@/services/estoqueCompras'
import { type NfeParsed, parseNotaXml } from '@/services/nfeXml'
import { type NfeItemPlan, fatorParaLinha, importNfe, suggestItemPlan } from '@/services/nfeImport'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

/** "1.250,00" → 125000. Aceita o que a pessoa digitar, inclusive só "1250". */
function paraCentavos(v: string): number {
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const paraTexto = (c: number) => (c / 100).toFixed(2).replace('.', ',')

type BoletoNaTela = { dueDate: string; valor: string }

const boletosNaTela = (totalCents: number, parcelas: number, primeiroVencimento: string): BoletoNaTela[] =>
  gerarBoletos(totalCents, parcelas, primeiroVencimento).map((b) => ({
    dueDate: b.dueDate,
    valor: paraTexto(b.amountCents),
  }))

export function ImportarNfe({
  stockItems,
  suppliers,
  onImportou,
}: {
  stockItems: StockItem[]
  suppliers: Supplier[]
  onImportou: () => void
}) {
  const [nfe, setNfe] = useState<NfeParsed | null>(null)
  const [nfePlan, setNfePlan] = useState<NfeItemPlan[]>([])
  const [nfeCreateSupplier, setNfeCreateSupplier] = useState(true)
  const [nfeCreatePayables, setNfeCreatePayables] = useState(true)
  /** Nota sem duplicata no XML: quantos boletos, o 1º vencimento e cada boleto como está no papel.
   *  O vencimento começa vazio de propósito: a emissão quase nunca é o dia de pagar. */
  const [nParcelas, setNParcelas] = useState('1')
  const [primeiroVenc, setPrimeiroVenc] = useState('')
  const [boletos, setBoletos] = useState<BoletoNaTela[]>([])
  /** Nota já importada com a mesma chave de acesso — bloqueia a segunda entrada. */
  const [nfeJaImportada, setNfeJaImportada] = useState<{ number: string; issueDate: string | null } | null>(null)
  const [importing, setImporting] = useState(false)
  const nfeFileRef = useRef<HTMLInputElement | null>(null)

  const handleNfeFile = async (file: File | null) => {
    if (!file) return
    try {
      const xml = await file.text()
      const parsed = parseNotaXml(xml)
      // Mesma nota subindo de novo (outro arquivo, outra pessoa, mesmo mês) — avisa antes de
      // montar o plano, senão o usuário confirma e só descobre no erro do índice único.
      const jaImportada = parsed.key ? await findInvoiceByNfeKey(parsed.key) : null
      setNfeJaImportada(jaImportada ? { number: jaImportada.number, issueDate: jaImportada.issueDate } : null)
      setNfe(parsed)
      setNfePlan(suggestItemPlan(parsed, stockItems))
      setNfeCreateSupplier(true)
      // Sem duplicata a nota também vira conta a pagar, pelos boletos digitados — senão a
      // compra entra no estoque e nunca aparece no financeiro.
      setNfeCreatePayables(parsed.totalCents > 0)
      setNParcelas('1')
      setPrimeiroVenc('')
      setBoletos(boletosNaTela(parsed.totalCents, 1, ''))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler o XML')
    } finally {
      if (nfeFileRef.current) nfeFileRef.current.value = ''
    }
  }

  const existingSupplierMatch = useMemo(() => {
    if (!nfe?.supplierCnpj) return null
    const digits = nfe.supplierCnpj.replace(/\D/g, '')
    return suppliers.find((s) => (s.cnpj ?? '').replace(/\D/g, '') === digits) ?? null
  }, [nfe, suppliers])

  const semDuplicata = nfe != null && nfe.installments.length === 0
  const somaBoletos = boletos.reduce((s, b) => s + paraCentavos(b.valor), 0)
  const boletosIncompletos =
    semDuplicata && nfeCreatePayables && boletos.some((b) => !b.dueDate || paraCentavos(b.valor) <= 0)

  const regerarBoletos = (parcelas: string, venc: string) => {
    if (!nfe) return
    setBoletos(boletosNaTela(nfe.totalCents, Number(parcelas), venc))
  }

  const confirmImport = async () => {
    if (!nfe) return
    setImporting(true)
    try {
      const result = await importNfe(nfe, {
        createSupplier: nfeCreateSupplier && !existingSupplierMatch,
        supplierId: existingSupplierMatch?.id ?? null,
        createPayables: nfeCreatePayables,
        boletos: semDuplicata
          ? boletos.map((b) => ({ dueDate: b.dueDate, amountCents: paraCentavos(b.valor) }))
          : [],
        itemsPlan: nfePlan,
      })
      toast.success(
        `NF ${result.invoiceNumber} importada: ${result.itemsStocked} ${result.itemsStocked === 1 ? 'entrada' : 'entradas'} no estoque` +
          (result.itemsCreated > 0 ? ` (${result.itemsCreated} ${result.itemsCreated === 1 ? 'item novo' : 'itens novos'})` : '') +
          (result.batches > 0 ? `, ${result.batches} ${result.batches === 1 ? 'lote' : 'lotes'}` : '') +
          (result.payables > 0 ? `, ${result.payables} ${result.payables === 1 ? 'parcela' : 'parcelas'}` : '') +
          (result.blingPushed > 0 ? `, ${result.blingPushed} ${result.blingPushed === 1 ? 'entrada' : 'entradas'} espelhada${result.blingPushed === 1 ? '' : 's'} no Bling` : '') + '.',
      )
      setNfe(null)
      setNfePlan([])
      onImportou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar a nota')
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <input
        ref={nfeFileRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        aria-label="Arquivo XML da NF-e ou NFS-e"
        className="hidden"
        onChange={(e) => void handleNfeFile(e.target.files?.[0] ?? null)}
      />
      <Button size="sm" variant="outline" onClick={() => nfeFileRef.current?.click()}>
        <FileCode className="size-4" /> Importar XML
      </Button>

      <Dialog open={nfe != null} onOpenChange={(open) => (!open ? setNfe(null) : null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar {nfe?.kind === 'nfse' ? 'NFS-e' : 'NF-e'} {nfe?.number}</DialogTitle>
            <DialogDescription>
              {nfe?.supplierName ?? 'Fornecedor não identificado'}
              {nfe?.issueDate ? ` · emitida ${formatDay(nfe.issueDate)}` : ''} · total {formatBRL(nfe?.totalCents ?? 0)}
            </DialogDescription>
          </DialogHeader>

          {nfe ? (
            <div className="space-y-4">
              {nfeJaImportada ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <p className="font-semibold text-destructive">Esta nota já foi importada</p>
                  <p className="text-muted-foreground">
                    A chave de acesso já está na NF {nfeJaImportada.number}
                    {nfeJaImportada.issueDate ? ` (emitida ${formatDay(nfeJaImportada.issueDate)})` : ''}. Importar de novo
                    duplicaria a entrada de estoque e as parcelas.
                  </p>
                </div>
              ) : null}
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="mb-1 font-semibold">Fornecedor</p>
                {existingSupplierMatch ? (
                  <p className="text-muted-foreground">
                    Já cadastrado: <span className="font-medium text-foreground">{existingSupplierMatch.name}</span>, a NF será vinculada a ele.
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="nfe-create-supplier"
                      checked={nfeCreateSupplier}
                      onCheckedChange={(checked) => setNfeCreateSupplier(checked)}
                    />
                    <Label htmlFor="nfe-create-supplier" className="font-normal text-muted-foreground">
                      Cadastrar fornecedor “{nfe.supplierName ?? 'sem nome'}”{nfe.supplierCnpj ? ` (CNPJ ${nfe.supplierCnpj})` : ''}
                    </Label>
                  </div>
                )}
              </div>

              {nfe.kind === 'nfse' ? (
                <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                  Nota de serviço: não tem lista de produtos, entra só no financeiro.
                </p>
              ) : (
                <div>
                  <p className="mb-2 text-sm font-semibold">Itens ({nfe.items.length}) → estoque</p>
                  <div className="space-y-1.5">
                    {nfe.items.map((item, index) => {
                      const plan = nfePlan[index]
                      const matchedItem =
                        plan?.action === 'existente' && plan.matchedItemId
                          ? stockItems.find((s) => s.id === plan.matchedItemId) ?? null
                          : null
                      const matchLabel =
                        plan?.matchedBy === 'ean'
                          ? 'casou por código de barras'
                          : plan?.matchedBy === 'sku'
                            ? 'casou por SKU'
                            : plan?.matchedBy === 'nome'
                              ? 'casou por nome'
                              : plan?.matchedBy === 'alias'
                                ? 'casou por alias (NF)'
                                : null
                      return (
                        <div key={index} className="rounded-md border border-border p-2.5 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              {/* Descrição de item de NF-e chega com mediana de 32 e até 90
                                  caracteres: sem truncar, empurrava o valor para fora da linha. */}
                              <div className="truncate font-medium" title={item.description}>{item.description}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.qty} {item.unit} · {formatBRL(item.unitCostCents)}/un
                                {item.ean ? ` · EAN ${item.ean}` : ''}
                                {item.supplierCode ? ` · cód. ${item.supplierCode}` : ''}
                                {item.lotCode ? ` · lote ${item.lotCode}` : ''}
                                {item.expiresOn ? ` · val. ${formatDay(item.expiresOn)}` : ''}
                              </div>
                              {matchedItem ? (
                                <div className="mt-0.5 text-xs text-emerald-600">
                                  ↳ dá entrada em: {matchedItem.name}
                                  {matchedItem.sku ? ` (SKU ${matchedItem.sku})` : ''}
                                  {matchLabel ? ` · ${matchLabel}` : ' · manual'}
                                </div>
                              ) : null}
                              {matchedItem && plan ? (() => {
                                // A nota vende caixa, o estoque conta unidade: sem o fator, 1 CX de
                                // 200 pares entrava como 1 par ao preço da caixa.
                                const fator = plan.packFactor ?? 1
                                const conv = converterPorEmbalagem(item.qty, item.unitCostCents, fator)
                                return (
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                    <Label htmlFor={`nfe-fator-${index}`} className="text-xs font-normal">
                                      1 {item.unit} =
                                    </Label>
                                    <Input
                                      id={`nfe-fator-${index}`}
                                      type="number"
                                      inputMode="decimal"
                                      min={0.001}
                                      step="any"
                                      className="h-7 w-20 px-2 text-xs"
                                      value={plan.packFactor ?? ''}
                                      placeholder="1"
                                      onChange={(e) => {
                                        // Campo vazio vale 1, mas fica vazio: forçar 1 impedia apagar pra digitar.
                                        const valor = Number(e.target.value)
                                        setNfePlan((prev) =>
                                          prev.map((p, j) =>
                                            j === index
                                              ? { ...p, packFactor: valor > 0 ? valor : undefined, packSource: 'manual' as const }
                                              : p,
                                          ),
                                        )
                                      }}
                                    />
                                    <span>{matchedItem.unit}</span>
                                    {fator !== 1 ? (
                                      <span className="text-foreground">
                                        · entram {conv.qty} {matchedItem.unit} a {formatBRL(conv.unitCostCents)} cada
                                      </span>
                                    ) : null}
                                    {plan.packSource === 'nome' ? <span>· lido do nome da nota, confira</span> : null}
                                    {plan.packSource === 'aprendido' ? <span>· fator já confirmado antes</span> : null}
                                  </div>
                                )
                              })() : null}
                            </div>
                            <Select
                              value={plan?.action === 'existente' ? (plan.matchedItemId ?? 'novo') : (plan?.action ?? 'novo')}
                              onValueChange={(v) =>
                                setNfePlan((prev) =>
                                  prev.map((p, j) =>
                                    j === index
                                      ? v === 'novo'
                                        ? { index, action: 'novo', matchedItemId: null, matchedBy: null }
                                        : v === 'ignorar'
                                          ? { index, action: 'ignorar', matchedItemId: null, matchedBy: null }
                                          : {
                                              index,
                                              action: 'existente',
                                              matchedItemId: v,
                                              matchedBy: null,
                                              ...fatorParaLinha(item, stockItems.find((s) => s.id === v)),
                                            }
                                      : p,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-[180px] shrink-0"
                                aria-label={`Destino do item ${item.description}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="novo">Criar item novo</SelectItem>
                                <SelectItem value="ignorar">Ignorar</SelectItem>
                                {stockItems.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    ↳ {s.name}
                                    {s.sku ? ` · SKU ${s.sku}` : s.barcode ? ` · ${s.barcode}` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {nfe.installments.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="nfe-create-payables"
                      checked={nfeCreatePayables}
                      onCheckedChange={(checked) => setNfeCreatePayables(checked)}
                    />
                    <Label htmlFor="nfe-create-payables" className="font-semibold">
                      Criar {nfe.installments.length} {nfe.installments.length === 1 ? 'parcela' : 'parcelas'} em contas a pagar
                    </Label>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {nfe.installments.map((inst) => (
                      <span key={inst.number} className="rounded-md bg-muted px-2 py-1 text-xs">
                        {formatDay(inst.dueDate)} · {formatBRL(inst.amountCents)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="nfe-create-payables"
                      checked={nfeCreatePayables}
                      onCheckedChange={(checked) => setNfeCreatePayables(checked)}
                      disabled={nfe.totalCents <= 0}
                    />
                    <Label htmlFor="nfe-create-payables" className="font-semibold">
                      Lançar {formatBRL(nfe.totalCents)} em contas a pagar
                    </Label>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A nota não traz os boletos. Digite como está no boleto: vencimento e valor de cada
                    parcela. Sem isso o gasto não aparece no financeiro, e com a data da emissão a conta
                    aparece vencida e não casa com o extrato.
                  </p>
                  {nfeCreatePayables ? (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="nfe-parcelas" className="text-xs font-normal text-muted-foreground">
                            Boletos
                          </Label>
                          <Input
                            id="nfe-parcelas"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={60}
                            className="h-8 w-20"
                            value={nParcelas}
                            onChange={(e) => {
                              setNParcelas(e.target.value)
                              if (Number(e.target.value) >= 1) regerarBoletos(e.target.value, primeiroVenc)
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="nfe-primeiro-venc" className="text-xs font-normal text-muted-foreground">
                            1º vencimento
                          </Label>
                          <Input
                            id="nfe-primeiro-venc"
                            type="date"
                            className="h-8 w-[160px]"
                            value={primeiroVenc}
                            onChange={(e) => {
                              setPrimeiroVenc(e.target.value)
                              regerarBoletos(nParcelas, e.target.value)
                            }}
                          />
                        </div>
                        <p className="pb-1.5 text-xs text-muted-foreground">os seguintes de mês em mês, dá para ajustar cada um</p>
                      </div>
                      <div className="space-y-1.5">
                        {boletos.map((b, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="w-16 text-xs text-muted-foreground">
                              {boletos.length > 1 ? `${i + 1}/${boletos.length}` : 'única'}
                            </span>
                            <Input
                              type="date"
                              aria-label={`Vencimento do boleto ${i + 1}`}
                              className="h-8 w-[160px]"
                              value={b.dueDate}
                              onChange={(e) =>
                                setBoletos((prev) => prev.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))
                              }
                            />
                            <Input
                              inputMode="decimal"
                              aria-label={`Valor do boleto ${i + 1}`}
                              className="h-8 w-[120px]"
                              value={b.valor}
                              onChange={(e) =>
                                setBoletos((prev) => prev.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))
                              }
                            />
                          </div>
                        ))}
                      </div>
                      {boletosIncompletos ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">Falta vencimento ou valor em algum boleto.</p>
                      ) : somaBoletos !== nfe.totalCents ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Os boletos somam {formatBRL(somaBoletos)} e a nota {formatBRL(nfe.totalCents)}. Confira antes de importar.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setNfe(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmImport} disabled={importing || nfeJaImportada != null || boletosIncompletos}>
              {importing ? 'Importando…' : nfeJaImportada ? 'Já importada' : 'Confirmar importação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
