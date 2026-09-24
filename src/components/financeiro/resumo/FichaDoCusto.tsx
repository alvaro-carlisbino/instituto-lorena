// A FICHA DE UM CUSTO: o que abre quando se clica numa fatia, numa barra ou num centro.
//
// Pedido do Kauan: "clicar em um custo e abrir ele como algo mais bonito e financeiro". A ficha
// responde as perguntas do Dr. na ordem em que ele faz: quanto foi, quanto isso é do mês, como
// se espalhou nos dias, em quê, e para quem, até o pagamento individual (mesma escada de
// GastosPorCentro: somado por quem recebeu, e abrindo cada pagamento).
//
// O cartão de crédito abre na fatura, compra a compra, com o seletor de centro de custo.

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { ChevronRight } from 'lucide-react'

import { FaturasCartao } from '@/components/financeiro/FaturasCartao'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { assinaturaPagador, agruparPorPagador } from '@/lib/extratoPadrao'
import { CENTRO_CARTAO } from '@/lib/faturaCartao'
import {
  SEM_CENTRO,
  diasDoPeriodo,
  serie,
  totaisPorCentro,
  type Direcao,
  type MovimentoClassificado,
} from '@/lib/resumoBanco'
import { cn } from '@/lib/utils'
import type { CostCenter, CostDetail, FinAccount } from '@/services/financeiro'
import { brl, corDe, pct } from './cores'

export type AlvoFicha = { tipo: 'classe'; direcao: Direcao; chave: string } | { tipo: 'centro'; chave: string }

const SEM_DETALHE = 'Sem detalhe'
const RECEBEDORES_VISIVEIS = 12
const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function FichaDoCusto({
  alvo,
  movimentos,
  de,
  ate,
  rotuloPeriodo,
  centros,
  detalhes,
  cartoes,
  onFechar,
  onAbrir,
  onMudou,
}: {
  alvo: AlvoFicha | null
  /** Já recortados no dia ou semana escolhidos, se houver. */
  movimentos: MovimentoClassificado[]
  de: string
  ate: string
  rotuloPeriodo: string
  centros: CostCenter[]
  detalhes: CostDetail[]
  cartoes: FinAccount[]
  onFechar: () => void
  onAbrir: (a: AlvoFicha) => void
  onMudou: () => void
}) {
  return (
    <Sheet open={Boolean(alvo)} onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent
        side="right"
        className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {alvo ? (
          <Conteudo
            key={`${alvo.tipo}:${alvo.chave}`}
            alvo={alvo}
            movimentos={movimentos}
            de={de}
            ate={ate}
            rotuloPeriodo={rotuloPeriodo}
            centros={centros}
            detalhes={detalhes}
            cartoes={cartoes}
            onAbrir={onAbrir}
            onMudou={onMudou}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Conteudo({
  alvo,
  movimentos,
  de,
  ate,
  rotuloPeriodo,
  centros,
  detalhes,
  cartoes,
  onAbrir,
  onMudou,
}: {
  alvo: AlvoFicha
  movimentos: MovimentoClassificado[]
  de: string
  ate: string
  rotuloPeriodo: string
  centros: CostCenter[]
  detalhes: CostDetail[]
  cartoes: FinAccount[]
  onAbrir: (a: AlvoFicha) => void
  onMudou: () => void
}) {
  const navigate = useNavigate()
  const [pagadorAberto, setPagadorAberto] = useState<string | null>(null)
  const [todos, setTodos] = useState(false)

  const direcao: Direcao = alvo.tipo === 'classe' ? alvo.direcao : 'out'
  const ehCartao = alvo.chave === CENTRO_CARTAO

  const itens = useMemo(
    () =>
      movimentos.filter((m) => {
        if (m.foraDoTotal || m.direcao !== direcao) return false
        if (alvo.tipo === 'classe') return m.classe === alvo.chave
        if (ehCartao) return m.fatura
        if (alvo.chave === SEM_CENTRO) return m.classe === SEM_CENTRO
        return m.centro === alvo.chave && !m.fatura
      }),
    [movimentos, alvo, direcao, ehCartao],
  )

  const totalDirecao = useMemo(
    () => movimentos.filter((m) => !m.foraDoTotal && m.direcao === direcao).reduce((s, m) => s + m.amountCents, 0),
    [movimentos, direcao],
  )
  const total = itens.reduce((s, i) => s + i.amountCents, 0)
  const maior = itens.reduce<MovimentoClassificado | null>((m, i) => (!m || i.amountCents > m.amountCents ? i : m), null)
  const classe = alvo.tipo === 'classe' ? alvo.chave : (itens[0]?.classe ?? SEM_CENTRO)
  const cor = corDe(direcao, classe)
  const grupoDoCentro = alvo.tipo === 'centro' && !ehCartao && alvo.chave !== SEM_CENTRO ? classe : null

  const porDia = useMemo(() => serie(itens, diasDoPeriodo(de, ate)), [itens, de, ate])
  const centrosDoGrupo = useMemo(
    () => (alvo.tipo === 'classe' && direcao === 'out' && !ehCartao ? totaisPorCentro(itens) : []),
    [itens, alvo.tipo, direcao, ehCartao],
  )
  const porDetalhe = useMemo(() => {
    if (alvo.tipo !== 'centro' || ehCartao) return []
    const m = new Map<string, number>()
    for (const i of itens) m.set(i.detalhe?.trim() || SEM_DETALHE, (m.get(i.detalhe?.trim() || SEM_DETALHE) ?? 0) + i.amountCents)
    return [...m.entries()].map(([nome, cents]) => ({ nome, cents })).sort((a, b) => b.cents - a.cents)
  }, [itens, alvo.tipo, ehCartao])
  const pagadores = useMemo(
    () => agruparPorPagador(itens.map((i) => ({ ...i, chave: assinaturaPagador(i.nome || i.descricao) }))),
    [itens],
  )

  const oQue = direcao === 'in' ? 'da entrada' : 'da saída'
  const visiveis = todos ? pagadores : pagadores.slice(0, RECEBEDORES_VISIVEIS)

  return (
    <>
      <SheetHeader className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="viz inline-flex">
            <span className="size-3 rounded-[3px]" style={{ background: cor }} />
          </span>
          {alvo.tipo === 'classe' ? (direcao === 'in' ? 'Forma de entrada' : 'Grupo de gasto') : grupoDoCentro ? `Centro de custo · ${grupoDoCentro}` : 'Saída'}
          <span>· {rotuloPeriodo}</span>
        </div>
        <SheetTitle className="text-xl">{alvo.chave}</SheetTitle>
        <SheetDescription className="sr-only">Detalhe do valor e de cada pagamento</SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-5 py-5">
        {/* Os números da ficha. O grande é o total; o resto responde "isso é muito?". */}
        <div>
          <div className="text-4xl font-semibold tracking-tight">{brl(total)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {pct(total, totalDirecao)} {oQue} do período ({brl(totalDirecao)})
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Mini rotulo={direcao === 'in' ? 'Entradas' : 'Pagamentos'} valor={String(itens.length)} />
            <Mini rotulo="Média" valor={itens.length ? brl(Math.round(total / itens.length)) : '—'} />
            <Mini rotulo="Maior" valor={maior ? brl(maior.amountCents) : '—'} dica={maior ? `${diaCurto(maior.data)} · ${maior.nome}` : undefined} />
          </div>
        </div>

        <Secao titulo="Dia a dia">
          <div className="viz">
            <ResponsiveContainer width="100%" height={130}>
              {/* Sem camada de teclado: a ficha abriria com o foco no gráfico e a dica do dia 1 acesa.
                  Cada valor daqui está escrito na lista de pagamentos logo abaixo. */}
              <BarChart
                data={porDia.map((p) => ({ rotulo: p.rotulo, v: (direcao === 'in' ? p.entrou : p.saiu) / 100 }))}
                accessibilityLayer={false}
              >
                <XAxis
                  dataKey="rotulo"
                  tick={{ fontSize: 10, fill: 'var(--viz-muted)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--viz-linha)' }}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
                <Tooltip
                  cursor={{ fill: 'var(--viz-grade)', opacity: 0.5 }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-border bg-popover px-2 py-1 text-xs shadow">
                        Dia {String((payload[0].payload as { rotulo: string }).rotulo)}:{' '}
                        <span className="tabular-nums">{brl(Number(payload[0].value) * 100)}</span>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="v" fill={cor} radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Secao>

        {ehCartao && (
          <Secao titulo="A fatura, compra a compra">
            <FaturasCartao
              pagamentos={itens.map((i) => ({ id: i.id, data: i.data, descricao: i.descricao, amountCents: i.amountCents }))}
              cartoes={cartoes}
              centros={centros}
              detalhes={detalhes}
              onMudou={onMudou}
            />
          </Secao>
        )}

        {centrosDoGrupo.length > 0 && (
          <Secao titulo="Por centro de custo">
            <div className="space-y-1">
              {centrosDoGrupo.map((c) => (
                <button
                  key={c.centro}
                  type="button"
                  onClick={() => onAbrir({ tipo: 'centro', chave: c.centro })}
                  className="grid w-full grid-cols-[minmax(110px,170px)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                >
                  <span className="truncate text-sm">{c.centro}</span>
                  <span className="viz flex items-center gap-2">
                    <span className="h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(2, (c.cents / (centrosDoGrupo[0]?.cents || 1)) * 100)}%`, background: cor }} />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct(c.cents, total)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-medium tabular-nums">
                    {brl(c.cents)} <ChevronRight className="size-3.5 text-muted-foreground" />
                  </span>
                </button>
              ))}
            </div>
          </Secao>
        )}

        {porDetalhe.length > 1 || (porDetalhe[0] && porDetalhe[0].nome !== SEM_DETALHE) ? (
          <Secao titulo="Em quê">
            <div className="flex flex-wrap gap-1.5">
              {porDetalhe.map((d) => (
                <span
                  key={d.nome}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    d.nome === SEM_DETALHE ? 'border-amber-500/50 text-amber-700 dark:text-amber-400' : 'border-border',
                  )}
                >
                  {d.nome} · <span className="tabular-nums">{brl(d.cents)}</span>{' '}
                  <span className="text-muted-foreground">{pct(d.cents, total)}</span>
                </span>
              ))}
            </div>
          </Secao>
        ) : null}

        {alvo.chave === SEM_CENTRO && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm">
            Estas saídas ainda não têm centro de custo, então não aparecem em grupo nenhum.
            <Button size="sm" variant="outline" className="ml-2 h-7" onClick={() => navigate('/extrato')}>
              Classificar no Extrato
            </Button>
          </div>
        )}

        {!ehCartao && (
          <Secao titulo={direcao === 'in' ? 'Quem pagou' : 'Quem recebeu'}>
            <table className="w-full text-sm">
              <tbody>
                {visiveis.map((p) => {
                  const varios = p.itens.length > 1
                  const aberto = pagadorAberto === p.rotulo
                  const unico = p.itens[0]
                  return (
                    <Fragment key={p.rotulo}>
                      <tr
                        className={cn('border-t border-border/60', varios && 'cursor-pointer hover:bg-muted/40')}
                        onClick={varios ? () => setPagadorAberto(aberto ? null : p.rotulo) : undefined}
                      >
                        <td className="py-1.5 pr-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {varios ? (
                              <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')} />
                            ) : (
                              <span className="w-3.5 shrink-0" />
                            )}
                            <span className="truncate font-medium" title={p.rotulo}>
                              {p.rotulo}
                            </span>
                          </div>
                          <div className="pl-5 text-xs text-muted-foreground">
                            {varios ? `${p.itens.length} pagamentos · média ${brl(Math.round(p.totalCents / p.itens.length))}` : diaCurto(unico.data)}
                            {!varios && unico.centro && alvo.tipo === 'classe' ? ` · ${unico.centro}` : ''}
                            {!varios && unico.detalhe ? ` · ${unico.detalhe}` : ''}
                          </div>
                        </td>
                        <td className="w-14 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{pct(p.totalCents, total)}</td>
                        <td className="w-28 py-1.5 text-right font-medium tabular-nums">{brl(p.totalCents)}</td>
                      </tr>
                      {aberto &&
                        [...p.itens]
                          .sort((a, b) => a.data.localeCompare(b.data))
                          .map((i) => (
                            <tr key={i.id} className="bg-muted/30 text-xs">
                              <td className="py-1 pl-6 pr-2">
                                <span className="tabular-nums text-muted-foreground">{diaCurto(i.data)}</span>{' '}
                                <span className="truncate">{i.descricao}</span>
                                {i.detalhe ? <span className="text-muted-foreground"> · {i.detalhe}</span> : null}
                              </td>
                              <td />
                              <td className="py-1 text-right tabular-nums">{brl(i.amountCents)}</td>
                            </tr>
                          ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {pagadores.length > RECEBEDORES_VISIVEIS && (
              <button
                type="button"
                onClick={() => setTodos((v) => !v)}
                className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {todos ? 'Mostrar só os maiores' : `Ver todos os ${pagadores.length}`}
              </button>
            )}
          </Secao>
        )}
      </div>
    </>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  )
}

function Mini({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-[0.7rem] text-muted-foreground">{rotulo}</div>
      <div className="text-sm font-semibold">{valor}</div>
      {dica ? (
        <div className="truncate text-[0.68rem] text-muted-foreground" title={dica}>
          {dica}
        </div>
      ) : null}
    </div>
  )
}
