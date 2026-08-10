import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, CheckCircle2, MessageCircle, PhoneCall } from 'lucide-react'

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_OUTCOMES,
  type FollowupAgendaRow,
  completeFollowup,
  listFollowupAgenda,
} from '@/services/leadFollowups'

const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emDias = (dias: number) => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const soDigitos = (v: string | null) => (v ?? '').replace(/\D/g, '')

/** Atalhos de reagendamento: é assim que ela fala, "volto nele daqui uma semana". */
const ATALHOS = [
  { label: 'Amanhã', dias: 1 },
  { label: '3 dias', dias: 3 },
  { label: '1 semana', dias: 7 },
  { label: '15 dias', dias: 15 },
  { label: '30 dias', dias: 30 },
]

export function FollowUpTab() {
  const [rows, setRows] = useState<FollowupAgendaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [alvo, setAlvo] = useState<FollowupAgendaRow | null>(null)
  const [outcome, setOutcome] = useState(FOLLOWUP_OUTCOMES[0])
  const [canal, setCanal] = useState(FOLLOWUP_CHANNELS[0])
  const [nota, setNota] = useState('')
  const [proxima, setProxima] = useState(emDias(7))
  const [semProxima, setSemProxima] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setRows(await listFollowupAgenda())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar os follow-ups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const grupos = useMemo(
    () => ({
      atrasado: rows.filter((r) => r.bucket === 'atrasado'),
      hoje: rows.filter((r) => r.bucket === 'hoje'),
      semana: rows.filter((r) => r.bucket === 'semana'),
    }),
    [rows],
  )

  const abrir = (row: FollowupAgendaRow) => {
    setAlvo(row)
    setOutcome(FOLLOWUP_OUTCOMES[0])
    setCanal(row.channel ?? FOLLOWUP_CHANNELS[0])
    setNota('')
    setProxima(emDias(7))
    setSemProxima(false)
  }

  const registrar = async () => {
    if (!alvo) return
    setSalvando(true)
    try {
      await completeFollowup({
        id: alvo.id,
        leadId: alvo.leadId,
        outcome,
        note: nota,
        channel: canal,
        nextDate: semProxima ? null : proxima,
      })
      toast.success(
        semProxima
          ? `${alvo.patientName} saiu da fila de follow-up.`
          : `Contato registrado. Próximo em ${new Date(`${proxima}T12:00:00`).toLocaleDateString('pt-BR')}.`,
      )
      setAlvo(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar')
    } finally {
      setSalvando(false)
    }
  }

  const tabela = (titulo: string, lista: FollowupAgendaRow[], destaque?: boolean) => (
    <Card key={titulo}>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <CardAction>
          <Badge variant={destaque && lista.length > 0 ? 'destructive' : 'secondary'}>{lista.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {lista.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nada aqui" className="py-6" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Tentativa</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Combinado</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.patientName}</div>
                      <div className="text-xs text-muted-foreground">{r.phone ?? 'sem telefone'}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.attemptNo}ª</TableCell>
                    <TableCell>
                      {new Date(`${r.scheduledFor}T12:00:00`).toLocaleDateString('pt-BR')}
                      {r.diasAtraso > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          {r.diasAtraso}d
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground">{r.note ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {soDigitos(r.phone).length >= 10 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            nativeButton={false}
                            render={
                              <a
                                href={`https://wa.me/55${soDigitos(r.phone)}`}
                                target="_blank"
                                rel="noreferrer noopener"
                              />
                            }
                          >
                            <MessageCircle className="size-3.5" /> WhatsApp
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => abrir(r)}>
                          <PhoneCall className="size-3.5" /> Registrar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      {loading && rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Carregando…" />
      ) : (
        <>
          {tabela('Atrasados', grupos.atrasado, true)}
          {tabela('Hoje', grupos.hoje)}
          {tabela('Próximos 7 dias', grupos.semana)}
        </>
      )}

      <Dialog open={alvo != null} onOpenChange={(open) => (!open ? setAlvo(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Contato com {alvo?.patientName}</DialogTitle>
            <DialogDescription>
              {alvo ? `${alvo.attemptNo}ª tentativa. O que ficou combinado?` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Resultado</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(String(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOWUP_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Canal</Label>
                <Select value={canal} onValueChange={(v) => setCanal(String(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOWUP_CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                placeholder="Pediu para chamar depois do dia 5, está juntando a entrada…"
              />
            </div>

            <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label>Próximo contato</Label>
              <div className="flex flex-wrap gap-1.5">
                {ATALHOS.map((a) => (
                  <Button
                    key={a.label}
                    type="button"
                    size="sm"
                    variant={!semProxima && proxima === emDias(a.dias) ? 'default' : 'outline'}
                    onClick={() => {
                      setSemProxima(false)
                      setProxima(emDias(a.dias))
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="date"
                  value={proxima}
                  min={hojeIso()}
                  disabled={semProxima}
                  onChange={(e) => setProxima(e.target.value)}
                  className="w-44"
                />
                <Button
                  type="button"
                  size="sm"
                  variant={semProxima ? 'default' : 'ghost'}
                  onClick={() => setSemProxima((v) => !v)}
                >
                  Encerrar follow-up
                </Button>
              </div>
              {semProxima && (
                <p className="text-xs text-muted-foreground">
                  O paciente sai da fila. Use quando fechou, ou quando ele disse não de vez.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAlvo(null)}>
              Cancelar
            </Button>
            <Button disabled={salvando} onClick={() => void registrar()}>
              {salvando ? 'Salvando…' : 'Registrar contato'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
