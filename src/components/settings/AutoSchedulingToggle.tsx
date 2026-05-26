import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock } from 'lucide-react'

import { supabase } from '@/lib/supabaseClient'
import { Switch } from '@/components/ui/switch'

/**
 * Toggle "Auto-agendamento pela IA". Quando ligado, a IA pode chamar
 * `book_appointment` direto na conversa via crm-ai-assistant. Lorena começa
 * desligado (comportamento atual). Outros tenants podem ligar.
 *
 * Persiste em crm_ai_configs.auto_scheduling_enabled (tenant-scoped via RLS).
 */
export function AutoSchedulingToggle() {
  const [enabled, setEnabled] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(true)
    void supabase
      .from('crm_ai_configs')
      .select('auto_scheduling_enabled')
      .eq('id', 'default')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          toast.error(error.message)
          return
        }
        setEnabled(Boolean((data as { auto_scheduling_enabled?: boolean } | null)?.auto_scheduling_enabled))
      })
      .then(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async (next: boolean) => {
    if (!supabase) return
    setSaving(true)
    setEnabled(next)
    try {
      const { error } = await supabase
        .from('crm_ai_configs')
        .update({ auto_scheduling_enabled: next })
        .eq('id', 'default')
      if (error) throw new Error(error.message)
      toast.success(next ? 'Auto-agendamento ligado.' : 'Auto-agendamento desligado.')
    } catch (e) {
      setEnabled(!next)
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-gradient-to-r from-primary/[0.04] to-transparent p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-1 sm:pr-2">
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={loading || saving}
            className="shrink-0"
          />
          <span className="text-sm font-medium sm:text-base">
            <CalendarClock className="mr-1.5 inline-block size-4 align-text-bottom" />
            Auto-agendamento pela IA
          </span>
        </label>
        <p className="m-0 text-xs text-muted-foreground sm:text-sm">
          Quando ligado, a IA pode marcar consultas automaticamente na conversa, sem
          confirmar com o consultor humano. Recomendado apenas se sua agenda já está
          conectada e os horários estão validados.
        </p>
      </div>
    </div>
  )
}
