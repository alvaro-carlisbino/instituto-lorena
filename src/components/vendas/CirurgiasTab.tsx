import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CalendarCheck2, FileWarning } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import {
  type ChecklistItem,
  type ClinicSale,
  type SurgeryReminder,
  listChecklist,
  listClinicSales,
  listReminders,
  setChecklistReceived,
} from '@/services/clinicSales'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const REMINDER_LABEL: Record<SurgeryReminder['kind'], string> = {
  d30: '30 dias',
  d15: '15 dias',
  d7: '7 dias',
  d2: '2 dias',
}

const diasAte = (iso: string) => {
  const alvo = new Date(iso)
  const hoje = new Date()
  return Math.ceil((alvo.getTime() - hoje.getTime()) / 86400000)
}

/**
 * A fila de cirurgias com a documentação de cada uma.
 *
 * O motivo dela existir: hoje a Aline descobre que falta exame quando liga na
 * véspera. Aqui o que falta aparece antes, e o paciente já foi avisado sozinho
 * nos marcos de 30, 15, 7 e 2 dias.
 */
export function CirurgiasTab() {
  const [sales, setSales] = useState<ClinicSale[]>([])
  const [checklist, setChecklist] = useState<Map<string, ChecklistItem[]>>(new Map())
  const [reminders, setReminders] = useState<Map<string, SurgeryReminder[]>>(new Map())
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const todas = await listClinicSales('cirurgia')
      const agendadas = todas
        .filter((s) => s.scheduledAt && s.status !== 'cancelada' && s.status !== 'realizada')
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
      setSales(agendadas)
      const ids = agendadas.map((s) => s.id)
      const [ck, rm] = await Promise.all([listChecklist(ids), listReminders(ids)])
      setChecklist(ck)
      setReminders(rm)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar as cirurgias')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const proximoMes = useMemo(() => sales.filter((s) => s.scheduledAt && diasAte(s.scheduledAt) <= 30), [sales])
  const pendencias = useMemo(
    () =>
      proximoMes.filter((s) => (checklist.get(s.id) ?? []).some((i) => i.required && !i.receivedAt)).length,
    [proximoMes, checklist],
  )

  const marcar = async (item: ChecklistItem, recebido: boolean) => {
    try {
      await setChecklistReceived(item.id, recebido)
      setChecklist((prev) => {
        const copia = new Map(prev)
        const lista = (copia.get(item.saleId) ?? []).map((i) =>
          i.id === item.id ? { ...i, receivedAt: recebido ? new Date().toISOString() : null } : i,
        )
        copia.set(item.saleId, lista)
        return copia
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao marcar')
    }
  }

  if (sales.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck2}
        title={loading ? 'Carregando…' : 'Nenhuma cirurgia agendada'}
        description={loading ? undefined : 'Cirurgia registrada na aba de vendas com data aparece aqui.'}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Agendadas</p>
            <p className="font-heading text-2xl">{sales.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Nos próximos 30 dias</p>
            <p className="font-heading text-2xl">{proximoMes.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Com documento faltando</p>
            <p className="font-heading text-2xl text-destructive">{pendencias}</p>
          </CardContent>
        </Card>
      </div>

      {sales.map((s) => {
        const itens = checklist.get(s.id) ?? []
        const faltando = itens.filter((i) => i.required && !i.receivedAt)
        const avisos = reminders.get(s.id) ?? []
        const dias = s.scheduledAt ? diasAte(s.scheduledAt) : null
        return (
          <Card key={s.id}>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  {s.patientName}
                  {dias != null && dias <= 30 && (
                    <Badge variant={dias <= 7 ? 'destructive' : 'default'}>
                      {dias <= 0 ? 'hoje' : `em ${dias} dias`}
                    </Badge>
                  )}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {s.scheduledAt ? new Date(s.scheduledAt).toLocaleString('pt-BR') : '—'} · {s.procedureLabel} ·{' '}
                  {s.performingDoctor ?? s.sellerDoctor ?? 'sem médico'} · {brl(s.valueCents)}
                  {s.city ? ` · ${s.city}` : ''}
                  {s.hotelNeeded ? ' · precisa de hotel' : ''}
                </p>
              </div>
              {faltando.length > 0 && (
                <CardAction>
                  <Badge variant="destructive">
                    <FileWarning className="size-3" /> {faltando.length} pendente{faltando.length > 1 ? 's' : ''}
                  </Badge>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {itens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Checklist ainda não gerado.</p>
                ) : (
                  itens.map((i) => (
                    <label key={i.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={i.receivedAt != null}
                        onCheckedChange={(v) => void marcar(i, v === true)}
                      />
                      <span className={i.receivedAt ? 'text-muted-foreground line-through' : undefined}>
                        {i.item}
                        {!i.required && <span className="text-xs text-muted-foreground"> (opcional)</span>}
                      </span>
                    </label>
                  ))
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Avisos ao paciente:</span>
                {avisos.length === 0 && <span className="text-xs text-muted-foreground">nenhum programado</span>}
                {avisos.map((a) => (
                  <Badge
                    key={a.id}
                    variant={
                      a.status === 'enviado' ? 'secondary' : a.status === 'erro' ? 'destructive' : 'outline'
                    }
                  >
                    {REMINDER_LABEL[a.kind]}
                    {a.status === 'enviado'
                      ? ' enviado'
                      : a.status === 'cancelado'
                        ? ' cancelado'
                        : a.status === 'simulado'
                          ? ' simulado'
                          : ` em ${new Date(`${a.scheduledFor}T12:00:00`).toLocaleDateString('pt-BR')}`}
                  </Badge>
                ))}
              </div>

              {s.status === 'agendada' && dias != null && dias < 0 && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3.5" />
                  A data já passou e o centro cirúrgico ainda não confirmou esta cirurgia no sistema.
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
