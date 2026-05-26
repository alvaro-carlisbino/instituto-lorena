import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TriangleAlert, EyeOff, Eye } from 'lucide-react'

import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_LOST_REASONS,
  setLeadExcludedFromMetrics,
  setLeadLostReason,
} from '@/services/analytics'

type Props = {
  leadId: string
  /** Permissão: só gestor/admin marca perdido e exclui das métricas. */
  canManage: boolean
}

/**
 * Ações de analytics no lead: marcar como perdido (com motivo) e excluir das
 * métricas (equipe/fornecedor/teste). Estado carregado direto via Supabase pra
 * não acoplar ao Lead type global.
 */
export function LeadAnalyticsActions({ leadId, canManage }: Props) {
  const [excluded, setExcluded] = useState<boolean>(false)
  const [lostReason, setLostReasonState] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)
  const [selectedReason, setSelectedReason] = useState<string>(DEFAULT_LOST_REASONS[0])
  const [customReason, setCustomReason] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)

  useEffect(() => {
    if (!supabase || !leadId) return
    let cancelled = false
    setLoading(true)
    void supabase
      .from('leads')
      .select('lost_reason, excluded_from_metrics')
      .eq('id', leadId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          toast.error(error.message)
          return
        }
        const row = (data ?? {}) as { lost_reason: string | null; excluded_from_metrics: boolean | null }
        setExcluded(Boolean(row.excluded_from_metrics))
        setLostReasonState(row.lost_reason ?? '')
      })
      .then(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const toggleExcluded = async () => {
    if (!canManage) return
    const next = !excluded
    setExcluded(next)
    try {
      await setLeadExcludedFromMetrics(leadId, next)
      toast.success(next ? 'Lead removido das métricas.' : 'Lead voltou a contar nas métricas.')
    } catch (e) {
      setExcluded(!next)
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar.')
    }
  }

  const handleSaveLost = async () => {
    const reason = selectedReason === 'Outro' ? customReason.trim() : selectedReason
    if (!reason) {
      toast.error('Informe o motivo.')
      return
    }
    setSaving(true)
    try {
      await setLeadLostReason(leadId, reason)
      setLostReasonState(reason)
      toast.success('Lead marcado como perdido.')
      setDialogOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const handleClearLost = async () => {
    setSaving(true)
    try {
      await setLeadLostReason(leadId, '')
      setLostReasonState('')
      toast.success('Lead reativado.')
      setDialogOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reativar.')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !canManage) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={lostReason ? 'destructive' : 'outline'} size="sm" onClick={() => setDialogOpen(true)}>
        <TriangleAlert className="mr-1.5 size-4" />
        {lostReason ? 'Perdido' : 'Marcar perdido'}
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lostReason ? 'Alterar / reativar' : 'Marcar como perdido'}</DialogTitle>
            <DialogDescription>
              {lostReason
                ? `Atual: ${lostReason}. Você pode escolher novo motivo ou reativar.`
                : 'Por que esse lead não fechou? Isso alimenta o relatório de Analytics.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Motivo</Label>
              <Select value={selectedReason} onValueChange={(v) => setSelectedReason(v ?? DEFAULT_LOST_REASONS[0])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_LOST_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedReason === 'Outro' ? (
              <div className="grid gap-1.5">
                <Label className="text-xs">Especifique</Label>
                <Input
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Descreva em poucas palavras"
                  autoFocus
                />
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            {lostReason ? (
              <Button variant="ghost" onClick={handleClearLost} disabled={saving}>
                Reativar lead
              </Button>
            ) : null}
            <Button onClick={handleSaveLost} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar motivo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button
        variant={excluded ? 'default' : 'outline'}
        size="sm"
        onClick={() => void toggleExcluded()}
        title={
          excluded
            ? 'Este lead está fora das métricas (equipe/fornecedor/teste). Clique pra incluir.'
            : 'Excluir este lead das métricas (útil pra equipe interna, fornecedor, teste).'
        }
      >
        {excluded ? (
          <>
            <EyeOff className="mr-1.5 size-4" />
            Fora das métricas
          </>
        ) : (
          <>
            <Eye className="mr-1.5 size-4" />
            Conta nas métricas
          </>
        )}
      </Button>
    </div>
  )
}
