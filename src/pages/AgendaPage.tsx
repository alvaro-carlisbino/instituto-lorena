import { useMemo, useState } from 'react'
import { CalendarBlank, Clock, Sparkle } from 'phosphor-react'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { useCrm } from '@/context/CrmContext'
import { findFirstFreeSlot } from '@/services/crmSupabase'
import { getDataProviderMode } from '@/services/dataMode'
import { isSupabaseConfigured } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { Appointment } from '@/mocks/crmMock'

function formatLocal(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function AgendaPage() {
  const crm = useCrm()
  const dataMode = getDataProviderMode()
  const online = dataMode === 'supabase' && isSupabaseConfigured
  const [leadId, setLeadId] = useState(crm.leads[0]?.id ?? '')
  const [roomId, setRoomId] = useState(crm.rooms[0]?.id ?? '')
  const [duration, setDuration] = useState(30)
  const [notes, setNotes] = useState('')

  const list = useMemo(
    () => [...crm.appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [crm.appointments],
  )

  const leadName = (id: string) => crm.leads.find((l) => l.id === id)?.patientName ?? id
  const roomName = (id: string) => crm.rooms.find((r) => r.id === id)?.name ?? id

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
        toast.message('Nenhum intervalo livre no período de 14 dias (verifique salas activas).')
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

  const handleMarkAttendance = (a: Appointment, s: Appointment['attendanceStatus']) => {
    crm.saveAppointmentRow({ ...a, attendanceStatus: s, updatedAt: new Date().toISOString() })
  }

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Agenda" subtitle="Sem permissão.">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Apenas a equipa com acesso a leads pode gerir a agenda.</CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Agenda"
      subtitle="Marcações, salas e presença. (Calendário externo: em breve.)"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkle className="h-4 w-4" /> Novo: primeiro horário livre
            </CardTitle>
            <CardDescription>Usa a função SQL e as salas activas. Duração em minutos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Lead</Label>
              <Select value={leadId} onValueChange={(v) => v && setLeadId(v)}>
                <SelectTrigger>
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
              <Label>Preferência de sala (sugestão ainda escolhe outra se a primeira estiver cheia)</Label>
              <Select value={roomId} onValueChange={(v) => v && setRoomId(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {crm.rooms
                    .filter((r) => r.active)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Duração (min)</Label>
              <Input
                type="number"
                min={5}
                max={240}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 30)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
            </div>
            <Button type="button" onClick={() => void handleSuggest()} className="w-full" disabled={!online}>
              {online ? 'Procurar e criar marcação' : 'Ligue Supabase para usar'}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarBlank className="h-4 w-4" /> Próximas marcações
            </CardTitle>
            <CardDescription>Presença: esperado, check-in ou ausência.</CardDescription>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">Nenhuma marcação ainda.</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {list.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="m-0 font-medium">
                        {leadName(a.leadId)} <span className="text-muted-foreground">· {roomName(a.roomId)}</span>
                      </p>
                      <p className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatLocal(a.startsAt)} — {formatLocal(a.endsAt)}
                      </p>
                      {a.notes ? <p className="m-0 text-xs text-muted-foreground">Nota: {a.notes}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          a.attendanceStatus === 'checked_in'
                            ? 'default'
                            : a.attendanceStatus === 'no_show'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {a.attendanceStatus === 'checked_in'
                          ? 'Presente'
                          : a.attendanceStatus === 'no_show'
                            ? 'Faltou'
                            : 'Previsto'}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleMarkAttendance(a, 'checked_in')}
                      >
                        Check-in
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMarkAttendance(a, 'no_show')}
                      >
                        Faltou
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
