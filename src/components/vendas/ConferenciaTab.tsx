import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CalendarCheck,
  CalendarX2,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  ScissorsLineDashed,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { combinaBusca } from '@/lib/busca'
import {
  type ConferenciaStatus,
  type LinhaConferencia,
  ORDEM_GRAVIDADE,
  ROTULO_CONFERENCIA,
  aplicarDataDaSala,
  listarConferencia,
} from '@/services/cirurgiaConferencia'

const diaBr = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—'

const ESTILO: Record<ConferenciaStatus, { cor: string; Icone: typeof AlertTriangle }> = {
  sala_ja_operou: { cor: 'text-destructive', Icone: ScissorsLineDashed },
  venda_sem_data: { cor: 'text-amber-600 dark:text-amber-500', Icone: CalendarCheck },
  realizada_sem_confirmacao: { cor: 'text-destructive', Icone: AlertTriangle },
  data_diverge: { cor: 'text-amber-600 dark:text-amber-500', Icone: CalendarX2 },
  sem_espelho: { cor: 'text-muted-foreground', Icone: CircleHelp },
  agendada_sem_espelho: { cor: 'text-muted-foreground', Icone: CircleHelp },
  confirmada: { cor: 'text-emerald-600 dark:text-emerald-500', Icone: CheckCircle2 },
}

/**
 * Onde o botão "aplicar data da sala" aparece.
 *
 * Só onde a sala TEM a resposta. Em "sem registro na sala" não há data para copiar, e
 * um botão que não faz nada é pior do que botão nenhum.
 */
const PODE_APLICAR: ConferenciaStatus[] = ['sala_ja_operou', 'venda_sem_data', 'data_diverge']

const EXPLICACAO: Record<ConferenciaStatus, string> = {
  sala_ja_operou:
    'O centro cirúrgico registrou a cirurgia como FINALIZADA e a venda ainda não diz "realizada". O procedimento aconteceu: falta o funil saber. Aplicar a data da sala corrige a data e marca a venda como realizada.',
  venda_sem_data:
    'A cirurgia existe na sala com data marcada e a venda está sem data nenhuma. Aplicar a data da sala resolve sem ninguém digitar.',
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
  const [foco, setFoco] = useState<ConferenciaStatus | null>(ORDEM_GRAVIDADE[0])
  const [termo, setTermo] = useState('')
  const buscaAdiada = useDeferredValue(termo)
  const [aplicando, setAplicando] = useState<string | null>(null)

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

  /**
   * Traz a data da sala para dentro da venda. É a única correção desta tela que o
   * sistema pode fazer sozinho com segurança: a sala é quem sabe o que aconteceu.
   * As outras faixas ("sem registro na sala") dependem de alguém investigar.
   */
  const aplicar = async (l: LinhaConferencia) => {
    setAplicando(l.saleId)
    try {
      const r = await aplicarDataDaSala(l.saleId)
      toast.success(
        r.virouRealizada
          ? `${l.pacienteNome}: data da sala aplicada e venda marcada como realizada.`
          : `${l.pacienteNome}: data da sala aplicada.`,
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao aplicar a data da sala')
    } finally {
      setAplicando(null)
    }
  }

  const contagem = useMemo(() => {
    const m = new Map<ConferenciaStatus, number>()
    for (const l of linhas) m.set(l.conferencia, (m.get(l.conferencia) ?? 0) + 1)
    return m
  }, [linhas])

  const visiveis = useMemo(
    () =>
      linhas.filter((l) => {
        if (foco && l.conferencia !== foco) return false
        // Prontuário entra na busca porque é por ele que a conferência com a sala
        // é feita na prática — nome bate errado, prontuário não.
        return combinaBusca(buscaAdiada, l.pacienteNome, l.prontuario)
      }),
    [linhas, foco, buscaAdiada],
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
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
        </Button>
        <SearchField
          value={termo}
          onChange={setTermo}
          label="Buscar paciente na conferência"
          placeholder="Paciente ou prontuário…"
          resultados={visiveis.length}
          className="w-full sm:ml-auto sm:w-64"
        />
      </div>

      {foco ? (
        <p className="text-xs text-muted-foreground">{EXPLICACAO[foco]}</p>
      ) : null}

      {visiveis.length === 0 ? (
        <EmptyState
          title={
            loading
              ? 'Carregando…'
              : termo.trim().length > 0
                ? `Ninguém com "${termo.trim()}" nesta faixa`
                : 'Nada nesta faixa'
          }
          description={
            loading
              ? 'Conferindo venda por venda contra o espelho da sala.'
              : termo.trim().length > 0
                ? 'A busca vale dentro da faixa escolhida. Tire o foco da faixa acima para procurar na base inteira.'
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
                    <th scope="col" className="min-w-36 px-3 py-2 text-left font-medium">Paciente</th>
                    <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">
                      Prontuário
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Data na venda</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Data na sala</th>
                    <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">
                      Folículos
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Situação</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => {
                    const { cor, Icone } = ESTILO[l.conferencia]
                    return (
                      <tr key={l.saleId} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="min-w-36 px-3 py-2">
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
                          {/* No celular as colunas de prontuário e folículos saem daqui. */}
                          <div className="text-xs text-muted-foreground sm:hidden">
                            {l.prontuario ? `prontuário ${l.prontuario}` : 'sem prontuário'}
                            {l.foliculosImplantados
                              ? ` · ${l.foliculosImplantados.toLocaleString('pt-BR')} folículos`
                              : ''}
                          </div>
                        </td>
                        <td className="hidden px-3 py-2 tabular-nums text-muted-foreground sm:table-cell">
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
                        <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                          {l.foliculosImplantados ? l.foliculosImplantados.toLocaleString('pt-BR') : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`flex items-center gap-1.5 text-xs ${cor}`}>
                            <Icone className="size-3.5 shrink-0" aria-hidden />
                            {ROTULO_CONFERENCIA[l.conferencia]}
                          </span>
                          {l.statusDaSala && l.conferencia !== 'sem_espelho' ? (
                            <span className="text-xs text-muted-foreground">
                              sala: {l.statusDaSala.toLowerCase().replace('_', ' ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {PODE_APLICAR.includes(l.conferencia) && l.dataDaSala ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={aplicando === l.saleId}
                              onClick={() => void aplicar(l)}
                              title={`Gravar ${diaBr(l.dataDaSala)} na venda${
                                l.statusDaSala === 'FINALIZADA' ? ' e marcar como realizada' : ''
                              }`}
                            >
                              {aplicando === l.saleId ? 'Aplicando…' : 'Aplicar data da sala'}
                            </Button>
                          ) : null}
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
