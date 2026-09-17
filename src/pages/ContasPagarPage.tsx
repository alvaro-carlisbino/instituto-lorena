// CONTAS A PAGAR: o que a clínica deve, quando vence, e o que já foi pago.
//
// Redesenho de 14/set/2026. A tela antiga empilhava sete cartões numa coluna (SEFAZ, conciliação
// automática, importar XML, registrar nota, programar pagamento, lista de notas) ao lado de uma
// agenda em cartões soltos, e o painel de conciliação era o mesmo da tela de Conciliação. O
// financeiro não achava a conta vencida no meio dos formulários.
//
// Agora são quatro vistas sobre o mesmo dado, e os formulários viraram botões no topo:
//   A pagar             · a agenda, vencidas primeiro, com centro de custo, Vincular e apagar
//   Conferir com banco  · o que o sistema não ligou sozinho ao extrato
//   Pagas               · o que saiu, e se foi ligado ao extrato ou marcado à mão
//   Notas fiscais       · as notas de compra (SEFAZ, XML ou digitadas) e o que entrou no estoque
//
// "Vincular" não lança saída no banco conectado: procura o pagamento no extrato e liga os dois
// (ver PagarContaDialog). Lançar outra saída no Itaú contava o mesmo boleto duas vezes em Gastos.
//
// Na vista de notas, cada nota diz se entrou no estoque e, quando não entrou, por quê
// (crm_notas_estoque). Antes isso só aparecia abrindo nota por nota, e o financeiro não achou.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronDown, FileText, Link2, Paperclip, Plus, RefreshCw, RotateCcw, Search } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { CentroCustoPicker } from '@/components/financeiro/CentroCustoPicker'
import { ConferenciaBanco } from '@/components/financeiro/ConferenciaBanco'
import { ExcluirLancamento } from '@/components/financeiro/ExcluirLancamento'
import { ImportarNfe } from '@/components/financeiro/ImportarNfe'
import { NotasSefazPanel } from '@/components/financeiro/NotasSefazPanel'
import { PagarContaDialog } from '@/components/financeiro/PagarContaDialog'
import { ParcelaEditor } from '@/components/financeiro/ParcelaEditor'
import { VencimentoNaLinha } from '@/components/financeiro/VencimentoNaLinha'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchPicker } from '@/components/ui/search-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import { desfazerConciliacao } from '@/services/conciliacaoAuto'
import {
  type EstoqueDaNota,
  type InvoiceMovement,
  type Payable,
  type PurchaseInvoice,
  type StockItem,
  type Supplier,
  createPayables,
  createPurchaseInvoice,
  getAttachmentSignedUrl,
  listEstoqueDasNotas,
  listInvoiceMovements,
  listPayables,
  listPurchaseInvoices,
  listStockItems,
  listSuppliers,
  updatePayable,
} from '@/services/estoqueCompras'
import {
  type CostCenter,
  type FinAccount,
  type PagamentoLigado,
  listAccounts,
  listCostCenters,
  listPagamentosLigados,
} from '@/services/financeiro'

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '')
const parseBRL = (v: string) => Math.round((Number(v.replace(/\./g, '').replace(',', '.')) || 0) * 100)
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000)
}

function rotuloDoMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const t = new Date(y, (m ?? 1) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

type Vista = 'apagar' | 'conferir' | 'pagas' | 'notas'
type FiltroNotas = 'todas' | 'entrou' | 'fora'
type Recorte = 'todas' | 'vencidas' | 'semana' | 'mes'

const NOVA_CONTA = {
  supplier: null as Supplier | null,
  description: '',
  amount: '',
  firstDue: '',
  installments: '1',
  method: 'boleto',
  barcode: '',
  costCenter: '',
}
const NOVA_NOTA = { number: '', supplier: null as Supplier | null, issueDate: '', total: '' }

function Indicador({
  rotulo,
  valor,
  dica,
  ativo,
  tom,
  onClick,
}: {
  rotulo: string
  valor: string
  dica: string
  ativo: boolean
  tom?: 'ruim' | 'alerta'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40',
        ativo ? 'border-primary ring-1 ring-primary/40' : 'border-border',
      )}
    >
      <div className="text-xs font-medium text-muted-foreground">{rotulo}</div>
      <div
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tom === 'ruim' && 'text-red-600 dark:text-red-400',
          tom === 'alerta' && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {valor}
      </div>
      <div className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">{dica}</div>
    </button>
  )
}

/** Entrou no estoque? E quando não entrou, o motivo, que muda o que dá para fazer. */
const ESTOQUE_DA_NOTA: Record<EstoqueDaNota['situacao'], { rotulo: string; dica: string; tom: string }> = {
  entrou: {
    rotulo: 'no estoque',
    dica: 'Os produtos desta nota entraram no estoque. Abra a nota para ver quais.',
    tom: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400',
  },
  pendente: {
    rotulo: 'entrada pendente',
    dica: 'Já está no financeiro e a entrada no estoque roda sozinha com esta aba aberta. Atualize em instantes.',
    tom: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
  },
  resumo: {
    rotulo: 'só resumo da SEFAZ',
    dica: 'A SEFAZ mandou só o resumo, sem a lista de produtos. Para dar entrada, importe o XML da nota pelo botão Importar XML (o fornecedor ou o contador têm).',
    tom: 'text-muted-foreground',
  },
  nao_entrou: {
    rotulo: 'não entrou',
    dica: 'Tem a lista de produtos, mas não deu entrada no estoque: não era material (café, flores, serviço) ou ficou de fora porque já estava contado no inventário.',
    tom: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
  },
  sem_xml: {
    rotulo: 'sem XML',
    dica: 'Registrada à mão, sem XML: não tem lista de produtos para dar entrada.',
    tom: 'text-muted-foreground',
  },
}

export function ContasPagarPage() {
  const { tenant } = useTenant()
  const [payables, setPayables] = useState<Payable[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [centros, setCentros] = useState<CostCenter[]>([])
  const [ligados, setLigados] = useState<Map<string, PagamentoLigado>>(new Map())
  const [estoqueNotas, setEstoqueNotas] = useState<Map<string, EstoqueDaNota>>(new Map())
  const [filtroNotas, setFiltroNotas] = useState<FiltroNotas>('todas')
  const [loading, setLoading] = useState(false)

  const [vista, setVista] = useState<Vista>('apagar')
  const [recorte, setRecorte] = useState<Recorte>('todas')
  const [busca, setBusca] = useState('')
  const [abertaId, setAbertaId] = useState<string | null>(null)
  const [pagando, setPagando] = useState<Payable | null>(null)
  const [naFila, setNaFila] = useState(0)

  const [novaConta, setNovaConta] = useState<typeof NOVA_CONTA | null>(null)
  const [novaNota, setNovaNota] = useState<typeof NOVA_NOTA | null>(null)
  const [notaArquivo, setNotaArquivo] = useState<File | null>(null)
  const notaArquivoRef = useRef<HTMLInputElement | null>(null)
  const [salvando, setSalvando] = useState(false)

  const [notaAberta, setNotaAberta] = useState<string | null>(null)
  const [movimentos, setMovimentos] = useState<Record<string, InvoiceMovement[]>>({})
  // A ficha do item (estoque) linka a nota que comprou: /contas-a-pagar?nota=<id> abre ela aqui.
  const [params, setParams] = useSearchParams()

  /** `silencioso` recarrega sem trocar a lista por "Carregando…": a rolagem não pula. */
  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true)
    try {
      const [p, inv, sup, items, acc, cc, lig, est] = await Promise.all([
        listPayables(),
        listPurchaseInvoices(),
        listSuppliers(),
        listStockItems(true),
        listAccounts(),
        listCostCenters(),
        listPagamentosLigados().catch(() => new Map<string, PagamentoLigado>()),
        // Auxiliar: se falhar, a tela de contas não pode cair junto.
        listEstoqueDasNotas().catch(() => new Map<string, EstoqueDaNota>()),
      ])
      setPayables(p)
      setInvoices(inv)
      setSuppliers(sup)
      setStockItems(items)
      setAccounts(acc)
      setCentros(cc)
      setLigados(lig)
      setEstoqueNotas(est)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas a pagar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])

  const hoje = hojeLocal()
  const mesAtual = hoje.slice(0, 7)
  const em7 = (() => {
    const d = new Date(`${hoje}T12:00:00`)
    d.setDate(d.getDate() + 7)
    return diaLocal(d)
  })()

  const abertas = useMemo(() => payables.filter((p) => p.status === 'aberto'), [payables])
  const nomeDe = (p: Payable) => p.counterparty || p.supplierName || p.description

  const numeros = useMemo(() => {
    const soma = (xs: Payable[]) => xs.reduce((s, p) => s + p.amountCents, 0)
    const vencidas = abertas.filter((p) => p.dueDate < hoje)
    const semana = abertas.filter((p) => p.dueDate >= hoje && p.dueDate <= em7)
    const mes = abertas.filter((p) => p.dueDate >= hoje && p.dueDate.slice(0, 7) === mesAtual)
    const pagasMes = payables.filter((p) => p.status === 'pago' && (p.paidAt ?? '').slice(0, 7) === mesAtual)
    return {
      vencidas: { n: vencidas.length, cents: soma(vencidas) },
      semana: { n: semana.length, cents: soma(semana) },
      mes: { n: mes.length, cents: soma(mes) },
      pagasMes: { n: pagasMes.length, cents: soma(pagasMes) },
      aberto: { n: abertas.length, cents: soma(abertas) },
    }
  }, [abertas, payables, hoje, em7, mesAtual])

  const casaBusca = (p: Payable) => {
    const t = busca.trim().toLowerCase()
    if (!t) return true
    return `${nomeDe(p)} ${p.description} ${p.costCenter ?? ''} ${p.paymentMethod ?? ''}`.toLowerCase().includes(t)
  }

  // Agenda: vencidas, esta semana, e depois mês a mês. Cada grupo com o próprio total.
  const agenda = useMemo(() => {
    const base = abertas.filter((p) => {
      if (recorte === 'vencidas' && p.dueDate >= hoje) return false
      if (recorte === 'semana' && (p.dueDate < hoje || p.dueDate > em7)) return false
      if (recorte === 'mes' && (p.dueDate < hoje || p.dueDate.slice(0, 7) !== mesAtual)) return false
      return casaBusca(p)
    })
    const grupos = new Map<string, { rotulo: string; tom?: 'ruim'; itens: Payable[] }>()
    for (const p of base) {
      const k = p.dueDate < hoje ? '0' : p.dueDate <= em7 ? '1' : `2-${p.dueDate.slice(0, 7)}`
      const rotulo = k === '0' ? 'Vencidas' : k === '1' ? 'Próximos 7 dias' : rotuloDoMes(p.dueDate.slice(0, 7))
      const g = grupos.get(k) ?? { rotulo, tom: k === '0' ? ('ruim' as const) : undefined, itens: [] }
      g.itens.push(p)
      grupos.set(k, g)
    }
    return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abertas, recorte, busca, hoje, em7, mesAtual])

  const pagas = useMemo(
    () =>
      payables
        .filter((p) => p.status === 'pago' && casaBusca(p))
        .sort((a, b) => (b.paidAt ?? b.dueDate).localeCompare(a.paidAt ?? a.dueDate))
        .slice(0, 300),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payables, busca],
  )

  const parcelasPorNota = useMemo(() => {
    const m = new Map<string, Payable[]>()
    for (const p of payables) if (p.invoiceId) m.set(p.invoiceId, [...(m.get(p.invoiceId) ?? []), p])
    return m
  }, [payables])

  const entrouNoEstoque = (id: string) => estoqueNotas.get(id)?.situacao === 'entrou'

  const notas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return invoices.filter((i) => {
      if (filtroNotas === 'entrou' && !entrouNoEstoque(i.id)) return false
      if (filtroNotas === 'fora' && entrouNoEstoque(i.id)) return false
      return !t || `${i.number} ${i.supplierName ?? ''}`.toLowerCase().includes(t)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, busca, filtroNotas, estoqueNotas])

  const notasNoEstoque = useMemo(
    () => invoices.filter((i) => estoqueNotas.get(i.id)?.situacao === 'entrou').length,
    [invoices, estoqueNotas],
  )

  const abrirRecorte = (r: Recorte) => {
    setVista('apagar')
    setRecorte((atual) => (atual === r && vista === 'apagar' ? 'todas' : r))
  }

  const classificar = async (p: Payable, c: CostCenter) => {
    setPayables((xs) => xs.map((x) => (x.id === p.id ? { ...x, costCenter: c.name } : x)))
    try {
      await updatePayable(p.id, { costCenter: c.name, categoryId: c.categoryId })
      toast.success(`Classificada em ${c.name}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao classificar')
    }
    await load(true)
  }

  const salvarConta = async () => {
    if (!novaConta) return
    const valor = parseBRL(novaConta.amount)
    const descricao = novaConta.description.trim() || novaConta.supplier?.name || ''
    if (!descricao || !novaConta.firstDue || valor <= 0) {
      toast.error('Preencha fornecedor ou descrição, valor e primeiro vencimento.')
      return
    }
    setSalvando(true)
    try {
      const centro = centros.find((c) => c.name === novaConta.costCenter)
      await createPayables({
        description: descricao,
        supplierId: novaConta.supplier?.id ?? null,
        counterparty: novaConta.supplier?.name ?? null,
        amountCents: valor,
        firstDueDate: novaConta.firstDue,
        installments: Number(novaConta.installments) || 1,
        paymentMethod: novaConta.method,
        barcode: novaConta.barcode,
        costCenter: centro?.name ?? null,
        categoryId: centro?.categoryId ?? null,
      })
      toast.success('Conta a pagar criada.')
      setNovaConta(null)
      await load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar a conta')
    } finally {
      setSalvando(false)
    }
  }

  const salvarNota = async () => {
    if (!novaNota) return
    if (!novaNota.number.trim()) {
      toast.error('Informe o número da nota.')
      return
    }
    setSalvando(true)
    try {
      await createPurchaseInvoice({
        number: novaNota.number,
        supplierId: novaNota.supplier?.id ?? null,
        issueDate: novaNota.issueDate || null,
        totalCents: parseBRL(novaNota.total),
        file: notaArquivo,
      })
      toast.success(`NF ${novaNota.number.trim()} registrada.`)
      setNovaNota(null)
      setNotaArquivo(null)
      await load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar a nota')
    } finally {
      setSalvando(false)
    }
  }

  const abrirNota = async (id: string) => {
    if (notaAberta === id) {
      setNotaAberta(null)
      return
    }
    setNotaAberta(id)
    if (movimentos[id]) return
    try {
      const rows = await listInvoiceMovements(id)
      setMovimentos((m) => ({ ...m, [id]: rows }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a nota')
    }
  }

  useEffect(() => {
    const id = params.get('nota')
    if (!id || invoices.length === 0) return
    // Link de fora (ficha do item) consumido uma vez: limpa a URL e abre a nota.
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('nota')
        return next
      },
      { replace: true },
    )
    if (!invoices.some((i) => i.id === id)) {
      toast.error('Nota não encontrada neste polo.')
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVista('notas')
    setBusca('')
    setFiltroNotas('todas')
    setNotaAberta(null)
    void abrirNota(id)
    window.setTimeout(() => document.getElementById(`nota-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, params])

  const abrirAnexo = async (path: string) => {
    try {
      window.open(await getAttachmentSignedUrl(path), '_blank', 'noopener')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir anexo')
    }
  }

  const fornecedoresPicker = useMemo(
    () => suppliers.filter((s) => s.active).map((s) => ({ id: s.id, label: s.name, hint: s.cnpj ?? undefined })),
    [suppliers],
  )

  const quando = (p: Payable) => {
    const d = diasEntre(hoje, p.dueDate)
    if (d < 0) return { texto: `venceu há ${-d} ${-d === 1 ? 'dia' : 'dias'}`, tom: 'text-red-600 dark:text-red-400' }
    if (d === 0) return { texto: 'vence hoje', tom: 'text-amber-700 dark:text-amber-400' }
    return { texto: `em ${d} ${d === 1 ? 'dia' : 'dias'}`, tom: 'text-muted-foreground' }
  }

  return (
    <AppLayout
      title="Contas a pagar"
      subtitle="O que a clínica deve, quando vence e o que já foi pago."
      actions={
        <>
          <ImportarNfe stockItems={stockItems} suppliers={suppliers} onImportou={() => void load(true)} />
          <Button size="sm" onClick={() => setNovaConta({ ...NOVA_CONTA, firstDue: hoje })}>
            <Plus className="size-4" /> Nova conta
          </Button>
        </>
      }
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Vencidas"
          valor={brl(numeros.vencidas.cents)}
          dica={
            numeros.vencidas.n === 0
              ? 'Nada vencido em aberto.'
              : `${plural(numeros.vencidas.n, 'conta', 'contas')} sem pagamento no banco. Pagou com juros ou de outro jeito? Vincular na linha.`
          }
          tom={numeros.vencidas.n > 0 ? 'ruim' : undefined}
          ativo={vista === 'apagar' && recorte === 'vencidas'}
          onClick={() => abrirRecorte('vencidas')}
        />
        <Indicador
          rotulo="Vencem em 7 dias"
          valor={brl(numeros.semana.cents)}
          dica={`${plural(numeros.semana.n, 'conta', 'contas')} até ${dia(em7)}`}
          tom={numeros.semana.n > 0 ? 'alerta' : undefined}
          ativo={vista === 'apagar' && recorte === 'semana'}
          onClick={() => abrirRecorte('semana')}
        />
        <Indicador
          rotulo="A vencer neste mês"
          valor={brl(numeros.mes.cents)}
          dica={`${plural(numeros.mes.n, 'conta', 'contas')} de hoje até o fim do mês`}
          ativo={vista === 'apagar' && recorte === 'mes'}
          onClick={() => abrirRecorte('mes')}
        />
        <Indicador
          rotulo="Pagas neste mês"
          valor={brl(numeros.pagasMes.cents)}
          dica={`${plural(numeros.pagasMes.n, 'conta', 'contas')}`}
          ativo={vista === 'pagas'}
          onClick={() => setVista('pagas')}
        />
      </div>

      {naFila > 0 && vista !== 'conferir' && (
        <button
          type="button"
          onClick={() => setVista('conferir')}
          className="mb-3 w-full rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-left text-xs"
        >
          <span className="font-medium">
            {plural(naFila, 'conta espera', 'contas esperam')} você confirmar o pagamento no extrato.
          </span>{' '}
          O sistema achou o pagamento provável e não decidiu sozinho. <span className="underline">Conferir</span>
        </button>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label="Vista">
          {(
            [
              ['apagar', `A pagar (${numeros.aberto.n})`],
              ['conferir', `Conferir com o banco${naFila ? ` (${naFila})` : ''}`],
              ['pagas', 'Pagas'],
              ['notas', `Notas fiscais (${invoices.length})`],
            ] as Array<[Vista, string]>
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              aria-pressed={vista === v}
              onClick={() => setVista(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                vista === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
        {vista !== 'conferir' && (
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={vista === 'notas' ? 'Buscar número ou fornecedor…' : 'Buscar fornecedor, nota, centro…'}
              className="h-9 pl-9"
            />
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </Button>
      </div>

      {vista === 'apagar' && recorte !== 'todas' && (
        <div className="mb-2 text-xs text-muted-foreground">
          Mostrando só{' '}
          {recorte === 'vencidas' ? 'as vencidas' : recorte === 'semana' ? 'os próximos 7 dias' : 'o que vence neste mês'}.{' '}
          <button type="button" className="underline" onClick={() => setRecorte('todas')}>
            Ver todas
          </button>
        </div>
      )}

      {/* A conferência fica montada mesmo em outra vista: é ela que conta a fila do aviso acima. */}
      <div hidden={vista !== 'conferir'}>
        <Card>
          <CardContent className="p-3">
            <ConferenciaBanco onMudou={() => void load(true)} onContagem={setNaFila} />
          </CardContent>
        </Card>
      </div>

      {vista === 'apagar' && (
        <Card>
          <CardContent className="p-0">
            {loading && payables.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
            ) : agenda.length === 0 ? (
              <EmptyState title="Nada em aberto" description="Quando uma nota chegar pela SEFAZ ou você criar uma conta, ela aparece aqui." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-32 px-3 py-2 text-left font-medium">Vencimento</th>
                      <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                      <th className="w-52 px-3 py-2 text-left font-medium">Centro de custo</th>
                      <th className="w-32 px-3 py-2 text-right font-medium">Valor</th>
                      <th className="w-32 px-3 py-2" />
                    </tr>
                  </thead>
                  {agenda.map((g) => (
                    <tbody key={g.rotulo}>
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={3} className={cn('px-3 py-1.5 text-xs font-semibold', g.tom === 'ruim' && 'text-red-600 dark:text-red-400')}>
                          {g.rotulo} · {plural(g.itens.length, 'conta', 'contas')}
                        </td>
                        <td className={cn('px-3 py-1.5 text-right text-xs font-semibold tabular-nums', g.tom === 'ruim' && 'text-red-600 dark:text-red-400')}>
                          {brl(g.itens.reduce((s, p) => s + p.amountCents, 0))}
                        </td>
                        <td />
                      </tr>
                      {g.itens.map((p) => {
                        const aberta = abertaId === p.id
                        const q = quando(p)
                        const nome = nomeDe(p)
                        return (
                          <Fragment key={p.id}>
                            <tr
                              className={cn('cursor-pointer border-t border-border/60 hover:bg-muted/30', aberta && 'bg-muted/30')}
                              onClick={() => setAbertaId(aberta ? null : p.id)}
                            >
                              <td className="px-3 py-2">
                                <VencimentoNaLinha
                                  id={p.id}
                                  vencimento={p.dueDate}
                                  onSalvo={(novo) => {
                                    if (aberta) setAbertaId(null)
                                    setPayables((xs) => xs.map((x) => (x.id === p.id ? { ...x, dueDate: novo } : x)))
                                    toast.success(`Vencimento mudado para ${dia(novo)}.`)
                                    void load(true)
                                  }}
                                />
                                <div className={cn('text-xs', q.tom)}>{q.texto}</div>
                              </td>
                              <td className="max-w-[380px] px-3 py-2">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate font-medium" title={nome}>
                                    {nome}
                                  </span>
                                  {p.invoiceId ? (
                                    <Badge variant="outline" className="shrink-0 text-[0.65rem]">
                                      nota
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="truncate text-xs text-muted-foreground" title={p.description}>
                                  {[p.description !== nome ? p.description : null, p.paymentMethod].filter(Boolean).join(' · ')}
                                </div>
                              </td>
                              <td className="px-3 py-1.5">
                                <CentroCustoPicker
                                  size="sm"
                                  className="w-full max-w-[200px]"
                                  centros={centros}
                                  value={p.costCenter}
                                  resumo={{ descricao: nome, data: p.dueDate, amountCents: p.amountCents }}
                                  onPick={(c) => classificar(p, c)}
                                />
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{brl(p.amountCents)}</td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7"
                                    onClick={() => setPagando(p)}
                                    title="Vincular ao pagamento no extrato, mesmo com juros, ou marcar como paga"
                                  >
                                    <Link2 className="size-3.5" /> Vincular
                                  </Button>
                                  <ExcluirLancamento
                                    variante="icone"
                                    origem="a pagar"
                                    id={p.id}
                                    resumo={`${nome} · vence ${dia(p.dueDate)} · ${brl(p.amountCents)}`}
                                    onExcluido={() => void load(true)}
                                  />
                                </div>
                              </td>
                            </tr>
                            {aberta && (
                              <tr className="border-t border-border/60 bg-muted/10">
                                <td colSpan={5} className="px-3 py-2">
                                  <ParcelaEditor
                                    parcela={p}
                                    centros={centros}
                                    onSalvo={() => {
                                      setAbertaId(null)
                                      void load(true)
                                    }}
                                    onCancelar={() => setAbertaId(null)}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {vista === 'pagas' && (
        <Card>
          <CardContent className="p-0">
            {pagas.length === 0 ? (
              <EmptyState title="Nada pago ainda" description="" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-28 px-3 py-2 text-left font-medium">Pago em</th>
                      <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                      <th className="px-3 py-2 text-left font-medium">Como</th>
                      <th className="w-32 px-3 py-2 text-right font-medium">Valor</th>
                      <th className="w-28 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pagas.map((p) => {
                      const lig = ligados.get(p.id)
                      return (
                        <tr key={p.id} className="border-t border-border/60">
                          <td className="px-3 py-2 tabular-nums">{dia(lig?.data ?? p.paidAt ?? p.dueDate)}</td>
                          <td className="max-w-[340px] px-3 py-2">
                            <div className="truncate font-medium">{nomeDe(p)}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              vencia {dia(p.dueDate)}
                              {p.costCenter ? ` · ${p.costCenter}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {lig ? (
                              <>
                                <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400">
                                  ligada ao extrato
                                </Badge>
                                <div className="mt-0.5 truncate text-muted-foreground" title={lig.descricao}>
                                  {lig.descricao}
                                </div>
                              </>
                            ) : (
                              <Badge variant="outline">marcada à mão</Badge>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{brl(p.amountCents)}</td>
                          <td className="px-2 py-2 text-right">
                            {lig ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7"
                                onClick={async () => {
                                  try {
                                    await desfazerConciliacao(p.id)
                                    toast.success('Voltou para em aberto.')
                                    await load(true)
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : 'Falha ao desfazer')
                                  }
                                }}
                              >
                                <RotateCcw className="size-3.5" /> Desfazer
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {vista === 'notas' && (
        <div className="space-y-3">
          <NotasSefazPanel onImportou={() => void load(true)} />
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['todas', 'Todas', invoices.length],
                      ['entrou', 'Entraram no estoque', notasNoEstoque],
                      ['fora', 'Não entraram', invoices.length - notasNoEstoque],
                    ] as Array<[FiltroNotas, string, number]>
                  ).map(([f, rotulo, n]) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filtroNotas === f}
                      onClick={() => setFiltroNotas(f)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        filtroNotas === f
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {rotulo} <span className="tabular-nums opacity-70">{n}</span>
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setNovaNota({ ...NOVA_NOTA })}>
                  <FileText className="size-3.5" /> Registrar nota sem XML
                </Button>
              </div>
              {notas.length === 0 ? (
                <EmptyState title="Nenhuma nota" description="" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted/40 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="w-28 px-3 py-2 text-left font-medium">Emissão</th>
                        <th className="px-3 py-2 text-left font-medium">Nota e fornecedor</th>
                        <th className="px-3 py-2 text-left font-medium">Contas a pagar</th>
                        <th className="px-3 py-2 text-left font-medium">Estoque</th>
                        <th className="w-32 px-3 py-2 text-right font-medium">Total</th>
                        <th className="w-12 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {notas.map((inv) => {
                        const parc = parcelasPorNota.get(inv.id) ?? []
                        const abertasDaNota = parc.filter((p) => p.status === 'aberto').length
                        const aberta = notaAberta === inv.id
                        const movs = movimentos[inv.id]
                        const est = estoqueNotas.get(inv.id)
                        const selo = est ? ESTOQUE_DA_NOTA[est.situacao] : null
                        return (
                          <Fragment key={inv.id}>
                            <tr
                              id={`nota-${inv.id}`}
                              className={cn('cursor-pointer border-t border-border/60 hover:bg-muted/30', aberta && 'bg-muted/30')}
                              onClick={() => void abrirNota(inv.id)}
                            >
                              <td className="px-3 py-2 tabular-nums">{dia(inv.issueDate)}</td>
                              <td className="max-w-[360px] px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', aberta && 'rotate-180')} />
                                  <span className="font-medium">NF {inv.number}</span>
                                </div>
                                <div className="truncate pl-5 text-xs text-muted-foreground">{inv.supplierName ?? 'Sem fornecedor'}</div>
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {parc.length === 0 ? (
                                  <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                                    sem conta a pagar
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">
                                    {plural(parc.length, 'parcela', 'parcelas')}
                                    {abertasDaNota > 0 ? `, ${abertasDaNota} em aberto` : ', todas resolvidas'}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {selo ? (
                                  <Badge variant="outline" className={cn('whitespace-nowrap', selo.tom)} title={selo.dica}>
                                    {selo.rotulo}
                                    {est?.situacao === 'entrou' ? ` · ${plural(est.itens, 'produto', 'produtos')}` : ''}
                                  </Badge>
                                ) : null}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{brl(inv.totalCents)}</td>
                              <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                {inv.storagePath ? (
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => void abrirAnexo(inv.storagePath!)}
                                    aria-label={`Abrir anexo da NF ${inv.number}`}
                                  >
                                    <Paperclip className="size-3.5" />
                                  </Button>
                                ) : null}
                              </td>
                            </tr>
                            {aberta && (
                              <tr className="border-t border-border/60 bg-muted/10 text-xs">
                                <td colSpan={6} className="px-3 py-2">
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                      <div className="mb-1 font-semibold">Entrou no estoque</div>
                                      {!movs ? (
                                        <p className="text-muted-foreground">Carregando…</p>
                                      ) : movs.length === 0 ? (
                                        <p className="text-muted-foreground">
                                          Nenhuma entrada de estoque desta nota.{' '}
                                          {selo && est?.situacao !== 'entrou' ? selo.dica : ''}
                                        </p>
                                      ) : (
                                        <ul className="space-y-0.5">
                                          {movs.map((m) => (
                                            <li key={m.id} className="flex justify-between gap-2">
                                              <Link to={`/estoque/item/${m.itemId}`} className="truncate hover:underline" title="Ficha do item: lotes, setor e para onde foi">
                                                {m.itemName}
                                              </Link>
                                              <span className="shrink-0 text-muted-foreground">
                                                {m.qtyDelta} {m.unit}
                                                {m.unitCostCents != null ? ` · ${brl(m.unitCostCents)}/un` : ''}
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                    <div>
                                      <div className="mb-1 font-semibold">Parcelas</div>
                                      {parc.length === 0 ? (
                                        <p className="text-muted-foreground">
                                          Sem conta a pagar: esta compra não está no financeiro.
                                        </p>
                                      ) : (
                                        <ul className="space-y-0.5">
                                          {parc.map((p) => (
                                            <li key={p.id} className="flex justify-between gap-2">
                                              <span>vence {dia(p.dueDate)}</span>
                                              <span className="text-muted-foreground">
                                                {brl(p.amountCents)} · {p.status === 'aberto' ? 'em aberto' : p.status === 'pago' ? 'paga' : 'apagada'}
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <PagarContaDialog
        key={pagando?.id ?? 'nenhuma'}
        parcela={pagando}
        contas={accounts}
        onFechar={() => setPagando(null)}
        onPago={() => {
          setPagando(null)
          void load(true)
        }}
      />

      <Dialog open={novaConta != null} onOpenChange={(o) => (!o ? setNovaConta(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova conta a pagar</DialogTitle>
            <DialogDescription>Boleto, parcela ou compromisso que ainda vai sair. Nota da SEFAZ entra sozinha.</DialogDescription>
          </DialogHeader>
          {novaConta && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label>Fornecedor</Label>
                <SearchPicker
                  items={fornecedoresPicker}
                  value={novaConta.supplier ? { id: novaConta.supplier.id, label: novaConta.supplier.name } : null}
                  onPick={(it) => setNovaConta((f) => (f ? { ...f, supplier: suppliers.find((s) => s.id === it.id) ?? null } : f))}
                  onClear={() => setNovaConta((f) => (f ? { ...f, supplier: null } : f))}
                  placeholder="Escolher fornecedor (opcional)"
                  title="Fornecedor"
                  searchPlaceholder="Nome ou CNPJ…"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Input
                  value={novaConta.description}
                  onChange={(e) => setNovaConta((f) => (f ? { ...f, description: e.target.value } : f))}
                  placeholder="Ex.: aluguel de setembro, boleto do equipamento"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Valor da parcela</Label>
                  <Input
                    value={novaConta.amount}
                    inputMode="decimal"
                    placeholder="0,00"
                    onChange={(e) => setNovaConta((f) => (f ? { ...f, amount: e.target.value } : f))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>1º vencimento</Label>
                  <Input
                    type="date"
                    value={novaConta.firstDue}
                    onChange={(e) => setNovaConta((f) => (f ? { ...f, firstDue: e.target.value } : f))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Parcelas</Label>
                  <Input
                    value={novaConta.installments}
                    inputMode="numeric"
                    onChange={(e) => setNovaConta((f) => (f ? { ...f, installments: e.target.value } : f))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Centro de custo</Label>
                <CentroCustoPicker
                  className="w-full"
                  centros={centros}
                  value={novaConta.costCenter || null}
                  onPick={(c) => setNovaConta((f) => (f ? { ...f, costCenter: c.name } : f))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Forma</Label>
                  <Select value={novaConta.method} onValueChange={(v) => setNovaConta((f) => (f ? { ...f, method: v ?? 'boleto' } : f))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        ['boleto', 'Boleto'],
                        ['pix', 'PIX'],
                        ['cartao', 'Cartão'],
                        ['transferencia', 'Transferência'],
                        ['dinheiro', 'Dinheiro'],
                      ].map(([v, r]) => (
                        <SelectItem key={v} value={v}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Linha digitável</Label>
                  <Input
                    value={novaConta.barcode}
                    placeholder="Opcional"
                    onChange={(e) => setNovaConta((f) => (f ? { ...f, barcode: e.target.value } : f))}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaConta(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={() => void salvarConta()} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Criar conta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={novaNota != null} onOpenChange={(o) => (!o ? setNovaNota(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar nota sem XML</DialogTitle>
            <DialogDescription>Para nota em papel ou PDF. Com o XML, use Importar XML, que já dá entrada no estoque.</DialogDescription>
          </DialogHeader>
          {novaNota && (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Número</Label>
                  <Input value={novaNota.number} onChange={(e) => setNovaNota((f) => (f ? { ...f, number: e.target.value } : f))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Emissão</Label>
                  <Input
                    type="date"
                    value={novaNota.issueDate}
                    onChange={(e) => setNovaNota((f) => (f ? { ...f, issueDate: e.target.value } : f))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Fornecedor</Label>
                <SearchPicker
                  items={fornecedoresPicker}
                  value={novaNota.supplier ? { id: novaNota.supplier.id, label: novaNota.supplier.name } : null}
                  onPick={(it) => setNovaNota((f) => (f ? { ...f, supplier: suppliers.find((s) => s.id === it.id) ?? null } : f))}
                  placeholder="Escolher fornecedor (opcional)"
                  title="Fornecedor"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Total (R$)</Label>
                  <Input
                    value={novaNota.total}
                    inputMode="decimal"
                    placeholder="0,00"
                    onChange={(e) => setNovaNota((f) => (f ? { ...f, total: e.target.value } : f))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Anexo</Label>
                  <Input
                    ref={notaArquivoRef}
                    type="file"
                    accept=".pdf,.xml,image/*"
                    onChange={(e) => setNotaArquivo(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaNota(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={() => void salvarNota()} disabled={salvando}>
              {salvando ? 'Registrando…' : 'Registrar nota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
