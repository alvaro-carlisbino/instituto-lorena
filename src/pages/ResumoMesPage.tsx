// RESUMO DO MÊS: o mês do banco para quem decide.
//
// Pedido do Kauan (24/set/2026), para apresentar o mês ao Dr.: gráfico por dia e por semana,
// as semanas do mês marcadas, cores diferentes para cada tipo de saída, pizza, colunas, linha de
// acompanhamento dos dias, clicar num custo e abrir o detalhe, e entrada e saída separadas, com
// a opção de ver só uma ("fica mais simples para ele visualizar e formar as ideias").
//
// É a leitura do EXTRATO DA CONTA CORRENTE: o que entrou e saiu de fato. O cartão aparece pelo
// boleto da fatura e abre nas compras. Transferência entre contas, aplicação e resgate ficam
// fora dos números e são ditos numa linha à parte. Classificar continua sendo no Extrato; aqui
// só se lê (com uma exceção: as compras do cartão se classificam dentro da fatura, na ficha).
//
// Um filtro para a tela toda, no topo. Clicar numa coluna ou numa semana recorta a tela nela.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownRight, ArrowUpRight, RefreshCw, X } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FichaDoCusto, type AlvoFicha } from '@/components/financeiro/resumo/FichaDoCusto'
import { GraficoAcumulado } from '@/components/financeiro/resumo/GraficoAcumulado'
import { GraficoPeriodo, type Modo } from '@/components/financeiro/resumo/GraficoPeriodo'
import { Rosca } from '@/components/financeiro/resumo/Rosca'
import { SemanasDoMes } from '@/components/financeiro/resumo/SemanasDoMes'
import { TorreCentros } from '@/components/financeiro/resumo/TorreCentros'
import { brl } from '@/components/financeiro/resumo/cores'
import { useTenant } from '@/context/TenantContext'
import { mesAtual, periodoDoMes, type Periodo } from '@/lib/periodo'
import {
  acumulado,
  classificar,
  diasDoPeriodo,
  periodoDeComparacao,
  semanasDoPeriodo,
  serie,
  totais,
  totaisPorCentro,
  totaisPorClasse,
  variacao,
  type Faixa,
  type Movimento,
  type MovimentoClassificado,
} from '@/lib/resumoBanco'
import { cn } from '@/lib/utils'
import {
  listAccounts,
  listCategories,
  listCostCenters,
  listCostDetails,
  listTransactions,
  type CostCenter,
  type CostDetail,
  type FinAccount,
  type FinCategory,
  type FinTransaction,
} from '@/services/financeiro'

const MODOS: Array<[Modo, string]> = [
  ['ambos', 'Entradas e saídas'],
  ['saidas', 'Só saídas'],
  ['entradas', 'Só entradas'],
]

function paraMovimentos(tx: FinTransaction[], idsBanco: Set<string>, categorias: Map<string, string>): Movimento[] {
  return tx
    .filter((t) => idsBanco.has(t.accountId))
    .map((t) => ({
      id: t.id,
      data: t.date,
      direcao: t.direction,
      amountCents: Math.abs(t.amountCents),
      descricao: t.description ?? '',
      nome: t.counterparty || t.description || 'sem descrição',
      centro: t.costCenter,
      detalhe: t.costDetail,
      categoria: t.categoryId ? (categorias.get(t.categoryId) ?? null) : null,
      faturaSemCompras: t.faturaSemCompras,
    }))
}

export function ResumoMesPage() {
  const { tenant } = useTenant()
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const [modo, setModo] = useState<Modo>('ambos')
  const [porSemana, setPorSemana] = useState(false)
  /** Dia ou semana escolhidos no gráfico. Recorta os números, as roscas e o ranking. */
  const [recorte, setRecorte] = useState<Faixa | null>(null)
  const [alvo, setAlvo] = useState<AlvoFicha | null>(null)

  const [tx, setTx] = useState<FinTransaction[]>([])
  const [txAntes, setTxAntes] = useState<FinTransaction[]>([])
  const [contas, setContas] = useState<FinAccount[]>([])
  const [centros, setCentros] = useState<CostCenter[]>([])
  const [detalhes, setDetalhes] = useState<CostDetail[]>([])
  const [categorias, setCategorias] = useState<FinCategory[]>([])
  const [carregando, setCarregando] = useState(false)

  const comparacao = useMemo(() => periodoDeComparacao(periodo), [periodo])

  const carregar = async (silencioso = false) => {
    if (!silencioso) setCarregando(true)
    try {
      const [a, t, ta, cc, det, cats] = await Promise.all([
        listAccounts(),
        listTransactions({ from: periodo.de, to: periodo.ate, limit: 5000 }),
        // A comparação é auxiliar: se falhar, a tela não cai junto.
        listTransactions({ from: comparacao.de, to: comparacao.ate, limit: 5000 }).catch(() => [] as FinTransaction[]),
        listCostCenters(),
        listCostDetails().catch(() => [] as CostDetail[]),
        listCategories(),
      ])
      setContas(a)
      setTx(t)
      setTxAntes(ta)
      setCentros(cc)
      setDetalhes(det)
      setCategorias(cats)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o mês')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.de, periodo.ate])

  const idsBanco = useMemo(() => new Set(contas.filter((c) => c.kind === 'banco').map((c) => c.id)), [contas])
  const cartoes = useMemo(() => contas.filter((c) => c.kind === 'carteira' && c.active), [contas])
  const nomeCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.name])), [categorias])

  const movs = useMemo(
    () => classificar(paraMovimentos(tx, idsBanco, nomeCategoria), centros),
    [tx, idsBanco, nomeCategoria, centros],
  )
  const movsAntes = useMemo(
    () => classificar(paraMovimentos(txAntes, idsBanco, nomeCategoria), centros),
    [txAntes, idsBanco, nomeCategoria, centros],
  )
  const noRecorte = useMemo<MovimentoClassificado[]>(
    () => (recorte ? movs.filter((m) => m.data >= recorte.de && m.data <= recorte.ate) : movs),
    [movs, recorte],
  )

  const dias = useMemo(() => diasDoPeriodo(periodo.de, periodo.ate), [periodo.de, periodo.ate])
  const semanas = useMemo(() => semanasDoPeriodo(periodo.de, periodo.ate), [periodo.de, periodo.ate])
  const pontosDia = useMemo(() => serie(movs, dias), [movs, dias])
  const pontosSemana = useMemo(() => serie(movs, semanas), [movs, semanas])
  const linhaDoMes = useMemo(() => acumulado(pontosDia), [pontosDia])

  const t = useMemo(() => totais(noRecorte), [noRecorte])
  const tAntes = useMemo(() => totais(movsAntes), [movsAntes])
  const saidaPorGrupo = useMemo(() => totaisPorClasse(noRecorte, 'out'), [noRecorte])
  const entradaPorForma = useMemo(() => totaisPorClasse(noRecorte, 'in'), [noRecorte])
  const porCentro = useMemo(() => totaisPorCentro(noRecorte), [noRecorte])

  const diasNoRecorte = recorte ? diasDoPeriodo(recorte.de, recorte.ate).length : dias.length
  const rotuloRecorte = recorte ? (recorte.de === recorte.ate ? `Dia ${recorte.rotulo}` : recorte.rotuloLongo) : periodo.rotulo
  // Comparar só faz sentido com o período inteiro: um dia contra um mês não diz nada.
  const comparar = !recorte && movsAntes.length > 0

  const mostraEntrada = modo !== 'saidas'
  const mostraSaida = modo !== 'entradas'
  const vazio = !carregando && movs.length === 0

  return (
    <AppLayout
      title="Resumo do mês"
      subtitle="O que entrou e o que saiu da conta do banco, em gráficos. Clique em qualquer valor para abrir o detalhe."
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      {/* Um filtro para a tela inteira, antes de tudo que ele recorta. */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <FiltroPeriodo
          valor={periodo}
          onChange={(p) => {
            setPeriodo(p)
            setRecorte(null)
          }}
          atalhos={['mes-atual', 'mes-passado', 'dias:30', 'dias:90']}
        />
        <Segmentos valor={modo} opcoes={MODOS} onChange={setModo} rotulo="Mostrar" />
        <Segmentos
          valor={porSemana ? 'semana' : 'dia'}
          opcoes={[
            ['dia', 'Por dia'],
            ['semana', 'Por semana'],
          ]}
          onChange={(v) => {
            setPorSemana(v === 'semana')
            setRecorte(null)
          }}
          rotulo="Colunas"
        />
        <Button variant="ghost" size="sm" onClick={() => void carregar()} disabled={carregando}>
          <RefreshCw size={14} className={carregando ? 'animate-spin' : ''} /> Atualizar
        </Button>
      </div>

      {recorte && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          Mostrando só <span className="font-medium">{rotuloRecorte}</span>.
          <button
            type="button"
            onClick={() => setRecorte(null)}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <X className="size-3.5" /> Ver {periodo.rotulo} inteiro
          </button>
        </div>
      )}

      <div className={cn('transition-opacity', carregando && movs.length > 0 && 'opacity-60')}>
        {/* Os números do período. Cada um diz com o que está sendo comparado. */}
        <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {mostraEntrada && (
            <Numero
              rotulo="Entrou"
              valor={brl(t.entrou)}
              variacao={comparar ? variacao(t.entrou, tAntes.entrou) : null}
              subirEBom
              contra={comparacao.rotuloCurto}
              dica={t.entrouFora > 0 ? `Fora: ${brl(t.entrouFora)} de resgate e transferência entre contas` : `${brl(Math.round(t.entrou / Math.max(1, diasNoRecorte)))} por dia`}
            />
          )}
          {mostraSaida && (
            <Numero
              rotulo="Saiu"
              valor={brl(t.saiu)}
              variacao={comparar ? variacao(t.saiu, tAntes.saiu) : null}
              contra={comparacao.rotuloCurto}
              dica={t.saiuFora > 0 ? `Fora: ${brl(t.saiuFora)} de aplicação e transferência entre contas` : `${brl(Math.round(t.saiu / Math.max(1, diasNoRecorte)))} por dia`}
            />
          )}
          {modo === 'ambos' && (
            <Numero
              rotulo="Entrou menos saiu"
              valor={brl(t.entrou - t.saiu)}
              negativo={t.entrou - t.saiu < 0}
              dica="Movimento do banco no período. Não é o lucro: o DRE é quem apura."
            />
          )}
          {mostraSaida && (
            <Numero
              rotulo="Saída sem centro de custo"
              valor={brl(t.semCentro)}
              alerta={t.semCentro > 0}
              dica={t.semCentro > 0 ? `${t.semCentroN} saída(s) que não entram em grupo nenhum até alguém classificar no Extrato` : 'Toda saída tem centro de custo'}
              onClick={t.semCentro > 0 ? () => setAlvo({ tipo: 'centro', chave: 'Sem centro de custo' }) : undefined}
            />
          )}
          {modo === 'saidas' && (
            <Numero
              rotulo="Maior grupo"
              valor={saidaPorGrupo.length ? [...saidaPorGrupo].sort((a, b) => b.cents - a.cents)[0].classe : '—'}
              dica={
                saidaPorGrupo.length
                  ? `${brl([...saidaPorGrupo].sort((a, b) => b.cents - a.cents)[0].cents)} do que saiu`
                  : ''
              }
            />
          )}
          {modo === 'entradas' && (
            <>
              <Numero
                rotulo="Maior forma de entrada"
                valor={entradaPorForma.length ? [...entradaPorForma].sort((a, b) => b.cents - a.cents)[0].classe : '—'}
                dica={
                  entradaPorForma.length ? `${brl([...entradaPorForma].sort((a, b) => b.cents - a.cents)[0].cents)} do que entrou` : ''
                }
              />
              <Numero
                rotulo="Entradas"
                valor={String(noRecorte.filter((m) => m.direcao === 'in' && !m.foraDoTotal).length)}
                dica={`média de ${brl(Math.round(t.entrou / Math.max(1, noRecorte.filter((m) => m.direcao === 'in' && !m.foraDoTotal).length)))} cada`}
              />
            </>
          )}
        </div>

        {vazio ? (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Nenhum movimento do banco em {periodo.rotulo}.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Semanas do mês</CardTitle>
              </CardHeader>
              <CardContent>
                <SemanasDoMes
                  semanas={pontosSemana}
                  modo={modo}
                  selecionado={recorte && recorte.de !== recorte.ate ? recorte.chave : null}
                  onSelecionar={(p) => setRecorte(p)}
                />
              </CardContent>
            </Card>

            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {porSemana ? 'Semana a semana' : 'Dia a dia'}
                  {modo === 'saidas' ? ': saída por grupo' : modo === 'entradas' ? ': entrada por forma' : ': entrou e saiu'}
                  <span className="font-normal text-muted-foreground"> · em reais</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <GraficoPeriodo
                  pontos={porSemana ? pontosSemana : pontosDia}
                  modo={modo}
                  porSemana={porSemana}
                  selecionado={recorte?.chave ?? null}
                  onSelecionar={(p) => setRecorte(p)}
                />
              </CardContent>
            </Card>

            <div className="mb-4 grid gap-4 xl:grid-cols-2">
              {mostraSaida && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Para onde foi o dinheiro</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Rosca
                      itens={saidaPorGrupo}
                      direcao="out"
                      rotuloTotal="saiu"
                      vazio="Nada saiu no período."
                      onAbrir={(c) => setAlvo({ tipo: 'classe', direcao: 'out', chave: c })}
                    />
                  </CardContent>
                </Card>
              )}
              {mostraEntrada && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">De onde veio o dinheiro</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Rosca
                      itens={entradaPorForma}
                      direcao="in"
                      rotuloTotal="entrou"
                      vazio="Nada entrou no período."
                      onAbrir={(c) => setAlvo({ tipo: 'classe', direcao: 'in', chave: c })}
                    />
                  </CardContent>
                </Card>
              )}
              {mostraSaida && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Saída por centro de custo</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TorreCentros itens={porCentro} onAbrir={(c) => setAlvo({ tipo: 'centro', chave: c })} />
                  </CardContent>
                </Card>
              )}
              {/* Só saídas deixa três cartões: o acompanhamento ocupa a linha inteira em vez de um buraco. */}
              <Card className={cn(modo === 'saidas' && 'xl:col-span-2')}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Acompanhamento do mês, somando dia a dia
                    <span className="font-normal text-muted-foreground"> · em reais</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <GraficoAcumulado pontos={linhaDoMes} modo={modo} />
                </CardContent>
              </Card>
            </div>

            {(t.entrouFora > 0 || t.saiuFora > 0) && (
              <p className="text-xs text-muted-foreground">
                Fora de todos os números acima, porque é dinheiro da própria clínica trocando de lugar:
                {t.entrouFora > 0 ? ` entrou ${brl(t.entrouFora)} (resgate de aplicação e transferência entre contas)` : ''}
                {t.entrouFora > 0 && t.saiuFora > 0 ? ' e' : ''}
                {t.saiuFora > 0 ? ` saiu ${brl(t.saiuFora)} (aplicação e transferência entre contas)` : ''}.
              </p>
            )}
          </>
        )}
      </div>

      <FichaDoCusto
        alvo={alvo}
        movimentos={noRecorte}
        de={recorte?.de ?? periodo.de}
        ate={recorte?.ate ?? periodo.ate}
        rotuloPeriodo={rotuloRecorte}
        centros={centros}
        detalhes={detalhes}
        cartoes={cartoes}
        onFechar={() => setAlvo(null)}
        onAbrir={setAlvo}
        onMudou={() => void carregar(true)}
      />
    </AppLayout>
  )
}

function Segmentos<T extends string>({
  valor,
  opcoes,
  onChange,
  rotulo,
}: {
  valor: T
  opcoes: Array<[T, string]>
  onChange: (v: T) => void
  rotulo: string
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label={rotulo}>
      {opcoes.map(([v, r]) => (
        <button
          key={v}
          type="button"
          aria-pressed={valor === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            valor === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

function Numero({
  rotulo,
  valor,
  dica,
  variacao: v,
  contra,
  subirEBom,
  alerta,
  negativo,
  onClick,
}: {
  rotulo: string
  valor: string
  dica?: string
  variacao?: number | null
  contra?: string
  /** Entrada subir é bom; saída subir é ruim. Define a cor da seta, nunca a cor sozinha. */
  subirEBom?: boolean
  alerta?: boolean
  negativo?: boolean
  onClick?: () => void
}) {
  const bom = v == null ? null : subirEBom ? v >= 0 : v <= 0
  const Corpo = (
    <>
      <div className="text-xs font-medium text-muted-foreground">{rotulo}</div>
      <div
        className={cn(
          'mt-1 truncate text-2xl font-semibold',
          alerta && 'text-amber-700 dark:text-amber-400',
          negativo && 'text-red-600 dark:text-red-400',
        )}
        title={valor}
      >
        {valor}
      </div>
      {v != null && Number.isFinite(v) && (
        <div
          className={cn(
            'mt-0.5 inline-flex items-center gap-1 text-xs font-medium',
            bom ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
          )}
        >
          {v >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {v >= 0 ? '+' : '−'}
          {Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%{' '}
          <span className="font-normal text-muted-foreground">contra {contra}</span>
        </div>
      )}
      {dica ? <div className="mt-0.5 text-[0.72rem] leading-snug text-muted-foreground">{dica}</div> : null}
    </>
  )
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-amber-500/40 bg-amber-500/[0.04] px-4 py-3 text-left transition-colors hover:bg-amber-500/[0.08]"
    >
      {Corpo}
    </button>
  ) : (
    <div className={cn('rounded-xl border border-border bg-card px-4 py-3')}>{Corpo}</div>
  )
}

export default ResumoMesPage
