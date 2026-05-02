import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarBlank, Trash } from 'phosphor-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { DEFAULT_CLINIC_TIMEZONE } from '@/lib/sameLocalDayInTimezone'
import {
  addMinutesToIso,
  datetimeLocalValueToIso,
  isoToDatetimeLocalValue,
} from '@/lib/clinicDatetime'
import type { Appointment } from '@/mocks/crmMock'

type Props = {
  appointment: Appointment | null
  onClose: () => void
}

function durationMinutesBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  return Math.max(5, Math.round(ms / 60000) || 30)
}

export function EditAppointmentDialog({ appointment, onClose }: Props) {
  const crm = useCrm()

  const sortedRooms = useMemo(
    () => [...crm.rooms].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt')),
    [crm.rooms],
  )

  const roomsForSelect = useMemo(() => {
    if (!appointment) return sortedRooms
    if (sortedRooms.some((r) => r.id === appointment.roomId)) return sortedRooms
    return [
      ...sortedRooms,
      {
        id: appointment.roomId,
        name: 'Sala desta marcação',
        active: false,
        slotMinutes: 30,
        sortOrder: 999,
        createdAt: appointment.createdAt,
      },
    ]
  }, [sortedRooms, appointment])

  const [leadId, setLeadId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [startLocal, setStartLocal] = useState('')
  const [duration, setDuration] = useState(30)
  const [notes, setNotes] = useState('')
  const [attendanceStatus, setAttendanceStatus] = useState<Appointment['attendanceStatus']>('expected')
  const [status, setStatus] = useState<Appointment['status']>('confirmed')

  useEffect(() => {
    if (!appointment) return
    setLeadId(appointment.leadId)
    setRoomId(appointment.roomId)
    setStartLocal(isoToDatetimeLocalValue(appointment.startsAt, DEFAULT_CLINIC_TIMEZONE))
    setDuration(durationMinutesBetween(appointment.startsAt, appointment.endsAt))
    setNotes(appointment.notes ?? '')
    setAttendanceStatus(appointment.attendanceStatus)
    setStatus(appointment.status)
  }, [appointment])

  const handleSave = () => {
    if (!appointment) return
    if (!leadId.trim()) {
      toast.error('Escolha um paciente (lead).')
      return
    }
    if (!roomId.trim()) {
      toast.error('Escolha uma sala.')
      return
    }
    try {
      const startsAt = datetimeLocalValueToIso(startLocal, DEFAULT_CLINIC_TIMEZONE)
      const endsAt = addMinutesToIso(startsAt, duration)
      crm.saveAppointmentRow({
        ...appointment,
        leadId,
        roomId,
        startsAt,
        endsAt,
        notes: notes.trim() || null,
        attendanceStatus,
        status,
        updatedAt: new Date().toISOString(),
      })
      toast.success('Marcação atualizada.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível guardar.')
    }
  }

  const handleDelete = () => {
    if (!appointment) return
    if (!window.confirm('Remover esta marcação da agenda?')) return
    try {
      crm.removeAppointmentRow(appointment.id)
      toast.success('Marcação removida.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover.')
    }
  }

  return (
    <Dialog open={appointment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px] rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarBlank className="h-5 w-5 text-primary" />
            Editar agendamento
          </DialogTitle>
          <DialogDescription>
            Início e fim em horário de Brasília (Maringá). A duração recalcula o término automaticamente.
          </DialogDescription>
        </DialogHeader>
        {appointment ? (
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-appt-lead">Paciente (lead)</Label>
              <Select value={leadId} onValueChange={(v) => v && setLeadId(v)}>
                <SelectTrigger id="edit-appt-lead" className="rounded-xl w-full">
                  <SelectValue placeholder="Selecione" />
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
              <Label htmlFor="edit-appt-room">Sala</Label>
              <Select value={roomId} onValueChange={(v) => v && setRoomId(v)}>
                <SelectTrigger id="edit-appt-room" className="rounded-xl w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {roomsForSelect.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {!r.active ? ' (inativa)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-appt-start">Início</Label>
              <Input
                id="edit-appt-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-appt-duration">Duração (min)</Label>
              <Input
                id="edit-appt-duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 30)}
                className="rounded-xl w-32"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-appt-notes">Notas</Label>
              <Input
                id="edit-appt-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-xl"
                placeholder="Procedimento, observações…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Presença</Label>
                <Select
                  value={attendanceStatus}
                  onValueChange={(v) => v && setAttendanceStatus(v as Appointment['attendanceStatus'])}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expected">Esperado</SelectItem>
                    <SelectItem value="checked_in">Compareceu</SelectItem>
                    <SelectItem value="no_show">Faltou</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={status} onValueChange={(v) => v && setStatus(v as Appointment['status'])}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">Confirmado</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : null}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => void handleDelete()}
            disabled={!appointment}
          >
            <Trash className="mr-2 h-4 w-4" />
            Excluir
          </Button>
          <div className="flex gap-2 justify-end w-full sm:w-auto">
            <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" className="rounded-xl" onClick={() => void handleSave()} disabled={!appointment}>
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
