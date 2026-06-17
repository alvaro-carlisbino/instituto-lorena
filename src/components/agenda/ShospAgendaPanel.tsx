import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
          <h2 className="text-base font-semibold">Agenda Shosp — tempo real</h2>
          <p className="text-xs text-muted-foreground">
            Grade do prestador direto da Shosp. Clique num horário <span className="text-emerald-600">livre</span> para agendar, ou num{' '}
            <span className="text-amber-700">ocupado</span> para cancelar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={codigoPrestador} onChange={(e) => setCodigoPrestador(e.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1 text-sm">
            {prestadores.map((p) => (
              <option key={p.codigo} value={p.codigo}>{p.nome}</option>
            ))}
          </select>
          {loading && <span className="text-xs text-muted-foreground">Carregando…</span>}
        </div>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
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
              {day.slots.length === 0 && <li className="text-center text-[10px] text-muted-foreground">—</li>}
              {day.slots.map((slot, i) => {
                const free = isFree(slot)
                return (
                  <li key={`${day.data}-${slot.horario}-${i}`}>
                    <button
                      type="button"
                      onClick={() =>
                        free
                          ? slot.codigoHorario && openBooking({ data: day.data, horario: slot.horario, codigoHorario: slot.codigoHorario })
                          : cancelSlot(slot)
                      }
                      className={
                        free
                          ? 'w-full rounded bg-emerald-500/10 px-1.5 py-0.5 text-left text-[11px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400'
                          : 'w-full rounded bg-amber-500/10 px-1.5 py-0.5 text-left text-[11px] text-amber-800 hover:bg-amber-500/20 dark:text-amber-300'
                      }
                      title={free ? 'Agendar' : `${slot.paciente ?? ''} — ${slot.status ?? ''} (clique p/ cancelar)`}
                    >
                      <span className="font-mono">{slot.horario}</span>{' '}
                      {free ? <span className="opacity-70">livre</span> : <span>{(slot.paciente ?? 'ocupado').split(' ').slice(0, 2).join(' ')}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setBooking(null)}>
          <div className="w-full max-w-md rounded-xl border border-border/40 bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">Agendar — {booking.data.split('-').reverse().join('/')} às {booking.horario}</h3>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Lead do CRM (opcional — prefill)</span>
                <select value={leadId} onChange={(e) => setLeadId(e.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1">
                  <option value="">— escolher lead —</option>
                  {crm.leads.slice(0, 300).map((l) => (
                    <option key={l.id} value={l.id}>{l.patientName} · {l.phone}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Serviço</span>
                <select value={servicoCodigo} onChange={(e) => setServicoCodigo(e.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1">
                  {servicos.map((s) => (
                    <option key={s.codigo} value={s.codigo}>{s.nome}{s.valor ? ` (R$ ${s.valor})` : ''}</option>
                  ))}
                </select>
              </label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" className="rounded-md border border-border/40 bg-background px-2 py-1" />
              <div className="grid grid-cols-2 gap-2">
                <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Telefone (DDD)" className="rounded-md border border-border/40 bg-background px-2 py-1" />
                <input value={nascimento} onChange={(e) => setNascimento(e.target.value)} placeholder="Nascimento DD/MM/AAAA" className="rounded-md border border-border/40 bg-background px-2 py-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className="rounded-md border border-border/40 bg-background px-2 py-1" />
                <select value={sexo} onChange={(e) => setSexo(e.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1">
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setBooking(null)} className="rounded-md border border-border/40 px-3 py-1.5 text-sm hover:bg-muted/40">Cancelar</button>
              <button type="button" disabled={saving} onClick={() => void submitBooking()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {saving ? 'Agendando…' : 'Agendar na Shosp'}
              </button>
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
