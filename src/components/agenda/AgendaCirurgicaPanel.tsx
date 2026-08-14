import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarPlus, ChevronLeft, ChevronRight, Copy, Hotel, Scissors, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type CirurgiaDoDia,
  type DataAberta,
  abrirData,
  agruparPorDia,
  fecharData,
  listarAgendaCirurgica,
  listarDatasAbertas,
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
  const [datasAbertas, setDatasAbertas] = useState<DataAberta[]>([])
  const [novaData, setNovaData] = useState('')
  const [novasVagas, setNovasVagas] = useState('1')
  const [salvandoData, setSalvandoData] = useState(false)

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

  const carregarDatas = useCallback(async () => {
    try {
      setDatasAbertas(await listarDatasAbertas(grade[0], grade[grade.length - 1]))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar as datas abertas')
    }
  }, [grade])

  useEffect(() => {
    void carregarDatas()
  }, [carregarDatas])

  /**
   * As datas que a clínica abriu e ainda não têm paciente.
   *
   * O número é de vaga, não de dia: a data com duas vagas e uma cirurgia marcada
   * ainda tem uma para vender. Só conta daqui para a frente — data aberta que
   * passou vazia é prejuízo consumado, e a Aline não pode fazer nada com ela.
   */
  const semPaciente = useMemo(() => {
    const doMes = datasAbertas.filter((d) => d.dia.startsWith(mes))
    const futuras = doMes.filter((d) => d.dia >= hoje && d.vagasLivres > 0)
    return {
      doMes,
      futuras,
      vagas: futuras.reduce((acc, d) => acc + d.vagasLivres, 0),
      passouVazia: doMes.filter((d) => d.dia < hoje && d.marcadas === 0).length,
    }
  }, [datasAbertas, mes, hoje])

  const registrarData = async () => {
    setSalvandoData(true)
    try {
      await abrirData({ dia: novaData, slots: Number(novasVagas || 1) })
      setNovaData('')
      setNovasVagas('1')
      await carregarDatas()
      toast.success('Data aberta.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir a data')
    } finally {
      setSalvandoData(false)
    }
  }

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
  const vagasPorDia = useMemo(
    () => new Map(datasAbertas.filter((d) => d.vagasLivres > 0).map((d) => [d.dia, d.vagasLivres] as const)),
    [datasAbertas],
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Cirurgias no mês</p>
            <p className="font-heading text-2xl">{resumo.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Datas sem paciente</p>
            <p className={cn('font-heading text-2xl', semPaciente.vagas > 0 && 'text-amber-600')}>
              {semPaciente.vagas}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {semPaciente.futuras.length === 0
                ? 'nenhuma data aberta à frente'
                : `em ${semPaciente.futuras.length} dia${semPaciente.futuras.length > 1 ? 's' : ''}`}
            </p>
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
              const vagas = vagasPorDia.get(dia) ?? 0
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
                    {vagas > 0 && (
                      <div className="truncate rounded border border-dashed border-amber-500/60 px-1 py-0.5 text-[11px] text-amber-600">
                        {vagas} vaga{vagas > 1 ? 's' : ''}
                      </div>
                    )}
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
          <CardTitle>Datas de cirurgia sem paciente</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            A data aberta é decisão da clínica, não dedução do sistema: segunda-feira vazia no calendário
            pode ser dia sem cirurgia ou sala reservada esperando paciente. Abra a data aqui e ela vira
            número — e vaga preenchida some sozinha da lista quando a venda é marcada.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-normal text-muted-foreground">Abrir data</Label>
              <Input
                type="date"
                value={novaData}
                onChange={(e) => setNovaData(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-normal text-muted-foreground">Vagas</Label>
              <Input
                value={novasVagas}
                onChange={(e) => setNovasVagas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className="w-20"
                inputMode="numeric"
              />
            </div>
            <Button size="sm" disabled={!novaData || salvandoData} onClick={() => void registrarData()}>
              {salvandoData ? 'Salvando…' : 'Abrir'}
            </Button>
          </div>

          {semPaciente.doMes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma data aberta neste mês. Sem data aberta, o painel não tem como dizer se falta
              paciente ou se o dia é de folga.
            </p>
          ) : (
            <div className="space-y-1.5">
              {semPaciente.doMes.map((d) => (
                <div
                  key={d.id}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm',
                    d.vagasLivres > 0 && d.dia >= hoje && 'border-amber-500/50 bg-amber-500/5',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{diaCurto(d.dia)}</span>
                    <span className="text-muted-foreground">
                      {d.marcadas} de {d.slots} ocupada{d.slots > 1 ? 's' : ''}
                    </span>
                    {d.vagasLivres > 0 ? (
                      d.dia >= hoje ? (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                          {d.vagasLivres} sem paciente
                        </Badge>
                      ) : (
                        <Badge variant="outline">passou com {d.vagasLivres} vaga vazia</Badge>
                      )
                    ) : (
                      <Badge variant="secondary">cheia</Badge>
                    )}
                    {d.note && <span className="text-xs text-muted-foreground">{d.note}</span>}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void fecharData(d.id)
                        .then(carregarDatas)
                        .catch((e) =>
                          toast.error(e instanceof Error ? e.message : 'Falha ao fechar a data'),
                        )
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
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
