import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, CheckCircle2, ListChecks, Play, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import {
  type LeadProtocol,
  type TreatmentProtocol,
  listLeadProtocols,
  listProtocolCatalog,
  registerSession,
  setLeadProtocolStatus,
  startLeadProtocol,
} from '@/services/treatmentProtocols'

type Props = {
  leadId: string
  leadName: string
}

export const PROTOCOL_STATUS_STYLE: Record<string, string> = {
  ativo: 'bg-sky-500/15 text-sky-600',
  pausado: 'bg-amber-500/15 text-amber-600',
  concluido: 'bg-emerald-500/15 text-emerald-600',
  cancelado: 'bg-red-500/15 text-red-600',
}

/**
 * Protocolos de tratamento do paciente na ficha do lead (além do tratamento
 * capilar): atribuir protocolo do catálogo e registrar sessões realizadas.
 * Só aparece no polo clínica — o catálogo é gerido em /protocolos.
 */
export function LeadProtocolsSection({ leadId, leadName }: Props) {
  const { tenant } = useTenant()
  const isClinic = tenant.poloType !== 'sales'

  const [catalog, setCatalog] = useState<TreatmentProtocol[]>([])
  const [protocols, setProtocols] = useState<LeadProtocol[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedProtocolId, setSelectedProtocolId] = useState('')
  const [sessionNote, setSessionNote] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    try {
      const [cat, mine] = await Promise.all([listProtocolCatalog(), listLeadProtocols(leadId)])
      setCatalog(cat)
      setProtocols(mine)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar protocolos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isClinic) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, isClinic])

  const availableCatalog = useMemo(
    () => catalog.filter((c) => !protocols.some((p) => p.protocolId === c.id && p.status === 'ativo')),
    [catalog, protocols],
  )

  if (!isClinic) return null

  const start = async () => {
    const proto = catalog.find((c) => c.id === selectedProtocolId)
    if (!proto) {
      toast.error('Escolha um protocolo do catálogo.')
      return
    }
    setSaving(true)
    try {
      await startLeadProtocol({
        leadId,
        protocolId: proto.id,
        name: proto.name,
        sessionsPlanned: proto.sessionsPlanned,
        price: proto.defaultPrice,
      })
      toast.success(`Protocolo "${proto.name}" iniciado para ${leadName}.`)
      setSelectedProtocolId('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar protocolo')
    } finally {
      setSaving(false)
    }
  }

  const addSession = async (p: LeadProtocol) => {
    const nextNumber = (p.sessions[p.sessions.length - 1]?.sessionNumber ?? 0) + 1
    try {
      await registerSession({
        leadProtocolId: p.id,
        sessionNumber: nextNumber,
        note: sessionNote[p.id] || undefined,
      })
      toast.success(`Sessão ${nextNumber}/${p.sessionsPlanned} registrada.`)
      setSessionNote((prev) => ({ ...prev, [p.id]: '' }))
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar sessão')
    }
  }

  const changeStatus = async (p: LeadProtocol, status: 'ativo' | 'concluido' | 'cancelado') => {
    try {
      await setLeadProtocolStatus(p.id, status)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar protocolo')
    }
  }

  return (
    <section
      aria-labelledby="lead-protocols-heading"
      className="rounded-md border border-border/80 bg-muted/10 p-3"
    >
      <h2
        id="lead-protocols-heading"
        className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground"
      >
        <ListChecks className="size-3.5" /> Protocolos de tratamento
      </h2>

      {protocols.length === 0 && !loading ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Nenhum protocolo para este paciente. Inicie um pelo catálogo — a gestão do catálogo fica
          em Protocolos, no menu.
        </p>
      ) : null}

      <div className="space-y-2">
        {protocols.map((p) => {
          const done = p.sessions.length
          const pct = p.sessionsPlanned > 0 ? Math.min(100, (done / p.sessionsPlanned) * 100) : 0
          return (
            <div key={p.id} className="rounded-md border border-border bg-background p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  <Badge variant="secondary" className={PROTOCOL_STATUS_STYLE[p.status]}>
                    {p.status}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Sessões {done}/{p.sessionsPlanned}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              {p.status === 'ativo' ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Input
                    value={sessionNote[p.id] ?? ''}
                    onChange={(e) => setSessionNote((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder="Obs. da sessão (opcional)"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button size="sm" onClick={() => void addSession(p)}>
                    <Plus className="size-3.5" /> Sessão
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void changeStatus(p, 'concluido')}>
                    <CheckCircle2 className="size-3.5" /> Concluir
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void changeStatus(p, 'cancelado')}>
                    <Ban className="size-3.5" /> Cancelar
                  </Button>
                </div>
              ) : p.status !== 'concluido' ? (
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={() => void changeStatus(p, 'ativo')}>
                    <Play className="size-3.5" /> Reativar
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Select value={selectedProtocolId || undefined} onValueChange={(v) => setSelectedProtocolId(v ?? '')}>
          <SelectTrigger className="h-9 flex-1 text-xs">
            <SelectValue placeholder={catalog.length === 0 ? 'Catálogo vazio — cadastre em Protocolos' : 'Iniciar protocolo do catálogo…'} />
          </SelectTrigger>
          <SelectContent>
            {availableCatalog.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.name} · {c.sessionsPlanned} {c.sessionsPlanned === 1 ? 'sessão' : 'sessões'}
                {c.category ? ` · ${c.category}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-9" disabled={!selectedProtocolId || saving} onClick={() => void start()}>
          <Play className="size-3.5" /> {saving ? 'Iniciando…' : 'Iniciar'}
        </Button>
      </div>
    </section>
  )
}
