// Conferência entre as contas a pagar e o extrato do banco.
//
// De hora em hora o banco casa sozinho a parcela em aberto com a saída do extrato
// (crm_conciliar_auto). Esta tela é onde a gente CONFERE isso, em duas listas:
//
//   Esperando você: pares que o sistema não decidiu sozinho (empate por valor sem nome, ou mesmo
//   fornecedor com valor diferente). Um clique confirma.
//
//   Dadas por pagas sozinho: o que ele já carimbou, com COMO decidiu. Um clique desfaz.
//
// Substitui o painel verde que aparecia igual em Contas a pagar e em Conciliação, em formato de
// cartão com listas recolhidas: a fila, que é o trabalho, ficava escondida atrás de um clique.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, RotateCcw, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import {
  type ConciliacaoAuto,
  type ConciliacaoPendente,
  conciliarAuto,
  confirmarConciliacao,
  desfazerConciliacao,
  listConciliacaoPendentes,
  listConciliadasAuto,
} from '@/services/conciliacaoAuto'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const soma = (rows: Array<{ amountCents: number }>) => rows.reduce((s, r) => s + r.amountCents, 0)

export function ConferenciaBanco({
  onMudou,
  onContagem,
}: {
  onMudou?: () => void
  /** Quantas parcelas esperam conferência, para quem mostra o número numa aba. */
  onContagem?: (n: number) => void
}) {
  const [feitas, setFeitas] = useState<ConciliacaoAuto[]>([])
  const [pendentes, setPendentes] = useState<ConciliacaoPendente[]>([])
  const [previa, setPrevia] = useState<ConciliacaoAuto[] | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [rodando, setRodando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [lista, setLista] = useState<'fila' | 'feitas'>('fila')

  const buscar = async () => {
    const [a, p] = await Promise.all([listConciliadasAuto(), listConciliacaoPendentes()])
    setFeitas(a)
    setPendentes(p)
    onContagem?.(new Set(p.map((x) => x.parcelaId)).size)
  }

  useEffect(() => {
    let vivo = true
    void Promise.all([listConciliadasAuto(), listConciliacaoPendentes()])
      .then(([a, p]) => {
        if (!vivo) return
        setFeitas(a)
        setPendentes(p)
        onContagem?.(new Set(p.map((x) => x.parcelaId)).size)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao ler a conferência com o banco'))
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const depois = async () => {
    await buscar()
    onMudou?.()
  }

  // Duas etapas: a prévia não escreve nada. Baixa em massa no primeiro clique é baixa que
  // ninguém leu antes de acontecer.
  const procurar = async () => {
    setRodando(true)
    try {
      const r = await conciliarAuto(true)
      setPrevia(r)
      if (r.length === 0) toast.info('Nada novo: o extrato não prova nenhuma conta em aberto agora.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao procurar no extrato')
    } finally {
      setRodando(false)
    }
  }

  const aplicar = async () => {
    setRodando(true)
    try {
      const r = await conciliarAuto(false)
      toast.success(`${r.length} conta(s) dada(s) por paga(s) · ${brl(soma(r))}`)
      setPrevia(null)
      await depois()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conciliar')
    } finally {
      setRodando(false)
    }
  }

  const confirmar = async (p: ConciliacaoPendente) => {
    setOcupado(p.parcelaId)
    try {
      const ok = await confirmarConciliacao(p.parcelaId, p.transacaoId)
      if (ok) toast.success(`${p.fornecedor}: paga em ${dia(p.dataExtrato)}.`)
      else toast.error('Esse lançamento do extrato já foi ligado a outra conta.')
      await depois()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conciliar')
    } finally {
      setOcupado(null)
    }
  }

  const desfazer = async (a: ConciliacaoAuto) => {
    setOcupado(a.parcelaId)
    try {
      await desfazerConciliacao(a.parcelaId)
      toast.success(`${a.fornecedor}: voltou para em aberto.`)
      await depois()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desfazer')
    } finally {
      setOcupado(null)
    }
  }

  const parcelasNaFila = new Set(pendentes.map((p) => p.parcelaId)).size

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group">
          {(
            [
              ['fila', `Esperando você (${parcelasNaFila})`],
              ['feitas', `Dadas por pagas sozinho (${feitas.length})`],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              aria-pressed={lista === v}
              onClick={() => setLista(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                lista === v ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void procurar()} disabled={rodando}>
          <Sparkles className="size-3.5" /> {rodando ? 'Procurando…' : 'Procurar no extrato agora'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        De hora em hora o sistema liga sozinho a conta em aberto ao pagamento do extrato, com a data do banco. Aqui
        fica o que ele não decidiu sozinho e o que ele já deu por pago.
      </p>

      {previa && previa.length > 0 && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.05] p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {previa.length} conta(s) que o extrato prova · {brl(soma(previa))}
            </span>
            <Button size="sm" onClick={() => void aplicar()} disabled={rodando}>
              <Check className="size-3.5" /> Dar as {previa.length} por pagas
            </Button>
          </div>
          <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs">
            {previa.map((a) => (
              <div key={a.parcelaId} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-muted-foreground">
                  {a.fornecedor} · pago {dia(a.pagoEm)}
                </span>
                <span className="shrink-0 tabular-nums">{brl(a.amountCents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        {carregando ? (
          <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
        ) : lista === 'fila' ? (
          pendentes.length === 0 ? (
            <EmptyState title="Nada esperando" description="Toda conta que o extrato explica já foi ligada." />
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Conta a pagar</th>
                  <th className="px-3 py-2 text-left font-medium">Pagamento no extrato</th>
                  <th className="px-3 py-2 text-left font-medium">Por que não decidiu</th>
                  <th className="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pendentes.map((p) => (
                  <tr key={`${p.parcelaId}:${p.transacaoId}`} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.fornecedor}</div>
                      <div className="text-xs text-muted-foreground">
                        vence {dia(p.vencimento)} · {brl(p.amountCents)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="truncate" title={p.extrato}>
                        {p.extrato}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {dia(p.dataExtrato)} · {brl(p.amountExtratoCents)}
                        {p.amountExtratoCents !== p.amountCents ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            {' '}
                            · diferença {brl(Math.abs(p.amountExtratoCents - p.amountCents))}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.motivo}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado === p.parcelaId}
                        onClick={() => void confirmar(p)}
                      >
                        <Check className="size-3.5" /> É esta
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : feitas.length === 0 ? (
          <EmptyState title="Nada ainda" description="Quando o sistema ligar uma conta ao extrato, ela aparece aqui." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Conta</th>
                <th className="px-3 py-2 text-left font-medium">Pago no extrato</th>
                <th className="px-3 py-2 text-left font-medium">Como decidiu</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Valor</th>
                <th className="w-28 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {feitas.map((a) => (
                <tr key={a.parcelaId} className="border-t border-border/60 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.fornecedor}</div>
                    <div className="text-xs text-muted-foreground">vence {dia(a.vencimento)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="truncate" title={a.extrato}>
                      {a.extrato}
                    </div>
                    <div className="text-xs text-muted-foreground">{dia(a.pagoEm)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={
                        a.confianca === 'alta'
                          ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
                          : 'border-amber-500/50 text-amber-700 dark:text-amber-400'
                      }
                    >
                      {a.confianca === 'alta' ? 'nome e valor batem' : 'valor e data batem'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(a.amountCents)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado === a.parcelaId}
                      onClick={() => void desfazer(a)}
                    >
                      <RotateCcw className="size-3.5" /> Desfazer
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
