import { useMemo, useState, useEffect } from 'react'
import { CaretLeft, CaretRight, Clock, Plus, Sparkle } from 'phosphor-react'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { useCrm } from '@/context/CrmContext'
import { findFirstFreeSlot } from '@/services/crmSupabase'
import { getDataProviderMode } from '@/services/dataMode'
import { isSupabaseConfigured } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

import type { Appointment, Room } from '@/mocks/crmMock'
import {
  addCalendarDaysInTimezone,
  calendarDayKeyInTimezone,
  DEFAULT_CLINIC_TIMEZONE,
  isSameCalendarDayAsAnchor,
  minutesSinceMidnightInTimezone,
} from '@/lib/sameLocalDayInTimezone'

const START_HOUR = 8
const END_HOUR = 19
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)
const PIXELS_PER_HOUR = 80 // Height of each hour block
const VISUAL_START_MIN = START_HOUR * 60
const VISUAL_END_MIN = (END_HOUR + 1) * 60

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: DEFAULT_CLINIC_TIMEZONE,
    })
  } catch {
    return ''
  }
}

export function AgendaPage() {
  const crm = useCrm()
  const dataMode = getDataProviderMode()
  const online = dataMode === 'supabase' && isSupabaseConfigured
  
  const [currentDate, setCurrentDate] = useState(new Date())
  
  const [leadId, setLeadId] = useState(crm.leads[0]?.id ?? '')
  const [roomId, setRoomId] = useState(crm.rooms[0]?.id ?? '')
  const [duration, setDuration] = useState(30)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (leadId && !crm.leads.some((l) => l.id === leadId)) {
      setLeadId(crm.leads[0]?.id ?? '')
    }
    if (roomId && !crm.rooms.some((r) => r.id === roomId)) {
      setRoomId(crm.rooms[0]?.id ?? '')
    }
  }, [crm.leads, crm.rooms, leadId, roomId])

  const activeRooms = useMemo(() => crm.rooms.filter(r => r.active), [crm.rooms])

  const appointmentsForDay = useMemo(() => {
    return crm.appointments.filter((a) =>
      isSameCalendarDayAsAnchor(a.startsAt, currentDate, DEFAULT_CLINIC_TIMEZONE),
    )
  }, [crm.appointments, currentDate])

  /** Colunas da grelha: salas ativas + salas com marcação neste dia (ex.: inativas ou só usadas pela IA). */
  const timelineRooms = useMemo(() => {
    const idsActive = new Set(activeRooms.map((r) => r.id))
    const extraIds = [...new Set(appointmentsForDay.map((a) => a.roomId).filter((id) => !idsActive.has(id)))]
    const byId = new Map(crm.rooms.map((r) => [r.id, r]))
    const extras: Room[] = []
    for (const id of extraIds) {
      const r = byId.get(id)
      if (r) {
        extras.push(r)
      } else {
        extras.push({
          id,
          name: 'Sala (referência)',
          active: false,
          slotMinutes: 30,
          sortOrder: 999,
          createdAt: new Date().toISOString(),
        })
      }
    }
    return [...activeRooms, ...extras].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt'),
    )
  }, [activeRooms, appointmentsForDay, crm.rooms])

  const gridRooms = timelineRooms.length > 0 ? timelineRooms : activeRooms
  const timelineMinWidth = Math.max(720, 60 + Math.max(gridRooms.length, 1) * 180)

  useEffect(() => {
    if (!online) return
    void crm.refreshChatFromSupabase()
  }, [online, crm.refreshChatFromSupabase])

  const leadName = (id: string) => crm.leads.find((l) => l.id === id)?.patientName ?? id

  const handleSuggest = async () => {
    if (!online) {
      toast.error('Disponível no modo com base de dados online.')
      return
    }
    const start = new Date()
    const end = addCalendarDaysInTimezone(start, 14, DEFAULT_CLINIC_TIMEZONE)
    const ymd = (d: Date) => calendarDayKeyInTimezone(d, DEFAULT_CLINIC_TIMEZONE)
    try {
      const slot = await findFirstFreeSlot({
        startsOn: ymd(start),
        endsOn: ymd(end),
        durationMinutes: duration,
      })
      if (!slot) {
        toast.message('Nenhum intervalo livre no período de 14 dias (verifique salas ativas).')
        return
      }
      if (!leadId || !roomId) {
        toast.error('Escolha lead e sala, ou crie salas em Configurações.')
        return
      }
      const a: Appointment = {
        id: `appt-${Date.now().toString(36)}`,
        leadId,
        roomId: slot.roomId,
        startsAt: slot.slotStart,
        endsAt: slot.slotEnd,
        status: 'confirmed',
        attendanceStatus: 'expected',
        notes: notes || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      crm.saveAppointmentRow(a)
      toast.success('Marcação proposta com o primeiro horário livre.')
      setNotes('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao calcular')
    }
  }

  const navigateDays = (days: number) => {
    setCurrentDate((prev) => addCalendarDaysInTimezone(prev, days, DEFAULT_CLINIC_TIMEZONE))
  }

  const handleMarkAttendance = (a: Appointment, s: Appointment['attendanceStatus']) => {
    crm.saveAppointmentRow({ ...a, attendanceStatus: s, updatedAt: new Date().toISOString() })
    toast.success('Status atualizado.')
  }

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Agenda">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Apenas a equipe com acesso a leads pode gerenciar a agenda.</CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Agenda Visual">
      <div className="grid gap-4 xl:grid-cols-4">
        {/* Sidebar: Auto Schedule */}
        <Card className="xl:col-span-1 h-fit shadow-sm">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkle className="h-4 w-4 text-primary" /> Auto-Agendamento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label>Lead</Label>
              <Select value={leadId} onValueChange={(v) => v && setLeadId(v)}>
                <SelectTrigger className="rounded-xl">
                  <span className="truncate">
                    {leadId ? crm.leads.find(l => l.id === leadId)?.patientName || 'Lead não encontrado' : 'Escolher lead'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {crm.leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.patientName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Preferência de sala</Label>
              <Select value={roomId} onValueChange={(v) => v && setRoomId(v)}>
                <SelectTrigger className="rounded-xl">
                  <span className="truncate">
                    {roomId ? activeRooms.find(r => r.id === roomId)?.name || 'Sala não encontrada' : 'Escolher sala'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {activeRooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duração (min)</Label>
                <Input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={duration}
                  className="rounded-xl"
                  onChange={(e) => setDuration(Number(e.target.value) || 30)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notas do Procedimento</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-xl" placeholder="Ex: Avaliação Inicial" />
            </div>
            <Button type="button" onClick={() => void handleSuggest()} className="w-full rounded-xl" disabled={!online}>
              {online ? 'Encontrar Horário Livre' : 'Ligue Supabase para usar'}
            </Button>
          </CardContent>
        </Card>

        {/* Main: Visual Timeline */}
        <Card className="xl:col-span-3 flex flex-col min-h-[min(72dvh,600px)] lg:min-h-[600px] shadow-sm overflow-hidden">
          {/* Calendar Header Controls */}
          <CardHeader className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-muted/20 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex items-center rounded-xl border border-border/70 bg-background overflow-hidden p-0.5">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigateDays(-1)}>
                  <CaretLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 rounded-lg text-sm font-semibold hover:bg-muted" onClick={() => setCurrentDate(new Date())}>
                  Hoje
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => navigateDays(1)}>
                  <CaretRight className="h-4 w-4" />
                </Button>
              </div>
              <h2 className="ml-1 truncate text-sm font-semibold sm:ml-2 sm:text-base">
                {currentDate.toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  timeZone: DEFAULT_CLINIC_TIMEZONE,
                })}
              </h2>
            </div>
            <Button size="sm" className="w-full rounded-xl gap-1 sm:w-auto">
              <Plus className="h-4 w-4" /> Novo Agendamento
            </Button>
          </CardHeader>

          {/* Timeline Grid */}
          <div className="flex flex-1 flex-col overflow-hidden bg-background">
            <div className="flex-1 overflow-x-auto">
              {/* Rooms Header */}
              <div
                className="grid border-b border-border/50 bg-muted/10"
                style={{ minWidth: `${timelineMinWidth}px`, gridTemplateColumns: `60px repeat(${gridRooms.length}, minmax(0, 1fr))` }}
              >
                <div className="w-[60px]" />
                {gridRooms.map(r => (
                  <div key={r.id} className="py-2.5 px-3 border-l border-border/50 text-center text-sm font-medium text-foreground truncate">
                    {r.name}
                  </div>
                ))}
              </div>

              {/* Scrollable Timeline Area */}
              <div className="h-full overflow-y-auto">
                <div
                  className="relative grid"
                  style={{ minWidth: `${timelineMinWidth}px`, gridTemplateColumns: `60px repeat(${gridRooms.length}, minmax(0, 1fr))` }}
                >
                {/* Y-Axis: Time Labels */}
                <div className="w-[60px] flex flex-col border-r border-border/50 bg-muted/5">
                  {HOURS.map(h => (
                    <div key={h} className="border-b border-border/50 text-right pr-2 pt-1.5 text-xs text-muted-foreground" style={{ height: PIXELS_PER_HOUR }}>
                      {h}:00
                    </div>
                  ))}
                </div>
                
                {/* X-Axis: Room Columns */}
                {gridRooms.map(room => {
                  const roomAppts = appointmentsForDay.filter(a => a.roomId === room.id)

                  return (
                    <div key={room.id} className="relative border-l border-border/50 border-r-transparent last:border-r-0 first:border-l-0">
                      {/* Grid Lines */}
                      {HOURS.map(h => (
                        <div key={h} className="border-b border-border/40" style={{ height: PIXELS_PER_HOUR }} />
                      ))}
                      
                      {/* Appointment Blocks */}
                      {roomAppts.map(appt => {
                        const start = new Date(appt.startsAt)
                        const end = new Date(appt.endsAt)
                        const startMin = minutesSinceMidnightInTimezone(appt.startsAt, DEFAULT_CLINIC_TIMEZONE)
                        const endMin = minutesSinceMidnightInTimezone(appt.endsAt, DEFAULT_CLINIC_TIMEZONE)

                        if (startMin >= VISUAL_END_MIN) return null

                        const endsBeforeGrid = endMin <= VISUAL_START_MIN
                        const top = endsBeforeGrid
                          ? 2
                          : ((startMin - VISUAL_START_MIN) / 60) * PIXELS_PER_HOUR
                        const height = endsBeforeGrid
                          ? 44
                          : Math.max(
                              24,
                              ((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * PIXELS_PER_HOUR,
                            )

                        let blockClass = endsBeforeGrid
                          ? 'bg-amber-500/15 border-amber-600/40 text-amber-950 dark:text-amber-100 hover:bg-amber-500/25'
                          : 'bg-primary/10 border-primary/30 text-primary-foreground/90 hover:bg-primary/20'
                        if (!endsBeforeGrid && appt.attendanceStatus === 'checked_in') {
                          blockClass =
                            'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                        } else if (!endsBeforeGrid && appt.attendanceStatus === 'no_show') {
                          blockClass = 'bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-500/25'
                        }

                        return (
                          <div
                            key={appt.id}
                            className={`absolute left-1 right-1 rounded-md border p-2 overflow-hidden shadow-sm transition-colors cursor-pointer ${blockClass}`}
                            style={{ top: `${top}px`, height: `${height}px` }}
                            onClick={() => {
                              if (appt.attendanceStatus === 'expected') {
                                handleMarkAttendance(appt, 'checked_in')
                              }
                            }}
                          >
                            <p className="text-xs font-semibold leading-tight truncate">{leadName(appt.leadId)}</p>
                            <div className="flex items-center gap-1 mt-0.5 opacity-80">
                              <Clock className="w-3 h-3" />
                              <span className="text-[10px]">{formatTime(appt.startsAt)} - {formatTime(appt.endsAt)}</span>
                            </div>
                            {endsBeforeGrid && (
                              <p className="text-[10px] mt-0.5 font-medium opacity-90">
                                Fora do horário da grelha — apague ou reagende no CRM.
                              </p>
                            )}
                            {appt.notes && <p className="text-[10px] mt-1 opacity-70 truncate">{appt.notes}</p>}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  )
}

