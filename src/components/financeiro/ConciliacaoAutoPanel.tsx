import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, RotateCcw, Sparkles, TriangleAlert, Wand2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  type ConciliacaoAuto,
  type ConciliacaoPendente,
  conciliarAuto,
  confirmarConciliacao,
  desfazerConciliacao,
  listConciliacaoPendentes,
  listConciliadasAuto,
} from '@/services/conciliacaoAuto'

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
const soma = (rows: Array<{ amountCents: number }>) => rows.reduce((s, r) => s + r.amountCents, 0)

/**
 * A ponte que faltava entre as duas automações.
 *
 * A nota do fornecedor entra sozinha pela SEFAZ e nasce EM ABERTO, porque nem o resumo nem o
 * XML dizem se foi paga. O extrato do banco entra sozinho pelo Open Finance. Ninguém encostava
 * um no outro: a clínica lia R$ 313 mil de dívida que em boa parte já tinha saído da conta, e
 * o relatório de gastos contava a mesma despesa duas vezes.
 *
 * O casamento roda no banco de dados, de hora em hora, logo depois do extrato entrar. Esta
 * tela existe pra ele ser CONFERÍVEL: o que ele deu por pago fica listado com a etiqueta de
 * como decidiu, e desfazer é um clique. O que ele não teve como decidir sozinho vira fila,
 * não vira chute.
 */
export function ConciliacaoAutoPanel({ onMudou }: { onMudou?: () => void }) {
  const [feitas, setFeitas] = useState<ConciliacaoAuto[]>([])
  const [pendentes, setPendentes] = useState<ConciliacaoPendente[]>([])
  const [previa, setPrevia] = useState<ConciliacaoAuto[] | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [rodando, setRodando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([listConciliadasAuto(), listConciliacaoPendentes()])
      setFeitas(a)
      setPendentes(p)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler a conciliação automática')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    let vivo = true
    void Promise.all([listConciliadasAuto(), listConciliacaoPendentes()])
      .then(([a, p]) => {
        if (!vivo) return
        setFeitas(a)
        setPendentes(p)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao ler a conciliação automática'))
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [])

  // Duas etapas de propósito: a prévia não escreve nada. Baixa em massa que acontece no
  // primeiro clique é baixa que ninguém leu antes de acontecer.
  const verPrevia = async () => {
    setRodando(true)
    try {
      const r = await conciliarAuto(true)
      setPrevia(r)
      if (r.length === 0) toast.info('Nada novo: o extrato não prova nenhuma parcela em aberto.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao simular a conciliação')
    } finally {
      setRodando(false)
    }
  }

  const aplicar = async () => {
    setRodando(true)
    try {
      const r = await conciliarAuto(false)
      toast.success(`${r.length} parcela(s) conciliada(s) · ${brl(soma(r))}`)
      setPrevia(null)
      await carregar()
      onMudou?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conciliar')
    } finally {
      setRodando(false)
    }
  }

  const confirmarPar = async (p: ConciliacaoPendente) => {
    setOcupado(p.parcelaId)
    try {
      const ok = await confirmarConciliacao(p.parcelaId, p.transacaoId)
      if (!ok) {
        toast.error('Esse lançamento do extrato já foi usado em outra parcela. Recarregue a fila.')
      } else {
        toast.success(`${p.fornecedor}: paga em ${dia(p.dataExtrato)}.`)
      }
      await carregar()
      onMudou?.()
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
      toast.success(`${a.fornecedor}: voltou pra em aberto.`)
      await carregar()
      onMudou?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desfazer')
    } finally {
      setOcupado(null)
    }
  }

  const parcelasNaFila = new Set(pendentes.map((p) => p.parcelaId)).size

  return (
    <Card className="border-emerald-500/40 bg-emerald-500/[0.04]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wand2 className="size-4 text-emerald-600" /> Conciliação automática
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">
          A nota da SEFAZ nasce em aberto e o extrato do banco entra sozinho. De hora em hora,
          logo depois do extrato, o sistema casa as duas pontas e dá a parcela por paga — com a
          data do banco, sem criar lançamento nenhum.
        </p>

        {carregando && (
          <p className="text-muted-foreground">Carregando…</p>
        )}

        {!carregando && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">
              {feitas.length} conciliada(s) sozinho · {brl(soma(feitas))}
            </Badge>
            {parcelasNaFila > 0 && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                {parcelasNaFila} esperando conferência
              </Badge>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void verPrevia()} disabled={rodando}>
            <Sparkles className="mr-1 size-3.5" />
            {rodando ? 'Conferindo…' : 'Procurar agora'}
          </Button>
        </div>

        {previa && (
          <div className="rounded border border-emerald-500/40 bg-background/60 p-2">
            {previa.length === 0 ? (
              <p className="text-muted-foreground">
                Nenhuma parcela em aberto tem correspondência no extrato agora.
              </p>
            ) : (
              <>
                <p className="font-medium">
                  {previa.length} parcela(s) que o extrato prova · {brl(soma(previa))}
                </p>
                <div className="mt-1.5 max-h-52 space-y-0.5 overflow-y-auto">
                  {previa.map((a) => (
                    <div key={a.parcelaId} className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-muted-foreground">
                        {a.fornecedor} · pago {dia(a.pagoEm)}
                      </span>
                      <span className="shrink-0 tabular-nums">{brl(a.amountCents)}</span>
                    </div>
                  ))}
                </div>
                <Button size="sm" className="mt-2" onClick={() => void aplicar()} disabled={rodando}>
                  <Check className="mr-1 size-3.5" /> Dar as {previa.length} por pagas
                </Button>
              </>
            )}
          </div>
        )}

        {/* A fila: pares que o motor NÃO carimbou. Empate por valor sem nome pra desempatar, e
            pagamento ao mesmo fornecedor com valor diferente (juros, desconto, boleto
            agrupado). Aqui só gente sabe — mas esconder é o que faz a parcela envelhecer em
            aberto pra sempre. */}
        {pendentes.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/[0.06] p-2 text-left font-medium">
              <TriangleAlert className="size-3 shrink-0 text-amber-600" />
              {parcelasNaFila} parcela(s) o sistema não decidiu sozinho
              <ChevronDown className="ml-auto size-3.5 shrink-0" />
            </CollapsibleTrigger>
            {/* `block`: o Panel do base-ui não é display:block por padrão e a lista some. */}
            <CollapsibleContent className="mt-1.5 block max-h-[26rem] space-y-1.5 overflow-y-auto">
              {pendentes.map((p) => (
                <div key={`${p.parcelaId}:${p.transacaoId}`} className="rounded border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.fornecedor}</div>
                      <div className="text-muted-foreground">
                        vence {dia(p.vencimento)} · {brl(p.amountCents)}
                      </div>
                      <div className="mt-0.5 truncate text-muted-foreground">
                        extrato {dia(p.dataExtrato)} · {brl(p.amountExtratoCents)} · {p.extrato}
                      </div>
                      <div className="mt-0.5 text-[11px] text-amber-600">{p.motivo}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={ocupado === p.parcelaId}
                      onClick={() => void confirmarPar(p)}
                    >
                      É esta
                    </Button>
                  </div>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* O que o robô fez, com a etiqueta de COMO decidiu. `media` é valor e data batendo num
            par único; `alta` é isso mais o nome do fornecedor aparecendo no extrato. */}
        {feitas.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded border p-2 text-left font-medium">
              {feitas.length} parcela(s) que o sistema deu por pagas
              <ChevronDown className="ml-auto size-3.5 shrink-0" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 block max-h-[26rem] space-y-1 overflow-y-auto">
              {feitas.map((a) => (
                <div key={a.parcelaId} className="flex items-start justify-between gap-2 rounded border p-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={
                          a.confianca === 'alta'
                            ? 'border-emerald-500/50 text-[10px] text-emerald-600'
                            : 'border-amber-500/50 text-[10px] text-amber-600'
                        }
                      >
                        {a.confianca === 'alta' ? 'nome bate' : 'valor e data'}
                      </Badge>
                      <span className="truncate font-medium">{a.fornecedor}</span>
                    </div>
                    <div className="mt-0.5 truncate text-muted-foreground">
                      vence {dia(a.vencimento)} · pago {dia(a.pagoEm)} · {a.extrato}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">{brl(a.amountCents)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado === a.parcelaId}
                      onClick={() => void desfazer(a)}
                    >
                      <RotateCcw className="mr-1 size-3.5" /> Desfazer
                    </Button>
                  </div>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
