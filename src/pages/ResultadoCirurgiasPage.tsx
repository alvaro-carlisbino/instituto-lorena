import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, PackageCheck, Search, Stethoscope, TrendingUp } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { ExportarMenu } from '@/components/page/ExportarMenu'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { STATUS_KIT, formatBRL } from '@/components/kits/kitUi'
import { useTenant } from '@/context/TenantContext'
import { exportarExcel, exportarPdf } from '@/lib/exportar'
import { mesAtual, periodoDoMes, type Periodo } from '@/lib/periodo'
import { contaDoProcedimento, somarContas } from '@/lib/resultadoProcedimento'
import { cn } from '@/lib/utils'
import { listCirurgiasPagamento, type CirurgiaPagamento } from '@/services/financeiro'
import { type StockKit, listKits } from '@/services/estoqueKits'
import { type Procedimento, listResultadoProcedimentos, salvarCustosDaVenda } from '@/services/resultadoProcedimentos'

type Filtro = 'cirurgia' | 'protocolo' | 'sem_venda' | 'todos'

const pct = (m: number | null) => (m == null ? '-' : `${(m * 100).toFixed(0)}%`)
const dataBr = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '')
const normalizar = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const reais = (c: number) => Math.round(c) / 100

/**
 * Uma linha por procedimento vendido: o valor da venda (Central de Vendas), o que o Shosp diz
 * que entrou, o custo real dos kits (estoque, lote a lote) e os custos lançados na venda. É a
 * primeira tela que junta os quatro; antes cada número morava num lugar e o lucro não existia.
 */
export function ResultadoCirurgiasPage() {
  const { tenant } = useTenant()
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const [filtro, setFiltro] = useState<Filtro>('cirurgia')
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState<Procedimento[]>([])
  const [pagamentos, setPagamentos] = useState<Map<number, CirurgiaPagamento>>(new Map())
  const [kits, setKits] = useState<Map<string, StockKit>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState<Procedimento | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    Promise.all([
      listResultadoProcedimentos(periodo.de, periodo.ate),
      // Recebimento e kits enriquecem a linha; se um deles falhar, o resultado ainda aparece.
      listCirurgiasPagamento(periodo.de, periodo.ate).catch(() => [] as CirurgiaPagamento[]),
      listKits().catch(() => [] as StockKit[]),
    ])
      .then(([rs, pags, ks]) => {
        if (!vivo) return
        setLinhas(rs)
        setPagamentos(new Map(pags.map((p) => [p.surgeryId, p] as const)))
        setKits(new Map(ks.map((k) => [k.id, k] as const)))
      })
      .catch((e) => vivo && toast.error(e instanceof Error ? e.message : 'Falha ao carregar o resultado'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [periodo.de, periodo.ate, versao])

  const contagem = useMemo(
    () => ({
      cirurgia: linhas.filter((l) => l.kind === 'cirurgia').length,
      protocolo: linhas.filter((l) => l.kind === 'protocolo').length,
      sem_venda: linhas.filter((l) => l.kind === 'sem_venda').length,
      todos: linhas.length,
    }),
    [linhas],
  )

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim())
    return linhas.filter(
      (l) =>
        (filtro === 'todos' || l.kind === filtro) &&
        (!q || normalizar(`${l.paciente} ${l.procedimento} ${l.prontuario ?? ''}`).includes(q)),
    )
  }, [linhas, filtro, busca])

  const total = useMemo(() => somarContas(visiveis), [visiveis])
  const recebido = visiveis.reduce((s, l) => s + (l.srgSurgeryId != null ? (pagamentos.get(l.srgSurgeryId)?.recebidoCents ?? 0) : 0), 0)
  const semCusto = visiveis.filter((l) => l.kind !== 'sem_venda' && contaDoProcedimento(l).custoTotal === 0).length
  const margemTotal = total.receita > 0 ? total.lucro / total.receita : null

  const colunas = ['Data', 'Paciente', 'Procedimento', 'Tipo', 'Prontuário Shosp', 'Receita', 'Cobrado nos kits', 'Materiais', 'Médico', 'Impostos', 'Outros', 'Custo total', 'Lucro', 'Margem %', 'Recebido (Shosp)', 'Kits']
  const linhaExport = (l: Procedimento) => {
    const c = contaDoProcedimento(l)
    const rec = l.srgSurgeryId != null ? pagamentos.get(l.srgSurgeryId)?.recebidoCents : undefined
    return [dataBr(l.dia), l.paciente, l.procedimento, l.kind === 'sem_venda' ? 'Kit sem venda' : l.kind, l.prontuario ?? '',
      reais(l.receitaCents), reais(l.cobradoKitsCents), reais(c.materiais), reais(l.custoMedicoCents), reais(l.impostoCents),
      reais(l.outrosCents), reais(c.custoTotal), reais(c.lucro), c.margem == null ? '' : Math.round(c.margem * 1000) / 10,
      rec == null ? '' : reais(rec), l.kits]
  }

  return (
    <AppLayout
      title="Resultado por cirurgia"
      subtitle="Venda, recebimento, kits e custos de cada procedimento: quanto entrou, quanto custou e quanto sobrou."
      actions={
        <ExportarMenu
          disabled={visiveis.length === 0}
          onExcel={() =>
            exportarExcel(`resultado-cirurgias-${periodo.rotulo}`, [
              { nome: 'Procedimentos', colunas, linhas: visiveis.map(linhaExport) },
              {
                nome: 'Resumo',
                colunas: ['Indicador', 'Valor'],
                linhas: [
                  ['Período', periodo.rotulo],
                  ['Procedimentos', visiveis.length],
                  ['Receita', reais(total.receita)],
                  ['Materiais', reais(total.materiais)],
                  ['Médico', reais(total.medico)],
                  ['Impostos', reais(total.imposto)],
                  ['Outros custos', reais(total.outros)],
                  ['Lucro', reais(total.lucro)],
                  ['Recebido (Shosp)', reais(recebido)],
                ],
              },
            ])
          }
          onPdf={() =>
            exportarPdf({
              titulo: 'Resultado por cirurgia',
              subtitulo: `${periodo.rotulo} · ${tenant.name}`,
              resumo: [
                { rotulo: 'Receita', valor: formatBRL(total.receita) },
                { rotulo: 'Custos', valor: formatBRL(total.custo) },
                { rotulo: 'Lucro', valor: formatBRL(total.lucro) },
                { rotulo: 'Margem', valor: pct(margemTotal) },
                { rotulo: 'Recebido (Shosp)', valor: formatBRL(recebido) },
              ],
              colunas: ['Data', 'Paciente', 'Procedimento', 'Receita', 'Materiais', 'Outros custos', 'Lucro', 'Margem'],
              numericas: [3, 4, 5, 6, 7],
              linhas: visiveis.map((l) => {
                const c = contaDoProcedimento(l)
                return [dataBr(l.dia), l.paciente, l.procedimento, formatBRL(c.receitaTotal), formatBRL(c.materiais),
                  formatBRL(l.custoMedicoCents + l.impostoCents + l.outrosCents), formatBRL(c.lucro), pct(c.margem)]
              }),
              rodape: 'Materiais = custo real dos kits (saída menos devolução, pelo custo do lote). Sem kit, vale o material lançado na venda.',
            })
          }
        />
      }
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div className="flex flex-wrap items-center gap-2">
        <FiltroPeriodo valor={periodo} onChange={(p) => { setCarregando(true); setPeriodo(p) }} atalhos={['mes-atual', 'mes-passado', 'dias:30', 'dias:90']} />
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Paciente, procedimento ou prontuário" className="h-9 pl-9" aria-label="Buscar" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[
          { rotulo: 'Receita', valor: formatBRL(total.receita), dica: `${visiveis.filter((l) => l.kind !== 'sem_venda').length} procedimentos` },
          { rotulo: 'Custos', valor: formatBRL(total.custo), dica: `materiais ${formatBRL(total.materiais)}` },
          { rotulo: 'Lucro', valor: formatBRL(total.lucro), dica: `margem ${pct(margemTotal)}`, destaque: total.lucro < 0 ? 'neg' : 'pos' },
          { rotulo: 'Recebido (Shosp)', valor: formatBRL(recebido), dica: 'cirurgias com sala vinculada' },
          { rotulo: 'Médico e impostos', valor: formatBRL(total.medico + total.imposto), dica: `outros ${formatBRL(total.outros)}` },
        ].map((k) => (
          <div key={k.rotulo} className="rounded-xl border border-border bg-card px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.rotulo}</p>
            <p className={cn('text-lg font-semibold tabular-nums', k.destaque === 'neg' && 'text-destructive', k.destaque === 'pos' && 'text-emerald-700 dark:text-emerald-300')}>
              {carregando ? '…' : k.valor}
            </p>
            <p className="truncate text-xs text-muted-foreground">{k.dica}</p>
          </div>
        ))}
      </div>

      {semCusto > 0 || contagem.sem_venda > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p>
            {semCusto > 0 ? `${semCusto} ${semCusto === 1 ? 'procedimento está' : 'procedimentos estão'} sem custo nenhum: o lucro deles aparece cheio. Monte o kit pelo paciente ou lance os custos. ` : ''}
            {contagem.sem_venda > 0 ? `${contagem.sem_venda} ${contagem.sem_venda === 1 ? 'kit não achou' : 'kits não acharam'} venda: material que saiu sem ninguém cobrando.` : ''}
          </p>
        </div>
      ) : null}

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ['cirurgia', 'Cirurgias'],
            ['protocolo', 'Protocolos'],
            ['sem_venda', 'Kits sem venda'],
            ['todos', 'Todos'],
          ] as Array<[Filtro, string]>
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium',
              filtro === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {label} <span className="tabular-nums opacity-70">{contagem[f]}</span>
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <EmptyState icon={TrendingUp} title={carregando ? 'Carregando…' : 'Nada neste período'} description="Procedimentos vendidos e kits montados no período aparecem aqui." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {visiveis.map((l) => {
            const c = contaDoProcedimento(l)
            const pag = l.srgSurgeryId != null ? pagamentos.get(l.srgSurgeryId) : undefined
            return (
              <li key={l.saleId ?? l.kitIds[0]}>
                <button type="button" onClick={() => setAberto(l)} className="flex w-full flex-col gap-2 px-3 py-3 text-left hover:bg-muted/50 sm:flex-row sm:items-center sm:px-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {l.paciente}
                      {l.kind === 'sem_venda' ? <Badge variant="destructive">kit sem venda</Badge> : null}
                      {l.kits > 0 ? (
                        <Badge variant="secondary" className="gap-1">
                          <PackageCheck className="size-3" aria-hidden /> {l.kits} {l.kits === 1 ? 'kit' : 'kits'}
                          {l.vinculo === 'automatico' ? ' (auto)' : ''}
                        </Badge>
                      ) : null}
                      {c.custoTotal === 0 && l.kind !== 'sem_venda' ? <Badge variant="outline" className="text-amber-700 dark:text-amber-300">sem custo</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[dataBr(l.dia), l.procedimento, l.prontuario ? `pront. ${l.prontuario}` : null, pag ? `recebido ${formatBRL(pag.recebidoCents)}` : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-right text-xs tabular-nums sm:w-80">
                    <span>
                      <span className="block text-muted-foreground">receita</span>
                      <span className="text-sm font-medium">{formatBRL(c.receitaTotal)}</span>
                    </span>
                    <span>
                      <span className="block text-muted-foreground">custo</span>
                      <span className="text-sm font-medium">{formatBRL(c.custoTotal)}</span>
                    </span>
                    <span>
                      <span className="block text-muted-foreground">lucro {pct(c.margem)}</span>
                      <span className={cn('text-sm font-semibold', c.lucro < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300')}>{formatBRL(c.lucro)}</span>
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {aberto ? (
        <ProcedimentoDialog
          key={aberto.saleId ?? aberto.kitIds[0]}
          linha={aberto}
          pagamento={aberto.srgSurgeryId != null ? pagamentos.get(aberto.srgSurgeryId) : undefined}
          kits={aberto.kitIds.map((id) => kits.get(id)).filter((k): k is StockKit => k != null)}
          onClose={() => setAberto(null)}
          onSalvo={() => {
            setAberto(null)
            setVersao((v) => v + 1)
          }}
        />
      ) : null}
    </AppLayout>
  )
}

function ProcedimentoDialog({
  linha,
  pagamento,
  kits,
  onClose,
  onSalvo,
}: {
  linha: Procedimento
  pagamento: CirurgiaPagamento | undefined
  kits: StockKit[]
  onClose: () => void
  onSalvo: () => void
}) {
  const [custos, setCustos] = useState(() => ({
    medico: linha.custoMedicoCents ? String(linha.custoMedicoCents / 100).replace('.', ',') : '',
    imposto: linha.impostoCents ? String(linha.impostoCents / 100).replace('.', ',') : '',
    outros: linha.outrosCents ? String(linha.outrosCents / 100).replace('.', ',') : '',
    materiais: linha.materiaisManualCents ? String(linha.materiaisManualCents / 100).replace('.', ',') : '',
  }))
  const [salvando, setSalvando] = useState(false)
  const cents = (t: string) => {
    const n = Number(t.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
  }
  const simulada = {
    ...linha,
    custoMedicoCents: cents(custos.medico),
    impostoCents: cents(custos.imposto),
    outrosCents: cents(custos.outros),
    materiaisManualCents: cents(custos.materiais),
  }
  const c = contaDoProcedimento(simulada)

  const salvar = async () => {
    if (!linha.saleId) return
    setSalvando(true)
    try {
      await salvarCustosDaVenda(linha.saleId, {
        medicoCents: simulada.custoMedicoCents,
        impostoCents: simulada.impostoCents,
        outrosCents: simulada.outrosCents,
        materiaisManualCents: simulada.materiaisManualCents,
      })
      toast.success('Custos salvos na venda.')
      onSalvo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const campo = (id: keyof typeof custos, rotulo: string, desabilitado = false) => (
    <div className="space-y-1">
      <Label htmlFor={`custo-${id}`} className="text-xs">
        {rotulo}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
        <Input
          id={`custo-${id}`}
          inputMode="decimal"
          value={custos[id]}
          disabled={desabilitado || !linha.saleId}
          onChange={(e) => setCustos((s) => ({ ...s, [id]: e.target.value }))}
          placeholder="0,00"
          className="h-9 pl-8 text-right tabular-nums"
        />
      </div>
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && !salvando && onClose()}>
      <DialogContent className="flex max-h-[min(100dvh-1rem,52rem)] flex-col gap-0 p-0 sm:max-w-2xl max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none">
        <DialogHeader className="border-b border-border p-4 pr-12">
          <DialogTitle>{linha.paciente}</DialogTitle>
          <DialogDescription>
            {[dataBr(linha.dia), linha.procedimento, linha.prontuario ? `prontuário Shosp ${linha.prontuario}` : 'sem prontuário do Shosp'].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border text-center">
            {[
              ['Receita', formatBRL(c.receitaTotal)],
              ['Custo', formatBRL(c.custoTotal)],
              [`Lucro ${pct(c.margem)}`, formatBRL(c.lucro)],
            ].map(([r, v]) => (
              <div key={r} className="bg-background px-2 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r}</p>
                <p className="text-base font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Onde este procedimento aparece</h3>
            <div className="flex flex-wrap gap-2">
              {linha.leadId ? (
                <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/leads/${linha.leadId}`} />}>
                  <ExternalLink className="size-3.5" aria-hidden /> Ficha do paciente
                </Button>
              ) : null}
              {linha.srgSurgeryId != null ? (
                <Button variant="outline" size="sm" nativeButton={false} render={<Link to={`/cirurgias/${linha.srgSurgeryId}`} />}>
                  <Stethoscope className="size-3.5" aria-hidden /> Cirurgia na sala #{linha.srgSurgeryId}
                </Button>
              ) : (
                <Badge variant="outline">sem cirurgia da sala vinculada</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {pagamento
                ? `Shosp: ${formatBRL(pagamento.recebidoCents)} recebidos em ${pagamento.recebidoQtd} ${pagamento.recebidoQtd === 1 ? 'lançamento' : 'lançamentos'}${pagamento.formas.length ? ` (${pagamento.formas.join(', ')})` : ''}, vínculo por ${pagamento.vinculo}.`
                : 'Recebimento do Shosp aparece quando a venda está ligada à cirurgia da sala.'}
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Kits</h3>
            {kits.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum kit ligado. Monte o kit escolhendo este paciente e a venda aparece para vincular.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {kits.map((k) => {
                  const custo = k.items.reduce((s, i) => s + i.chargeCents, 0)
                  return (
                    <li key={k.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block font-medium">{k.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {STATUS_KIT[k.status].label} · {k.items.length} itens{custo > 0 ? ` · cobrado ${formatBRL(custo)}` : ''}
                          {linha.vinculo === 'automatico' ? ' · vínculo automático (mesmo paciente e data próxima)' : ''}
                        </span>
                      </span>
                      <Button variant="ghost" size="sm" nativeButton={false} render={<Link to={`/kits?aba=kits&kit=${k.id}`} />}>
                        Abrir
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Materiais dos kits: {formatBRL(linha.materiaisKitsCents)} (saída menos devolução, pelo custo do lote).</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Custos lançados na venda</h3>
            {!linha.saleId ? (
              <p className="text-xs text-muted-foreground">Kit sem venda: ligue o kit à venda do paciente para os custos entrarem na conta.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {campo('medico', 'Médico / equipe')}
                {campo('imposto', 'Impostos')}
                {campo('outros', 'Outros (sala, hotel, taxa)')}
                {campo('materiais', linha.kits > 0 ? 'Materiais (vem dos kits)' : 'Materiais (sem kit)', linha.kits > 0)}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-border p-3 sm:p-4">
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Fechar
          </Button>
          {linha.saleId ? (
            <Button onClick={() => void salvar()} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar custos'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
