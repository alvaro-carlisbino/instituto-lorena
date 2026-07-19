import { useId, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const COMMON_REASONS = [
  'Preço / Orçamento alto',
  'Distância / Localização',
  'Indecisão do paciente',
  'Fez em outra clínica',
  'Falta de agenda / horário',
  'Apenas curiosidade',
  'Não respondeu o follow-up',
]

const CANCELLATION_REASONS = [
  'Financeiro / forma de pagamento',
  'Remarcou / vai reagendar',
  'Medo / insegurança',
  'Motivo de saúde',
  'Problema de agenda',
  'Fez em outra clínica',
  'Desistiu do tratamento',
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string) => void
  patientName: string
  /** Nome da etapa de destino; se contiver "cancel", vira diálogo de cancelamento. */
  stageName?: string
}

export function LeadLossReasonDialog({ open, onOpenChange, onConfirm, patientName, stageName }: Props) {
  const [reason, setReason] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const notesId = useId()

  const isCancellation = stageName ? /cancel/i.test(stageName) : false
  const cancelledWhat = /cirurgia/i.test(stageName ?? '')
    ? 'a cirurgia'
    : /protocolo/i.test(stageName ?? '')
      ? 'o protocolo'
      : 'o atendimento'
  const presets = isCancellation ? CANCELLATION_REASONS : COMMON_REASONS

  const handleConfirm = () => {
    const finalReason = selectedPreset
      ? (reason.trim() ? `${selectedPreset}: ${reason}` : selectedPreset)
      : reason
    onConfirm(finalReason)
    setReason('')
    setSelectedPreset(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertCircle className="size-5" aria-hidden />
            <DialogTitle className="uppercase tracking-wider font-black">
              {isCancellation ? 'Registrar Cancelamento' : 'Encerrar Lead'}
            </DialogTitle>
          </div>
          <DialogDescription className="font-medium">
            {isCancellation ? (
              <>Por que <span className="text-foreground font-bold">{patientName}</span> cancelou {cancelledWhat}?</>
            ) : (
              <>Por que o atendimento de <span className="text-foreground font-bold">{patientName}</span> foi encerrado?</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Motivos comuns">
            {presets.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="ghost"
                aria-pressed={selectedPreset === preset}
                onClick={() => setSelectedPreset(preset === selectedPreset ? null : preset)}
                className={cn(
                  'h-auto whitespace-normal rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight',
                  selectedPreset === preset
                    ? 'border-destructive bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20 hover:bg-destructive hover:text-destructive-foreground'
                    : 'border-border/50 bg-muted/50 text-muted-foreground hover:bg-muted/50 hover:border-destructive/30 hover:text-destructive',
                )}
              >
                {preset}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor={notesId} className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
              Observações Adicionais
            </Label>
            <Textarea
              id={notesId}
              placeholder={isCancellation ? 'Detalhes do cancelamento...' : 'Detalhes sobre a perda do lead...'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[100px] resize-none rounded-xl border-border/60 bg-muted/20"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl uppercase font-bold text-xs"
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!selectedPreset && !reason.trim()}
            className="rounded-xl uppercase font-black text-xs shadow-lg shadow-destructive/20"
          >
            {isCancellation ? 'Confirmar Cancelamento' : 'Confirmar Encerramento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
