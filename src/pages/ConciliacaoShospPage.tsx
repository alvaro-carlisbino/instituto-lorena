import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Banknote, CreditCard, Download, FileSpreadsheet, FileUp, Landmark, Sparkles } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { listTransactions } from '@/services/financeiro'
import { parseBankStatement } from '@/services/ofx'
import {
  type ShospColumnKey,
  type ShospColumnMap,
  type ShospParseResult,
  type ShospSale,
  parseShospSales,
} from '@/services/shospVendas'
import {
  CONFIG_PADRAO,
  DIVERGENCE_BADGE,
  DIVERGENCE_LABEL,
  type BankCredit,
  type Divergence,
  type DivergenceKind,
  type ReconcileConfig,
  type ReconcileResult,
  reconcileShospVsBanco,
} from '@/services/conciliacaoShosp'

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dia(iso: string): string {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

const COLUNA_LABEL: Record<ShospColumnKey, string> = {
  date: 'Data do pagamento',
  patient: 'Paciente',
  cpf: 'CPF',
  amount: 'Valor cobrado',
  method: 'Forma de pagamento',
  installments: 'Parcelas',
  caixa: 'Caixa / conta',
  service: 'Serviço',
  provider: 'Prestador',
  doc: 'Código da venda',
  status: 'Situação',
}
const COLUNAS: ShospColumnKey[] = [
  'date',
  'patient',
  'cpf',
  'amount',
  'method',
  'installments',
  'caixa',
  'service',
  'provider',
  'doc',
  'status',
]

type FonteBanco = 'conectado' | 'arquivo'

export function ConciliacaoShospPage() {
  const { tenant } = useTenant()

  const [shospFile, setShospFile] = useState<File | null>(null)
  const [parse, setParse] = useState<ShospParseResult | null>(null)
  const [override, setOverride] = useState<Partial<ShospColumnMap>>({})
  const [fonte, setFonte] = useState<FonteBanco>('conectado')
  const [creditos, setCreditos] = useState<BankCredit[] | null>(null)
  const [resultado, setResultado] = useState<ReconcileResult | null>(null)
  const [config, setConfig] = useState<ReconcileConfig>(CONFIG_PADRAO)
  const [caixasFora, setCaixasFora] = useState<string[]>([])
  const [filtro, setFiltro] = useState<DivergenceKind | 'todas'>('todas')
  const [busy, setBusy] = useState(false)

  const shospRef = useRef<HTMLInputElement | null>(null)
  const bancoRef = useRef<HTMLInputElement | null>(null)

  const vendas: ShospSale[] = useMemo(() => parse?.sales ?? [], [parse])

  // Período coberto pela planilha — usado pra puxar o extrato da conta conectada.
  const periodo = useMemo(() => {
    if (vendas.length === 0) return null
    const datas = vendas.map((s) => s.date).sort()
    return { from: datas[0], to: datas[datas.length - 1] }
  }, [vendas])

  // ── planilha do Shosp
  const lerShosp = async (file: File | null, mapa: Partial<ShospColumnMap> = {}) => {
    if (!file) return
    setBusy(true)
    try {
      const res = await parseShospSales(file, mapa)
      setParse(res)
      setResultado(null)
      // Caixa marcado some quando o arquivo muda: a lista de caixas é outra.
      setCaixasFora([])
      if (res.sales.length === 0) {
        if (res.map.date < 0 || res.map.amount < 0) {
          toast.error('Não achei as colunas de data e valor. Aponte na mão ali embaixo em "Colunas lidas".')
        } else {
          toast.error('Li a planilha mas não veio nenhuma venda aproveitável.')
        }
      } else {
        toast.success(
          `Shosp: ${res.sales.length} venda(s)` +
            (res.groupedRows > 0 ? ` em ${res.rowsRead} linha(s) de serviço` : '') +
            (res.canceled > 0 ? `, ${res.canceled} cancelada(s) fora da conta` : '') +
            '.',
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler a planilha do Shosp')
    } finally {
      setBusy(false)
    }
  }

  const trocarColuna = async (chave: ShospColumnKey, idx: number) => {
    const novo = { ...override, [chave]: idx }
    setOverride(novo)
    await lerShosp(shospFile, novo)
  }

  // ── extrato do banco
  const lerBancoArquivo = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      const text = await file.text()
      const { txns, format } = parseBankStatement(text, file.name)
      const entradas = txns
        .filter((t) => t.amountCents > 0)
        .map((t) => ({
          id: t.externalId,
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
        }))
      if (entradas.length === 0) {
        toast.error('Não achei entradas nesse arquivo. Confira se é o OFX/CSV do extrato.')
        return
      }
      setCreditos(entradas)
      setResultado(null)
      toast.success(`Extrato (${format.toUpperCase()}): ${entradas.length} entrada(s).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler o extrato')
    } finally {
      setBusy(false)
      if (bancoRef.current) bancoRef.current.value = ''
    }
  }

  const puxarBancoConectado = async () => {
    if (!periodo) {
      toast.error('Suba primeiro a planilha do Shosp — é ela que define o período.')
      return
    }
    setBusy(true)
    try {
      // folga na janela: repasse de cartão de venda do fim do mês cai depois do período
      const ate = new Date(`${periodo.to}T12:00:00`)
      ate.setDate(ate.getDate() + config.cartaoAtrasoMax)
      // Teto alto de propósito: extrato cortado vira divergência falsa. Como a ordem é data
      // DESC, faltar linha significa faltar o COMEÇO do período, e toda venda daqueles dias
      // apareceria como "não caiu no banco". Antes buscar demais do que acusar errado.
      const txns = await listTransactions({ from: periodo.from, to: ate.toISOString().slice(0, 10), limit: 20000 })
      const entradas = txns
        .filter((t) => t.direction === 'in')
        .map((t) => ({
          id: t.id,
          date: t.date,
          amountCents: Math.abs(t.amountCents),
          description: t.description ?? t.counterparty ?? '',
        }))
      setCreditos(entradas)
      setResultado(null)
      if (entradas.length === 0) {
        toast.error('A conta conectada não tem entradas nesse período. Sincronize o banco ou suba o OFX.')
      } else {
        toast.success(`Banco: ${entradas.length} entrada(s) no período.`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao puxar o extrato da conta conectada')
    } finally {
      setBusy(false)
    }
  }

  // ── conciliar
  const conciliar = () => {
    if (vendas.length === 0) {
      toast.error('Falta a planilha de vendas do Shosp.')
      return
    }
    if (!creditos || creditos.length === 0) {
      toast.error('Falta o extrato do banco.')
      return
    }
    setResultado(reconcileShospVsBanco(vendas, creditos, { ...config, caixasFora }))
  }

  const baixarCsv = () => {
    if (!resultado) return
    const linhas = [
      ['Tipo', 'Gravidade', 'Data', 'Valor', 'Descrição', 'Detalhe'],
      ...resultado.divergences.map((d) => [
        DIVERGENCE_LABEL[d.kind],
        d.severity,
        dia(d.date),
        brl(d.amountCents),
        d.title,
        d.detail,
      ]),
    ]
    const csv = linhas
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\n')
    // BOM (\ufeff) na frente: sem ele o Excel abre o CSV em latin-1 e come os acentos.
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `conciliacao-shosp-banco-${periodo?.from ?? 'periodo'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const divergencias = useMemo(() => {
    if (!resultado) return []
    return filtro === 'todas' ? resultado.divergences : resultado.divergences.filter((d) => d.kind === filtro)
  }, [resultado, filtro])

  const contagem = useMemo(() => {
    const m = new Map<DivergenceKind, number>()
    for (const d of resultado?.divergences ?? []) m.set(d.kind, (m.get(d.kind) ?? 0) + 1)
    return m
  }, [resultado])

  return (
    <AppLayout
      title="Conciliação Shosp × Banco"
      subtitle="Sobe o extrato de vendas do Shosp, cruza com as entradas da conta e devolve só o que não fecha."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_1fr]">
        {/* ─────────────────────────────── coluna esquerda: entradas */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="size-4 text-muted-foreground" /> 1. Vendas do Shosp
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Exporte o extrato de vendas/recebimentos do Shosp em XLS ou CSV e solte aqui.
              </p>
              <Input
                ref={shospRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setShospFile(f)
                  setOverride({})
                  void lerShosp(f, {})
                }}
              />
              {parse && (
                <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                  <div className="font-medium">
                    {parse.sales.length} venda(s) lida(s)
                    {parse.canceled > 0 ? ` · ${parse.canceled} cancelada(s)` : ''}
                  </div>
                  {periodo && (
                    <div className="mt-0.5 text-muted-foreground">
                      Período {dia(periodo.from)} a {dia(periodo.to)} · aba “{parse.sheetName}”
                    </div>
                  )}
                  {/* O Shosp traz uma linha por SERVIÇO. Dizer isso aqui evita a pergunta
                      "por que 300 vendas se a planilha tem 306 linhas?". */}
                  {parse.groupedRows > 0 && (
                    <div className="mt-0.5 text-muted-foreground">
                      {parse.rowsRead} linha(s) de serviço agrupadas por código da venda
                    </div>
                  )}
                  {parse.mixedCount > 0 && (
                    <div className="mt-0.5 text-muted-foreground">
                      {parse.mixedCount} com pagamento dividido entre formas
                    </div>
                  )}
                  {parse.statusCounts.length > 0 && (
                    <div className="mt-0.5 text-muted-foreground">
                      Situação: {parse.statusCounts.map((s) => `${s.status} (${s.qtd})`).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Landmark className="size-4 text-muted-foreground" /> 2. Entradas do banco
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={fonte} onValueChange={(v) => setFonte((v as FonteBanco) ?? 'conectado')}>
                <SelectTrigger id="fonte-banco">
                  <SelectValue placeholder="Fonte do extrato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conectado">Conta já conectada (Open Finance)</SelectItem>
                  <SelectItem value="arquivo">Subir OFX / CSV agora</SelectItem>
                </SelectContent>
              </Select>

              {fonte === 'conectado' ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Usa o extrato que já entra sozinho na Conciliação bancária, no mesmo período da planilha.
                  </p>
                  <Button size="sm" variant="outline" disabled={busy || !periodo} onClick={() => void puxarBancoConectado()}>
                    <FileUp className="size-4" /> Puxar extrato do período
                  </Button>
                </>
              ) : (
                <Input
                  ref={bancoRef}
                  type="file"
                  accept=".ofx,.csv,.txt"
                  disabled={busy}
                  onChange={(e) => void lerBancoArquivo(e.target.files?.[0] ?? null)}
                />
              )}

              {creditos && (
                <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                  <span className="font-medium">{creditos.length} entrada(s)</span> no extrato.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">3. Regras</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="janela" className="text-xs">
                    Janela PIX/TED (dias)
                  </Label>
                  <Input
                    id="janela"
                    type="number"
                    min={0}
                    max={30}
                    value={config.janelaDias}
                    onChange={(e) => setConfig({ ...config, janelaDias: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="taxa" className="text-xs">
                    Teto da taxa (%)
                  </Label>
                  <Input
                    id="taxa"
                    type="number"
                    min={0}
                    max={30}
                    step={0.5}
                    value={config.taxaMaxPct}
                    onChange={(e) => setConfig({ ...config, taxaMaxPct: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="atraso-min" className="text-xs">
                    Repasse cartão de D+
                  </Label>
                  <Input
                    id="atraso-min"
                    type="number"
                    min={0}
                    max={60}
                    value={config.cartaoAtrasoMin}
                    onChange={(e) => setConfig({ ...config, cartaoAtrasoMin: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="atraso-max" className="text-xs">
                    até D+
                  </Label>
                  <Input
                    id="atraso-max"
                    type="number"
                    min={0}
                    max={120}
                    value={config.cartaoAtrasoMax}
                    onChange={(e) => setConfig({ ...config, cartaoAtrasoMax: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
              {/* Caixa do Shosp = em que conta o dinheiro entrou. Venda lançada no caixa de um
                  anestesista ou de outra praça nunca vai estar NESTE extrato; sem desmarcar,
                  cada uma vira "não caiu no banco" — erro alto, no lugar mais visível da tela.
                  Dinheiro não precisa: já tem tratamento próprio e nunca cai como divergência. */}
              {parse && parse.caixas.length > 1 && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <Label className="text-xs">Caixas do Shosp neste extrato</Label>
                  <p className="text-xs text-muted-foreground">
                    Desmarque a conta que não passa pelo extrato do banco que você subiu.
                  </p>
                  {parse.caixas.map((c) => {
                    const dentro = !caixasFora.includes(c.name)
                    return (
                      <label key={c.name} className="flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox
                          checked={dentro}
                          onCheckedChange={() =>
                            setCaixasFora((atual) =>
                              dentro ? [...atual, c.name] : atual.filter((n) => n !== c.name),
                            )
                          }
                        />
                        <span className={`min-w-0 flex-1 truncate ${dentro ? '' : 'text-muted-foreground line-through'}`}>
                          {c.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{brl(c.amountCents)}</span>
                      </label>
                    )
                  })}
                </div>
              )}

              <Button className="w-full" disabled={busy || vendas.length === 0 || !creditos} onClick={conciliar}>
                <Sparkles className="size-4" /> Conciliar
              </Button>
            </CardContent>
          </Card>

          {/* Detecção de colunas: a parte frágil. Fica visível e corrigível. */}
          {parse && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Colunas lidas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Detectadas pelo cabeçalho da planilha. Se alguma estiver errada, aponte a certa aqui.
                </p>
                {COLUNAS.map((chave) => (
                  <div key={chave} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-xs text-muted-foreground">{COLUNA_LABEL[chave]}</span>
                    <Select
                      value={String(parse.map[chave])}
                      onValueChange={(v) => void trocarColuna(chave, Number(v ?? -1))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-1">— não tem —</SelectItem>
                        {parse.headers.map((h, i) => (
                          <SelectItem key={`${h}-${i}`} value={String(i)}>
                            {h || `Coluna ${i + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ─────────────────────────────── coluna direita: resultado */}
        <div className="space-y-4">
          {!resultado ? (
            <Card>
              <CardContent className="pt-6">
                <EmptyState
                  icon={AlertTriangle}
                  title="Nada conciliado ainda"
                  description="Suba a planilha do Shosp, escolha a fonte do extrato e clique em Conciliar."
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* resumo */}
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Vendas no Shosp</div>
                    <div className="mt-0.5 text-lg font-semibold">{brl(resultado.totais.vendasBrutoCents)}</div>
                    <div className="text-xs text-muted-foreground">{resultado.totais.vendasQtd} venda(s)</div>
                    {/* Quando o usuário tira um caixa, o total da tela deixa de ser o total do mês.
                        Mostrar os dois evita a conclusão errada de que a clínica faturou menos. */}
                    {resultado.foraDoExtrato.qtd > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        de {brl(resultado.totais.vendasTotalBrutoCents)} na planilha ·{' '}
                        {brl(resultado.foraDoExtrato.amountCents)} em caixa fora deste extrato
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Entradas no banco</div>
                    <div className="mt-0.5 text-lg font-semibold">{brl(resultado.totais.creditosCents)}</div>
                    <div className="text-xs text-muted-foreground">
                      {resultado.totais.creditosQtd} lançamento(s)
                      {resultado.totais.ignoradosQtd > 0
                        ? ` · ${resultado.totais.ignoradosQtd} fora da conta (não é venda)`
                        : ''}
                    </div>
                  </CardContent>
                </Card>
                <Card className={resultado.divergences.length > 0 ? 'border-amber-500/40 bg-amber-500/[0.04]' : ''}>
                  <CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Divergências</div>
                    <div className="mt-0.5 text-lg font-semibold">{resultado.divergences.length}</div>
                    <div className="text-xs text-muted-foreground">
                      {resultado.casados.length} venda(s) casada(s) 1 pra 1
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* cartão e dinheiro: os dois que não casam 1 pra 1 */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <CreditCard className="size-4 text-muted-foreground" /> Cartão no período
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bruto vendido</span>
                      <span>{brl(resultado.cartao.brutoCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Repassado pelo adquirente</span>
                      <span>{brl(resultado.cartao.repassadoCents)}</span>
                    </div>
                    {resultado.cartao.brutoPendenteCents > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ainda sem repasse</span>
                        <span>
                          {brl(resultado.cartao.brutoPendenteCents)}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({resultado.cartao.diasSemRepasse} dia
                            {resultado.cartao.diasSemRepasse > 1 ? 's' : ''})
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium">
                      <span>Taxa efetiva</span>
                      <span>
                        {resultado.cartao.taxaEfetivaPct == null
                          ? '—'
                          : `${resultado.cartao.taxaEfetivaPct.toFixed(2)}%`}
                      </span>
                    </div>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Repasse é agrupado e líquido de taxa — por isso não casa venda a venda. A taxa sai só
                      sobre {brl(resultado.cartao.brutoConciliadoCents)} que já foram repassados; o que ainda
                      não caiu ficaria de fora da conta e inflaria o percentual.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Banknote className="size-4 text-muted-foreground" /> Dinheiro no período
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Recebido em espécie</span>
                      <span>{brl(resultado.dinheiro.vendidoCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Depositado no banco</span>
                      <span>{brl(resultado.dinheiro.depositadoCents)}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>Ainda em caixa</span>
                      <span>{brl(resultado.dinheiro.diferencaCents)}</span>
                    </div>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Dinheiro só aparece no banco se alguém depositou — a diferença é o caixa da clínica.
                    </p>
                  </CardContent>
                </Card>
              </div>

              {(resultado.foraDoExtrato.qtd > 0 || resultado.mistos.qtd > 0) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Fora das regras</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {resultado.foraDoExtrato.porCaixa.map((c) => (
                      <div key={c.name} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {c.name} <span className="text-xs">({c.qtd})</span>
                        </span>
                        <span className="shrink-0">{brl(c.amountCents)}</span>
                      </div>
                    ))}
                    {resultado.mistos.qtd > 0 && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          Pagamento dividido <span className="text-xs">({resultado.mistos.qtd})</span>
                        </span>
                        <span>{brl(resultado.mistos.amountCents)}</span>
                      </div>
                    )}
                    <p className="pt-1 text-xs text-muted-foreground">
                      Esse dinheiro existe, só não dá pra cobrar deste extrato: caixa marcado como de
                      outra conta, e venda paga em mais de uma forma — o Shosp não diz quanto foi em
                      cada uma. Aparece na lista abaixo para conferência na mão.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* divergências */}
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-sm">O que não fecha</CardTitle>
                  <div className="flex items-center gap-2">
                    <Select value={filtro} onValueChange={(v) => setFiltro((v as DivergenceKind | 'todas') ?? 'todas')}>
                      <SelectTrigger className="h-8 w-[220px] text-xs">
                        <SelectValue placeholder="Todas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas ({resultado.divergences.length})</SelectItem>
                        {([...contagem.keys()] as DivergenceKind[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {DIVERGENCE_LABEL[k]} ({contagem.get(k)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={baixarCsv} disabled={resultado.divergences.length === 0}>
                      <Download className="size-4" /> CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {divergencias.length === 0 ? (
                    <EmptyState
                      title="Tudo fechado"
                      description="Nenhuma divergência com as regras atuais. Se esperava erros, afrouxe a janela ou confira as colunas lidas."
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[120px]">Tipo</TableHead>
                          <TableHead className="w-[90px]">Data</TableHead>
                          <TableHead className="w-[110px] text-right">Valor</TableHead>
                          {/* w-full: a coluna que explica o erro tem que ficar com a sobra */}
                          <TableHead className="w-full">O quê</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {divergencias.map((d: Divergence, i) => (
                          <TableRow key={`${d.kind}-${d.date}-${d.amountCents}-${i}`}>
                            <TableCell className="align-top">
                              <Badge
                                variant={d.severity === 'alta' ? 'destructive' : 'secondary'}
                                title={DIVERGENCE_LABEL[d.kind]}
                              >
                                {DIVERGENCE_BADGE[d.kind]}
                              </Badge>
                            </TableCell>
                            <TableCell className="align-top whitespace-nowrap text-xs">{dia(d.date)}</TableCell>
                            <TableCell className="align-top text-right font-medium">{brl(d.amountCents)}</TableCell>
                            <TableCell className="align-top">
                              <div className="text-sm">{d.title}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{d.detail}</div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
