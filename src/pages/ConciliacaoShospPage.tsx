import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileUp,
  Landmark,
  Sparkles,
  Users,
  X,
} from 'lucide-react'

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
import {
  bankCoverage,
  deleteReconcileRule,
  listAccounts,
  listReconcileRules,
  listTransactions,
  saveReconcileRule,
  type FinAccount,
  type ReconcileRule,
} from '@/services/financeiro'
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
  type CreditClass,
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

/** Rótulo de cada natureza no painel "quem é quem" — é o que o usuário está declarando. */
const CLASSE_LABEL: Record<CreditClass, string> = {
  venda: 'Pagamento de paciente',
  adquirente: 'Repasse de cartão (adquirente)',
  deposito: 'Depósito de dinheiro em espécie',
  nao_venda: 'Não é venda (transferência própria, rendimento, estorno)',
}
const CLASSES: CreditClass[] = ['nao_venda', 'adquirente', 'deposito', 'venda']

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

  // conta do extrato + até onde ela tem dado
  const [contas, setContas] = useState<FinAccount[]>([])
  const [contaId, setContaId] = useState<string>('')
  const [cobertura, setCobertura] = useState<{ from: string; to: string } | null>(null)
  // quem é quem no extrato
  const [regras, setRegras] = useState<ReconcileRule[]>([])

  const shospRef = useRef<HTMLInputElement | null>(null)
  const bancoRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [cs, rs] = await Promise.all([listAccounts(), listReconcileRules()])
        // Conta BANCO primeiro. O cartão corporativo da clínica é `carteira` e também tem
        // entrada — estorno de anuidade, cashback do Mercado Livre — e nada disso é venda de
        // paciente: em julho/2026 eram 10 lançamentos que só sabiam virar "entrada sem venda".
        // A tela deixa trocar, mas não começa no lugar errado.
        const correntes = cs.filter((c) => c.kind === 'banco')
        setContas(cs)
        setContaId((atual) => atual || correntes[0]?.id || cs[0]?.id || '')
        setRegras(rs)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas e regras')
      }
    })()
  }, [])

  useEffect(() => {
    if (!contaId) return
    void (async () => {
      try {
        setCobertura(await bankCoverage(contaId))
      } catch {
        setCobertura(null)
      }
    })()
  }, [contaId])

  const vendas: ShospSale[] = useMemo(() => parse?.sales ?? [], [parse])

  // Período coberto pela planilha — usado pra puxar o extrato da conta conectada.
  const periodoPlanilha = useMemo(() => {
    if (vendas.length === 0) return null
    const datas = vendas.map((s) => s.date).sort()
    return { from: datas[0], to: datas[datas.length - 1] }
  }, [vendas])

  /**
   * Período que dá pra conciliar de verdade: a planilha cortada pelo que o banco tem.
   *
   * O export do Shosp vem com um ano (11/ago/2025 a 10/ago/2026) e o fin_transactions da
   * clínica começa em 12/mai/2026. Sem este corte, os nove meses sem extrato viravam ~2.700
   * "não caiu no banco" — a tela acusando a clínica de perder dinheiro que ela só não importou.
   */
  const periodo = useMemo(() => {
    if (!periodoPlanilha) return null
    if (fonte === 'arquivo' || !cobertura) return periodoPlanilha
    const from = periodoPlanilha.from > cobertura.from ? periodoPlanilha.from : cobertura.from
    const to = periodoPlanilha.to < cobertura.to ? periodoPlanilha.to : cobertura.to
    return from <= to ? { from, to } : null
  }, [periodoPlanilha, cobertura, fonte])

  /** Vendas efetivamente conciliadas — as de fora do período com extrato ficam nomeadas na tela. */
  const vendasNoPeriodo = useMemo(
    () => (periodo ? vendas.filter((s) => s.date >= periodo.from && s.date <= periodo.to) : vendas),
    [vendas, periodo],
  )
  const foraDaCobertura = vendas.length - vendasNoPeriodo.length

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
      ate.setDate(ate.getDate() + config.creditoDias + 5)
      // Teto alto de propósito: extrato cortado vira divergência falsa. Como a ordem é data
      // DESC, faltar linha significa faltar o COMEÇO do período, e toda venda daqueles dias
      // apareceria como "não caiu no banco". Antes buscar demais do que acusar errado.
      const txns = await listTransactions({
        accountId: contaId || undefined,
        from: periodo.from,
        to: ate.toISOString().slice(0, 10),
        limit: 20000,
      })
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
  const conciliar = (regrasAgora: ReconcileRule[] = regras) => {
    if (vendasNoPeriodo.length === 0) {
      toast.error(
        vendas.length > 0
          ? 'Nenhuma venda da planilha cai no período que o banco cobre.'
          : 'Falta a planilha de vendas do Shosp.',
      )
      return
    }
    if (!creditos || creditos.length === 0) {
      toast.error('Falta o extrato do banco.')
      return
    }
    setResultado(
      reconcileShospVsBanco(vendasNoPeriodo, creditos, {
        ...config,
        caixasFora,
        regras: regrasAgora.map((r) => ({ pattern: r.pattern, classe: r.classe, label: r.label ?? undefined })),
        // Até onde dá pra cobrar repasse: o último dia que o extrato entregou.
        extratoAte: fonte === 'conectado' ? cobertura?.to : creditos.map((c) => c.date).sort().at(-1),
      }),
    )
  }

  /** Declara a natureza de um pagador recorrente e reconcilia de novo já com a regra valendo. */
  const classificarContraparte = async (pattern: string, classe: CreditClass, label: string) => {
    setBusy(true)
    try {
      const nova = await saveReconcileRule({ pattern, classe, label })
      const proximas = [...regras.filter((r) => r.id !== nova.id), nova]
      setRegras(proximas)
      conciliar(proximas)
      toast.success(`"${pattern}" agora conta como ${CLASSE_LABEL[classe].toLowerCase()}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar a regra')
    } finally {
      setBusy(false)
    }
  }

  const removerRegra = async (id: string) => {
    setBusy(true)
    try {
      await deleteReconcileRule(id)
      const proximas = regras.filter((r) => r.id !== id)
      setRegras(proximas)
      conciliar(proximas)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover a regra')
    } finally {
      setBusy(false)
    }
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
                  <Select value={contaId} onValueChange={(v) => setContaId(v ?? '')}>
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="Conta do extrato" />
                    </SelectTrigger>
                    <SelectContent>
                      {contas.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.kind !== 'banco' ? ` (${c.kind})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {cobertura && (
                    <p className="text-xs text-muted-foreground">
                      Extrato desta conta vai de {dia(cobertura.from)} a {dia(cobertura.to)}.
                    </p>
                  )}
                  {/* O usuário sobe um export de um ano e o banco tem três meses. Dizer isso
                      ANTES de conciliar evita a leitura de que a clínica perdeu o dinheiro. */}
                  {foraDaCobertura > 0 && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-2 text-xs">
                      {foraDaCobertura} das {vendas.length} vendas da planilha estão fora do período com
                      extrato e ficam de fora da conciliação. Para incluir, importe o extrato desses meses
                      ou suba o OFX na opção acima.
                    </p>
                  )}
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
                  <Label htmlFor="debito-dias" className="text-xs">
                    Débito cai em D+
                  </Label>
                  <Input
                    id="debito-dias"
                    type="number"
                    min={0}
                    max={30}
                    value={config.debitoDias}
                    onChange={(e) => setConfig({ ...config, debitoDias: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="credito-dias" className="text-xs">
                    Parcela a cada (dias)
                  </Label>
                  <Input
                    id="credito-dias"
                    type="number"
                    min={1}
                    max={60}
                    value={config.creditoDias}
                    onChange={(e) => setConfig({ ...config, creditoDias: Number(e.target.value) || 30 })}
                  />
                </div>
              </div>
              {/* Sem isto o campo "Parcela a cada" parece burocracia. É ele que faz a venda em
                  10x ser cobrada em dez pedaços em vez de inteira dentro do mês. */}
              <p className="text-xs text-muted-foreground">
                Venda parcelada não cai inteira: o adquirente devolve uma parcela por vez. A tela só
                cobra a parcela que já venceu e mostra o resto como “ainda vai cair”.
              </p>
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
                    // Depois de conciliar, o próprio resultado diz qual caixa está errado:
                    // "7 de 7 não casaram" é o sinal de que aquele dinheiro é de outra conta.
                    const falha = resultado?.semCreditoPorCaixa.find((f) => f.name === c.name)
                    const todasFalharam = falha && falha.totalQtd > 0 && falha.qtd === falha.totalQtd
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
                          {dentro && falha && (
                            <span className={todasFalharam ? 'ml-1 text-amber-600' : 'ml-1 text-muted-foreground'}>
                              · {falha.qtd}/{falha.totalQtd} sem crédito
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{brl(c.amountCents)}</span>
                      </label>
                    )
                  })}
                  {resultado?.semCreditoPorCaixa.some((f) => f.totalQtd > 0 && f.qtd === f.totalQtd) && (
                    <p className="text-xs text-amber-600">
                      Caixa em que NENHUMA venda casou quase sempre é conta que não passa por este
                      extrato. Desmarque e concilie de novo.
                    </p>
                  )}
                </div>
              )}

              <Button
                className="w-full"
                disabled={busy || vendasNoPeriodo.length === 0 || !creditos}
                onClick={() => conciliar()}
              >
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
                    {resultado.cartao.parceladoCents > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>disso, parcelado em até {resultado.cartao.maxParcelas}x</span>
                        <span>{brl(resultado.cartao.parceladoCents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Já venceu no adquirente</span>
                      <span>{brl(resultado.cartao.esperadoCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Creditado nesta conta</span>
                      <span>{brl(resultado.cartao.repassadoCents)}</span>
                    </div>
                    {resultado.cartao.aReceberCents > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Ainda vai cair</span>
                        <span>
                          {brl(resultado.cartao.aReceberCents)}
                          {resultado.cartao.aReceberAte && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (até {dia(resultado.cartao.aReceberAte)})
                            </span>
                          )}
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
                    {/* Dois textos porque são dois mundos: ou o repasse cai aqui e a taxa é
                        medível, ou ele cai em outro lugar e QUALQUER percentual seria invenção. */}
                    {resultado.cartao.repasseForaDaConta ? (
                      <p className="pt-1 text-xs text-amber-600">
                        Os adquirentes creditaram só {brl(resultado.cartao.repassadoCents)} dos{' '}
                        {brl(resultado.cartao.esperadoCents)} que já venceram. Com essa cobertura a taxa
                        não dá pra medir sem inventar número. Confira no portal do adquirente qual das
                        três é: antecipação que parou, domicílio bancário em outra conta, ou venda
                        lançada no Shosp que não passou na maquininha.
                      </p>
                    ) : (
                      <p className="pt-1 text-xs text-muted-foreground">
                        Repasse é agrupado e líquido de taxa — por isso não casa venda a venda. A taxa sai
                        sobre {brl(resultado.cartao.esperadoCents)} que já venceram pelo cronograma
                        (débito D+{config.debitoDias}, uma parcela do crédito a cada {config.creditoDias}{' '}
                        dias). O que ainda não venceu fica fora da conta para não inflar o percentual.
                      </p>
                    )}
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

              {/* QUEM É QUEM NO EXTRATO — o conserto de verdade das "entradas sem venda".
                  Um pagador recorrente com R$ 412 mil não é 22 divergências: é uma pergunta.
                  Aqui ela é feita uma vez e a resposta fica salva. */}
              {(resultado.contrapartesAbertas.length > 0 || regras.length > 0) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Users className="size-4 text-muted-foreground" /> Quem é quem no extrato
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {resultado.contrapartesAbertas.length > 0 && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Pagadores que aparecem várias vezes e nenhuma venda explica. Diga o que são e
                          eles param de contar como divergência — para sempre, não só nesta conciliação.
                        </p>
                        <div className="space-y-2">
                          {resultado.contrapartesAbertas.slice(0, 8).map((c) => (
                            <div
                              key={c.label}
                              className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{c.exemplo}</div>
                                <div className="text-xs text-muted-foreground">
                                  {c.qtd} lançamento(s) · {brl(c.amountCents)}
                                </div>
                              </div>
                              <Select
                                value=""
                                onValueChange={(v) =>
                                  void classificarContraparte(c.label, v as CreditClass, c.exemplo)
                                }
                              >
                                <SelectTrigger className="h-8 w-[210px] text-xs">
                                  <SelectValue placeholder="Classificar como…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {CLASSES.map((k) => (
                                    <SelectItem key={k} value={k}>
                                      {CLASSE_LABEL[k]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {regras.length > 0 && (
                      <div className="space-y-1 border-t border-border pt-3">
                        <Label className="text-xs">Já classificados</Label>
                        {regras.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 text-xs">
                            <span className="min-w-0 flex-1 truncate">
                              {r.label || r.pattern}
                              <span className="text-muted-foreground"> — {CLASSE_LABEL[r.classe]}</span>
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5"
                              disabled={busy}
                              onClick={() => void removerRegra(r.id)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {(resultado.foraDoExtrato.qtd > 0 ||
                resultado.mistos.qtd > 0 ||
                resultado.ignorados.length > 0) && (
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
                    {/* Entrada de banco que saiu da conta por não ser venda. Aparece somada e
                        NOMEADA: "R$ 412.215 de transferência entre contas próprias" é informação;
                        22 linhas vermelhas de "entrada sem venda" era ruído. */}
                    {resultado.ignorados.map((i) => (
                      <div key={i.label} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {i.label} <span className="text-xs">({i.qtd})</span>
                          {i.declarado && <span className="ml-1 text-xs">· você classificou</span>}
                        </span>
                        <span className="shrink-0">{brl(i.amountCents)}</span>
                      </div>
                    ))}
                    {resultado.totais.foraDoPeriodoQtd > 0 && (
                      <div className="flex justify-between gap-2">
                        <span className="min-w-0 truncate text-muted-foreground">
                          Entradas fora do período da planilha{' '}
                          <span className="text-xs">({resultado.totais.foraDoPeriodoQtd})</span>
                        </span>
                        <span className="shrink-0">{brl(resultado.totais.foraDoPeriodoCents)}</span>
                      </div>
                    )}
                    <p className="pt-1 text-xs text-muted-foreground">
                      Esse dinheiro existe, só não dá pra cobrar deste extrato: caixa de outra conta,
                      venda paga em mais de uma forma (o Shosp não diz quanto foi em cada uma), entrada
                      que não é venda, e o extrato esticado além do mês só para alcançar o repasse do
                      cartão. As vendas aparecem na lista abaixo para conferência na mão.
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
