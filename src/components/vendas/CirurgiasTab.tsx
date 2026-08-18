import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, Ban, CalendarCheck2, CalendarPlus, CalendarSync, Copy } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { combinaBusca } from '@/lib/busca'
import { cn } from '@/lib/utils'
import {
  CONFIRMATION_LABEL,
  type ClinicSale,
  type ConfirmationStatus,
  type ResultadoEnfermagem,
  type SurgeryReminder,
  cancelarCirurgia,
  getAgendaIcsUrl,
  googleCalendarLink,
  listClinicSales,
  listReminders,
  remarcarCirurgia,
  setSaleConfirmation,
} from '@/services/clinicSales'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const diasAte = (iso: string) => {
  const alvo = new Date(iso)
  const hoje = new Date()
  return Math.ceil((alvo.getTime() - hoje.getTime()) / 86400000)
}

const nomeDoMes = (m: string) => {
  const [ano, mes] = m.split('-')
  const nome = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

const ORDEM: ConfirmationStatus[] = ['confirmada', 'nao_confirmada', 'remanejar']

/** Cor só no que está escolhido: três botões coloridos por linha viram semáforo quebrado. */
const TOM: Record<ConfirmationStatus, string> = {
  confirmada: 'bg-emerald-600 text-white hover:bg-emerald-600/90',
  nao_confirmada: 'bg-muted-foreground text-background hover:bg-muted-foreground/90',
  remanejar: 'bg-amber-500 text-white hover:bg-amber-500/90',
}

/** Data e hora de um ISO, nos formatos que os dois inputs esperam. */
const partesLocais = (iso: string | null) => {
  if (!iso) return { dia: '', hora: '07:00' }
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    dia: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    hora: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}

/**
 * O que aconteceu na agenda da enfermagem, em uma frase para o toast.
 *
 * Aparece sempre, inclusive quando NADA foi alterado lá: "atualizei aqui e não
 * consegui lá" é a informação que decide se alguém precisa descer e avisar a sala.
 */
const recadoDaEnfermagem = (r: ResultadoEnfermagem): string =>
  r.tocou ? `Agenda da enfermagem: ${r.acao}.` : `Agenda da enfermagem NÃO mudou — ${r.motivo}.`

/**
 * A lista de cirurgias do mês, com um status por paciente.
 *
 * Era um checklist de seis documentos por cirurgia. A gerente pediu para tirar em
 * 14/08/2026, e a razão está no próprio dado: das cirurgias agendadas, quase
 * nenhuma tinha mais de uma caixinha marcada — quem atende não abre a tela para
 * marcar "termo de consentimento assinado", abre para saber quem confirmou e quem
 * precisa remarcar. O checklist continua nascendo no banco a cada agendamento, e
 * o histórico dos meses anteriores continua lá; ele só saiu daqui.
 */
export function CirurgiasTab() {
  const [sales, setSales] = useState<ClinicSale[]>([])
  const [reminders, setReminders] = useState<Map<string, SurgeryReminder[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [icsUrl, setIcsUrl] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [remarcando, setRemarcando] = useState<ClinicSale | null>(null)
  const [novaData, setNovaData] = useState('')
  const [novaHora, setNovaHora] = useState('07:00')
  const [cancelando, setCancelando] = useState<ClinicSale | null>(null)
  const [motivo, setMotivo] = useState('')
  const [estorno, setEstorno] = useState('Em avaliação')
  const [enviando, setEnviando] = useState(false)
  const [termo, setTermo] = useState('')
  const buscaAdiada = useDeferredValue(termo)
  /** null = todas as faixas; escolher uma foca em quem ainda precisa de contato. */
  const [foco, setFoco] = useState<ConfirmationStatus | null>(null)
  const [mes, setMes] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const load = async () => {
    setLoading(true)
    try {
      const todas = await listClinicSales('cirurgia')
      const agendadas = todas
        .filter((s) => s.scheduledAt && s.status !== 'cancelada' && s.status !== 'realizada')
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
      setSales(agendadas)
      setReminders(await listReminders(agendadas.map((s) => s.id)))
      setIcsUrl(await getAgendaIcsUrl().catch(() => null))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar as cirurgias')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  /** Meses que têm cirurgia marcada, do mais próximo para o mais distante. */
  const meses = useMemo(() => {
    const set = new Set(sales.map((s) => String(s.scheduledAt).slice(0, 7)))
    return [...set].sort()
  }, [sales])

  // Se o mês corrente não tem nenhuma cirurgia, abrir numa tela vazia esconderia a
  // fila inteira. Cai no primeiro mês que tem — derivado, e não um setMes dentro de
  // efeito, que pisca a tela vazia antes de corrigir.
  const mesAtivo = meses.length > 0 && !meses.includes(mes) ? meses[0] : mes

  const doMes = useMemo(
    () => sales.filter((s) => String(s.scheduledAt).slice(0, 7) === mesAtivo),
    [sales, mesAtivo],
  )

  // A contagem do topo é sempre do mês inteiro: se ela seguisse a busca, o número
  // de "não confirmadas" mudaria a cada letra digitada e deixaria de ser a fila.
  const contagem = useMemo(() => {
    const base: Record<ConfirmationStatus, number> = { confirmada: 0, nao_confirmada: 0, remanejar: 0 }
    for (const s of doMes) base[s.confirmationStatus] += 1
    return base
  }, [doMes])

  const visiveis = useMemo(
    () =>
      doMes.filter((s) => {
        if (foco && s.confirmationStatus !== foco) return false
        return combinaBusca(
          buscaAdiada,
          s.patientName,
          s.phone,
          s.city,
          s.procedureLabel,
          s.attendingDoctor,
          s.performingDoctor,
          s.anesthetist,
          s.room,
        )
      }),
    [doMes, foco, buscaAdiada],
  )

  const marcar = async (sale: ClinicSale, status: ConfirmationStatus) => {
    if (sale.confirmationStatus === status) return
    setSalvando(sale.id)
    const anterior = sale.confirmationStatus
    // Otimista: a atendente clica descendo a lista inteira, e esperar o banco a
    // cada clique faz a tela parecer travada.
    setSales((prev) => prev.map((s) => (s.id === sale.id ? { ...s, confirmationStatus: status } : s)))
    try {
      await setSaleConfirmation(sale.id, status)
    } catch (e) {
      setSales((prev) =>
        prev.map((s) => (s.id === sale.id ? { ...s, confirmationStatus: anterior } : s)),
      )
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar o status')
    } finally {
      setSalvando(null)
    }
  }

  const abrirRemarcacao = (sale: ClinicSale) => {
    const { dia, hora } = partesLocais(sale.scheduledAt)
    setNovaData(dia)
    setNovaHora(hora)
    setRemarcando(sale)
  }

  const confirmarRemarcacao = async () => {
    if (!remarcando || !novaData) return
    setEnviando(true)
    try {
      const iso = new Date(`${novaData}T${novaHora || '07:00'}:00`).toISOString()
      const enfermagem = await remarcarCirurgia(remarcando.id, iso)
      toast.success(
        `${remarcando.patientName} remarcada para ${new Date(iso).toLocaleString('pt-BR')}. ${recadoDaEnfermagem(enfermagem)}`,
        // A sala já começou: o recado precisa ficar na tela até alguém ler, não
        // sumir em três segundos como toast de sucesso comum.
        enfermagem.precisaAvisar ? { duration: 15000 } : undefined,
      )
      setRemarcando(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remarcar')
    } finally {
      setEnviando(false)
    }
  }

  const confirmarCancelamento = async () => {
    if (!cancelando) return
    setEnviando(true)
    try {
      const enfermagem = await cancelarCirurgia(cancelando.id, { reason: motivo, refundStatus: estorno })
      toast.success(
        `Cirurgia de ${cancelando.patientName} cancelada. ${recadoDaEnfermagem(enfermagem)}`,
        enfermagem.precisaAvisar ? { duration: 15000 } : undefined,
      )
      setCancelando(null)
      setMotivo('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar')
    } finally {
      setEnviando(false)
    }
  }

  if (sales.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck2}
        title={loading ? 'Carregando…' : 'Nenhuma cirurgia agendada'}
        description={loading ? undefined : 'Cirurgia registrada na aba de vendas com data aparece aqui.'}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Cirurgias em {nomeDoMes(mesAtivo)}</p>
            <p className="font-heading text-2xl">{doMes.length}</p>
          </CardContent>
        </Card>
        {/* Os três status viram filtro: a atendente lê "4 não confirmadas" e o que
            ela quer em seguida é a lista dessas 4, não rolar o mês inteiro atrás. */}
        {ORDEM.map((st) => {
          const ativo = foco === st
          const n = contagem[st]
          return (
            <Card
              key={st}
              className={cn('py-0 transition-colors', ativo && 'bg-primary/5 ring-2 ring-primary')}
            >
              <button
                type="button"
                aria-pressed={ativo}
                onClick={() => setFoco(ativo ? null : st)}
                title={`Mostrar só as cirurgias com status "${CONFIRMATION_LABEL[st]}"`}
                className="w-full cursor-pointer px-4 py-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <p className="text-xs text-muted-foreground">{CONFIRMATION_LABEL[st]}</p>
                <p
                  className={cn(
                    'font-heading text-2xl',
                    st === 'confirmada' && n > 0 && 'text-emerald-600',
                    st === 'nao_confirmada' && n > 0 && 'text-destructive',
                    st === 'remanejar' && n > 0 && 'text-amber-600',
                  )}
                >
                  {n}
                </p>
              </button>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>Pacientes de {nomeDoMes(mesAtivo)}</CardTitle>
          <CardAction>
            {icsUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(icsUrl)
                  toast.success('Endereço copiado. No Google Agenda: "Outras agendas" › "Da URL".')
                }}
              >
                <Copy className="size-3.5" aria-hidden /> Assinar no Google
              </Button>
            )}
          </CardAction>

          <div className="col-span-full flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchField
              value={termo}
              onChange={setTermo}
              label="Buscar paciente da fila"
              placeholder="Paciente, telefone, cidade, médico, sala…"
              resultados={visiveis.length}
              className="w-full sm:max-w-xs"
            />
            <Select value={mesAtivo} onValueChange={(v) => setMes(String(v ?? mesAtivo))}>
              <SelectTrigger className="h-8 w-44" aria-label="Mês da cirurgia">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m} value={m}>
                    {nomeDoMes(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {foco && (
              <Button size="sm" variant="ghost" onClick={() => setFoco(null)}>
                Limpar filtro de {CONFIRMATION_LABEL[foco].toLowerCase()}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {visiveis.length === 0 ? (
            <EmptyState
              icon={CalendarCheck2}
              title={
                termo.trim().length > 0
                  ? `Nenhum paciente para "${termo.trim()}"`
                  : foco
                    ? `Nenhuma cirurgia com status "${CONFIRMATION_LABEL[foco]}" em ${nomeDoMes(mesAtivo)}`
                    : `Nenhuma cirurgia em ${nomeDoMes(mesAtivo)}`
              }
              description={
                termo.trim().length > 0 || foco
                  ? 'A fila do mês continua ali: limpe a busca ou o filtro de status.'
                  : undefined
              }
              className="py-6"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  {`${visiveis.length} cirurgia${visiveis.length === 1 ? '' : 's'} em ${nomeDoMes(mesAtivo)}. `}
                  No celular a tabela mostra paciente, data e situação; procedimento, médico e
                  valor aparecem junto do nome do paciente.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="min-w-36">Paciente</TableHead>
                    <TableHead scope="col">Data</TableHead>
                    <TableHead scope="col" className="hidden md:table-cell">Procedimento</TableHead>
                    <TableHead scope="col" className="hidden lg:table-cell">Médico</TableHead>
                    <TableHead scope="col" className="hidden text-right sm:table-cell">Valor</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col"><span className="sr-only">Ações</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((s) => {
                    const dias = s.scheduledAt ? diasAte(s.scheduledAt) : null
                    const falhou = (reminders.get(s.id) ?? []).some((a) => a.status === 'erro')
                    const link = googleCalendarLink(s)
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="min-w-36">
                          {/* Da fila até a ficha 360, onde estão consulta do Shosp,
                              tricoscopia do HairMetrix e o histórico de pagamento. */}
                          {s.leadId ? (
                            <Link
                              to={`/leads/${s.leadId}`}
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {s.patientName}
                            </Link>
                          ) : (
                            <span className="font-medium">{s.patientName}</span>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {s.city && <span className="text-xs text-muted-foreground">{s.city}</span>}
                            {s.hotelNeeded && (
                              <span className="text-xs text-muted-foreground">precisa de hotel</span>
                            )}
                            {falhou && (
                              <Badge variant="destructive" className="text-[10px]">
                                aviso não saiu
                              </Badge>
                            )}
                          </div>
                          {/* O que as colunas escondidas no celular diriam. */}
                          <div className="text-xs text-muted-foreground md:hidden">
                            {s.procedureLabel}
                          </div>
                          <div className="text-xs text-muted-foreground sm:hidden">
                            {brl(s.valueCents)}
                            {s.performingDoctor ?? s.attendingDoctor
                              ? ` · ${s.performingDoctor ?? s.attendingDoctor}`
                              : ''}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {s.scheduledAt ? new Date(s.scheduledAt).toLocaleString('pt-BR') : '—'}
                          {dias != null && dias <= 30 && (
                            <div className={cn('text-xs', dias <= 7 ? 'text-destructive' : 'text-muted-foreground')}>
                              {dias < 0 ? 'já passou' : dias === 0 ? 'hoje' : `em ${dias} dias`}
                            </div>
                          )}
                          {dias != null && dias < 0 && s.status === 'agendada' && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <AlertTriangle className="size-3" aria-hidden /> a sala não confirmou
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden max-w-[200px] truncate md:table-cell">
                          {s.procedureLabel}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                          {s.performingDoctor ?? s.attendingDoctor ?? 'sem médico'}
                        </TableCell>
                        <TableCell className="hidden text-right whitespace-nowrap sm:table-cell">
                          {brl(s.valueCents)}
                        </TableCell>
                        <TableCell>
                          <div
                            role="group"
                            aria-label={`Confirmação da cirurgia de ${s.patientName}`}
                            className="flex flex-wrap gap-1 sm:flex-nowrap"
                          >
                            {ORDEM.map((op) => (
                              <Button
                                key={op}
                                size="sm"
                                variant={s.confirmationStatus === op ? 'default' : 'outline'}
                                disabled={salvando === s.id}
                                aria-pressed={s.confirmationStatus === op}
                                className={cn('h-7 px-2 text-xs', s.confirmationStatus === op && TOM[op])}
                                onClick={() => void marcar(s, op)}
                              >
                                {CONFIRMATION_LABEL[op]}
                              </Button>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-0.5">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Mudar a data — atualiza a agenda da enfermagem"
                              aria-label={`Remarcar a cirurgia de ${s.patientName}`}
                              onClick={() => abrirRemarcacao(s)}
                            >
                              <CalendarSync className="size-3.5" aria-hidden />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Cancelar a cirurgia — tira da agenda da enfermagem"
                              aria-label={`Cancelar a cirurgia de ${s.patientName}`}
                              onClick={() => {
                                setMotivo('')
                                setEstorno('Em avaliação')
                                setCancelando(s)
                              }}
                            >
                              <Ban className="size-3.5" aria-hidden />
                            </Button>
                            {link && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title="Criar o evento no Google Agenda agora"
                                aria-label={`Criar no Google Agenda o evento de ${s.patientName}`}
                                nativeButton={false}
                                render={<a href={link} target="_blank" rel="noreferrer noopener" />}
                              >
                                <CalendarPlus className="size-3.5" aria-hidden />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Mudar a data ou cancelar já atualiza a agenda da enfermagem. Remarcar devolve o paciente para
            "não confirmada": o sim que ele deu foi para a data antiga.
          </p>
        </CardContent>
      </Card>

      <Dialog open={remarcando != null} onOpenChange={(v) => (!v ? setRemarcando(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova data para {remarcando?.patientName}</DialogTitle>
            <DialogDescription>
              {remarcando?.scheduledAt
                ? `Hoje está marcada para ${new Date(remarcando.scheduledAt).toLocaleString('pt-BR')}.`
                : ''}{' '}
              A agenda da enfermagem é atualizada junto, e os avisos ao paciente são reprogramados para a
              data nova.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={novaData}
                onChange={(e) => setNovaData(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hora</Label>
              <Input
                type="time"
                value={novaHora}
                onChange={(e) => setNovaHora(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemarcando(null)}>
              Voltar
            </Button>
            <Button disabled={enviando || !novaData} onClick={() => void confirmarRemarcacao()}>
              {enviando ? 'Remarcando…' : 'Remarcar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelando != null} onOpenChange={(v) => (!v ? setCancelando(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar a cirurgia de {cancelando?.patientName}</DialogTitle>
            <DialogDescription>
              A cirurgia sai da agenda da enfermagem e da fila daqui, e os avisos pendentes ao paciente são
              cancelados. A venda fica registrada como cancelada, com o motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Desistiu, condição de saúde, remarcou sem data…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Estorno da entrada</Label>
              <Input value={estorno} onChange={(e) => setEstorno(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={enviando || !motivo.trim()}
              onClick={() => void confirmarCancelamento()}
            >
              {enviando ? 'Cancelando…' : 'Cancelar cirurgia'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
