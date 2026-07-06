import { useState } from 'react'
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
            <AlertCircle className="size-5" />
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
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setSelectedPreset(preset === selectedPreset ? null : preset)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all border",
                  selectedPreset === preset
                    ? "bg-destructive border-destructive text-white shadow-lg shadow-destructive/20"
                    : "bg-muted/50 border-border/50 text-muted-foreground hover:border-destructive/30 hover:text-destructive"
                )}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70 ml-1">
              Observações Adicionais
            </label>
            <Textarea
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
