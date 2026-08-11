import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarPlus, ChevronLeft, ChevronRight, Copy, Hotel, Scissors } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import {
  type CirurgiaDoDia,
  agruparPorDia,
  listarAgendaCirurgica,
} from '@/services/agendaCirurgica'
import { getAgendaIcsUrl } from '@/services/clinicSales'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Cor por médico. A agenda é lida de longe: quem opera precisa ser reconhecível sem ler. */
const CORES_MEDICO = [
  { ponto: 'bg-sky-500', chip: 'border-sky-500/40 bg-sky-500/10' },
  { ponto: 'bg-violet-500', chip: 'border-violet-500/40 bg-violet-500/10' },
  { ponto: 'bg-emerald-500', chip: 'border-emerald-500/40 bg-emerald-500/10' },
  { ponto: 'bg-amber-500', chip: 'border-amber-500/40 bg-amber-500/10' },
  { ponto: 'bg-rose-500', chip: 'border-rose-500/40 bg-rose-500/10' },
]
const CINZA = { ponto: 'bg-muted-foreground', chip: 'border-border bg-muted/50' }

const rotuloMes = (mes: string) => {
  const [ano, m] = mes.split('-').map(Number)
  const nome = new Date(Date.UTC(ano, m - 1, 1, 12)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

const mesVizinho = (mes: string, passo: number) => {
  const [ano, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(ano, m - 1 + passo, 1, 12))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const diaCurto = (dia: string) =>
  new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })

/** Só a hora, e só quando é real — a hora da venda é sempre a mesma e não quer dizer nada. */
const horaReal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

/**
 * O calendário do centro cirúrgico.
 *
 * Antes desta tela, saber "que dia tem cirurgia" pedia abrir a fila da Central de Vendas,
 * que é uma lista por paciente e não por data: dia com três cirurgias e dia vazio têm
 * exatamente a mesma aparência lá. Aqui o mês é a unidade, e a sala ocupada aparece mesmo
 * quando a cirurgia não tem venda registrada no CRM.
 */
export function AgendaCirurgicaPanel() {
  const hoje = hojeLocal()
  const [mes, setMes] = useState(() => hoje.slice(0, 7))
  const [itens, setItens] = useState<CirurgiaDoDia[]>([])
  const [medico, setMedico] = useState('todos')
  const [selecionado, setSelecionado] = useState<string | null>(hoje)
  const [loading, setLoading] = useState(false)
  const [icsUrl, setIcsUrl] = useState<string | null>(null)

  /** Grade completa: semanas inteiras, de domingo a sábado, cobrindo o mês. */
  const grade = useMemo(() => {
    const [ano, m] = mes.split('-').map(Number)
    const primeiro = new Date(Date.UTC(ano, m - 1, 1, 12))
    const ultimo = new Date(Date.UTC(ano, m, 0, 12))
    const inicio = primeiro.getTime() - primeiro.getUTCDay() * 86_400_000
    const fim = ultimo.getTime() + (6 - ultimo.getUTCDay()) * 86_400_000
    const dias: string[] = []
    for (let t = inicio; t <= fim; t += 86_400_000) {
      dias.push(new Date(t).toISOString().slice(0, 10))
    }
    return dias
  }, [mes])

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    listarAgendaCirurgica(grade[0], grade[grade.length - 1])
      .then((res) => !cancelado && setItens(res))
      .catch((e) => !cancelado && toast.error(e instanceof Error ? e.message : 'Falha ao carregar a agenda'))
      .finally(() => !cancelado && setLoading(false))
    return () => {
      cancelado = true
    }
  }, [grade])

  useEffect(() => {
    getAgendaIcsUrl()
      .then(setIcsUrl)
      .catch(() => setIcsUrl(null))
  }, [])

  const medicos = useMemo(() => {
    const nomes = new Set<string>()
    for (const i of itens) if (i.medico) nomes.add(i.medico)
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [itens])

  const corDoMedico = (nome: string | null) => {
    if (!nome) return CINZA
    const idx = medicos.indexOf(nome)
    return idx >= 0 ? CORES_MEDICO[idx % CORES_MEDICO.length] : CINZA
  }

  const filtrados = useMemo(
    () => (medico === 'todos' ? itens : itens.filter((i) => i.medico === medico)),
    [itens, medico],
  )
  const porDia = useMemo(() => agruparPorDia(filtrados), [filtrados])

  /** Os números do mês em tela, sem contar os dias vizinhos que a grade traz junto. */
  const resumo = useMemo(() => {
    const doMes = filtrados.filter((i) => i.dia.startsWith(mes))
    return {
      total: doMes.length,
      dias: new Set(doMes.map((i) => i.dia)).size,
      foliculos: doMes.reduce((acc, i) => acc + (i.meta ?? 0), 0),
      semVenda: doMes.filter((i) => i.origem === 'sala').length,
      // Cirurgia cuja data já passou e que a sala nunca registrou: ou não aconteceu,
      // ou aconteceu e ninguém deu baixa. Nos dois casos alguém precisa olhar.
      semEspelho: doMes.filter((i) => i.origem === 'venda' && i.dia < hoje).length,
    }
  }, [filtrados, mes, hoje])

  const doDia = selecionado ? (porDia.get(selecionado) ?? []) : []

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Cirurgias no mês</p>
            <p className="font-heading text-2xl">{resumo.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Dias com cirurgia</p>
            <p className="font-heading text-2xl">{resumo.dias}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Folículos previstos</p>
            <p className="font-heading text-2xl">{resumo.foliculos.toLocaleString('pt-BR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Sem venda no CRM</p>
            <p className="font-heading text-2xl">{resumo.semVenda}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Passou sem a sala confirmar</p>
            <p className={cn('font-heading text-2xl', resumo.semEspelho > 0 && 'text-destructive')}>
              {resumo.semEspelho}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{rotuloMes(mes)}</CardTitle>
          <CardAction>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={medico} onValueChange={(v) => setMedico(String(v ?? 'todos'))}>
                <SelectTrigger className="h-8 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os médicos</SelectItem>
                  {medicos.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => setMes(mesVizinho(mes, -1))}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMes(hoje.slice(0, 7))
                  setSelecionado(hoje)
                }}
              >
                Hoje
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMes(mesVizinho(mes, 1))}>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="pb-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grade.map((dia) => {
              const cirurgias = porDia.get(dia) ?? []
              const foraDoMes = !dia.startsWith(mes)
              return (
                <button
                  key={dia}
                  type="button"
                  onClick={() => setSelecionado(dia)}
                  className={cn(
                    'min-h-24 rounded-md border border-border p-1 text-left align-top transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60',
                    foraDoMes && 'opacity-45',
                    dia === selecionado && 'ring-2 ring-primary',
                  )}
                >
                  <div className="flex items-center justify-between px-0.5">
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        dia === hoje && 'rounded bg-primary px-1 text-primary-foreground',
                      )}
                    >
                      {Number(dia.slice(8, 10))}
                    </span>
                    {cirurgias.length > 1 && (
                      <span className="text-[10px] text-muted-foreground">{cirurgias.length}</span>
                    )}
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {cirurgias.slice(0, 3).map((c) => (
                      <div
                        key={c.key}
                        className={cn(
                          'flex items-center gap-1 truncate rounded border px-1 py-0.5 text-[11px]',
                          corDoMedico(c.medico).chip,
                        )}
                        title={`${c.paciente} · ${c.medico ?? 'sem médico'}`}
                      >
                        <span className={cn('size-1.5 shrink-0 rounded-full', corDoMedico(c.medico).ponto)} />
                        <span className="truncate">{c.paciente}</span>
                      </div>
                    ))}
                    {cirurgias.length > 3 && (
                      <div className="px-1 text-[10px] text-muted-foreground">
                        +{cirurgias.length - 3} no dia
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          {medicos.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
              {medicos.map((m) => (
                <span key={m} className="flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', corDoMedico(m).ponto)} /> {m}
                </span>
              ))}
              {loading && <span>carregando…</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selecionado ? diaCurto(selecionado) : 'Escolha um dia'}</CardTitle>
          {icsUrl && (
            <CardAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(icsUrl)
                  toast.success('Endereço copiado. No Google Agenda: "Outras agendas" › "Da URL".')
                }}
              >
                <Copy className="size-3.5" /> Assinar no Google
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {doDia.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading ? 'Carregando…' : 'Nenhuma cirurgia neste dia.'}
            </p>
          ) : (
            doDia.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('size-2 rounded-full', corDoMedico(c.medico).ponto)} />
                    {c.leadId ? (
                      <Link to={`/leads/${c.leadId}`} className="font-semibold hover:underline">
                        {c.paciente}
                      </Link>
                    ) : (
                      <span className="font-semibold">{c.paciente}</span>
                    )}
                    {c.origem === 'sala' && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                        sem venda no CRM
                      </Badge>
                    )}
                    {c.origem === 'venda' && c.dia < hoje && (
                      <Badge variant="outline" className="border-destructive/50 text-destructive">
                        sala não confirmou
                      </Badge>
                    )}
                    {c.statusSala && <Badge variant="secondary">{c.statusSala.toLowerCase()}</Badge>}
                    {c.precisaHotel && (
                      <Badge variant="outline">
                        <Hotel className="size-3" /> hotel
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {c.valorCents != null && <span>{brl(c.valorCents)}</span>}
                    {c.saleId && (
                      <Button size="sm" variant="ghost" nativeButton={false} render={<Link to="/central-vendas/cirurgias" />}>
                        <CalendarPlus className="size-3.5" /> Documentação
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[
                    c.procedimento,
                    c.medico ?? 'sem médico',
                    c.anestesista ? `anestesia: ${c.anestesista}` : null,
                    c.sala ? `sala ${c.sala}` : null,
                    horaReal(c.horaInicio) ? `começou ${horaReal(c.horaInicio)}` : null,
                    c.meta ? `meta ${c.meta.toLocaleString('pt-BR')} folículos` : null,
                    c.implantados ? `${c.implantados.toLocaleString('pt-BR')} implantados` : null,
                    c.cidade,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {itens.length === 0 && !loading && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Scissors className="size-3.5" /> Nenhuma cirurgia neste mês. Cirurgia marcada na Central de Vendas
          aparece aqui no dia combinado.
        </p>
      )}
    </div>
  )
}
