import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Ban, CalendarOff, FileSpreadsheet, Pencil, Plus, Target, UserX } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { VendaFormDialog } from '@/components/vendas/VendaFormDialog'
import {
  DEPOSIT_PAYEE_LABEL,
  type ClinicSale,
  type ClinicSaleKind,
  type FiltroStatusVendas,
  type RecorteVendas,
  type SalesTarget,
  type StaffMember,
  cancelClinicSale,
  deleteSalesTarget,
  diasAteFechar,
  filtrarVendas,
  followUpStats,
  listClinicSales,
  listSalesTargets,
  listSurgicalStaff,
  progressoDaMeta,
  resultadoDasVendas,
  salesByDoctor,
  salesByProcedure,
  saveSalesTarget,
  tipoNegociacao,
  vendasSemData,
  vendasSemPaciente,
} from '@/services/clinicSales'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const parseMoney = (v: string): number => {
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const dia = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—')

const nomeDoMes = (m: string) => {
  const [ano, mes] = m.split('-')
  const d = new Date(Number(ano), Number(mes) - 1, 1)
  const nome = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

const STATUS_LABEL: Record<ClinicSale['status'], string> = {
  vendida: 'Vendida',
  agendada: 'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
}

/** Quanto tempo a venda levou depois da consulta, em rótulo curto de tabela. */
function rotuloPrazo(dias: number | null): { texto: string; tom: string } {
  if (dias == null) return { texto: 'sem consulta', tom: 'text-muted-foreground' }
  if (dias < 0) return { texto: 'consulta depois', tom: 'text-amber-600' }
  if (dias === 0) return { texto: 'fechou na consulta', tom: 'text-emerald-600' }
  if (dias === 1) return { texto: 'follow-up · 1 dia', tom: 'text-sky-600' }
  return { texto: `follow-up · ${dias} dias`, tom: 'text-sky-600' }
}

const FILTRO_STATUS: { valor: FiltroStatusVendas; rotulo: string }[] = [
  { valor: 'ativas', rotulo: 'Ativas (sem canceladas)' },
  { valor: 'vendida', rotulo: 'Só vendidas' },
  { valor: 'agendada', rotulo: 'Só agendadas' },
  { valor: 'realizada', rotulo: 'Só realizadas' },
  { valor: 'cancelada', rotulo: 'Só canceladas' },
  { valor: 'todas', rotulo: 'Todas, com canceladas' },
]

/** Há quantos dias a venda fechou. É o tempo que ela está parada sem data. */
const diasDesde = (iso: string): number => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

/**
 * Número do topo. Vira botão quando filtra: número que não leva a lugar nenhum é
 * o que fazia "19 vendidas sem data" ser um enfeite — dava para ler e não dava
 * para saber QUEM são as 19.
 */
function Kpi({
  rotulo,
  valor,
  detalhe,
  tom,
  ativo,
  onClick,
  descricao,
  icone: Icone,
}: {
  rotulo: string
  valor: string | number
  detalhe?: string
  tom?: string
  ativo?: boolean
  onClick?: () => void
  descricao?: string
  icone?: typeof UserX
}) {
  const conteudo = (
    <>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icone && <Icone className="size-3.5 shrink-0" aria-hidden />}
        {rotulo}
      </p>
      <p className={cn('font-heading text-xl break-words tabular-nums sm:text-2xl', tom)}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
    </>
  )

  if (!onClick) {
    return (
      <Card>
        <CardContent className="pt-4">{conteudo}</CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn('py-0 transition-colors', ativo && 'bg-primary/5 ring-2 ring-primary')}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={ativo}
        title={descricao}
        className="w-full cursor-pointer px-4 py-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {conteudo}
      </button>
    </Card>
  )
}

export function VendasTab({ kind }: { kind: ClinicSaleKind }) {
  const [sales, setSales] = useState<ClinicSale[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [targets, setTargets] = useState<SalesTarget[]>([])
  const [metaAberta, setMetaAberta] = useState(false)
  const [metaValor, setMetaValor] = useState('')
  const [metaQtd, setMetaQtd] = useState('')
  const [salvandoMeta, setSalvandoMeta] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<{ open: boolean; editing: ClinicSale | null }>({ open: false, editing: null })
  const [cancelando, setCancelando] = useState<ClinicSale | null>(null)
  const [motivo, setMotivo] = useState('')
  const [estorno, setEstorno] = useState('Em avaliação')
  const [obsCancel, setObsCancel] = useState('')
  const [recorte, setRecorte] = useState<RecorteVendas>('mes')
  const [status, setStatus] = useState<FiltroStatusVendas>('ativas')
  const [termo, setTermo] = useState('')
  // A lista tem até 400 linhas: adiar o filtro mantém a digitação fluida.
  const buscaAdiada = useDeferredValue(termo)
  /** "todas" = a clínica inteira; escolher uma dá a visão daquela consultora. */
  const [vendedora, setVendedora] = useState('todas')
  const [mes, setMes] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const load = async () => {
    setLoading(true)
    try {
      const [s, st, mt] = await Promise.all([
        listClinicSales(kind),
        listSurgicalStaff(),
        listSalesTargets(kind).catch(() => [] as SalesTarget[]),
      ])
      setSales(s)
      setStaff(st)
      setTargets(mt)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar as vendas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  /** Meses que existem nos dados, do mais novo para o mais velho. */
  const mesesDisponiveis = useMemo(() => {
    const set = new Set(sales.map((s) => s.soldAt.slice(0, 7)).filter(Boolean))
    return [...set].sort().reverse()
  }, [sales])

  // Venda sem paciente vinculado não move card nem recebe lembrete: fica órfã.
  // Acontece quando o telefone da planilha bate com dois leads (parente, cadastro
  // duplicado) e casar por semelhança em saúde é mostrar a cirurgia de um
  // paciente para outro. Então o sistema não adivinha, ele mostra a lista.
  const semPaciente = useMemo(() => vendasSemPaciente(sales), [sales])

  // Venda fechada que nunca ganhou data. Atravessa o mês: a mais velha da lista
  // fechou em janeiro e continua aqui. Por isso conta a base inteira, não o mês.
  const semData = useMemo(() => vendasSemData(sales), [sales])

  /** Vendedoras que aparecem nos dados — a lista cresce sozinha conforme elas registram. */
  const vendedoras = useMemo(() => {
    const set = new Set(sales.map((s) => s.sellerName).filter((v): v is string => !!v))
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [sales])

  /** Como a fatia atual se chama nos títulos, para nenhum rótulo mentir o recorte. */
  const rotuloRecorte =
    recorte === 'mes'
      ? nomeDoMes(mes)
      : recorte === 'sem-data'
        ? 'vendas sem data marcada'
        : 'vendas sem paciente vinculado'

  const doMes = useMemo(
    () => filtrarVendas(sales, { recorte, mes, status, vendedora, termo: buscaAdiada }),
    [sales, mes, recorte, status, vendedora, buscaAdiada],
  )

  const resumo = useMemo(() => {
    const total = doMes.reduce((acc, s) => acc + s.valueCents, 0)
    return {
      qtd: doMes.length,
      total,
      ticket: doMes.length > 0 ? Math.round(total / doMes.length) : 0,
      semData: semData.length,
      semDataCents: semData.reduce((acc, s) => acc + s.valueCents, 0),
    }
  }, [doMes, semData])

  // O "por médico" acompanha o mês escolhido: é o fechamento que ela digita hoje
  // no rodapé da planilha ("4 fechamentos, 37% de conversão").
  const porMedico = useMemo(() => salesByDoctor(doMes), [doMes])

  // Ticket por procedimento. O ticket do mês inteiro mistura transplante de
  // R$ 34 mil com sobrancelha de R$ 24 mil, e a média sobe ou desce só porque a
  // proporção mudou — não porque o preço mudou.
  const porProcedimento = useMemo(() => salesByProcedure(doMes), [doMes])

  // A meta segue o filtro da tela: escolhida uma vendedora, é a meta dela; em
  // "todas", é a da clínica. Meta de vendedora somada com a da clínica seria
  // contar o mesmo faturamento duas vezes.
  const meta = useMemo(
    () =>
      targets.find(
        (t) => t.month === mes && (vendedora === 'todas' ? t.sellerName == null : t.sellerName === vendedora),
      ) ?? null,
    [targets, mes, vendedora],
  )
  const progresso = useMemo(
    () => progressoDaMeta(recorte === 'mes' ? doMes : [], meta, mes),
    [doMes, meta, mes, recorte],
  )
  const resultado = useMemo(() => resultadoDasVendas(doMes), [doMes])

  // Quanto do mês fechou na própria consulta e quanto veio de follow-up.
  const prazo = useMemo(() => followUpStats(doMes), [doMes])
  const pctFollowUp = useMemo(() => {
    const base = prazo.noDia + prazo.followUp
    return base > 0 ? Math.round((prazo.followUp / base) * 100) : 0
  }, [prazo])

  /** Clicar de novo no recorte ativo volta para o mês — o botão liga e desliga. */
  const alternarRecorte = (alvo: Exclude<RecorteVendas, 'mes'>) =>
    setRecorte((atual) => (atual === alvo ? 'mes' : alvo))

  const abrirMeta = () => {
    setMetaValor(meta && meta.targetCents > 0 ? String(meta.targetCents / 100).replace('.', ',') : '')
    setMetaQtd(meta && meta.targetCount > 0 ? String(meta.targetCount) : '')
    setMetaAberta(true)
  }

  const salvarMeta = async () => {
    setSalvandoMeta(true)
    try {
      await saveSalesTarget({
        month: mes,
        kind,
        sellerName: vendedora === 'todas' ? null : vendedora,
        targetCents: parseMoney(metaValor),
        targetCount: Number(metaQtd || 0),
      })
      toast.success('Meta salva.')
      setMetaAberta(false)
      setTargets(await listSalesTargets(kind))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar a meta')
    } finally {
      setSalvandoMeta(false)
    }
  }

  const apagarMeta = async () => {
    if (!meta) return
    setSalvandoMeta(true)
    try {
      await deleteSalesTarget(meta.id)
      setMetaAberta(false)
      setTargets(await listSalesTargets(kind))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao apagar a meta')
    } finally {
      setSalvandoMeta(false)
    }
  }

  const confirmarCancelamento = async () => {
    if (!cancelando) return
    try {
      await cancelClinicSale(cancelando.id, { reason: motivo, refundStatus: estorno, note: obsCancel })
      toast.success('Venda cancelada. Os lembretes pendentes saíram da fila.')
      setCancelando(null)
      setMotivo('')
      setObsCancel('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar')
    }
  }

  return (
    <div className="space-y-4">
      {recorte === 'mes' && (
        <Card>
          <CardHeader>
            <CardTitle>
              Meta de {nomeDoMes(mes)}
              {vendedora !== 'todas' && <span className="text-muted-foreground"> · {vendedora}</span>}
            </CardTitle>
            <CardAction>
              <Button size="sm" variant="outline" onClick={abrirMeta}>
                <Target className="size-3.5" /> {meta ? 'Editar meta' : 'Definir meta'}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {!meta ? (
              <p className="text-sm text-muted-foreground">
                Sem meta definida para este mês. Com a meta, esta faixa mostra o quanto já foi feito e o
                quanto o ritmo do mês projeta até o dia {progresso.diasNoMes}.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="font-heading text-2xl">
                      {brl(progresso.realizadoCents)}
                      <span className="ml-1 text-sm text-muted-foreground">de {brl(progresso.metaCents)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {progresso.faltaCents > 0
                        ? `faltam ${brl(progresso.faltaCents)}`
                        : 'meta batida'}
                      {progresso.metaQtd > 0 &&
                        ` · ${progresso.realizadoQtd} de ${progresso.metaQtd} venda${progresso.metaQtd > 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <p
                    className={cn(
                      'font-heading text-2xl',
                      progresso.pctValor >= 100
                        ? 'text-emerald-600'
                        : progresso.pctValor >= 60
                          ? 'text-foreground'
                          : 'text-amber-600',
                    )}
                  >
                    {progresso.pctValor}%
                  </p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width]',
                      progresso.pctValor >= 100 ? 'bg-emerald-600' : 'bg-primary',
                    )}
                    style={{ width: `${Math.min(progresso.pctValor, 100)}%` }}
                  />
                </div>
                {progresso.diasDecorridos < progresso.diasNoMes && (
                  <p className="text-xs text-muted-foreground">
                    No ritmo dos {progresso.diasDecorridos} primeiros dias, o mês fecha em{' '}
                    <span
                      className={
                        progresso.projecaoCents >= progresso.metaCents ? 'text-emerald-600' : 'text-amber-600'
                      }
                    >
                      {brl(progresso.projecaoCents)}
                    </span>
                    . Projeção é régua de três, não promessa.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi rotulo={`Vendas · ${rotuloRecorte}`} valor={resumo.qtd} />
        <Kpi rotulo="Faturamento" valor={brl(resumo.total)} />
        <Kpi rotulo="Ticket médio" valor={brl(resumo.ticket)} />
        <Kpi
          rotulo="Lucro"
          valor={brl(resultado.lucro)}
          tom={resultado.lucro < 0 ? 'text-destructive' : undefined}
          detalhe={
            (resultado.custo > 0 ? `${resultado.margem}% de margem` : 'nenhum custo lançado') +
            (resultado.semCusto > 0 && resultado.custo > 0 ? ` · ${resultado.semCusto} sem custo` : '')
          }
        />
        <Kpi
          rotulo="Fechou em follow-up"
          valor={prazo.followUp}
          detalhe={`de ${prazo.noDia + prazo.followUp} · ${pctFollowUp}% · ${brl(prazo.valorFollowUpCents)}${
            prazo.medianaDias > 0 ? ` · mediana ${prazo.medianaDias} dias` : ''
          }`}
        />
        <Kpi
          rotulo="Vendidas sem data"
          icone={CalendarOff}
          valor={resumo.semData}
          tom={resumo.semData > 0 ? 'text-amber-600' : undefined}
          detalhe={
            resumo.semData > 0
              ? `${brl(resumo.semDataCents)} parados · clique para ver`
              : 'toda venda tem data'
          }
          ativo={recorte === 'sem-data'}
          onClick={resumo.semData > 0 ? () => alternarRecorte('sem-data') : undefined}
          descricao="Mostrar as vendas fechadas que ainda não têm data marcada"
        />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>{kind === 'cirurgia' ? 'Vendas cirúrgicas' : 'Vendas de protocolo'}</CardTitle>
          <CardAction>
            <Button size="sm" onClick={() => setForm({ open: true, editing: null })}>
              <Plus className="size-3.5" aria-hidden /> Nova venda
            </Button>
          </CardAction>

          {/* Filtros em linha própria: no celular eles não cabem ao lado do título,
              e espremidos no CardAction viravam três selects de 40px ilegíveis. */}
          <div className="col-span-full flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchField
              value={termo}
              onChange={setTermo}
              label="Buscar venda"
              placeholder="Paciente, telefone, procedimento, cidade, médico…"
              resultados={doMes.length}
              className="w-full sm:max-w-xs"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={mes}
                disabled={recorte !== 'mes'}
                onValueChange={(v) => setMes(String(v ?? mes))}
              >
                <SelectTrigger className="h-8 w-40" aria-label="Mês da venda">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mesesDisponiveis.map((m) => (
                    <SelectItem key={m} value={m}>
                      {nomeDoMes(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={status} onValueChange={(v) => setStatus(String(v ?? 'ativas') as FiltroStatusVendas)}>
                <SelectTrigger className="h-8 w-48" aria-label="Situação da venda">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILTRO_STATUS.map((f) => (
                    <SelectItem key={f.valor} value={f.valor}>
                      {f.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {vendedoras.length > 0 && (
                <Select value={vendedora} onValueChange={(v) => setVendedora(String(v ?? 'todas'))}>
                  <SelectTrigger className="h-8 w-40" aria-label="Vendedora">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as vendedoras</SelectItem>
                    {vendedoras.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {semData.length > 0 && (
                <Button
                  size="sm"
                  variant={recorte === 'sem-data' ? 'default' : 'outline'}
                  aria-pressed={recorte === 'sem-data'}
                  onClick={() => alternarRecorte('sem-data')}
                >
                  <CalendarOff className="size-3.5" aria-hidden /> Sem data ({semData.length})
                </Button>
              )}
              {semPaciente.length > 0 && (
                <Button
                  size="sm"
                  variant={recorte === 'sem-paciente' ? 'default' : 'outline'}
                  aria-pressed={recorte === 'sem-paciente'}
                  onClick={() => alternarRecorte('sem-paciente')}
                >
                  <UserX className="size-3.5" aria-hidden /> Sem paciente ({semPaciente.length})
                </Button>
              )}
            </div>
          </div>

          {recorte !== 'mes' && (
            <p className="col-span-full text-xs text-muted-foreground">
              {recorte === 'sem-data'
                ? 'Vendas fechadas de todos os meses que ainda não têm data marcada, da mais parada para a mais recente. O filtro de mês fica de fora de propósito: venda parada não pertence a um mês só.'
                : 'Vendas de todos os meses cujo paciente não foi vinculado a um cadastro. Sem vínculo, o card não anda no funil e o lembrete não sai.'}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {doMes.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title={
                loading
                  ? 'Carregando…'
                  : termo.trim().length > 0
                    ? `Nenhuma venda para "${termo.trim()}"`
                    : recorte === 'sem-paciente'
                      ? 'Todas as vendas têm paciente'
                      : recorte === 'sem-data'
                        ? 'Toda venda já tem data marcada'
                        : `Nenhuma venda em ${nomeDoMes(mes)}`
              }
              description={
                loading
                  ? undefined
                  : termo.trim().length > 0
                    ? 'A busca olha paciente, telefone, procedimento, cidade, vendedora e médico. Limpe o termo para ver a lista inteira.'
                    : 'Escolha outro mês ou registre a primeira venda.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  {`${doMes.length} venda${doMes.length === 1 ? '' : 's'} em ${rotuloRecorte}. `}
                  No celular a tabela mostra paciente, valor, data e situação; as demais colunas
                  aparecem em telas maiores e o conteúdo delas vai junto do nome do paciente.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    {/* Colunas somem por prioridade clínica, não por ordem: quem abre no
                        celular precisa de paciente, valor, data e situação. O resto volta
                        dentro da célula do paciente para nenhum dado sumir de verdade. */}
                    <TableHead scope="col" className="hidden lg:table-cell">Consulta</TableHead>
                    <TableHead scope="col" className="hidden md:table-cell">Venda</TableHead>
                    <TableHead scope="col" className="min-w-36">Paciente</TableHead>
                    <TableHead scope="col" className="hidden sm:table-cell">
                      {kind === 'cirurgia' ? 'Procedimento' : 'Protocolo'}
                    </TableHead>
                    <TableHead scope="col" className="hidden xl:table-cell">Vendedora</TableHead>
                    <TableHead scope="col" className="hidden xl:table-cell">Médico</TableHead>
                    <TableHead scope="col" className="text-right">Valor</TableHead>
                    <TableHead scope="col" className="hidden text-right lg:table-cell">Lucro</TableHead>
                    <TableHead scope="col">{kind === 'cirurgia' ? 'Cirurgia' : 'Agendado'}</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col" className="hidden text-right xl:table-cell">NF</TableHead>
                    <TableHead scope="col"><span className="sr-only">Ações</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doMes.map((s) => {
                    const prazoVenda = rotuloPrazo(diasAteFechar(s))
                    return (
                    <TableRow key={s.id} className={s.status === 'cancelada' ? 'opacity-60' : undefined}>
                      <TableCell className="hidden whitespace-nowrap lg:table-cell">
                        <div>{dia(s.consultationAt)}</div>
                        <div className={`text-xs ${prazoVenda.tom}`}>{prazoVenda.texto}</div>
                        {s.consultationType && (
                          <div className="text-xs text-muted-foreground">{s.consultationType}</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap md:table-cell">{dia(s.soldAt)}</TableCell>
                      <TableCell className="min-w-36">
                        {/* A ficha 360 é onde consulta do Shosp, cirurgia da sala,
                            tricoscopia do HairMetrix e pagamento se encontram. Da venda
                            até aqui era caminho de decorar URL. */}
                        {s.leadId ? (
                          <Link
                            to={`/leads/${s.leadId}`}
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {s.patientName}
                          </Link>
                        ) : (
                          <span className="font-medium">{s.patientName}</span>
                        )}
                        {s.city && <div className="text-xs text-muted-foreground">{s.city}</div>}
                        {!s.leadId && (
                          <div className="text-xs text-destructive">sem paciente vinculado</div>
                        )}
                        {/* O que as colunas escondidas no celular diriam. */}
                        <div className="text-xs text-muted-foreground sm:hidden">{s.procedureLabel}</div>
                        <div className="text-xs text-muted-foreground md:hidden">
                          vendida em {dia(s.soldAt)}
                          {s.sellerName ? ` · ${s.sellerName}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-[200px] truncate sm:table-cell">
                        {s.procedureLabel}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap xl:table-cell">
                        {s.sellerName ?? <span className="text-xs text-muted-foreground">a informar</span>}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">
                        {s.attendingDoctor ?? s.sellerDoctor ?? '—'}
                        {s.performingDoctor && s.performingDoctor !== (s.attendingDoctor ?? s.sellerDoctor) && (
                          <span className="block text-xs">opera: {s.performingDoctor}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div>{brl(s.valueCents)}</div>
                        <div className="text-xs text-muted-foreground">{tipoNegociacao(s)}</div>
                        {s.depositCents != null && s.depositCents > 0 && (
                          <div className="text-xs text-muted-foreground">
                            entrada {brl(s.depositCents)}
                            {s.depositPayee ? ` · ${DEPOSIT_PAYEE_LABEL[s.depositPayee]}` : ''}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right whitespace-nowrap lg:table-cell">
                        {s.costMaterialsCents + s.costDoctorCents + s.taxCents + s.costOtherCents === 0 ? (
                          <span className="text-xs text-muted-foreground">sem custo</span>
                        ) : (
                          <>
                            <div className={s.profitCents < 0 ? 'text-destructive' : undefined}>
                              {brl(s.profitCents)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {s.valueCents > 0 ? `${Math.round((s.profitCents / s.valueCents) * 100)}%` : '—'}
                            </div>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {s.scheduledAt ? (
                          new Date(s.scheduledAt).toLocaleDateString('pt-BR')
                        ) : (
                          <>
                            <Badge variant="outline">a definir</Badge>
                            {/* "A definir" há 7 meses e "a definir" desde ontem são
                                problemas diferentes, e o selo sozinho não separava. */}
                            {s.status !== 'cancelada' && (
                              <div
                                className={cn(
                                  'mt-0.5 text-xs',
                                  diasDesde(s.soldAt) >= 30 ? 'text-amber-600' : 'text-muted-foreground',
                                )}
                              >
                                parada há {diasDesde(s.soldAt)} dias
                              </div>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.status === 'cancelada'
                              ? 'destructive'
                              : s.status === 'realizada'
                                ? 'secondary'
                                : 'default'
                          }
                        >
                          {STATUS_LABEL[s.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground xl:table-cell">
                        {s.invoiceIssued ? 'Sim' : 'Não'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Editar a venda de ${s.patientName}`}
                            onClick={() => setForm({ open: true, editing: s })}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </Button>
                          {s.status !== 'cancelada' && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Cancelar a venda de ${s.patientName}`}
                              onClick={() => setCancelando(s)}
                            >
                              <Ban className="size-3.5" aria-hidden />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {doMes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado de {rotuloRecorte}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              O que entrou menos o que a venda custou. Custo em branco entra como zero, então lucro só é
              lucro de verdade quando as {doMes.length} vendas do mês estiverem lançadas —
              {resultado.semCusto > 0
                ? ` hoje ${resultado.semCusto} ainda não estão.`
                : ' todas já estão.'}
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Faturamento', valor: resultado.receita, tom: '' },
                { label: 'Material', valor: -resultado.material, tom: 'text-muted-foreground' },
                { label: 'Repasse médico', valor: -resultado.repasse, tom: 'text-muted-foreground' },
                { label: 'Imposto', valor: -resultado.imposto, tom: 'text-muted-foreground' },
                { label: 'Outros', valor: -resultado.outros, tom: 'text-muted-foreground' },
                {
                  label: `Lucro · ${resultado.margem}%`,
                  valor: resultado.lucro,
                  tom: resultado.lucro < 0 ? 'text-destructive' : 'text-emerald-600',
                },
              ].map((linha) => (
                <div key={linha.label}>
                  <p className="text-xs text-muted-foreground">{linha.label}</p>
                  <p className={cn('font-heading text-lg', linha.tom)}>{brl(linha.valor)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {porMedico.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por médico em {rotuloRecorte}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Quem vendeu, quanto vendeu e quantas executa. É o fechamento que hoje é digitado na mão no rodapé
              da planilha.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Médico</TableHead>
                    <TableHead scope="col" className="text-right">Vendeu</TableHead>
                    <TableHead scope="col" className="text-right">Em follow-up</TableHead>
                    <TableHead scope="col" className="text-right">Faturamento</TableHead>
                    <TableHead scope="col" className="text-right">Ticket médio</TableHead>
                    <TableHead scope="col" className="text-right">Executa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porMedico.map((m) => (
                    <TableRow key={m.nome}>
                      <TableCell className="font-medium">{m.nome}</TableCell>
                      <TableCell className="text-right">{m.vendeu}</TableCell>
                      <TableCell className="text-right">
                        {m.followUp}
                        {m.vendeu > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {Math.round((m.followUp / m.vendeu) * 100)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{brl(m.valorCents)}</TableCell>
                      <TableCell className="text-right">{brl(m.ticketCents)}</TableCell>
                      <TableCell className="text-right">{m.executa}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {kind === 'cirurgia' && porProcedimento.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Ticket por procedimento em {rotuloRecorte}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Transplante masculino, feminino e de sobrancelha têm preços diferentes, e a média dos
              três junta não é o preço de nenhum deles. O procedimento é texto livre no cadastro, então
              cada linha mostra as grafias que caíram nela.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Procedimento</TableHead>
                    <TableHead scope="col" className="text-right">Vendeu</TableHead>
                    <TableHead scope="col" className="text-right">Faturamento</TableHead>
                    <TableHead scope="col" className="text-right">Ticket médio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porProcedimento.map((p) => (
                    <TableRow key={p.grupo}>
                      <TableCell>
                        <span className="font-medium">{p.label}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {p.rotulos.join(' · ')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right align-top">{p.vendeu}</TableCell>
                      <TableCell className="text-right align-top">{brl(p.valorCents)}</TableCell>
                      <TableCell className="text-right align-top font-medium">
                        {brl(p.ticketCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <VendaFormDialog
        open={form.open}
        kind={kind}
        staff={staff}
        editing={form.editing}
        onClose={() => setForm({ open: false, editing: null })}
        onSaved={() => void load()}
      />

      <Dialog open={metaAberta} onOpenChange={(v) => (!v ? setMetaAberta(false) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Meta de {nomeDoMes(mes)}
              {vendedora !== 'todas' ? ` · ${vendedora}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Faturamento</Label>
              <Input
                value={metaValor}
                onChange={(e) => setMetaValor(e.target.value)}
                placeholder="400.000,00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Quantidade de vendas (opcional)</Label>
              <Input
                value={metaQtd}
                onChange={(e) => setMetaQtd(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="12"
                inputMode="numeric"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {vendedora === 'todas'
                ? 'Esta é a meta da clínica inteira. Para a meta de uma consultora, escolha o nome dela no filtro antes de abrir aqui.'
                : `Meta individual de ${vendedora}. A meta da clínica é definida com o filtro em "todas".`}
            </p>
          </div>
          <DialogFooter>
            {meta && (
              <Button variant="ghost" disabled={salvandoMeta} onClick={() => void apagarMeta()}>
                Apagar
              </Button>
            )}
            <Button variant="ghost" onClick={() => setMetaAberta(false)}>
              Cancelar
            </Button>
            <Button disabled={salvandoMeta} onClick={() => void salvarMeta()}>
              {salvandoMeta ? 'Salvando…' : 'Salvar meta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelando != null} onOpenChange={(v) => (!v ? setCancelando(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancelar a venda de {cancelando?.patientName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivos pessoais, não quis seguir, condição de saúde…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Estorno da entrada</Label>
              <Input value={estorno} onChange={(e) => setEstorno(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Textarea value={obsCancel} onChange={(e) => setObsCancel(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={() => void confirmarCancelamento()}>
              Cancelar venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
