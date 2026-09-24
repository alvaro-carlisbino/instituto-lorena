// A FATURA DO CARTÃO ABERTA EM COMPRAS.
//
// No banco o cartão é um boleto só. Aqui ele abre nas compras daquela fatura, cada uma com o
// mesmo seletor de centro de custo e detalhe de Gastos (pedido do Kauan, 24/set/2026: "desmembrar
// esse valor e ter como colocar cada coisa com sua classificação, como se estivesse entrando
// dentro da fatura").
//
// Classificar aqui é classificar a compra na conta do cartão: é a mesma linha que Gastos mostra
// no mês da compra, então o trabalho feito num lugar aparece no outro.
//
// A diferença entre o boleto e a soma das compras fica à vista, com o nome das causas possíveis.
// Esconder faria o total da fatura "fechar" por conta própria, e é essa a conta que o financeiro
// confere contra o PDF do banco.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CreditCard } from 'lucide-react'

import { CentroCustoPicker } from '@/components/financeiro/CentroCustoPicker'
import { Checkbox } from '@/components/ui/checkbox'
import { padraoDaRegra } from '@/lib/extratoPadrao'
import {
  comprasPorCentro,
  diaDeFechamento,
  inicioDasCompras,
  montarFaturas,
  type Fatura,
  type ItemCartao,
  type PagamentoFatura,
} from '@/lib/faturaCartao'
import { cn } from '@/lib/utils'
import {
  classificarSaida,
  listTransactions,
  type CostCenter,
  type CostDetail,
  type FinAccount,
} from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const diaCurto = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '')
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

export function FaturasCartao({
  pagamentos,
  cartoes,
  centros,
  detalhes = [],
  onMudou,
}: {
  /** Boletos da fatura que saíram da conta corrente. */
  pagamentos: PagamentoFatura[]
  /** Contas de cartão da clínica. As compras de todas entram na conta. */
  cartoes: FinAccount[]
  centros: CostCenter[]
  detalhes?: CostDetail[]
  /** Depois de classificar, para a tela de fora recarregar os totais dela. */
  onMudou?: () => void
}) {
  const dia = diaDeFechamento(cartoes[0])
  const [itens, setItens] = useState<ItemCartao[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [soSemCentro, setSoSemCentro] = useState(false)

  /** As compras de todos os cartões na janela das faturas destes boletos. */
  const buscarItens = async (): Promise<ItemCartao[]> => {
    const de = inicioDasCompras(pagamentos, dia)
    if (!de) return []
    const ate = pagamentos.map((p) => p.data).sort().at(-1) ?? de
    const listas = await Promise.all(cartoes.map((c) => listTransactions({ accountId: c.id, from: de, to: ate, limit: 3000 })))
    return listas.flat().map((t) => ({
      id: t.id,
      data: t.date,
      descricao: t.description || t.counterparty || 'sem descrição',
      amountCents: Math.abs(t.amountCents),
      credito: t.direction === 'in',
      centro: t.costCenter,
      detalhe: t.costDetail,
    }))
  }

  const chavePagamentos = pagamentos.map((p) => p.id).join(',')
  const chaveCartoes = cartoes.map((c) => c.id).join(',')
  useEffect(() => {
    let vivo = true
    buscarItens()
      .then((xs) => {
        if (!vivo) return
        setErro(null)
        setItens(xs)
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : 'Falha ao buscar as compras do cartão'))
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chavePagamentos, chaveCartoes, dia])

  const faturas = useMemo(() => (itens ? montarFaturas(pagamentos, itens, dia) : []), [itens, pagamentos, dia])

  const classificar = async (i: ItemCartao, c: CostCenter, aplicarIguais: boolean, detalhe: string | null) => {
    setItens((xs) => xs?.map((x) => (x.id === i.id ? { ...x, centro: c.name, detalhe } : x)) ?? xs)
    const onde = detalhe ? `${c.name} · ${detalhe}` : c.name
    try {
      const n = await classificarSaida(i.id, c.name, aplicarIguais ? padraoDaRegra(i.descricao) : null, detalhe)
      toast.success(n > 0 ? `${onde}: esta e mais ${n} compra(s) iguais.` : `Classificada em ${onde}.`)
      // Com regra, outras compras mudaram também: busca de novo para a fatura mostrar.
      if (n > 0) setItens(await buscarItens())
      onMudou?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao classificar')
    }
  }

  if (cartoes.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted-foreground">Nenhum cartão ligado ao sistema: as compras não têm de onde vir.</p>
  }
  if (erro) return <p className="px-2 py-3 text-sm text-destructive">{erro}</p>
  if (!itens) return <p className="px-2 py-3 text-sm text-muted-foreground">Abrindo a fatura…</p>
  if (faturas.length === 0) return <p className="px-2 py-3 text-sm text-muted-foreground">Nenhuma fatura paga no período.</p>

  return (
    <div className="space-y-3">
      <label className="flex w-fit cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
        <Checkbox checked={soSemCentro} onCheckedChange={(v) => setSoSemCentro(Boolean(v))} />
        Só as compras sem centro de custo
      </label>
      {faturas.map((f) => (
        <UmaFatura
          key={f.fechamento}
          fatura={f}
          centros={centros}
          detalhes={detalhes}
          soSemCentro={soSemCentro}
          onClassificar={classificar}
        />
      ))}
    </div>
  )
}

function UmaFatura({
  fatura: f,
  centros,
  detalhes,
  soSemCentro,
  onClassificar,
}: {
  fatura: Fatura
  centros: CostCenter[]
  detalhes: CostDetail[]
  soSemCentro: boolean
  onClassificar: (i: ItemCartao, c: CostCenter, aplicarIguais: boolean, detalhe: string | null) => Promise<void>
}) {
  const porCentro = comprasPorCentro(f.compras)
  const semCentro = porCentro.find((p) => p.centro === null)
  const visiveis = soSemCentro ? f.compras.filter((c) => !c.centro) : f.compras
  const maior = Math.max(1, ...porCentro.map((p) => p.cents))
  const bate = Math.abs(f.diferencaCents) < 100

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <CreditCard className="size-4 text-muted-foreground" />
          Fatura que fechou em {diaCurto(f.fechamento)}
        </div>
        <div className="text-xs text-muted-foreground">
          Compras de {diaCurto(f.de)} a {diaCurto(f.ate)} · paga em{' '}
          {f.pagamentos.map((p) => `${diaCurto(p.data)} (${brl(p.amountCents)})`).join(' e ')}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-border px-3 py-2.5 sm:grid-cols-4">
        <Numero rotulo="Pago no banco" valor={brl(f.pagoCents)} />
        <Numero rotulo={plural(f.compras.length, 'compra', 'compras')} valor={brl(f.comprasCents)} />
        <Numero rotulo="Estornos e créditos" valor={f.creditosCents > 0 ? `− ${brl(f.creditosCents)}` : 'nenhum'} />
        <Numero
          rotulo="Diferença"
          valor={bate ? 'bate' : `${f.diferencaCents > 0 ? '+' : '−'} ${brl(Math.abs(f.diferencaCents))}`}
          alerta={!bate}
        />
      </div>

      {!bate && (
        <p className="border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          {f.diferencaCents > 0
            ? 'Foi pago mais do que as compras que o banco mandou: juros, IOF, anuidade, compra que o banco não mandou, ou outro cartão pago no mesmo boleto.'
            : 'As compras somam mais do que o boleto: pagamento parcial, estorno que o banco não mandou, ou compra lançada na fatura seguinte.'}{' '}
          Confira no PDF da fatura.
        </p>
      )}

      {porCentro.length > 0 && (
        <div className="space-y-1 border-b border-border px-3 py-2.5">
          <div className="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">Por centro de custo</div>
          {porCentro.map((p) => (
            <div key={p.centro ?? '__sem'} className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'w-40 shrink-0 truncate',
                  p.centro === null ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-foreground',
                )}
                title={p.centro ?? 'Sem centro de custo'}
              >
                {p.centro ?? 'Sem centro de custo'}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', p.centro === null ? 'bg-amber-500' : 'bg-primary')}
                  style={{ width: `${Math.max(2, (p.cents / maior) * 100)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums">{brl(p.cents)}</span>
              <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{p.n}</span>
            </div>
          ))}
          {semCentro ? (
            <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">
              {plural(semCentro.n, 'compra sem centro', 'compras sem centro')} ({brl(semCentro.cents)}). Classifique abaixo.
            </p>
          ) : null}
        </div>
      )}

      {visiveis.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          {soSemCentro ? 'Toda compra desta fatura tem centro de custo.' : 'O banco não mandou nenhuma compra desta fatura.'}
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {visiveis.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
              <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{diaCurto(i.data)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm" title={i.descricao}>
                  {i.descricao}
                </div>
                {i.detalhe ? <div className="truncate text-xs text-muted-foreground">{i.detalhe}</div> : null}
              </div>
              <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">{brl(i.amountCents)}</span>
              <CentroCustoPicker
                size="sm"
                className="h-7 w-[200px] shrink-0"
                centros={centros}
                detalhes={detalhes}
                value={i.centro}
                valueDetalhe={i.detalhe}
                resumo={{ descricao: i.descricao, data: i.data, amountCents: i.amountCents }}
                permitirIguais
                padrao={padraoDaRegra(i.descricao)}
                excluirId={i.id}
                onPick={(c, { aplicarIguais, detalhe }) => onClassificar(i, c, aplicarIguais, detalhe)}
              />
            </div>
          ))}
        </div>
      )}

      {f.creditos.length > 0 && !soSemCentro && (
        <div className="border-t border-border px-3 py-2">
          <div className="text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">Estornos e créditos</div>
          {f.creditos.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-0.5 text-xs text-muted-foreground">
              <span className="w-12 shrink-0 tabular-nums">{diaCurto(c.data)}</span>
              <span className="min-w-0 flex-1 truncate">{c.descricao}</span>
              <span className="shrink-0 tabular-nums">− {brl(c.amountCents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.68rem] text-muted-foreground">{rotulo}</div>
      <div className={cn('text-sm font-semibold', alerta && 'text-amber-700 dark:text-amber-400')}>{valor}</div>
    </div>
  )
}
