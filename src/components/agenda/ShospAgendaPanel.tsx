import { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
import {
  cancelShospAppointment,
  fetchShospAgenda,
  fetchShospPrestadores,
  fetchShospServicos,
  linkLeadToShospPatient,
  scheduleShospAppointment,
  type ShospPrestadorAgenda,
  type ShospSlot,
} from '@/services/shosp'

const CODIGO_UNIDADE = 1
const CODIGO_PLANO_PARTICULAR = 1

function isFree(slot: ShospSlot): boolean {
  return !slot.codigoAgendamento && !slot.paciente
}

type BookingTarget = { data: string; horario: string; codigoHorario: number }

export function ShospAgendaPanel() {
  const crm = useCrm()
  const fid = useId()
  const [prestadores, setPrestadores] = useState<Array<{ codigo: string; nome: string }>>([])
  const [servicos, setServicos] = useState<Array<{ codigo: string; nome: string; valor: string | null }>>([])
  const [codigoPrestador, setCodigoPrestador] = useState<string>('')
  const [agenda, setAgenda] = useState<ShospPrestadorAgenda[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Estado do diálogo de agendamento.
  const [booking, setBooking] = useState<BookingTarget | null>(null)
  const [leadId, setLeadId] = useState<string>('')
  const [servicoCodigo, setServicoCodigo] = useState<string>('')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [nascimento, setNascimento] = useState('')
  const [sexo, setSexo] = useState('M')
  const [saving, setSaving] = useState(false)
  const [slotToCancel, setSlotToCancel] = useState<ShospSlot | null>(null)

  useEffect(() => {
    fetchShospPrestadores()
      .then((list) => {
        setPrestadores(list)
        if (list.length) setCodigoPrestador((prev) => prev || list[0].codigo)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao listar prestadores.'))
    fetchShospServicos()
      .then((list) => {
        setServicos(list)
        const cortesia = list.find((s) => s.nome.toUpperCase().includes('CORTESIA'))
        setServicoCodigo(cortesia?.codigo ?? list[0]?.codigo ?? '')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!codigoPrestador) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchShospAgenda({ codigoPrestador: Number(codigoPrestador), diasMostrar: 15 })
      .then((res) => !cancelled && setAgenda(res))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Falha ao carregar agenda Shosp.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [codigoPrestador, reloadKey])

  const days = agenda[0]?.days ?? []
  const selectedLead = useMemo(() => crm.leads.find((l) => l.id === leadId) ?? null, [crm.leads, leadId])

  const openBooking = (target: BookingTarget) => {
    setBooking(target)
    setLeadId('')
    setNome('')
    setTelefone('')
    setEmail('')
    setNascimento('')
    setSexo('M')
  }

  // Prefill ao escolher o lead — inclui o que a IA captou na conversa
  // (custom_fields.cadastro): nome completo, nascimento, sexo, e-mail.
  useEffect(() => {
    if (!selectedLead) return
    const cad = ((selectedLead.customFields as Record<string, unknown> | undefined)?.cadastro ?? {}) as Record<string, string>
    setNome(cad.nomeCompleto || selectedLead.patientName || '')
    setTelefone((selectedLead.phone ?? '').replace(/\D/g, ''))
    setNascimento(cad.dataNascimento || '')
    setEmail(cad.email || '')
    if (cad.sexo === 'M' || cad.sexo === 'F') setSexo(cad.sexo)
  }, [selectedLead])

  const submitBooking = async () => {
    if (!booking) return
    if (!nome.trim() || telefone.replace(/\D/g, '').length < 10 || !nascimento.trim() || !email.trim()) {
      toast.error('Preencha nome, telefone, nascimento (DD/MM/AAAA) e e-mail.')
      return
    }
    setSaving(true)
    try {
      const r = await scheduleShospAppointment({
        codigoPrestador: Number(codigoPrestador),
        codigoUnidade: CODIGO_UNIDADE,
        codigoServico: Number(servicoCodigo),
        codigoPlanoSaude: CODIGO_PLANO_PARTICULAR,
        data: booking.data,
        horario: booking.horario,
        codigoHorario: booking.codigoHorario,
        nome: nome.trim(),
        telefone: telefone.replace(/\D/g, ''),
        email: email.trim(),
        dataNascimento: nascimento.trim(),
        sexo,
      })
      if (!r.ok) {
        toast.error(r.error ?? 'Falha ao agendar.')
        return
      }
      if (leadId && r.codigoPaciente) await linkLeadToShospPatient(leadId, r.codigoPaciente)
      toast.success(`Agendado na Shosp (${booking.data.split('-').reverse().join('/')} ${booking.horario}).`)
      setBooking(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao agendar.')
    } finally {
      setSaving(false)
    }
  }

  const cancelSlot = (slot: ShospSlot) => {
    if (!slot.codigoAgendamento) return
    setSlotToCancel(slot)
  }

  const confirmCancelSlot = async (slot: ShospSlot) => {
    if (!slot.codigoAgendamento) return
    const r = await cancelShospAppointment(slot.codigoAgendamento)
    if (r.ok) {
      toast.success('Agendamento cancelado na Shosp.')
      setReloadKey((k) => k + 1)
    } else {
      toast.error(r.error ?? 'Falha ao cancelar.')
    }
  }

  return (
    <section className="rounded-xl border border-border/30 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Agenda Shosp · tempo real</h2>
          <p className="text-xs text-muted-foreground">
            Grade do prestador direto da Shosp. Clique num horário <span className="text-success">livre</span> para agendar, ou num{' '}
            <span className="text-warning">ocupado</span> para cancelar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={codigoPrestador || null}
            onValueChange={(v) => v && setCodigoPrestador(v)}
            items={prestadores.map((p) => ({ value: p.codigo, label: p.nome }))}
          >
            <SelectTrigger aria-label="Prestador">
              <SelectValue placeholder="Prestador" />
            </SelectTrigger>
            <SelectContent>
              {prestadores.map((p) => (
                <SelectItem key={p.codigo} value={p.codigo}>{p.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <span role="status" className="text-xs text-muted-foreground">Carregando…</span>}
        </div>
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {!error && days.length === 0 && !loading && (
        <p className="py-8 text-center text-xs text-muted-foreground">Sem dias retornados para este prestador.</p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {days.map((day) => (
          <div key={day.data} className="min-w-[150px] flex-1 rounded-lg border border-border/20 bg-muted/10 p-2">
            <div className="mb-2 border-b border-border/20 pb-1 text-center">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">{day.diaSemana}</p>
              <p className="text-xs font-medium">{day.data.split('-').reverse().slice(0, 2).join('/')}</p>
            </div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {day.slots.length === 0 && <li className="text-center text-[10px] text-muted-foreground">Sem horários</li>}
              {day.slots.map((slot, i) => {
                const free = isFree(slot)
                return (
                  <li key={`${day.data}-${slot.horario}-${i}`}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        free
                          ? slot.codigoHorario && openBooking({ data: day.data, horario: slot.horario, codigoHorario: slot.codigoHorario })
                          : cancelSlot(slot)
                      }
                      className={
                        free
                          ? 'h-auto w-full min-w-0 justify-start rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-normal text-success hover:bg-success/20 hover:text-success'
                          : 'h-auto w-full min-w-0 justify-start rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-normal text-warning hover:bg-warning/20 hover:text-warning'
                      }
                      title={free ? 'Agendar' : `${slot.paciente ?? ''} · ${slot.status ?? ''} (clique p/ cancelar)`}
                      aria-label={
                        free
                          ? `${slot.horario} livre, agendar`
                          : `${slot.horario} ${slot.paciente ?? 'ocupado'}, cancelar agendamento`
                      }
                    >
                      <span className="font-mono">{slot.horario}</span>
                      {free ? <span className="opacity-70">livre</span> : <span className="min-w-0 truncate">{(slot.paciente ?? 'ocupado').split(' ').slice(0, 2).join(' ')}</span>}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setBooking(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${fid}-booking-title`}
            className="w-full max-w-md rounded-xl border border-border/40 bg-card p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={`${fid}-booking-title`} className="text-sm font-semibold">Agendar · {booking.data.split('-').reverse().join('/')} às {booking.horario}</h3>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fid}-lead`} className="text-xs text-muted-foreground">Lead do CRM (opcional, preenche os dados)</Label>
                <Select
                  value={leadId || null}
                  onValueChange={(v) => setLeadId(v ?? '')}
                  items={[
                    { value: null, label: 'Escolher lead' },
                    ...crm.leads.slice(0, 300).map((l) => ({ value: l.id, label: `${l.patientName} · ${l.phone}` })),
                  ]}
                >
                  <SelectTrigger id={`${fid}-lead`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>Escolher lead</SelectItem>
                    {crm.leads.slice(0, 300).map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.patientName} · {l.phone}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fid}-servico`} className="text-xs text-muted-foreground">Serviço</Label>
                <Select
                  value={servicoCodigo || null}
                  onValueChange={(v) => v && setServicoCodigo(v)}
                  items={servicos.map((s) => ({ value: s.codigo, label: `${s.nome}${s.valor ? ` (R$ ${s.valor})` : ''}` }))}
                >
                  <SelectTrigger id={`${fid}-servico`} className="w-full">
                    <SelectValue placeholder="Serviço" />
                  </SelectTrigger>
                  <SelectContent>
                    {servicos.map((s) => (
                      <SelectItem key={s.codigo} value={s.codigo}>{s.nome}{s.valor ? ` (R$ ${s.valor})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fid}-nome`} className="text-xs text-muted-foreground">Nome completo</Label>
                <Input id={`${fid}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${fid}-telefone`} className="text-xs text-muted-foreground">Telefone (com DDD)</Label>
                  <Input id={`${fid}-telefone`} type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="44999999999" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${fid}-nascimento`} className="text-xs text-muted-foreground">Nascimento</Label>
                  <Input id={`${fid}-nascimento`} value={nascimento} onChange={(e) => setNascimento(e.target.value)} placeholder="DD/MM/AAAA" inputMode="numeric" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${fid}-email`} className="text-xs text-muted-foreground">E-mail</Label>
                  <Input id={`${fid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${fid}-sexo`} className="text-xs text-muted-foreground">Sexo</Label>
                  <Select
                    value={sexo}
                    onValueChange={(v) => v && setSexo(v)}
                    items={[
                      { value: 'M', label: 'Masculino' },
                      { value: 'F', label: 'Feminino' },
                    ]}
                  >
                    <SelectTrigger id={`${fid}-sexo`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="M">Masculino</SelectItem>
                      <SelectItem value="F">Feminino</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setBooking(null)}>Cancelar</Button>
              <Button type="button" disabled={saving} onClick={() => void submitBooking()}>
                {saving ? 'Agendando…' : 'Agendar na Shosp'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={slotToCancel !== null}
        onOpenChange={(open) => { if (!open) setSlotToCancel(null) }}
        title="Cancelar este agendamento?"
        description={
          slotToCancel
            ? `O agendamento de ${slotToCancel.paciente ?? 'paciente'} às ${slotToCancel.horario} será cancelado na Shosp. Esta ação não pode ser desfeita.`
            : ''
        }
        confirmLabel="Cancelar agendamento"
        cancelLabel="Voltar"
        onConfirm={() => {
          if (slotToCancel) void confirmCancelSlot(slotToCancel)
          setSlotToCancel(null)
        }}
      />
    </section>
  )
}
