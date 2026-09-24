// GASTOS POR CENTRO DE CUSTO, COM O "DO QUE É FEITO" A UM CLIQUE.
//
// Pedido para a reunião com o Dr.: clicar no centro e ver os maiores pagamentos dele; os de
// mesmo nome somados, e clicando no somado ver cada pagamento. Um total em "Salários e
// encargos" não responde nada sozinho; "a maior parte foi para um fornecedor, em 6 PIX" responde.
//
// Três níveis, sempre do maior para o menor:
//   centro  →  quem recebeu (somado)  →  cada pagamento
//
// O que não é gasto (transferência entre contas, aplicação) aparece separado no fim e fora do
// total, e "sem centro" vem primeiro e em âmbar: enquanto for grande, a divisão por centro está
// falando de uma parte do dinheiro.

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { CentroCustoPicker } from '@/components/financeiro/CentroCustoPicker'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { CENTRO_A_CONFIRMAR } from '@/lib/centroCusto'
import { assinaturaPagador, agruparPorPagador, padraoDaRegra } from '@/lib/extratoPadrao'
import { cn } from '@/lib/utils'
import type { CostCenter, CostDetail } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '')
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const pct = (parte: number, todo: number) =>
  todo > 0 ? `${((parte / todo) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '0%'

export type LinhaGasto = {
  id: string
  /** Id do lançamento no banco ou da conta a pagar, para classificar dali. */
  refId?: string
  origem?: 'banco' | 'a pagar'
  data: string
  /** Quem recebeu, como a tela deve mostrar. */
  nome: string
  /** Descrição crua do banco ou da nota, para quem quiser conferir. */
  descricao: string
  amountCents: number
  centro: string | null
  /** Em quê, dentro do centro. É o que responde "Centro Cirúrgico, mas com o quê?". */
  detalhe?: string | null
  foraDoTotal: boolean
  /** Nota que o banco ainda não mostrou paga. */
  nota?: boolean
  possivelDuplicado?: boolean
}

const SEM_DETALHE = 'Sem detalhe'
const SEM_CENTRO = 'Sem centro de custo'
const PAGADORES_VISIVEIS = 8

export function GastosPorCentro({
  linhas,
  centros,
  vazio = 'Nada saiu no período.',
  onClassificar,
  onClassificarVarios,
  detalhes = [],
  conteudoDoCentro,
}: {
  linhas: LinhaGasto[]
  centros: CostCenter[]
  vazio?: string
  /**
   * Classificar em lote o que foi marcado, SEM criar regra. É o caso do Mercado Livre: o nome
   * é o mesmo em toda compra, então só quem confere o pedido sabe o centro, e uma regra
   * decidiria a próxima compra no chute. Marcar 20 e escolher uma vez é o que evita o um a um.
   */
  onClassificarVarios?: (linhas: LinhaGasto[], centro: CostCenter, detalhe: string | null) => Promise<void>
  /** Subclassificação, para o lote já perguntar "Retirada sócios, de quem?". */
  detalhes?: CostDetail[]
  /**
   * Classificar direto do "Sem centro de custo": o recebedor inteiro de uma vez quando o nome
   * identifica alguém, ou pagamento por pagamento quando não identifica (PIX QR-CODE).
   */
  onClassificar?: (
    linha: LinhaGasto,
    centro: CostCenter,
    aplicarIguais: boolean,
    padrao: string | null,
  ) => Promise<void>
  /**
   * O que mostrar ao abrir um centro que não é lista de recebedores. É o caso do cartão no
   * Extrato: o boleto abre nas compras da fatura, cada uma com o seu centro.
   */
  conteudoDoCentro?: (centro: string) => ReactNode | null
}) {
  const [centroAberto, setCentroAberto] = useState<string | null>(null)
  const [pagadorAberto, setPagadorAberto] = useState<string | null>(null)
  const [todosDe, setTodosDe] = useState<string | null>(null)
  /** Compras marcadas para classificar juntas (id da LinhaGasto). */
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const alternar = (ids: string[], marcar: boolean) =>
    setMarcados((atual) => {
      const novo = new Set(atual)
      for (const id of ids) {
        if (marcar) novo.add(id)
        else novo.delete(id)
      }
      return novo
    })

  const { dentro, fora, totalDentro, totalFora } = useMemo(() => {
    const porCentro = new Map<string, LinhaGasto[]>()
    for (const l of linhas) {
      const k = l.centro ?? SEM_CENTRO
      porCentro.set(k, [...(porCentro.get(k) ?? []), l])
    }
    const blocos = [...porCentro.entries()].map(([centro, itens]) => {
      const total = itens.reduce((s, i) => s + i.amountCents, 0)
      const pagadores = agruparPorPagador(itens.map((i) => ({ ...i, chave: i.nota ? i.nome : assinaturaPagador(i.nome) })))
      // "Centro Cirúrgico, mas em quê?" — a quebra por subclassificação, maior primeiro. O que
      // ainda não tem detalhe aparece como "Sem detalhe" em vez de sumir: é ele que diz o
      // tamanho do que falta responder.
      const porDetalhe = new Map<string, number>()
      for (const i of itens) {
        const k = i.detalhe?.trim() || SEM_DETALHE
        porDetalhe.set(k, (porDetalhe.get(k) ?? 0) + i.amountCents)
      }
      const detalhes = [...porDetalhe.entries()]
        .map(([nome, cents]) => ({ nome, cents }))
        .sort((x, y) => y.cents - x.cents)
      return {
        centro,
        itens,
        total,
        pagadores,
        detalhes,
        foraDoTotal: itens.every((i) => i.foraDoTotal),
        descricao: centros.find((c) => c.name === centro)?.description ?? null,
      }
    })
    const d = blocos
      .filter((b) => !b.foraDoTotal)
      // "Sem centro" primeiro: é o que falta fazer, e o que torna o resto parcial.
      .sort((a, b) => (a.centro === SEM_CENTRO ? -1 : b.centro === SEM_CENTRO ? 1 : b.total - a.total))
    const f = blocos
      .filter((b) => b.foraDoTotal)
      // "Pessoal ou empresa?" abre a lista de fora: é a única dali que ainda espera resposta.
      .sort((a, b) => (a.centro === CENTRO_A_CONFIRMAR ? -1 : b.centro === CENTRO_A_CONFIRMAR ? 1 : b.total - a.total))
    return {
      dentro: d,
      fora: f,
      totalDentro: d.reduce((s, b) => s + b.total, 0),
      totalFora: f.reduce((s, b) => s + b.total, 0),
    }
  }, [linhas, centros])

  if (linhas.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{vazio}</p>
  }

  const maior = Math.max(1, ...dentro.filter((b) => b.centro !== SEM_CENTRO).map((b) => b.total))

  const renderBloco = (b: (typeof dentro)[number], referencia: number) => {
    const aberto = centroAberto === b.centro
    const semCentro = b.centro === SEM_CENTRO
    // "Pessoal ou empresa?" está fora do total mas é pergunta: cobra em âmbar e classifica
    // compra a compra. Nunca pelo grupo, senão a regra nova (mais longa) ganharia da
    // MERCADOLIVRE e a próxima compra entraria já decidida.
    const aConfirmar = b.centro === CENTRO_A_CONFIRMAR
    const pergunta = semCentro || aConfirmar
    const emLote = pergunta && Boolean(onClassificarVarios)
    const doLote = emLote ? b.itens.filter((i) => i.refId && marcados.has(i.id)) : []
    const loteCents = doLote.reduce((s, i) => s + i.amountCents, 0)
    const todosMarcaveis = b.itens.filter((i) => i.refId).map((i) => i.id)
    const topo = b.pagadores[0]
    const visiveis = todosDe === b.centro ? b.pagadores : b.pagadores.slice(0, PAGADORES_VISIVEIS)
    const proprio = aberto ? (conteudoDoCentro?.(b.centro) ?? null) : null
    return (
      <div key={b.centro} className={cn('rounded-lg border border-border', aberto && 'bg-muted/20')}>
        <button
          type="button"
          aria-expanded={aberto}
          onClick={() => {
            setCentroAberto(aberto ? null : b.centro)
            setPagadorAberto(null)
          }}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
        >
          <ChevronRight
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn('truncate text-sm font-medium', pergunta && 'text-amber-700 dark:text-amber-400')}>
                {b.centro}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{brl(b.total)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', pergunta ? 'bg-amber-500' : b.foraDoTotal ? 'bg-muted-foreground/40' : 'bg-primary')}
                  style={{ width: `${Math.max(2, Math.min(100, (b.total / (semCentro ? referencia || 1 : maior)) * 100))}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {b.foraDoTotal ? '' : pct(b.total, referencia)}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {plural(b.itens.length, 'pagamento', 'pagamentos')} · {plural(b.pagadores.length, 'recebedor', 'recebedores')}
              {topo ? ` · maior: ${topo.rotulo}, ${brl(topo.totalCents)}` : ''}
            </div>
          </div>
        </button>

        {proprio ? (
          <div className="border-t border-border px-2 pb-2 pt-2">{proprio}</div>
        ) : aberto && (
          <div className="border-t border-border px-2 pb-2 pt-1">
            {b.descricao ? <p className="px-2 py-1 text-xs text-muted-foreground">{b.descricao}</p> : null}
            {emLote ? (
              <div className="sticky top-0 z-10 mb-1 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-background px-2 py-1.5 text-xs">
                <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                  <Checkbox
                    checked={doLote.length > 0 && doLote.length === todosMarcaveis.length}
                    indeterminate={doLote.length > 0 && doLote.length < todosMarcaveis.length}
                    onCheckedChange={(v) => alternar(todosMarcaveis, Boolean(v))}
                  />
                  {doLote.length === 0
                    ? `Marcar todas (${todosMarcaveis.length})`
                    : `${plural(doLote.length, 'marcada', 'marcadas')} · ${brl(loteCents)}`}
                </label>
                {doLote.length > 0 && onClassificarVarios ? (
                  <>
                    <CentroCustoPicker
                      size="sm"
                      className="h-7 w-[180px]"
                      centros={centros}
                      detalhes={detalhes}
                      value={null}
                      resumo={{ descricao: plural(doLote.length, 'compra marcada', 'compras marcadas'), amountCents: loteCents }}
                      onPick={async (c, { detalhe }) => {
                        await onClassificarVarios(doLote, c, detalhe)
                        alternar(doLote.map((i) => i.id), false)
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => alternar(todosMarcaveis, false)}
                      className="text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Desmarcar
                    </button>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Marque as compras do mesmo destino e classifique todas de uma vez.
                  </span>
                )}
              </div>
            ) : null}
            {/* Só aparece quando há o que dizer: um centro com tudo "Sem detalhe" não ganha uma
                faixa para repetir o total que já está no cabeçalho. */}
            {b.detalhes.length > 1 || (b.detalhes[0] && b.detalhes[0].nome !== SEM_DETALHE) ? (
              <div className="mb-1 flex flex-wrap items-center gap-1.5 px-2 py-1">
                <span className="text-[0.68rem] uppercase tracking-wide text-muted-foreground">Em quê</span>
                {b.detalhes.map((d) => (
                  <span
                    key={d.nome}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs',
                      d.nome === SEM_DETALHE
                        ? 'border-amber-500/50 text-amber-700 dark:text-amber-400'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {d.nome} <span className="tabular-nums">{brl(d.cents)}</span>
                  </span>
                ))}
              </div>
            ) : null}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.68rem] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1 text-left font-medium">Quem recebeu</th>
                  <th className="hidden px-2 py-1 text-right font-medium sm:table-cell">Pagamentos</th>
                  <th className="px-2 py-1 text-right font-medium">Total</th>
                  <th className="hidden w-16 px-2 py-1 text-right font-medium sm:table-cell">% do centro</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => {
                  const chave = `${b.centro}::${p.rotulo}`
                  const varios = p.itens.length > 1
                  const pAberto = pagadorAberto === chave
                  const unico = p.itens[0]
                  const datas = p.itens.map((i) => i.data).filter(Boolean).sort()
                  // Recebedor que o nome identifica pode ser classificado inteiro de uma vez.
                  // O padrão é o nome MAIS CURTO do grupo: o banco corta o nome num tamanho no
                  // PIX enviado e em outro no PIX agendado, e só o curto casa com os dois.
                  const padraoGrupo =
                    semCentro && onClassificar && unico?.origem === 'banco' && unico.refId
                      ? (p.itens
                          .map((i) => padraoDaRegra(i.descricao || i.nome))
                          .filter((x): x is string => Boolean(x))
                          .sort((a, z) => a.length - z.length)[0] ?? null)
                      : null
                  const acao =
                    pergunta && onClassificar && unico?.refId && (padraoGrupo || !varios) ? (
                      <CentroCustoPicker
                        size="sm"
                        className="h-7 w-[150px]"
                        centros={centros}
                        value={null}
                        resumo={{ descricao: p.rotulo, amountCents: p.totalCents }}
                        permitirIguais={unico.origem === 'banco' && !aConfirmar}
                        padrao={padraoGrupo}
                        excluirId={unico.refId}
                        onPick={(c, { aplicarIguais }) => onClassificar(unico, c, aplicarIguais, padraoGrupo)}
                      />
                    ) : null
                  return (
                    <Fragment key={chave}>
                      <tr
                        className={cn('border-t border-border/60', varios && 'cursor-pointer hover:bg-muted/40')}
                        onClick={varios ? () => setPagadorAberto(pAberto ? null : chave) : undefined}
                      >
                        <td className="px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {emLote ? (
                              <span onClick={(e) => e.stopPropagation()} className="flex shrink-0">
                                <Checkbox
                                  aria-label={`Marcar ${p.rotulo}`}
                                  checked={p.itens.every((i) => marcados.has(i.id))}
                                  indeterminate={
                                    p.itens.some((i) => marcados.has(i.id)) && !p.itens.every((i) => marcados.has(i.id))
                                  }
                                  onCheckedChange={(v) => alternar(p.itens.filter((i) => i.refId).map((i) => i.id), Boolean(v))}
                                />
                              </span>
                            ) : null}
                            {varios ? (
                              <ChevronRight
                                className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', pAberto && 'rotate-90')}
                              />
                            ) : (
                              <span className="w-3.5 shrink-0" />
                            )}
                            <span className="truncate font-medium" title={p.rotulo}>
                              {p.rotulo}
                            </span>
                            {!varios && unico?.nota ? <Badge variant="outline" className="shrink-0 text-[0.65rem]">nota sem pagamento</Badge> : null}
                            {!varios && unico?.possivelDuplicado ? (
                              <Badge variant="outline" className="shrink-0 border-amber-500/60 text-[0.65rem] text-amber-700 dark:text-amber-400">
                                repetido?
                              </Badge>
                            ) : null}
                          </div>
                          {!varios && unico ? (
                            <div className="pl-5 text-xs text-muted-foreground">
                              {dia(unico.data)}
                              {unico.descricao && unico.descricao !== p.rotulo ? ` · ${unico.descricao}` : ''}
                            </div>
                          ) : varios && datas.length > 0 ? (
                            <div className="pl-5 text-xs text-muted-foreground">
                              {datas[0] === datas[datas.length - 1]
                                ? dia(datas[0])
                                : `de ${dia(datas[0]).slice(0, 5)} a ${dia(datas[datas.length - 1]).slice(0, 5)}`}
                              {` · média ${brl(Math.round(p.totalCents / p.itens.length))}`}
                            </div>
                          ) : null}
                          {acao ? (
                            <div className="pl-5 pt-1" onClick={(e) => e.stopPropagation()}>
                              {acao}
                            </div>
                          ) : null}
                        </td>
                        <td className="hidden px-2 py-1.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                          {p.itens.length}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium tabular-nums">{brl(p.totalCents)}</td>
                        <td className="hidden px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                          {pct(p.totalCents, b.total)}
                        </td>
                      </tr>
                      {pAberto &&
                        p.itens.map((i) => (
                          <tr key={i.id} className="bg-muted/30 text-xs">
                            <td className="py-1 pl-9 pr-2">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {emLote && i.refId ? (
                                  <Checkbox
                                    aria-label={`Marcar compra de ${dia(i.data)}`}
                                    checked={marcados.has(i.id)}
                                    onCheckedChange={(v) => alternar([i.id], Boolean(v))}
                                  />
                                ) : null}
                                <span className="shrink-0 tabular-nums text-muted-foreground">{dia(i.data)}</span>
                                <span className="truncate" title={i.descricao}>
                                  {i.descricao || i.nome}
                                </span>
                                {i.nota ? <Badge variant="outline" className="shrink-0 text-[0.65rem]">nota sem pagamento</Badge> : null}
                                {i.possivelDuplicado ? (
                                  <Badge variant="outline" className="shrink-0 border-amber-500/60 text-[0.65rem] text-amber-700 dark:text-amber-400">
                                    repetido?
                                  </Badge>
                                ) : null}
                                {pergunta && onClassificar && i.refId && !padraoGrupo ? (
                                  <span className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <CentroCustoPicker
                                      size="sm"
                                      className="h-6 w-[140px]"
                                      centros={centros}
                                      value={null}
                                      resumo={{ descricao: i.descricao || i.nome, data: i.data, amountCents: i.amountCents }}
                                      onPick={(c) => onClassificar(i, c, false, null)}
                                    />
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="hidden sm:table-cell" />
                            <td className="px-2 py-1 text-right tabular-nums">{brl(i.amountCents)}</td>
                            <td className="hidden px-2 py-1 text-right tabular-nums text-muted-foreground sm:table-cell">
                              {pct(i.amountCents, b.total)}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {b.pagadores.length > PAGADORES_VISIVEIS && (
              <button
                type="button"
                onClick={() => setTodosDe(todosDe === b.centro ? null : b.centro)}
                className="mt-1 px-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                {todosDe === b.centro ? 'Mostrar só os maiores' : `Ver todos os ${b.pagadores.length} recebedores`}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between px-1 text-xs text-muted-foreground">
        <span>Clique no centro para ver quem recebeu. Pagamentos com o mesmo nome aparecem somados.</span>
        <span className="shrink-0 font-medium tabular-nums text-foreground">{brl(totalDentro)}</span>
      </div>
      {dentro.map((b) => renderBloco(b, totalDentro))}
      {fora.length > 0 && (
        <>
          <div className="flex items-baseline justify-between px-1 pt-3 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide">Fora do total · não é gasto</span>
            <span className="tabular-nums">{brl(totalFora)}</span>
          </div>
          {fora.map((b) => renderBloco(b, totalFora))}
        </>
      )}
    </div>
  )
}
