// CONCILIAÇÃO: ligar o extrato do banco às contas a pagar e a receber.
//
// Redesenho de 14/set/2026. A tela antiga misturava três coisas numa grade: conectar banco,
// importar OFX, e conciliar. E terminava numa lista de "lançamentos sem conciliação" com mais de
// mil linhas, quase todas salário, imposto e PIX que nunca vão ter conta a pagar: ruído no lugar
// onde deveria estar o trabalho.
//
// Agora a tela é só conciliar:
//   Contas a pagar    · a mesma conferência de Contas a pagar (ConferenciaBanco)
//   Contas a receber  · entradas do extrato que batem com uma conta a receber em aberto
//
// Conectar banco e importar extrato foram para Contas & caixa (ConexoesBanco). O que o banco
// trouxe e não é conta nenhuma se classifica em Gastos, por centro de custo.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { ConferenciaBanco } from '@/components/financeiro/ConferenciaBanco'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { useTenant } from '@/context/TenantContext'
import { bankSyncTrouble, sinceLabel } from '@/lib/bankSync'
import { cn } from '@/lib/utils'
import {
  type FinAccount,
  type FinTransaction,
  type MatchSuggestion,
  type Receivable,
  confirmMatch,
  listAccounts,
  listReceivables,
  listTransactions,
  suggestMatches,
} from '@/services/financeiro'

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')

type Vista = 'pagar' | 'receber'

export function ConciliacaoPage() {
  const { tenant } = useTenant()
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [txns, setTxns] = useState<FinTransaction[]>([])
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [vista, setVista] = useState<Vista>('pagar')
  const [naFila, setNaFila] = useState(0)

  const load = async () => {
    setLoading(true)
    try {
      const [acc, t, r] = await Promise.all([
        listAccounts(),
        listTransactions({ onlyUnreconciled: true, limit: 500 }),
        listReceivables(),
      ])
      setAccounts(acc)
      setTxns(t)
      setReceivables(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar conciliação')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [])

  const openReceivables = useMemo(() => receivables.filter((r) => r.status === 'aberto'), [receivables])

  // Só o lado da RECEITA. A conta a pagar é casada no servidor (`crm_conciliar_auto`), com janela
  // larga e desempate por nome do fornecedor; este motor palpitando sobre parcela sugeriria com
  // confiança justamente os empates que o servidor se recusou a decidir.
  const suggestions = useMemo(
    () => suggestMatches(txns, [], openReceivables).filter((s) => !dismissed.has(s.transaction.id)),
    [txns, openReceivables, dismissed],
  )

  // Extrato parado faz "não achei no extrato" parecer "não pagou" (ver lib/bankSync).
  const parados = useMemo(
    () => accounts.filter((a) => a.ofAccountId).map((a) => ({ a, motivo: bankSyncTrouble(a) })).filter((x) => x.motivo),
    [accounts],
  )
  const conectadas = accounts.filter((a) => a.ofAccountId)

  const confirm = async (s: MatchSuggestion) => {
    try {
      await confirmMatch(s.transaction.id, s.refType, s.refId, s.transaction.categoryId)
      toast.success(`Conciliado: ${s.refDescription}.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conciliar')
    }
  }

  return (
    <AppLayout title="Conciliação" subtitle="Ligar o extrato do banco às contas a pagar e a receber.">
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div
        className={cn(
          'mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs',
          parados.length > 0 ? 'border-destructive/40 bg-destructive/[0.05]' : 'border-border bg-muted/20',
        )}
      >
        {conectadas.length === 0 ? (
          <span className="text-muted-foreground">Nenhum banco conectado: sem extrato não há o que conciliar.</span>
        ) : parados.length > 0 ? (
          parados.map(({ a, motivo }) => (
            <span key={a.id} className="font-medium text-destructive">
              {a.name}: {motivo}
            </span>
          ))
        ) : (
          conectadas.map((a) => (
            <span key={a.id} className="text-muted-foreground">
              <span className="font-medium text-foreground">{a.name}</span> · extrato atualizado {sinceLabel(a.ofLastSyncAt)}
            </span>
          ))
        )}
        <Link to="/contas-caixa" className="ml-auto font-medium underline underline-offset-2">
          Conexões e importar extrato
        </Link>
      </div>

      <div className="mb-2 inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label="Vista">
        {(
          [
            ['pagar', `Contas a pagar${naFila ? ` (${naFila})` : ''}`],
            ['receber', `Contas a receber (${suggestions.length})`],
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

      <div hidden={vista !== 'pagar'}>
        <Card>
          <CardContent className="p-3">
            <ConferenciaBanco onMudou={() => void load()} onContagem={setNaFila} />
          </CardContent>
        </Card>
      </div>

      {vista === 'receber' && (
        <Card>
          <CardContent className="p-0">
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              Entradas do extrato com o mesmo valor de uma conta a receber em aberto, até 5 dias de diferença. Venda do
              Shosp se confere em Conciliação Shosp.
            </p>
            {suggestions.length === 0 ? (
              <EmptyState
                title={loading ? 'Carregando…' : 'Nada para ligar'}
                description="Nenhuma entrada do extrato bate com conta a receber em aberto."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Conta a receber</th>
                      <th className="px-3 py-2 text-left font-medium">Entrada no extrato</th>
                      <th className="w-32 px-3 py-2 text-right font-medium">Valor</th>
                      <th className="w-36 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s) => (
                      <tr key={s.transaction.id} className="border-t border-border/60">
                        <td className="px-3 py-2">
                          <div className="font-medium">{s.refDescription}</div>
                          <div className="text-xs text-muted-foreground">vence {dia(s.refDueDate)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="truncate">{s.transaction.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {dia(s.transaction.date)} · {s.dayGap > 0 ? `${s.dayGap} dia(s) de diferença` : 'mesma data'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{brl(s.refAmountCents)}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7" onClick={() => void confirm(s)}>
                              <Check className="size-3.5" /> Ligar
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Não é esta"
                              title="Não é esta"
                              onClick={() => setDismissed((d) => new Set(d).add(s.transaction.id))}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </AppLayout>
  )
}
