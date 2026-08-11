import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CalendarX2, CheckCircle2, CircleHelp, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  type ConferenciaStatus,
  type LinhaConferencia,
  ORDEM_GRAVIDADE,
  ROTULO_CONFERENCIA,
  listarConferencia,
} from '@/services/cirurgiaConferencia'

const diaBr = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—'

const ESTILO: Record<ConferenciaStatus, { cor: string; Icone: typeof AlertTriangle }> = {
  realizada_sem_confirmacao: { cor: 'text-destructive', Icone: AlertTriangle },
  data_diverge: { cor: 'text-amber-600 dark:text-amber-500', Icone: CalendarX2 },
  sem_espelho: { cor: 'text-muted-foreground', Icone: CircleHelp },
  agendada_sem_espelho: { cor: 'text-muted-foreground', Icone: CircleHelp },
  confirmada: { cor: 'text-emerald-600 dark:text-emerald-500', Icone: CheckCircle2 },
}

const EXPLICACAO: Record<ConferenciaStatus, string> = {
  realizada_sem_confirmacao:
    'A venda está marcada como realizada, mas não existe cirurgia correspondente no sistema da sala. Ou a cirurgia não aconteceu, ou o nome do paciente na sala não bate com o cadastro.',
  data_diverge:
    'A cirurgia existe na sala, em outra data. A data da planilha é a que costuma estar errada.',
  sem_espelho: 'Venda sem cirurgia correspondente na sala.',
  agendada_sem_espelho:
    'Normal na maior parte dos casos: a sala só cria a cirurgia perto do dia. O espelho inteiro tem 1 cirurgia futura.',
  confirmada: 'Venda e sala batem, mesma data.',
}

/**
 * O que a Central de Vendas afirma x o que a sala de cirurgia registrou.
 *
 * Antes disso a única forma de saber que o funil mentia era rodar SQL na mão: 135 vendas
 * com status "realizada" e 12 com cirurgia de verdade no espelho. Agora a diferença tem
 * tela, e quem confere é a Aline, não o banco.
 */
export function ConferenciaTab() {
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([])
  const [loading, setLoading] = useState(false)
  const [foco, setFoco] = useState<ConferenciaStatus | null>('realizada_sem_confirmacao')

  const load = async () => {
    setLoading(true)
    try {
      setLinhas(await listarConferencia())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a conferência')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const contagem = useMemo(() => {
    const m = new Map<ConferenciaStatus, number>()
    for (const l of linhas) m.set(l.conferencia, (m.get(l.conferencia) ?? 0) + 1)
    return m
  }, [linhas])

  const visiveis = useMemo(
    () => (foco ? linhas.filter((l) => l.conferencia === foco) : linhas),
    [linhas, foco],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ORDEM_GRAVIDADE.map((status) => {
          const n = contagem.get(status) ?? 0
          const { cor, Icone } = ESTILO[status]
          const ativo = foco === status
          return (
            <button
              key={status}
              type="button"
              onClick={() => setFoco(ativo ? null : status)}
              data-testid={`conferencia-filtro-${status}`}
              aria-pressed={ativo}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
                ativo ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
              }`}
            >
              <Icone className={`size-3.5 ${cor}`} />
              <span className="font-medium">{n}</span>
              <span className="text-muted-foreground">{ROTULO_CONFERENCIA[status]}</span>
            </button>
          )
        })}
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {foco ? (
        <p className="text-xs text-muted-foreground">{EXPLICACAO[foco]}</p>
      ) : null}

      {visiveis.length === 0 ? (
        <EmptyState
          title={loading ? 'Carregando…' : 'Nada nesta faixa'}
          description={
            loading
              ? 'Conferindo venda por venda contra o espelho da sala.'
              : 'Escolha outra faixa acima para ver as vendas correspondentes.'
          }
        />
      ) : (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              {foco ? ROTULO_CONFERENCIA[foco] : 'Todas as vendas de cirurgia'} ({visiveis.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Paciente</th>
                    <th className="px-3 py-2 text-left font-medium">Prontuário</th>
                    <th className="px-3 py-2 text-left font-medium">Data na venda</th>
                    <th className="px-3 py-2 text-left font-medium">Data na sala</th>
                    <th className="px-3 py-2 text-right font-medium">Folículos</th>
                    <th className="px-3 py-2 text-left font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => {
                    const { cor, Icone } = ESTILO[l.conferencia]
                    return (
                      <tr key={l.saleId} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2">
                          {l.leadId ? (
                            <Link
                              to={`/leads/${l.leadId}`}
                              className="text-primary underline-offset-2 hover:underline"
                            >
                              {l.pacienteNome}
                            </Link>
                          ) : (
                            <span>{l.pacienteNome}</span>
                          )}
                          {!l.leadId ? (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              sem card
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {l.prontuario ?? '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{diaBr(l.dataVendida)}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {diaBr(l.dataDaSala)}
                          {l.diffDias ? (
                            <span className="ml-1 text-xs text-amber-600 dark:text-amber-500">
                              ({l.diffDias > 0 ? '+' : ''}
                              {l.diffDias}d)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.foliculosImplantados ? l.foliculosImplantados.toLocaleString('pt-BR') : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`flex items-center gap-1.5 text-xs ${cor}`}>
                            <Icone className="size-3.5 shrink-0" />
                            {ROTULO_CONFERENCIA[l.conferencia]}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
