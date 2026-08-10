import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Download, FileSpreadsheet, Landmark, Upload } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { listAccounts, listCategories, type FinAccount, type FinCategory } from '@/services/financeiro'
import { parseShospSales, PAYMENT_LABEL, type ShospParseResult } from '@/services/shospVendas'
import { parseLionEntradas, type LionParseResult } from '@/services/lionEntradas'
import {
  cruzarLionComShosp,
  importarEntradas,
  vendaShospParaEntrada,
  type CruzamentoResult,
} from '@/services/importVendasFinanceiro'

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dia(iso: string): string {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

/** Valor da opção do Select quando o usuário escolhe "não lançar essa conta". */
const SEM_CONTA = '__sem__'

export function ImportarVendasPage() {
  const { tenant } = useTenant()

  const [shosp, setShosp] = useState<ShospParseResult | null>(null)
  const [lion, setLion] = useState<LionParseResult | null>(null)
  const [contas, setContas] = useState<FinAccount[]>([])
  const [categorias, setCategorias] = useState<FinCategory[]>([])
  const [caixaParaConta, setCaixaParaConta] = useState<Record<string, string | null>>({})
  const [categoryId, setCategoryId] = useState<string>(SEM_CONTA)
  const [busy, setBusy] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [a, c] = await Promise.all([listAccounts(), listCategories('receita')])
        setContas(a)
        setCategorias(c)
      } catch {
        // tela funciona sem: o mapeamento fica vazio e o usuário vê o aviso
      }
    })()
  }, [])

  // Conta sem extrato automático é a única em que a venda também vira lançamento de caixa —
  // ver o comentário do importador. Aqui só monta o conjunto pra passar adiante.
  const contasSemExtrato = useMemo(
    () => new Set(contas.filter((c) => !c.ofProvider).map((c) => c.id)),
    [contas],
  )

  const cruzamento: CruzamentoResult | null = useMemo(() => {
    if (!shosp || !lion) return null
    return cruzarLionComShosp(lion.entries, shosp.sales, 1)
  }, [shosp, lion])

  const periodo = useMemo(() => {
    const datas = (shosp?.sales ?? []).map((s) => s.date).sort()
    if (datas.length === 0) return null
    return { from: datas[0], to: datas[datas.length - 1] }
  }, [shosp])

  const lerShosp = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      const res = await parseShospSales(file)
      setShosp(res)
      setResultado(null)
      // Sugere o mapeamento: caixa cujo nome lembra o da conta já vem escolhido, e o resto
      // fica em branco de propósito — chutar conta erra o polo e o saldo.
      const mapa: Record<string, string | null> = {}
      for (const c of res.caixas) {
        const alvo = c.name.toLowerCase()
        const achou = contas.find((a) => {
          const n = a.name.toLowerCase()
          if (alvo.includes('dinheiro')) return n.includes('dinheiro') || n.includes('caixa')
          const primeira = alvo.split(/[\s-]+/)[0]
          return primeira.length >= 4 && n.includes(primeira)
        })
        mapa[c.name] = achou?.id ?? null
      }
      setCaixaParaConta(mapa)
      toast.success(`Shosp: ${res.sales.length} venda(s).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler o relatório do Shosp')
    } finally {
      setBusy(false)
    }
  }

  const lerLion = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      const res = await parseLionEntradas(file)
      if (res.entries.length === 0) {
        toast.error('Não achei lançamentos. O mês precisa estar no nome do arquivo (ex.: JUL_2026).')
      } else {
        toast.success(`Planilha: ${res.entries.length} lançamento(s).`)
      }
      setLion(res)
      setResultado(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler a planilha da recepção')
    } finally {
      setBusy(false)
    }
  }

  const importar = async (dryRun: boolean) => {
    if (!shosp || shosp.sales.length === 0) {
      toast.error('Suba o relatório do Shosp primeiro.')
      return
    }
    setBusy(true)
    try {
      const entradas = shosp.sales.map(vendaShospParaEntrada)
      const r = await importarEntradas(entradas, {
        caixaParaConta,
        contasSemExtrato,
        categoryId: categoryId === SEM_CONTA ? null : categoryId,
        dryRun,
      })
      const resumo =
        `${r.novas} nova(s), ${r.atualizadas} já existia(m), ${brl(r.totalCents)}` +
        (r.lancamentosCaixa > 0 ? ` · ${r.lancamentosCaixa} lançamento(s) em caixa sem extrato` : '')
      setResultado(dryRun ? `Simulação: ${resumo}` : `Importado: ${resumo}`)
      if (r.falhas.length > 0) {
        toast.error(`${r.falhas.length} falha(s). Primeira: ${r.falhas[0].motivo}`)
      } else {
        toast.success(dryRun ? 'Simulação pronta, nada foi gravado.' : 'Vendas no financeiro.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar')
    } finally {
      setBusy(false)
    }
  }

  const baixarPendencias = () => {
    if (!cruzamento) return
    const linhas: string[][] = [['Tipo', 'Data', 'Valor', 'Quem', 'Descrição']]
    for (const s of cruzamento.soNoShosp) {
      linhas.push(['Venda no Shosp que a recepção não anotou', dia(s.date), brl(s.amountCents), s.patient, s.services.join(' + ')])
    }
    for (const e of cruzamento.soNaLion.filter((x) => x.kind !== 'varejo')) {
      linhas.push(['Anotado na recepção e não lançado no Shosp', dia(e.date), brl(e.amountCents), e.customerName, e.description])
    }
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `vendas-sem-par-${periodo?.from ?? 'periodo'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const semConta = (shosp?.caixas ?? []).filter((c) => !caixaParaConta[c.name])

  return (
    <AppLayout
      title="Importar vendas"
      subtitle="Relatório do Shosp vira conta a receber. A planilha da recepção mostra o que ficou de fora."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4 text-muted-foreground" /> 1. Relatório do Shosp
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Financeiro → Vendas realizadas. É esse arquivo que vira receita da clínica.
              </p>
              <Input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(e) => void lerShosp(e.target.files?.[0] ?? null)} />
              {shosp && (
                <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                  <div className="font-medium">
                    {shosp.sales.length} venda(s) · {brl(shosp.sales.reduce((a, s) => a + s.amountCents, 0))}
                  </div>
                  {periodo && (
                    <div className="mt-0.5 text-muted-foreground">
                      {dia(periodo.from)} a {dia(periodo.to)}
                      {shosp.groupedRows > 0 ? ` · ${shosp.rowsRead} linhas de serviço agrupadas` : ''}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4 text-muted-foreground" /> 2. Planilha da recepção
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Opcional, e não vira receita: serve pra achar venda que ninguém lançou no Shosp. O mês
                sai do nome do arquivo.
              </p>
              <Input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(e) => void lerLion(e.target.files?.[0] ?? null)} />
              {lion && lion.entries.length > 0 && (
                <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                  <div className="font-medium">
                    {lion.entries.length} lançamento(s) · {brl(lion.entries.reduce((a, e) => a + e.amountCents, 0))}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {String(lion.month).padStart(2, '0')}/{lion.year} · {lion.days.length} dia(s)
                  </div>
                  {lion.conferencia.length > 0 && (
                    // A planilha traz subtotais escritos à mão que não fecham com as próprias
                    // colunas. Dizer isso aqui evita que alguém use aqueles números como verdade.
                    <div className="mt-1 text-amber-600 dark:text-amber-500">
                      {lion.conferencia.length} dia(s) em que o subtotal escrito não bate com a soma da
                      coluna — a planilha não fecha com ela mesma.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Landmark className="size-4 text-muted-foreground" /> 3. Para onde vai
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Categoria de receita</Label>
                <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? SEM_CONTA)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Sem categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CONTA}>Sem categoria</SelectItem>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {shosp && shosp.caixas.length > 0 && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <Label className="text-xs">Caixa do Shosp → conta do financeiro</Label>
                  <p className="text-xs text-muted-foreground">
                    Conta sem extrato automático (dinheiro, conta de terceiro) também recebe o
                    lançamento de caixa. Conta com Open Finance não recebe: o extrato já traz o mesmo
                    dinheiro, e lançar de novo dobraria o saldo.
                  </p>
                  {shosp.caixas.map((c) => (
                    <div key={c.name} className="flex items-center gap-2">
                      <span className="w-[130px] shrink-0 truncate text-xs text-muted-foreground" title={c.name}>
                        {c.name}
                      </span>
                      <Select
                        value={caixaParaConta[c.name] ?? SEM_CONTA}
                        onValueChange={(v) =>
                          setCaixaParaConta((m) => ({ ...m, [c.name]: v === SEM_CONTA ? null : (v ?? null) }))
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_CONTA}>— sem conta —</SelectItem>
                          {contas.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                              {a.ofProvider ? '' : ' (sem extrato)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  {semConta.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {semConta.length} caixa(s) sem conta: a venda entra como conta a receber, só sem
                      amarrar em conta nenhuma.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 border-t border-border pt-3">
                <Button size="sm" variant="outline" className="flex-1" disabled={busy || !shosp} onClick={() => void importar(true)}>
                  Simular
                </Button>
                <Button size="sm" className="flex-1" disabled={busy || !shosp} onClick={() => void importar(false)}>
                  <Upload className="size-4" /> Importar
                </Button>
              </div>
              {resultado && (
                <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs font-medium">{resultado}</div>
              )}
              <p className="text-xs text-muted-foreground">
                Reimportar o mesmo mês atualiza as vendas em vez de duplicar — a chave é o código da
                venda no Shosp.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {!cruzamento ? (
            <Card>
              <CardContent className="pt-6">
                <EmptyState
                  icon={AlertTriangle}
                  title="Suba os dois arquivos"
                  description="Com o Shosp sozinho dá pra importar. Com a planilha da recepção junto, dá pra ver o que ficou de fora do sistema."
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Shosp · vira receita</div>
                    <div className="mt-0.5 text-lg font-semibold">{brl(cruzamento.totais.shospCents)}</div>
                    <div className="text-xs text-muted-foreground">{shosp?.sales.length} venda(s)</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Confere com a recepção</div>
                    <div className="mt-0.5 text-lg font-semibold">
                      {brl(cruzamento.totais.casadosCents + cruzamento.totais.compostosCents)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {cruzamento.casados.length} direto
                      {cruzamento.compostos.length > 0 ? ` · ${cruzamento.compostos.length} somado(s)` : ''}
                    </div>
                  </CardContent>
                </Card>
                <Card className={cruzamento.soNoShosp.length > 0 ? 'border-amber-500/40 bg-amber-500/[0.04]' : ''}>
                  <CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Sem par</div>
                    <div className="mt-0.5 text-lg font-semibold">
                      {cruzamento.soNoShosp.length + cruzamento.soNaLion.filter((e) => e.kind !== 'varejo').length}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {brl(cruzamento.totais.soNoShospCents + cruzamento.totais.soNaLionClinicaCents)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {cruzamento.totais.soNaLionVarejoCents > 0 && (
                <Card>
                  <CardContent className="pt-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        Varejo na planilha (shampoo, tricopill) — polo Tricopill, não é receita da clínica
                      </span>
                      <span className="shrink-0 font-medium">{brl(cruzamento.totais.soNaLionVarejoCents)}</span>
                    </div>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Fica de fora da importação de propósito: a fonte da verdade do varejo é o Bling.
                      Somar aqui misturaria os dois polos.
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-sm">O que não tem par nos dois lados</CardTitle>
                  <Button size="sm" variant="outline" onClick={baixarPendencias}>
                    <Download className="size-4" /> CSV
                  </Button>
                </CardHeader>
                <CardContent>
                  {cruzamento.soNoShosp.length === 0 &&
                  cruzamento.soNaLion.filter((e) => e.kind !== 'varejo').length === 0 ? (
                    <EmptyState title="Tudo casado" description="Cada venda do Shosp tem contrapartida na planilha." />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[130px]">Onde está</TableHead>
                          <TableHead className="w-[90px]">Data</TableHead>
                          <TableHead className="w-[110px] text-right">Valor</TableHead>
                          <TableHead className="w-full">Quem / o quê</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cruzamento.soNoShosp.map((s) => (
                          <TableRow key={`s-${s.saleId}`}>
                            <TableCell className="align-top">
                              <Badge variant="destructive">Só no Shosp</Badge>
                            </TableCell>
                            <TableCell className="align-top whitespace-nowrap text-xs">{dia(s.date)}</TableCell>
                            <TableCell className="align-top text-right font-medium">{brl(s.amountCents)}</TableCell>
                            <TableCell className="align-top">
                              <div className="text-sm">{s.patient}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {s.services.join(' + ')} · {PAYMENT_LABEL[s.method]} · a recepção não anotou
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {cruzamento.soNaLion
                          .filter((e) => e.kind !== 'varejo')
                          .map((e) => (
                            <TableRow key={`l-${e.key}`}>
                              <TableCell className="align-top">
                                <Badge variant="secondary">Só na recepção</Badge>
                              </TableCell>
                              <TableCell className="align-top whitespace-nowrap text-xs">{dia(e.date)}</TableCell>
                              <TableCell className="align-top text-right font-medium">{brl(e.amountCents)}</TableCell>
                              <TableCell className="align-top">
                                <div className="text-sm">{e.customerName}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {e.description} · não existe no Shosp
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {cruzamento.compostos.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Uma venda, vários lançamentos</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      O Shosp registra a venda inteira numa linha; a recepção anota uma linha por forma
                      de pagamento. Não é divergência — só some antes de comparar.
                    </p>
                    {cruzamento.compostos.map((c, i) => (
                      <div key={i} className="rounded-md border border-border p-2 text-xs">
                        <div className="font-medium">{brl(c.amountCents)}</div>
                        <div className="mt-1 grid gap-1 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                          <div className="text-muted-foreground">
                            {c.entries.map((e) => (
                              <div key={e.key}>
                                {brl(e.amountCents)} — {e.description}
                              </div>
                            ))}
                          </div>
                          <ArrowRight className="hidden size-3 shrink-0 text-muted-foreground sm:block" />
                          <div>
                            {c.sales.map((s) => (
                              <div key={s.saleId}>
                                {brl(s.amountCents)} — {s.patient} ({s.methodRaw})
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
