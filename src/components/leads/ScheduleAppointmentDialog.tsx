import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarBlank, Clock } from 'phosphor-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { findFirstFreeSlot } from '@/services/crmSupabase'
import { getDataProviderMode } from '@/services/dataMode'
import { isSupabaseConfigured } from '@/lib/supabaseClient'
import type { Appointment } from '@/mocks/crmMock'

type Props = {
  isOpen: boolean
  onClose: () => void
  leadId: string
}

export function ScheduleAppointmentDialog({ isOpen, onClose, leadId }: Props) {
  const crm = useCrm()
  const dataMode = getDataProviderMode()
  const online = dataMode === 'supabase' && isSupabaseConfigured

  const activeRooms = crm.rooms.filter(r => r.active)
  
  const [roomId, setRoomId] = useState(activeRooms[0]?.id ?? '')
  const [duration, setDuration] = useState(30)
  const [notes, setNotes] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setRoomId(activeRooms[0]?.id ?? '')
      setDuration(30)
      setNotes('')
    }
  }, [isOpen])

  const handleSchedule = async () => {
    if (!online) {
      toast.error('Disponível no modo com base de dados online.')
      return
    }
    setIsLoading(true)
    const start = new Date()
    const end = new Date()
    end.setDate(end.getDate() + 14) // look 14 days ahead
    
    const ymd = (d: Date) => d.toISOString().slice(0, 10)
    
    try {
      const slot = await findFirstFreeSlot({
        startsOn: ymd(start),
        endsOn: ymd(end),
        durationMinutes: duration,
      })
      
      if (!slot) {
        toast.message('Nenhum intervalo livre no período de 14 dias (verifique salas ativas).')
        setIsLoading(false)
        return
      }
      
      const a: Appointment = {
        id: `appt-${Date.now().toString(36)}`,
        leadId,
        roomId: slot.roomId, // Supabase chooses the room if the preferred one is busy
        startsAt: slot.slotStart,
        endsAt: slot.slotEnd,
        status: 'confirmed',
        attendanceStatus: 'expected',
        notes: notes || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      
      crm.saveAppointmentRow(a)
      toast.success('Marcação realizada com sucesso.')
      
      // Optionally, send an automated message to the user!
      const lead = crm.leads.find(l => l.id === leadId)
      if (lead) {
        const dateStr = new Date(slot.slotStart).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        const autoMessage = `Sua consulta foi agendada para ${dateStr}. Nos vemos lá!`
        crm.setDraftMessage(autoMessage)
      }
      
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao agendar')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px] rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarBlank className="w-5 h-5 text-primary" /> Agendar Consulta
          </DialogTitle>
          <DialogDescription>
            Encontraremos o primeiro horário livre para este paciente.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Sala Preferida</Label>
            <Select value={roomId} onValueChange={(v) => v && setRoomId(v)}>
              <SelectTrigger className="col-span-3 rounded-lg">
                <SelectValue placeholder="Selecione a sala" />
              </SelectTrigger>
              <SelectContent>
                {activeRooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Duração</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Input
                type="number"
                min={5}
                max={240}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 30)}
                className="rounded-lg w-24"
              />
              <span className="text-sm text-muted-foreground">minutos</span>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Notas</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="col-span-3 rounded-lg"
              placeholder="Ex: Primeira consulta..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="rounded-lg">Cancelar</Button>
          <Button type="submit" onClick={() => void handleSchedule()} disabled={isLoading || !online} className="rounded-lg gap-2">
            <Clock className="w-4 h-4" />
            {isLoading ? 'Agendando...' : 'Confirmar Agendamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
