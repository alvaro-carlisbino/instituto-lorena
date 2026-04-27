import { useMemo, useState } from 'react'
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
  SelectValue,
} from '@/components/ui/select'

import type { Appointment } from '@/mocks/crmMock'

const START_HOUR = 8
const END_HOUR = 19
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)
const PIXELS_PER_HOUR = 80 // Height of each hour block

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
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

  const activeRooms = useMemo(() => crm.rooms.filter(r => r.active), [crm.rooms])

  const appointmentsForDay = useMemo(() => {
    const startOfDay = new Date(currentDate)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(currentDate)
    endOfDay.setHours(23, 59, 59, 999)

    return crm.appointments.filter(a => {
      const d = new Date(a.startsAt)
      return d >= startOfDay && d <= endOfDay
    })
  }, [crm.appointments, currentDate])

  const leadName = (id: string) => crm.leads.find((l) => l.id === id)?.patientName ?? id

  const handleSuggest = async () => {
    if (!online) {
      toast.error('Disponível no modo com base de dados online.')
      return
    }
    const start = new Date()
    const end = new Date()
    end.setDate(end.getDate() + 14)
    const ymd = (d: Date) => d.toISOString().slice(0, 10)
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
    const next = new Date(currentDate)
    next.setDate(next.getDate() + days)
    setCurrentDate(next)
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
                  <SelectValue placeholder="Escolher lead" />
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
                  <SelectValue />
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
        <Card className="xl:col-span-3 flex flex-col min-h-[600px] shadow-sm overflow-hidden">
          {/* Calendar Header Controls */}
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 bg-muted/20 py-3">
            <div className="flex items-center gap-2">
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
              <h2 className="ml-2 text-base font-semibold">
                {currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
              </h2>
            </div>
            <Button size="sm" className="rounded-xl gap-1">
              <Plus className="h-4 w-4" /> Novo Agendamento
            </Button>
          </CardHeader>

          {/* Timeline Grid */}
          <div className="flex flex-1 flex-col overflow-hidden bg-background">
            {/* Rooms Header */}
            <div className="grid border-b border-border/50 bg-muted/10" style={{ gridTemplateColumns: `60px repeat(${activeRooms.length}, minmax(0, 1fr))` }}>
              <div className="w-[60px]" />
              {activeRooms.map(r => (
                <div key={r.id} className="py-2.5 px-3 border-l border-border/50 text-center text-sm font-medium text-foreground truncate">
                  {r.name}
                </div>
              ))}
            </div>

            {/* Scrollable Timeline Area */}
            <div className="flex-1 overflow-y-auto">
              <div className="relative grid" style={{ gridTemplateColumns: `60px repeat(${activeRooms.length}, minmax(0, 1fr))` }}>
                {/* Y-Axis: Time Labels */}
                <div className="w-[60px] flex flex-col border-r border-border/50 bg-muted/5">
                  {HOURS.map(h => (
                    <div key={h} className="border-b border-border/50 text-right pr-2 pt-1.5 text-xs text-muted-foreground" style={{ height: PIXELS_PER_HOUR }}>
                      {h}:00
                    </div>
                  ))}
                </div>
                
                {/* X-Axis: Room Columns */}
                {activeRooms.map(room => {
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
                        
                        // Prevent out of bounds render
                        if (start.getHours() >= END_HOUR + 1 || end.getHours() < START_HOUR) return null

                        const top = ((start.getHours() - START_HOUR) * PIXELS_PER_HOUR) + (start.getMinutes() / 60) * PIXELS_PER_HOUR
                        const height = Math.max(24, ((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * PIXELS_PER_HOUR)
                        
                        // Visual styles based on status
                        let blockClass = "bg-primary/10 border-primary/30 text-primary-foreground/90 hover:bg-primary/20"
                        if (appt.attendanceStatus === 'checked_in') {
                          blockClass = "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25"
                        } else if (appt.attendanceStatus === 'no_show') {
                          blockClass = "bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-500/25"
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
        </Card>
      </div>
    </AppLayout>
  )
}

