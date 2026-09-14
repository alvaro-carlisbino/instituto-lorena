// GASTOS E CONTROLE: quanto saiu, onde foi gasto, e o que ainda falta dizer o que é.
//
// Redesenho de 14/set/2026, para a reunião de gastos com o Dr. A tela antiga somava num número
// só quatro coisas diferentes: gasto de verdade, transferência entre contas próprias,
// lançamento que o Open Finance gravou duas vezes e nota de
// fornecedor que o banco nunca mostrou paga. Cada uma agora tem o seu número, e cada número é um
// botão que abre as linhas dele.
//
// Duas vistas sobre as MESMAS linhas:
//   Por centro de custo · para ler: centro → quem recebeu (somado) → cada pagamento
//   Lançamentos         · para trabalhar: classificar o que falta, conferir nota e repetido
//
// Classificar é UMA pergunta, centro de custo, com o mesmo seletor do Extrato. A categoria do
// DRE é derivada do centro no banco. Ver a migration 20260914200000.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownWideNarrow, CalendarDays, Plus, RefreshCw, Search, Upload } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CentroCustoPicker } from '@/components/financeiro/CentroCustoPicker'
import { centroForaDoTotal } from '@/lib/centroCusto'
import { GastosPorCentro, type LinhaGasto } from '@/components/financeiro/GastosPorCentro'
import { ExcluirLancamento } from '@/components/financeiro/ExcluirLancamento'
import { SaidaEditor } from '@/components/financeiro/SaidaEditor'
import { useTenant } from '@/context/TenantContext'
import { hojeLocal } from '@/lib/diaLocal'
import { padraoDaRegra } from '@/lib/extratoPadrao'
import { mesAtual, periodoDoMes, type Periodo } from '@/lib/periodo'
import { cn } from '@/lib/utils'
import { createGastoManual, importGastosRows, parseGastosSpreadsheet } from '@/services/gastosControle'
import { updatePayable } from '@/services/estoqueCompras'
import {
  classificarSaida,
  desfazerExclusao,
  listCategories,
  listCostCenters,
  listLancamentosExcluidos,
  listSaidasTudo,
  type CostCenter,
  type FinCategory,
  type LancamentoExcluido,
  type SaidaTudo,
} from '@/services/financeiro'

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '')

type Filtro = 'todos' | 'sem_centro' | 'notas' | 'fora' | 'repetidos'
type Vista = 'centros' | 'lancamentos'

const EMPTY_FORM = {
  date: hojeLocal(),
  counterparty: '',
  paymentMethod: 'PIX - Pagamentos Instantâneos',
  costCenter: '',
  subcategory: '',
  amount: '',
  markPaid: true,
}

/** Nota do fornecedor que chegou e o banco ainda não mostrou paga. */
const ehNotaAberta = (r: SaidaTudo) => r.origem === 'a pagar' && r.status !== 'pago'

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
  tom?: 'alerta' | 'neutro'
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
          tom === 'alerta' && 'text-amber-700 dark:text-amber-400',
          tom === 'neutro' && 'text-muted-foreground',
        )}
      >
        {valor}
      </div>
      <div className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">{dica}</div>
    </button>
  )
}

export function GastosControlePage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const [rows, setRows] = useState<SaidaTudo[]>([])
  const [centros, setCentros] = useState<CostCenter[]>([])
  const [categorias, setCategorias] = useState<FinCategory[]>([])
  const [excluidos, setExcluidos] = useState<LancamentoExcluido[]>([])
  const [verExcluidos, setVerExcluidos] = useState(false)
  const [vista, setVista] = useState<Vista>('centros')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [ordem, setOrdem] = useState<'data' | 'valor'>('data')
  const [q, setQ] = useState('')
  /** Linha aberta pra edição, na mesma chave da tabela: origem + id. */
  const [abertoId, setAbertoId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [openForm, setOpenForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)

  /** `silencioso` recarrega sem trocar a tabela por "Carregando…": classificar não pode pular a rolagem. */
  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true)
    try {
      const [todas, cc, cats, ex] = await Promise.all([
        listSaidasTudo(periodo.de, periodo.ate),
        listCostCenters(),
        listCategories('despesa'),
        // Lista auxiliar: se falhar, a tela principal não pode cair junto.
        listLancamentosExcluidos().catch(() => [] as LancamentoExcluido[]),
      ])
      setRows(todas)
      setCentros(cc)
      setCategorias(cats)
      setExcluidos(ex)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar gastos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.de, periodo.ate])

  const foraDoTotal = (r: SaidaTudo) => r.naoEGasto || centroForaDoTotal(centros, r.centroCusto)

  // Lançamentos do banco IGUAIS (dia, descrição e valor): cada grupo com mais de um tem cópia a
  // apagar. Vale para qualquer origem da cópia, não só a pendente do Open Finance: em setembro a
  // mesma conta de luz apareceu três vezes no mesmo dia.
  const copias = useMemo(() => {
    const grupos = new Map<string, SaidaTudo[]>()
    for (const r of rows) {
      if (r.origem !== 'banco') continue
      const k = `${r.data}|${r.descricao}|${r.amountCents}`
      grupos.set(k, [...(grupos.get(k) ?? []), r])
    }
    const ids = new Set<string>()
    let extras = 0
    let extrasCents = 0
    for (const g of grupos.values()) {
      if (g.length < 2) continue
      for (const r of g) ids.add(r.id)
      extras += g.length - 1
      extrasCents += (g.length - 1) * g[0].amountCents
    }
    return { ids, extras, extrasCents }
  }, [rows])
  const temCopia = (r: SaidaTudo) => r.origem === 'banco' && copias.ids.has(r.id)

  const numeros = useMemo(() => {
    const soma = (xs: SaidaTudo[]) => xs.reduce((s, r) => s + r.amountCents, 0)
    const gasto = rows.filter((r) => !foraDoTotal(r))
    const semCentro = gasto.filter((r) => !r.centroCusto)
    const notas = rows.filter(ehNotaAberta)
    const hoje = hojeLocal()
    const notasVencidas = notas.filter((r) => r.data <= hoje)
    const fora = rows.filter(foraDoTotal)
    const repetidos = rows.filter((r) => temCopia(r))
    return {
      gasto: { n: gasto.length, cents: soma(gasto) },
      semCentro: { n: semCentro.length, cents: soma(semCentro) },
      notas: { n: notas.length, cents: soma(notas) },
      notasVencidas: { n: notasVencidas.length, cents: soma(notasVencidas) },
      fora: { n: fora.length, cents: soma(fora) },
      repetidos: { n: repetidos.length, cents: copias.extrasCents, extras: copias.extras },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, centros, copias])

  const linhasCentro = useMemo<LinhaGasto[]>(
    () =>
      rows.map((r) => ({
        id: `${r.origem}-${r.id}`,
        refId: r.id,
        origem: r.origem,
        data: r.data,
        nome: r.contraparte || r.descricao,
        descricao: r.descricao,
        amountCents: r.amountCents,
        centro: r.centroCusto,
        foraDoTotal: foraDoTotal(r),
        nota: ehNotaAberta(r),
        possivelDuplicado: temCopia(r),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, centros],
  )

  const visiveis = useMemo(() => {
    const termo = q.trim().toLowerCase()
    const base = rows.filter((r) => {
      if (filtro === 'sem_centro' && (r.centroCusto || foraDoTotal(r))) return false
      if (filtro === 'notas' && !ehNotaAberta(r)) return false
      if (filtro === 'fora' && !foraDoTotal(r)) return false
      if (filtro === 'repetidos' && !temCopia(r)) return false
      if (!termo) return true
      return (
        r.descricao.toLowerCase().includes(termo) ||
        r.contraparte.toLowerCase().includes(termo) ||
        (r.centroCusto ?? '').toLowerCase().includes(termo)
      )
    })
    return ordem === 'valor' ? [...base].sort((a, b) => b.amountCents - a.amountCents) : base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filtro, q, ordem, centros, copias])

  const abrirFiltro = (f: Filtro) => {
    setFiltro((atual) => (atual === f && vista === 'lancamentos' ? 'todos' : f))
    setVista('lancamentos')
  }

  const classificar = async (r: SaidaTudo, c: CostCenter, aplicarIguais: boolean, padraoGrupo?: string | null) => {
    // Otimista: a linha muda na hora; a recarga silenciosa traz os iguais que a regra carimbou.
    setRows((xs) => xs.map((x) => (x.origem === r.origem && x.id === r.id ? { ...x, centroCusto: c.name } : x)))
    try {
      if (r.origem === 'banco') {
        const padrao = aplicarIguais ? (padraoGrupo ?? padraoDaRegra(r.descricao || r.contraparte)) : null
        const n = await classificarSaida(r.id, c.name, padrao)
        toast.success(n > 0 ? `${c.name}: este e mais ${n} lançamento(s) iguais.` : `Classificado em ${c.name}.`)
      } else {
        await updatePayable(r.id, { costCenter: c.name, categoryId: c.categoryId })
        toast.success(`Classificado em ${c.name}.`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao classificar')
    }
    await load(true)
  }

  const handleImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    try {
      const parsed = await parseGastosSpreadsheet(file)
      if (parsed.length === 0) {
        toast.error('Nenhuma linha válida encontrada na planilha.')
        return
      }
      const { inserted, skipped } = await importGastosRows(parsed, { markPaid: true })
      toast.success(`Importados ${inserted} gasto(s)${skipped ? ` · ${skipped} já existiam` : ''}.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar planilha')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleSave = async () => {
    const amountCents = Math.round(
      (Number(String(form.amount).replace(/\./g, '').replace(',', '.')) || 0) * 100,
    )
    if (!form.date || !form.counterparty.trim() || !form.costCenter.trim() || amountCents <= 0) {
      toast.error('Preencha data, quem recebeu, centro de custo e valor.')
      return
    }
    setSaving(true)
    try {
      await createGastoManual({
        date: form.date,
        counterparty: form.counterparty,
        paymentMethod: form.paymentMethod,
        costCenter: form.costCenter,
        subcategory: form.subcategory,
        amountCents,
        markPaid: form.markPaid,
      })
      toast.success('Gasto lançado.')
      setOpenForm(false)
      setForm({ ...EMPTY_FORM })
      await load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout
      title="Gastos e controle"
      subtitle="Quanto saiu, onde foi gasto e o que ainda falta classificar."
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => void handleImport(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" size="sm" disabled={importing} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> {importing ? 'Importando…' : 'Importar planilha'}
          </Button>
          <Button size="sm" onClick={() => setOpenForm(true)}>
            <Plus size={14} /> Novo gasto
          </Button>
        </>
      }
    >
      <FinanceTabs isSalesPolo={isSalesPolo} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </Button>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Gasto no período"
          valor={brl(numeros.gasto.cents)}
          dica={`${numeros.gasto.n} lançamentos, sem transferências e aplicações`}
          ativo={vista === 'lancamentos' && filtro === 'todos'}
          onClick={() => {
            setFiltro('todos')
            setVista('lancamentos')
          }}
        />
        <Indicador
          rotulo="Falta classificar"
          valor={brl(numeros.semCentro.cents)}
          dica={
            numeros.semCentro.n === 0
              ? 'Tudo tem centro de custo.'
              : `${numeros.semCentro.n} sem centro de custo. Enquanto houver, a divisão por centro é parcial.`
          }
          tom={numeros.semCentro.n > 0 ? 'alerta' : undefined}
          ativo={vista === 'lancamentos' && filtro === 'sem_centro'}
          onClick={() => abrirFiltro('sem_centro')}
        />
        <Indicador
          rotulo="Notas sem pagamento no banco"
          valor={brl(numeros.notas.cents)}
          dica={`${numeros.notasVencidas.n} vencidas (${brl(numeros.notasVencidas.cents)}) e ${
            numeros.notas.n - numeros.notasVencidas.n
          } a vencer. Nota que não foi compra se exclui no detalhe da linha.`}
          ativo={vista === 'lancamentos' && filtro === 'notas'}
          onClick={() => abrirFiltro('notas')}
        />
        <Indicador
          rotulo="Fora do total"
          valor={brl(numeros.fora.cents)}
          dica={`${numeros.fora.n} transferências entre contas e aplicações. Saiu da conta, não é gasto.`}
          tom="neutro"
          ativo={vista === 'lancamentos' && filtro === 'fora'}
          onClick={() => abrirFiltro('fora')}
        />
      </div>

      {numeros.repetidos.n > 0 && (
        <button
          type="button"
          onClick={() => abrirFiltro('repetidos')}
          className="mb-3 w-full rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-left text-xs"
        >
          <span className="font-medium">
            {numeros.repetidos.extras} lançamento(s) do banco aparecem repetidos ({brl(numeros.repetidos.cents)} a mais).
          </span>{' '}
          Mesmo dia, valor e descrição. Estão somados no total até alguém conferir: se for cópia, apague na lixeira da
          linha. <span className="underline">Ver quais</span>
        </button>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label="Vista">
          {(
            [
              ['centros', 'Por centro de custo'],
              ['lancamentos', `Lançamentos (${rows.length})`],
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

        {vista === 'lancamentos' && (
          <>
            <div className="relative min-w-[200px] flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar quem recebeu, nota, centro…"
                className="h-9 pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOrdem((o) => (o === 'data' ? 'valor' : 'data'))}
              title="Trocar a ordem"
            >
              {ordem === 'data' ? <CalendarDays size={14} /> : <ArrowDownWideNarrow size={14} />}
              {ordem === 'data' ? 'Mais recentes' : 'Maiores valores'}
            </Button>
          </>
        )}
      </div>

      {vista === 'lancamentos' && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(
            [
              ['todos', 'Todos', rows.length],
              ['sem_centro', 'Falta classificar', numeros.semCentro.n],
              ['notas', 'Notas sem pagamento', numeros.notas.n],
              ['fora', 'Fora do total', numeros.fora.n],
              ...(numeros.repetidos.n > 0 ? [['repetidos', 'Repetidos?', numeros.repetidos.n]] : []),
            ] as Array<[Filtro, string, number]>
          ).map(([f, rotulo, n]) => (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => setFiltro(f)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                filtro === f
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {rotulo} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className={cn(vista === 'lancamentos' ? 'p-0' : 'p-3')}>
          {loading && rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
          ) : vista === 'centros' ? (
            <GastosPorCentro
              linhas={linhasCentro}
              centros={centros}
              vazio="Nada saiu neste período."
              onClassificar={async (l, c, aplicarIguais, padrao) => {
                const r = rows.find((x) => x.origem === l.origem && x.id === l.refId)
                if (r) await classificar(r, c, aplicarIguais, padrao)
              }}
            />
          ) : visiveis.length === 0 ? (
            <EmptyState
              title={filtro === 'sem_centro' ? 'Tudo classificado' : 'Nada neste filtro'}
              description={filtro === 'sem_centro' ? 'Todo gasto do período tem centro de custo.' : ''}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-24 px-3 py-2 text-left font-medium">Data</th>
                    <th className="px-3 py-2 text-left font-medium">Quem recebeu</th>
                    <th className="w-52 px-3 py-2 text-left font-medium">Centro de custo</th>
                    <th className="w-32 px-3 py-2 text-right font-medium">Valor</th>
                    <th className="w-10 px-1 py-2">
                      <span className="sr-only">Apagar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r) => {
                    const chave = `${r.origem}-${r.id}`
                    const aberto = abertoId === chave
                    const fora = foraDoTotal(r)
                    const nome = r.contraparte || r.descricao
                    return (
                      <Fragment key={chave}>
                        <tr
                          className={cn(
                            'cursor-pointer border-t border-border/60 hover:bg-muted/30',
                            aberto && 'bg-muted/30',
                            fora && 'text-muted-foreground',
                          )}
                          onClick={() => setAbertoId(aberto ? null : chave)}
                        >
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dia(r.data)}</td>
                          <td className="max-w-[360px] px-3 py-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium" title={nome}>
                                {nome}
                              </span>
                              {ehNotaAberta(r) ? (
                                <Badge variant="outline" className="shrink-0 text-[0.65rem]">
                                  {r.data > hojeLocal() ? `nota vence ${dia(r.data).slice(0, 5)}` : 'nota sem pagamento no banco'}
                                </Badge>
                              ) : r.origem === 'a pagar' ? (
                                <Badge variant="outline" className="shrink-0 text-[0.65rem]">
                                  lançado à mão
                                </Badge>
                              ) : null}
                              {temCopia(r) ? (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-amber-500/60 text-[0.65rem] text-amber-700 dark:text-amber-400"
                                >
                                  repetido?
                                </Badge>
                              ) : null}
                            </div>
                            {r.descricao && r.descricao !== nome ? (
                              <div className="truncate text-xs text-muted-foreground" title={r.descricao}>
                                {r.descricao}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5">
                            <CentroCustoPicker
                              size="sm"
                              className="w-full max-w-[200px]"
                              centros={centros}
                              value={r.centroCusto}
                              resumo={{ descricao: nome, data: r.data, amountCents: r.amountCents }}
                              permitirIguais={r.origem === 'banco'}
                              padrao={r.origem === 'banco' ? padraoDaRegra(r.descricao || r.contraparte) : null}
                              excluirId={r.id}
                              onPick={(c, { aplicarIguais }) => classificar(r, c, aplicarIguais)}
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                            {brl(r.amountCents)}
                          </td>
                          <td className="px-1 py-1.5 text-center">
                            <ExcluirLancamento
                              variante="icone"
                              origem={r.origem}
                              id={r.id}
                              temCopia={temCopia(r)}
                              resumo={`${nome} · ${dia(r.data)} · ${brl(r.amountCents)}`}
                              centros={centros}
                              onTirarDoTotal={(c) => classificar(r, c, false)}
                              onExcluido={() => void load(true)}
                            />
                          </td>
                        </tr>
                        {aberto && (
                          <tr className="border-t border-border/60 bg-muted/10">
                            <td colSpan={5} className="px-3 py-2">
                              <SaidaEditor
                                origem={r.origem}
                                id={r.id}
                                categorias={categorias}
                                centros={centros}
                                onSalvo={() => {
                                  setAbertoId(null)
                                  void load(true)
                                }}
                                onCancelar={() => setAbertoId(null)}
                                temCopia={temCopia(r)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-muted/20 text-xs">
                    <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                      {visiveis.length} lançamento(s) neste filtro
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {brl(visiveis.reduce((s, r) => s + r.amountCents, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {excluidos.length > 0 && (
        <div className="mt-3 rounded-lg border border-border">
          <button
            type="button"
            aria-expanded={verExcluidos}
            onClick={() => setVerExcluidos((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30"
          >
            <span>
              <span className="font-medium text-foreground">Excluídos</span> · {excluidos.length} lançamento(s) que
              saíram do gasto e ainda podem voltar
            </span>
            <span className="underline underline-offset-2">{verExcluidos ? 'fechar' : 'ver'}</span>
          </button>
          {verExcluidos && (
            <div className="divide-y divide-border/60 border-t border-border">
              {excluidos.map((x) => (
                <div key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{dia(x.data)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{x.descricao || 'sem descrição'}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {x.origem === 'banco' ? 'Cópia do banco' : 'Conta a pagar'} · {x.motivo} · excluído em{' '}
                      {new Date(x.excluidoEm).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums">{brl(x.amountCents)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={async () => {
                      try {
                        await desfazerExclusao(x.id)
                        toast.success('Lançamento de volta.')
                        await load(true)
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Falha ao desfazer')
                      }
                    }}
                  >
                    Desfazer
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo gasto</DialogTitle>
            <DialogDescription>
              Para o que não passa pelo banco conectado (dinheiro, outra conta). O que saiu do Itaú já entra sozinho.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Data</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Valor (R$)</Label>
                <Input
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Quem recebeu</Label>
              <Input
                value={form.counterparty}
                onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))}
                placeholder="Favorecido ou fornecedor"
              />
            </div>
            <div className="space-y-1">
              <Label>Centro de custo</Label>
              <CentroCustoPicker
                className="w-full"
                centros={centros}
                value={form.costCenter || null}
                onPick={(c) => setForm((f) => ({ ...f, costCenter: c.name }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Forma de pagamento</Label>
                <Input
                  value={form.paymentMethod}
                  onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  list="formas-gasto"
                />
                <datalist id="formas-gasto">
                  <option value="PIX - Pagamentos Instantâneos" />
                  <option value="Boletos de cobrança" />
                  <option value="Crédito em conta" />
                  <option value="Dinheiro" />
                  <option value="Concessionárias" />
                  <option value="DARF - Documento de Arrec. de" />
                  <option value="Tributos municipais" />
                </datalist>
              </div>
              <div className="space-y-1">
                <Label>Detalhe</Label>
                <Input
                  value={form.subcategory}
                  onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                  placeholder="NF, VT, diarista…"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.markPaid}
                onChange={(e) => setForm((f) => ({ ...f, markPaid: e.target.checked }))}
              />
              Já pago (marca como quitado na data)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

export default GastosControlePage
