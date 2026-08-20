import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarClock, Flame, Percent } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/page/StatCard'
import { AppLayout } from '@/layouts/AppLayout'
import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import {
  DIAS_SEMANA,
  JA_FEZ_LABEL,
  OBJETIVO_LABEL,
  STATUS_LABEL,
  TEMPO_LABEL,
  URGENCIA_LABEL,
  alternarJanela,
  cancelarPreAgendamento,
  carimbarComparecimento,
  confirmarPreAgendamento,
  fecharDia,
  grauLegivel,
  listarDiasFechados,
  listarJanelas,
  listarPreAgendamentos,
  listarUnidadesAgenda,
  estadoDaAgendaShosp,
  reabrirDia,
  type EstadoAgendaShosp,
  type DiaFechado,
  type JanelaAgenda,
  type PreAgendamento,
  type StatusPreAgendamento,
  type UnidadeAgenda,
} from '@/services/preAgendamentos'

/**
 * Pré-agendamentos: a fila que a landing /consulta enche sozinha.
 *
 * A tela existe para responder três perguntas, nessa ordem: quem reservou e ainda
 * não foi confirmado, quem vem hoje, e quem faltou. Tudo o que a pessoa respondeu
 * na triagem aparece junto do nome, porque o objetivo é que ninguém precise ligar
 * para descobrir o que já foi respondido.
 *
 * Confirmar não é enfeite: a vaga sai da landing na hora e o lead anda no funil.
 */

const abas = [
  { id: 'pendentes', rotulo: 'Aguardando confirmação' },
  { id: 'hoje', rotulo: 'Hoje e amanhã' },
  { id: 'confirmados', rotulo: 'Confirmados' },
  { id: 'todos', rotulo: 'Todos' },
  { id: 'agenda', rotulo: 'Horários da landing' },
] as const

type Aba = (typeof abas)[number]['id']

const CORES_STATUS: Record<StatusPreAgendamento, string> = {
  pendente: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  confirmado: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  cancelado: 'bg-muted text-muted-foreground',
  compareceu: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  faltou: 'bg-destructive/15 text-destructive',
}

function quandoLegivel(iso: string): string {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function telefoneLegivel(digitos: string): string {
  const d = digitos.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return digitos
}

function Triagem({ pre }: { pre: PreAgendamento }) {
  const partes = [
    OBJETIVO_LABEL[pre.objetivo] ?? pre.objetivo,
    grauLegivel(pre.grau),
    TEMPO_LABEL[String(pre.respostas?.tempoQueda ?? '')] ?? '',
    JA_FEZ_LABEL[String(pre.respostas?.jaFez ?? '')] ?? '',
    URGENCIA_LABEL[pre.urgencia] ?? '',
  ].filter(Boolean)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {partes.map((p) => (
        <Badge key={p} variant="secondary" className="font-normal">
          {p}
        </Badge>
      ))}
      {pre.estimativaMin && pre.estimativaMax ? (
        <Badge variant="outline" className="font-normal">
          ~{pre.estimativaMin.toLocaleString('pt-BR')} a {pre.estimativaMax.toLocaleString('pt-BR')} UF
        </Badge>
      ) : null}
    </div>
  )
}

function LinhaPreAgendamento({
  pre,
  agora,
  onConfirmar,
  onCancelar,
  onCarimbar,
  ocupado,
}: {
  pre: PreAgendamento
  /** Instante da última carga. Vem de fora para a linha não ler o relógio no render. */
  agora: number
  onConfirmar: (p: PreAgendamento) => void
  onCancelar: (p: PreAgendamento) => void
  onCarimbar: (p: PreAgendamento, veio: boolean) => void
  ocupado: boolean
}) {
  const passou = new Date(pre.slotAt).getTime() < agora
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tabular-nums">{quandoLegivel(pre.slotAt)}</span>
            <Badge className={cn('font-normal', CORES_STATUS[pre.status])}>{STATUS_LABEL[pre.status]}</Badge>
            <Badge variant="outline" className="font-normal">
              {pre.unidadeId}
            </Badge>
            {pre.prestador ? (
              <Badge variant="outline" className="font-normal">
                {pre.prestador}
              </Badge>
            ) : null}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                pre.temperatura === 'hot'
                  ? 'bg-destructive/15 text-destructive'
                  : pre.temperatura === 'warm'
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              <Flame className="h-3 w-3" />
              {pre.score}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-medium">{pre.nome}</span>
            <a
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              href={`https://wa.me/${pre.telefone}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {telefoneLegivel(pre.telefone)}
            </a>
            <span className="text-xs text-muted-foreground">{pre.protocolo}</span>
            {pre.leadId ? (
              <Link className="text-sm text-primary underline-offset-2 hover:underline" to={`/leads/${pre.leadId}`}>
                Abrir card
              </Link>
            ) : null}
          </div>

          <div className="mt-2">
            <Triagem pre={pre} />
          </div>

          {pre.observacao ? (
            <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">{pre.observacao}</p>
          ) : null}

          {pre.canceladoMotivo ? (
            <p className="mt-2 text-xs text-muted-foreground">Cancelado: {pre.canceladoMotivo}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {pre.status === 'pendente' ? (
            <>
              <Button size="sm" disabled={ocupado} onClick={() => onConfirmar(pre)}>
                Confirmar
              </Button>
              <Button size="sm" variant="outline" disabled={ocupado} onClick={() => onCancelar(pre)}>
                Cancelar
              </Button>
            </>
          ) : null}
          {pre.status === 'confirmado' ? (
            <>
              {passou ? (
                <>
                  <Button size="sm" disabled={ocupado} onClick={() => onCarimbar(pre, true)}>
                    Compareceu
                  </Button>
                  <Button size="sm" variant="outline" disabled={ocupado} onClick={() => onCarimbar(pre, false)}>
                    Faltou
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => onCancelar(pre)}>
                  Cancelar
                </Button>
              )}
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function PainelAgenda({
  unidades,
  janelas,
  fechados,
  agenda,
  onRecarregar,
}: {
  unidades: UnidadeAgenda[]
  janelas: JanelaAgenda[]
  fechados: DiaFechado[]
  agenda: EstadoAgendaShosp | null
  onRecarregar: () => void
}) {
  const [novoDia, setNovoDia] = useState('')
  const [motivo, setMotivo] = useState('')

  const porUnidade = useMemo(() => {
    const mapa = new Map<string, JanelaAgenda[]>()
    for (const j of janelas) {
      const atual = mapa.get(j.unidadeId)
      if (atual) atual.push(j)
      else mapa.set(j.unidadeId, [j])
    }
    return mapa
  }, [janelas])

  const atrasada = agenda?.minutosDesde != null && agenda.minutosDesde > 90

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ligação com a agenda da Shosp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>
            <strong className="tabular-nums">{agenda?.horariosLivres?.toLocaleString('pt-BR') ?? '—'}</strong>{' '}
            horários livres espelhados
          </span>
          <span className={cn(atrasada && 'font-semibold text-destructive')}>
            {agenda?.minutosDesde == null
              ? 'Nunca sincronizado'
              : agenda.minutosDesde < 2
                ? 'Sincronizado agora'
                : `Sincronizado há ${agenda.minutosDesde} min`}
          </span>
          <span className="text-xs text-muted-foreground">
            A landing só oferece horário que a Shosp diz estar livre, e confere de novo na hora da reserva. O espelho
            atualiza de 30 em 30 minutos.
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Expediente que a landing pode vender</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Isto não cria horário: só limita o que veio da Shosp. Desligar uma faixa some com aqueles horários da
            página no mesmo instante, e o que já foi reservado continua valendo.
          </p>
          {unidades
            .filter((u) => porUnidade.has(u.id))
            .map((u) => (
              <div key={u.id}>
                <p className="mb-2 text-sm font-medium">{u.rotulo}</p>
                <div className="flex flex-wrap gap-2">
                  {(porUnidade.get(u.id) ?? [])
                    .slice()
                    .sort((a, b) => a.weekday - b.weekday || a.horaInicio.localeCompare(b.horaInicio))
                    .map((j) => (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => {
                          void alternarJanela(j)
                            .then(onRecarregar)
                            .catch((e) => toast.error(e instanceof Error ? e.message : 'Falhou'))
                        }}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-xs transition',
                          j.ativa
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground line-through',
                        )}
                      >
                        {DIAS_SEMANA[j.weekday].slice(0, 3)} {j.horaInicio} às {j.horaFim}
                      </button>
                    ))}
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Dias fechados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Feriado, congresso, viagem. Nesses dias a landing não oferece horário nenhum.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Input type="date" value={novoDia} onChange={(e) => setNovoDia(e.target.value)} className="w-40" />
            <Input
              placeholder="Motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-48"
            />
            <Button
              size="sm"
              disabled={!novoDia}
              onClick={() => {
                void fecharDia(novoDia, motivo)
                  .then(() => {
                    setNovoDia('')
                    setMotivo('')
                    onRecarregar()
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : 'Falhou'))
              }}
            >
              Fechar dia
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {fechados.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum dia fechado à frente.</p>
            ) : (
              fechados.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                  <span className="text-sm">
                    {f.dia.split('-').reverse().join('/')}
                    {f.motivo ? <span className="ml-2 text-muted-foreground">{f.motivo}</span> : null}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void reabrirDia(f.id)
                        .then(onRecarregar)
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'Falhou'))
                    }}
                  >
                    Reabrir
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function PreAgendamentosPage() {
  const [aba, setAba] = useState<Aba>('pendentes')
  const [lista, setLista] = useState<PreAgendamento[]>([])
  const [unidades, setUnidades] = useState<UnidadeAgenda[]>([])
  const [janelas, setJanelas] = useState<JanelaAgenda[]>([])
  const [fechados, setFechados] = useState<DiaFechado[]>([])
  const [agendaShosp, setAgendaShosp] = useState<EstadoAgendaShosp | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  // Relógio carimbado na carga: sem isto cada render lia Date.now() e o resultado
  // mudava no meio da tela (o botão "Compareceu" nascia e sumia sozinho).
  const [agora, setAgora] = useState(0)

  const recarregar = () => {
    setCarregando(true)
    void Promise.all([
      listarPreAgendamentos(),
      listarUnidadesAgenda(),
      listarJanelas(),
      listarDiasFechados(),
      estadoDaAgendaShosp(),
    ])
      .then(([pre, uni, jan, fec, ag]) => {
        setAgora(Date.now())
        setLista(pre)
        setUnidades(uni)
        setJanelas(jan)
        setFechados(fec)
        setAgendaShosp(ag)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => setCarregando(false))
  }

  useEffect(() => recarregar(), [])

  const hoje = useMemo(() => (agora ? diaLocal(new Date(agora)) : hojeLocal()), [agora])
  const amanha = useMemo(() => diaLocal(new Date((agora || 0) + 86_400_000)), [agora])

  const resumo = useMemo(() => {
    const pendentes = lista.filter((p) => p.status === 'pendente').length
    const proximos = lista.filter(
      (p) => (p.status === 'pendente' || p.status === 'confirmado') && [hoje, amanha].includes(diaLocal(p.slotAt)),
    ).length
    const carimbados = lista.filter((p) => p.status === 'compareceu' || p.status === 'faltou')
    const compareceram = carimbados.filter((p) => p.status === 'compareceu').length
    const comScore = lista.filter((p) => p.score > 0)
    return {
      pendentes,
      proximos,
      comparecimento: carimbados.length ? Math.round((compareceram / carimbados.length) * 100) : null,
      scoreMedio: comScore.length
        ? Math.round(comScore.reduce((soma, p) => soma + p.score, 0) / comScore.length)
        : null,
      total: lista.length,
    }
  }, [lista, hoje, amanha])

  const visiveis = useMemo(() => {
    if (aba === 'pendentes') return lista.filter((p) => p.status === 'pendente')
    if (aba === 'confirmados') return lista.filter((p) => p.status === 'confirmado')
    if (aba === 'hoje')
      return lista.filter(
        (p) => (p.status === 'pendente' || p.status === 'confirmado') && [hoje, amanha].includes(diaLocal(p.slotAt)),
      )
    return lista
  }, [lista, aba, hoje, amanha])

  const comAcao = async (acao: () => Promise<void>, mensagem: string) => {
    setOcupado(true)
    try {
      await acao()
      toast.success(mensagem)
      recarregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui salvar')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <AppLayout
      title="Pré-agendamentos"
      subtitle="Quem se qualificou sozinho na landing e já escolheu horário. Confirmar tira a vaga da página e anda o funil."
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Aguardando confirmação"
            value={resumo.pendentes}
            hint="reservas que ninguém tocou ainda"
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            valueClassName={resumo.pendentes > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}
          />
          <StatCard
            label="Hoje e amanhã"
            value={resumo.proximos}
            hint="consultas por acontecer"
            icon={<CalendarCheck className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="Comparecimento"
            value={resumo.comparecimento == null ? '—' : `${resumo.comparecimento}%`}
            hint="entre os já carimbados"
            icon={<Percent className="h-3.5 w-3.5" />}
          />
          <StatCard
            label="Score médio"
            value={resumo.scoreMedio == null ? '—' : resumo.scoreMedio}
            hint={`${resumo.total} reservas nos últimos 30 dias`}
            icon={<Flame className="h-3.5 w-3.5" />}
          />
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-border">
          {abas.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setAba(t.id)}
              className={cn(
                '-mb-px whitespace-nowrap rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors',
                aba === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.rotulo}
            </button>
          ))}
        </nav>

        {carregando ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : aba === 'agenda' ? (
          <PainelAgenda
            unidades={unidades}
            janelas={janelas}
            fechados={fechados}
            agenda={agendaShosp}
            onRecarregar={recarregar}
          />
        ) : visiveis.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nada nesta aba. A landing publica em <span className="font-mono">/consulta</span>: enquanto ninguém
              preencher, esta fila fica vazia mesmo.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {visiveis.map((pre) => (
              <LinhaPreAgendamento
                key={pre.id}
                pre={pre}
                agora={agora}
                ocupado={ocupado}
                onConfirmar={(p) =>
                  void comAcao(() => confirmarPreAgendamento(p), `Consulta de ${p.nome} confirmada.`)
                }
                onCancelar={(p) => {
                  const motivo = window.prompt(`Cancelar o horário de ${p.nome}. Motivo:`) ?? ''
                  if (!motivo.trim()) return
                  void comAcao(() => cancelarPreAgendamento(p, motivo), 'Horário liberado na landing.')
                }}
                onCarimbar={(p, veio) =>
                  void comAcao(
                    () => carimbarComparecimento(p, veio),
                    veio ? 'Comparecimento registrado.' : 'Falta registrada.',
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

export default PreAgendamentosPage
