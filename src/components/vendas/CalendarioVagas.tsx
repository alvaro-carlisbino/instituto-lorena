import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { mesComOffset } from '@/lib/periodo'
import { cn } from '@/lib/utils'
import { type SituacaoDoDia, proximoEstado, situacaoDoDia, slotsAposClique } from '@/lib/vagasCirurgia'
import { type DataAberta, definirVagaDoDia, listarDatasAbertas } from '@/services/agendaCirurgica'
import type { ClinicSale } from '@/services/clinicSales'

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

type Quadrado = {
  dia: string
  numero: number
  situacao: SituacaoDoDia
  /** Cirurgias do CRM naquele dia. */
  marcadas: number
  /** Vagas abertas ainda sem paciente. */
  vagas: number
  passado: boolean
}

const COR: Record<SituacaoDoDia, string> = {
  livre: 'border-border bg-muted/30 text-foreground',
  aberta: 'border-red-600 bg-red-500 text-white',
  preenchida: 'border-emerald-700 bg-emerald-600 text-white',
  ocupada: 'border-emerald-700 bg-emerald-600 text-white',
}

/** Só quem ainda aceita clique escurece no hover; dia passado fica parado. */
const HOVER: Record<SituacaoDoDia, string> = {
  livre: 'hover:bg-muted',
  aberta: 'hover:bg-red-600',
  preenchida: 'hover:bg-emerald-700',
  ocupada: 'hover:bg-emerald-700',
}

const diaCurto = (dia: string) =>
  new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })

const rotuloMes = (mes: string) => {
  const [ano, m] = mes.split('-').map(Number)
  const nome = new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** O que está no dia e o que o clique faz com ele — vai no title e no aria-label. */
const legendaDoDia = (q: Quadrado): string => {
  const data = diaCurto(q.dia)
  const agora =
    q.situacao === 'aberta'
      ? `${plural(q.vagas, 'vaga em aberto', 'vagas em aberto')}${q.marcadas > 0 ? ` e ${plural(q.marcadas, 'cirurgia marcada', 'cirurgias marcadas')}` : ''}`
      : q.situacao === 'preenchida'
        ? 'vaga preenchida fora do CRM'
        : q.situacao === 'ocupada'
          ? plural(q.marcadas, 'cirurgia marcada', 'cirurgias marcadas')
          : 'sem vaga aberta'
  if (q.passado) return `${data} · ${agora} · já passou`
  const proximo =
    q.situacao === 'livre'
      ? 'clique para abrir uma vaga'
      : q.situacao === 'ocupada'
        ? 'clique para abrir mais uma vaga'
        : q.situacao === 'aberta'
          ? q.marcadas > 0
            ? 'clique para fechar a vaga extra'
            : 'clique para marcar como preenchida'
          : 'clique para limpar'
  return `${data} · ${agora} · ${proximo}`
}

type Props = {
  mes: string
  onMes: (mes: string) => void
  /** A fila da aba: é dela que sai "dia com cirurgia" (verde sem ninguém clicar). */
  sales: ClinicSale[]
}

/**
 * O calendário de vagas da cirurgia: um quadradinho por dia, um clique por decisão.
 *
 * Vermelho é o que a vendedora precisa vender; verde é o que já está resolvido,
 * seja por venda lançada no CRM, seja porque alguém marcou que a vaga foi
 * preenchida. Cinza é dia comum — e dia comum não é "vaga vazia": sem alguém
 * abrir a data, o sistema não tem como saber se a sala está livre ou de folga.
 */
export function CalendarioVagas({ mes, onMes, sales }: Props) {
  const hoje = hojeLocal()
  const [abertas, setAbertas] = useState<Map<string, DataAberta>>(new Map())
  const [salvando, setSalvando] = useState<string | null>(null)

  const { primeiro, ultimo, inicioSemana, diasNoMes } = useMemo(() => {
    const [ano, m] = mes.split('-').map(Number)
    const p = new Date(Date.UTC(ano, m - 1, 1, 12))
    const u = new Date(Date.UTC(ano, m, 0, 12))
    return {
      primeiro: p.toISOString().slice(0, 10),
      ultimo: u.toISOString().slice(0, 10),
      inicioSemana: p.getUTCDay(),
      diasNoMes: u.getUTCDate(),
    }
  }, [mes])

  const carregar = useCallback(async () => {
    try {
      const lista = await listarDatasAbertas(primeiro, ultimo)
      setAbertas(new Map(lista.map((d) => [d.dia, d])))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar as vagas do mês')
    }
  }, [primeiro, ultimo])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const marcadasPorDia = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sales) {
      if (!s.scheduledAt) continue
      const d = diaLocal(s.scheduledAt)
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return m
  }, [sales])

  const quadrados = useMemo<Quadrado[]>(() => {
    const lista: Quadrado[] = []
    for (let n = 1; n <= diasNoMes; n++) {
      const dia = `${mes}-${String(n).padStart(2, '0')}`
      const { situacao, marcadas, vagas } = situacaoDoDia(abertas.get(dia), marcadasPorDia.get(dia) ?? 0)
      lista.push({ dia, numero: n, situacao, marcadas, vagas, passado: dia < hoje })
    }
    return lista
  }, [mes, diasNoMes, marcadasPorDia, abertas, hoje])

  const resumo = useMemo(() => {
    const aFrente = quadrados.filter((q) => !q.passado && q.situacao === 'aberta')
    return {
      vagas: aFrente.reduce((acc, q) => acc + q.vagas, 0),
      diasAbertos: aFrente,
      diasVerdes: quadrados.filter((q) => q.situacao === 'ocupada' || q.situacao === 'preenchida').length,
    }
  }, [quadrados])

  const clicar = async (q: Quadrado) => {
    if (q.passado || salvando) return
    const estado = proximoEstado(q)
    const anterior = abertas
    // Otimista: é um clique por dia, descendo o mês; esperar o banco a cada um
    // faria o calendário parecer travado.
    setAbertas((prev) => {
      const m = new Map(prev)
      const atual = prev.get(q.dia)
      if (estado === 'livre') m.delete(q.dia)
      else {
        const slots = slotsAposClique(estado, atual?.slots ?? 0, q.marcadas)
        m.set(q.dia, {
          id: atual?.id ?? `tmp-${q.dia}`,
          dia: q.dia,
          slots,
          marcadas: q.marcadas,
          vagasLivres: estado === 'aberta' ? Math.max(slots - q.marcadas, 0) : 0,
          doctor: atual?.doctor ?? null,
          room: atual?.room ?? null,
          note: atual?.note ?? null,
          preenchida: estado === 'preenchida',
        })
      }
      return m
    })
    setSalvando(q.dia)
    try {
      await definirVagaDoDia(q.dia, estado, q.marcadas)
      await carregar()
    } catch (e) {
      setAbertas(anterior)
      toast.error(e instanceof Error ? e.message : 'Falha ao marcar a vaga')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>Vagas de {rotuloMes(mes)}</CardTitle>
        <p className="text-sm text-muted-foreground">
          Um clique no dia abre a vaga; o segundo marca como preenchida; o terceiro limpa. Dia com
          cirurgia lançada já nasce verde.
        </p>
        <CardAction>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="Mês anterior" onClick={() => onMes(mesComOffset(mes, -1))}>
              <ChevronLeft className="size-3.5" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" onClick={() => onMes(hoje.slice(0, 7))}>
              Hoje
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="Próximo mês" onClick={() => onMes(mesComOffset(mes, 1))}>
              <ChevronRight className="size-3.5" aria-hidden />
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="w-full max-w-xs shrink-0">
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="pb-1">
                  {d}
                </div>
              ))}
            </div>
            <div role="grid" aria-label={`Vagas de cirurgia em ${rotuloMes(mes)}`} className="grid grid-cols-7 gap-1">
              {Array.from({ length: inicioSemana }, (_, i) => (
                <div key={`vazio-${i}`} aria-hidden />
              ))}
              {quadrados.map((q) => (
                <button
                  key={q.dia}
                  type="button"
                  disabled={q.passado || salvando != null}
                  title={legendaDoDia(q)}
                  aria-label={legendaDoDia(q)}
                  aria-pressed={q.situacao !== 'livre'}
                  onClick={() => void clicar(q)}
                  className={cn(
                    'relative flex aspect-square flex-col items-center justify-center rounded-md border text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                    COR[q.situacao],
                    q.passado ? 'cursor-default opacity-45' : cn('cursor-pointer', HOVER[q.situacao]),
                    q.dia === hoje && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                    salvando === q.dia && 'animate-pulse',
                  )}
                >
                  <span>{q.numero}</span>
                  {(q.situacao === 'aberta' && q.vagas > 1) || (q.situacao === 'ocupada' && q.marcadas > 1) ? (
                    <span className="absolute right-0.5 top-0.5 text-[9px] font-normal leading-none opacity-90">
                      {q.situacao === 'aberta' ? q.vagas : q.marcadas}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-red-500" aria-hidden /> vaga em aberto
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-emerald-600" aria-hidden /> preenchida
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm border border-border bg-muted/30" aria-hidden /> sem vaga aberta
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Vagas em aberto daqui para a frente</p>
              <p className={cn('font-heading text-2xl', resumo.vagas > 0 && 'text-red-600')}>{resumo.vagas}</p>
              <p className="text-xs text-muted-foreground">
                {resumo.diasAbertos.length === 0
                  ? 'nenhum dia aberto à frente neste mês'
                  : `em ${plural(resumo.diasAbertos.length, 'dia', 'dias')} · ${plural(resumo.diasVerdes, 'dia preenchido', 'dias preenchidos')} no mês`}
              </p>
            </div>
            {resumo.diasAbertos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {resumo.diasAbertos.map((q) => (
                  <span
                    key={q.dia}
                    className="rounded-md border border-red-500/50 bg-red-500/5 px-2 py-0.5 text-xs text-red-700"
                  >
                    {diaCurto(q.dia)}
                    {q.vagas > 1 ? ` · ${q.vagas} vagas` : ''}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              É o mesmo registro de "datas abertas" da Agenda Cirúrgica: a vaga que a venda ocupa fica
              verde sozinha quando a cirurgia é marcada com data.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
