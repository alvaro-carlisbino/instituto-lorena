import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronDown, Copy, FileText, Layers } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { formatBRL, formatQtd } from '@/components/kits/kitUi'
import { dataDia, dataHora } from '@/components/estoque/kardexUi'
import type { CompraDoItem, LoteDoItem } from '@/lib/kardex'
import { cn } from '@/lib/utils'

const diasAte = (dia: string, hoje: string) =>
  Math.round((new Date(`${dia}T12:00:00`).getTime() - new Date(`${hoje}T12:00:00`).getTime()) / 86_400_000)

export function ComprasDoItem({
  compras,
  unidade,
  podeVerFinanceiro,
  carregando,
  onJuntar,
}: {
  compras: CompraDoItem[]
  unidade: string
  podeVerFinanceiro: boolean
  carregando: boolean
  /** Abre a busca de item de nota com outro nome para juntar neste. */
  onJuntar: () => void
}) {
  if (compras.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={FileText}
          title={carregando ? 'Carregando…' : 'Nenhuma nota de compra ligada a este item'}
          description={
            carregando
              ? undefined
              : 'Se a nota chegou com o nome do fornecedor, ela entrou num cadastro separado. Procure pelo nome da nota e junte neste item.'
          }
        />
        {carregando ? null : (
          <div className="flex justify-center">
            <Button size="sm" onClick={onJuntar}>
              Procurar a nota deste item
            </Button>
          </div>
        )}
      </div>
    )
  }
  const totalQtd = compras.reduce((s, c) => s + c.qtd, 0)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {compras.length} {compras.length === 1 ? 'compra' : 'compras'} · {formatQtd(totalQtd)} {unidade} no total
        </p>
        <Button size="sm" variant="outline" onClick={onJuntar}>
          Falta alguma nota?
        </Button>
      </div>
      <ul className="space-y-2">
        {compras.map((c) => {
          const o = c.origem
          const titulo = o.tipo === 'nota' ? (o.numero ? `NF ${o.numero}` : 'Nota fiscal') : 'Ordem de compra'
          const link = o.tipo === 'nota' && o.id && podeVerFinanceiro ? `/contas-a-pagar?nota=${o.id}` : null
          return (
            <li key={c.chave} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {link ? (
                      <Link to={link} className="hover:underline">
                        {titulo}
                      </Link>
                    ) : (
                      titulo
                    )}
                    {o.tipo === 'nota' && o.fornecedor ? <span className="font-normal text-muted-foreground"> · {o.fornecedor}</span> : null}
                    {o.tipo === 'ordem' && o.responsavel ? <span className="font-normal text-muted-foreground"> · {o.responsavel}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {o.tipo === 'nota' && o.emissao ? `Emitida ${dataDia(o.emissao)} · ` : ''}
                    entrou no estoque {dataHora(c.entradaEm)}
                    {c.setores.length > 0 ? ` em ${c.setores.join(', ')}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">
                    {formatQtd(c.qtd)} {unidade}
                  </p>
                  {c.custoMedioCents != null ? (
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatBRL(c.custoMedioCents)}/{unidade} · {formatBRL(c.totalCents ?? 0)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">sem custo</p>
                  )}
                </div>
              </div>
              {c.lotes.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.lotes.map((l) => (
                    <Badge key={l.lote} variant="outline" className="tabular-nums">
                      lote {l.lote}
                      {l.validade ? ` · vence ${dataDia(l.validade)}` : ''} · {formatQtd(l.qtd)}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {c.nomes.length > 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">Na nota: {c.nomes.join(' · ')}</p>
              ) : null}
              {o.tipo === 'nota' && o.chave ? (
                <button
                  type="button"
                  className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(o.chave ?? '')
                      .then(() => toast.success('Chave da NF-e copiada.'))
                      .catch(() => toast.error('Não deu para copiar.'))
                  }}
                  title="Copiar chave da NF-e"
                >
                  <Copy className="size-3 shrink-0" aria-hidden />
                  <span className="truncate font-mono tabular-nums">{o.chave}</span>
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function LotesDoItem({
  lotes,
  unidade,
  hoje,
  podeVerFinanceiro,
  carregando,
}: {
  lotes: LoteDoItem[]
  unidade: string
  hoje: string
  podeVerFinanceiro: boolean
  carregando: boolean
}) {
  const [soComSaldo, setSoComSaldo] = useState(true)
  const [aberto, setAberto] = useState<string | null>(null)
  const visiveis = soComSaldo ? lotes.filter((l) => l.saldo !== 0) : lotes
  if (lotes.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title={carregando ? 'Carregando…' : 'Este item não tem lote registrado'}
        description={carregando ? undefined : 'Lote entra pela nota fiscal (quando o fornecedor informa) ou na bipagem de entrada.'}
      />
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {lotes.filter((l) => l.saldo > 0).length} com saldo · {lotes.length} no histórico
        </p>
        <Button size="sm" variant="outline" onClick={() => setSoComSaldo((v) => !v)}>
          {soComSaldo ? 'Mostrar lotes esgotados' : 'Só lotes com saldo'}
        </Button>
      </div>
      {visiveis.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Nenhum lote com saldo. Veja os esgotados para rastrear quem recebeu.
        </p>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((l) => {
            const dias = l.validade ? diasAte(l.validade, hoje) : null
            const abertoAqui = aberto === l.loteId
            return (
              <li key={l.loteId} className="rounded-xl border border-border bg-card text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="font-semibold tabular-nums">Lote {l.lote}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.validade ? (
                        <span
                          className={cn(
                            'tabular-nums',
                            l.vencido && 'font-semibold text-destructive',
                            !l.vencido && dias != null && dias <= 30 && 'font-semibold text-amber-700 dark:text-amber-400',
                          )}
                        >
                          {l.vencido ? `venceu em ${dataDia(l.validade)}` : `vence ${dataDia(l.validade)}${dias != null && dias <= 90 ? ` (${dias} dias)` : ''}`}
                        </span>
                      ) : (
                        'sem validade'
                      )}
                      {l.nota ? (
                        <>
                          {' · '}
                          {podeVerFinanceiro ? (
                            <Link to={`/contas-a-pagar?nota=${l.nota.notaId}`} className="text-primary hover:underline">
                              NF {l.nota.numero}
                            </Link>
                          ) : (
                            `NF ${l.nota.numero}`
                          )}
                          {l.nota.fornecedor ? ` · ${l.nota.fornecedor}` : ''}
                        </>
                      ) : (
                        ' · sem nota de origem'
                      )}
                    </p>
                    {l.setores.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {l.setores.map((s) => `${s.setorNome} ${formatQtd(s.qtd)}`).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className={cn('font-semibold tabular-nums', l.saldo < 0 && 'text-destructive')}>
                      {formatQtd(l.saldo)} {unidade}
                    </p>
                    <p className="text-xs text-muted-foreground">entrou {dataHora(l.entradaEm)}</p>
                  </div>
                </div>
                {l.pacientes.length > 0 ? (
                  <div className="border-t border-border">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-muted/50"
                      onClick={() => setAberto(abertoAqui ? null : l.loteId)}
                      aria-expanded={abertoAqui}
                    >
                      <span>
                        Usado em {l.pacientes.length} {l.pacientes.length === 1 ? 'kit' : 'kits'}
                      </span>
                      <ChevronDown className={cn('size-4 transition-transform', abertoAqui && 'rotate-180')} aria-hidden />
                    </button>
                    {abertoAqui ? (
                      <ul className="divide-y divide-border border-t border-border">
                        {l.pacientes.map((p) => (
                          <li key={p.kitId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                            <Link to={`/kits/${p.kitId}/editar`} className="min-w-0 truncate hover:underline">
                              {p.paciente ?? 'Sem paciente'} · {p.kitNome}
                            </Link>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {dataDia(p.data)} · {formatQtd(p.qtd)} {unidade}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
