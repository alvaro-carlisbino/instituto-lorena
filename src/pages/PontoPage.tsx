import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, Camera, Fingerprint, MapPin, Plus } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { supabase } from '@/lib/supabaseClient'
import {
  type HrEmployee,
  type HrSettings,
  type LeaveRequest,
  type LeaveType,
  type TimeEntry,
  buildTimesheet,
  createLeave,
  getHrSettings,
  getMyEmployee,
  haversineMeters,
  listDayMarks,
  listLeaves,
  listTimeEntries,
  minutesToHHMM,
  registerPunch,
  type DayMark,
} from '@/services/rhPonto'

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthStart = () => {
  const d = new Date()
  d.setDate(1)
  return ymd(d)
}

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  ferias: 'Férias',
  atestado: 'Atestado',
  folga: 'Folga',
  outro: 'Outro',
}
export const LEAVE_STATUS_STYLE: Record<string, string> = {
  pendente: 'bg-amber-500/15 text-amber-600',
  aprovado: 'bg-emerald-500/15 text-emerald-600',
  negado: 'bg-red-500/15 text-red-600',
}

/** Captura de selfie pra evidência da batida (frente, câmera do aparelho). */
function SelfieDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCapture: (blob: Blob) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' } })
      .then((s) => {
        streamRef.current = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play()
        }
      })
      .catch(() => setError('Não foi possível acessar a câmera. Libere a permissão e tente de novo.'))
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [open])

  const capture = () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      toast.error('Câmera ainda carregando…')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob)
        else toast.error('Falha ao capturar a foto.')
      },
      'image/jpeg',
      0.8,
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Selfie do ponto</DialogTitle>
          <DialogDescription>A foto fica registrada como evidência da batida.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="py-4 text-sm text-muted-foreground">{error}</p>
        ) : (
          <video ref={videoRef} className="aspect-[3/4] w-full rounded-md bg-black object-cover" muted playsInline />
        )}
        <DialogFooter>
          <Button onClick={capture} disabled={!!error}>
            <Camera className="size-4" /> Capturar e registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PontoPage() {
  const [me, setMe] = useState<HrEmployee | null>(null)
  const [settings, setSettings] = useState<HrSettings | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [marks, setMarks] = useState<DayMark[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  const [punching, setPunching] = useState(false)
  const [selfieOpen, setSelfieOpen] = useState(false)
  const pendingGeo = useRef<{ lat: number | null; lng: number | null; distanceM: number | null; withinFence: boolean | null }>({
    lat: null,
    lng: null,
    distanceM: null,
    withinFence: null,
  })

  // solicitação de férias/afastamento
  const [leaveType, setLeaveType] = useState<LeaveType>('ferias')
  const [leaveStart, setLeaveStart] = useState('')
  const [leaveEnd, setLeaveEnd] = useState('')
  const [leaveNote, setLeaveNote] = useState('')
  const [savingLeave, setSavingLeave] = useState(false)

  const from = monthStart()
  const to = ymd(new Date())

  const load = async () => {
    try {
      const emp = await getMyEmployee()
      setMe(emp)
      if (emp) {
        const [st, ent, mk, lv] = await Promise.all([
          getHrSettings(),
          listTimeEntries(emp.id, from, to),
          listDayMarks(emp.id, from, to),
          listLeaves(emp.id),
        ])
        setSettings(st)
        setEntries(ent)
        setMarks(mk)
        setLeaves(lv)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o ponto')
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (supabase) void load()
    else setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const timesheet = useMemo(
    () =>
      me
        ? buildTimesheet({
            fromDay: from,
            toDay: to,
            schedule: me.schedule,
            entries,
            marks,
            approvedLeaves: leaves.filter((l) => l.status === 'aprovado'),
          })
        : null,
    [me, entries, marks, leaves, from, to],
  )

  const todayRow = timesheet?.rows[timesheet.rows.length - 1]
  const nextIsEntrada = ((todayRow?.punches.length ?? 0) % 2) === 0

  const startPunch = () => {
    if (!me || !settings) return
    setPunching(true)
    if (!('geolocation' in navigator)) {
      toast.error('Este aparelho não fornece localização.')
      setPunching(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        let distanceM: number | null = null
        let withinFence: boolean | null = null
        if (settings.lat != null && settings.lng != null) {
          distanceM = haversineMeters(latitude, longitude, settings.lat, settings.lng)
          withinFence = distanceM <= settings.radiusM
        }
        if (settings.enforceFence && withinFence === false) {
          toast.error(
            `Fora da clínica (${distanceM}m do local, limite ${settings.radiusM}m). O ponto só pode ser batido na clínica.`,
          )
          setPunching(false)
          return
        }
        pendingGeo.current = { lat: latitude, lng: longitude, distanceM, withinFence }
        if (settings.requireSelfie) {
          setSelfieOpen(true)
        } else {
          void finishPunch(null)
        }
      },
      () => {
        if (settings.enforceFence) {
          toast.error('Não foi possível obter sua localização — libere o GPS para bater o ponto.')
          setPunching(false)
        } else {
          pendingGeo.current = { lat: null, lng: null, distanceM: null, withinFence: null }
          if (settings.requireSelfie) setSelfieOpen(true)
          else void finishPunch(null)
        }
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const finishPunch = async (selfie: Blob | null) => {
    if (!me) return
    setSelfieOpen(false)
    try {
      await registerPunch({ employeeId: me.id, ...pendingGeo.current, selfieBlob: selfie })
      toast.success(`Ponto registrado — ${nextIsEntrada ? 'entrada' : 'saída'} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar o ponto')
    } finally {
      setPunching(false)
    }
  }

  const requestLeave = async () => {
    if (!me) return
    setSavingLeave(true)
    try {
      await createLeave({ employeeId: me.id, type: leaveType, startDate: leaveStart, endDate: leaveEnd, note: leaveNote })
      toast.success('Solicitação enviada para aprovação.')
      setLeaveStart('')
      setLeaveEnd('')
      setLeaveNote('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao solicitar')
    } finally {
      setSavingLeave(false)
    }
  }

  return (
    <AppLayout title="Meu ponto" subtitle="Registro de jornada com selfie e localização — o ponto só vale dentro da clínica.">
      {!loaded ? null : !me ? (
        <EmptyState
          icon={Fingerprint}
          title="Você ainda não está no RH"
          description="Peça para a gestão te cadastrar como funcionário (Gestão de ponto) e vincular ao seu login."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Fingerprint className="size-4 text-primary" /> {me.name}
                  {me.roleTitle ? <span className="font-normal text-muted-foreground">· {me.roleTitle}</span> : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="h-14 w-full text-base" onClick={startPunch} disabled={punching}>
                  <Fingerprint className="size-5" />
                  {punching ? 'Registrando…' : `Registrar ${nextIsEntrada ? 'ENTRADA' : 'SAÍDA'}`}
                </Button>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" />
                  {settings?.lat != null
                    ? `Cerca ativa: até ${settings.radiusM}m da clínica${settings.requireSelfie ? ' · selfie obrigatória' : ''}`
                    : 'Cerca ainda não configurada pela gestão'}
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">Hoje</p>
                  {todayRow && todayRow.punches.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {todayRow.punches.map((p, i) => (
                        <Badge key={i} variant="secondary" className={i % 2 === 0 ? 'bg-emerald-500/15 text-emerald-600' : 'bg-sky-500/15 text-sky-600'}>
                          {i % 2 === 0 ? '→' : '←'} {p.time}
                          {p.manual ? ' (m)' : ''}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma batida hoje.</p>
                  )}
                  {todayRow ? (
                    <p className="mt-1.5 text-sm">
                      Trabalhadas: <strong>{minutesToHHMM(todayRow.workedMin)}</strong> · Previstas:{' '}
                      {minutesToHHMM(todayRow.expectedMin)}
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CalendarDays className="size-4 text-primary" /> Férias e afastamentos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5">
                    <Label>Tipo</Label>
                    <Select value={leaveType} onValueChange={(v) => setLeaveType((v ?? 'ferias') as LeaveType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((t) => (
                          <SelectItem key={t} value={t}>
                            {LEAVE_TYPE_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lv-start">Início</Label>
                    <Input id="lv-start" type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lv-end">Fim</Label>
                    <Input id="lv-end" type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
                  </div>
                </div>
                <Input value={leaveNote} onChange={(e) => setLeaveNote(e.target.value)} placeholder="Observação (opcional)" />
                <Button size="sm" onClick={requestLeave} disabled={savingLeave || !leaveStart || !leaveEnd}>
                  <Plus className="size-3.5" /> {savingLeave ? 'Enviando…' : 'Solicitar'}
                </Button>
                <div className="space-y-1.5">
                  {leaves.map((l) => (
                    <div key={l.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span>
                        {LEAVE_TYPE_LABEL[l.type]} —{' '}
                        {new Date(`${l.startDate}T12:00:00`).toLocaleDateString('pt-BR')} a{' '}
                        {new Date(`${l.endDate}T12:00:00`).toLocaleDateString('pt-BR')}
                      </span>
                      <Badge variant="secondary" className={LEAVE_STATUS_STYLE[l.status]}>
                        {l.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Meu espelho do mês</CardTitle>
            </CardHeader>
            <CardContent>
              {timesheet ? (
                <>
                  <div className="mb-3 flex flex-wrap gap-3 text-sm">
                    <span>Trabalhadas: <strong>{minutesToHHMM(timesheet.totalWorkedMin)}</strong></span>
                    <span>Previstas: <strong>{minutesToHHMM(timesheet.totalExpectedMin)}</strong></span>
                    <span>
                      Saldo:{' '}
                      <strong className={timesheet.totalSaldoMin < 0 ? 'text-red-500' : 'text-emerald-600'}>
                        {minutesToHHMM(timesheet.totalSaldoMin)}
                      </strong>
                    </span>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Dia</TableHead>
                          <TableHead>Pontos</TableHead>
                          <TableHead className="text-right">Trabalhadas</TableHead>
                          <TableHead className="text-right">Previstas</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {timesheet.rows.map((r) => (
                          <TableRow key={r.day}>
                            <TableCell className="whitespace-nowrap text-xs">
                              {new Date(`${r.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}{' '}
                              <span className="text-muted-foreground">{r.weekdayLabel.slice(0, 3)}</span>
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.markLabel ? <Badge variant="secondary">{r.markLabel}</Badge> : null}{' '}
                              {r.punches.map((p) => `${p.time}${p.manual ? ' (m)' : ''}`).join(' | ') || (r.markLabel ? '' : '—')}
                            </TableCell>
                            <TableCell className="text-right text-xs">{r.workedMin > 0 ? minutesToHHMM(r.workedMin) : '—'}</TableCell>
                            <TableCell className="text-right text-xs">{r.expectedMin > 0 ? minutesToHHMM(r.expectedMin) : '—'}</TableCell>
                            <TableCell className={`text-right text-xs font-medium ${r.saldoMin < 0 ? 'text-red-500' : r.saldoMin > 0 ? 'text-emerald-600' : ''}`}>
                              {r.expectedMin > 0 || r.workedMin > 0 ? minutesToHHMM(r.saldoMin) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      <SelfieDialog
        open={selfieOpen}
        onOpenChange={(open) => {
          setSelfieOpen(open)
          if (!open) setPunching(false)
        }}
        onCapture={(blob) => void finishPunch(blob)}
      />
    </AppLayout>
  )
}
