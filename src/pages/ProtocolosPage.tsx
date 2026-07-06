import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, CheckCircle2, ListChecks, NotebookPen, Play, Plus, Trash2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PROTOCOL_STATUS_STYLE } from '@/components/leads/LeadProtocolsSection'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import {
  type LeadProtocol,
  type TreatmentProtocol,
  createProtocol,
  deactivateProtocol,
  listLeadProtocols,
  listProtocolCatalog,
  registerSession,
  setLeadProtocolStatus,
  startLeadProtocol,
} from '@/services/treatmentProtocols'

const parseMoney = (v: string): number | null => {
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function ProtocolosPage() {
  const { tenant } = useTenant()
  const crm = useCrm()
  const [catalog, setCatalog] = useState<TreatmentProtocol[]>([])
  const [protocols, setProtocols] = useState<LeadProtocol[]>([])
  const [loading, setLoading] = useState(false)

  // form de protocolo (catálogo)
  const [pName, setPName] = useState('')
  const [pCategory, setPCategory] = useState('')
  const [pSessions, setPSessions] = useState('1')
  const [pInterval, setPInterval] = useState('')
  const [pPrice, setPPrice] = useState('')
  const [pDescription, setPDescription] = useState('')
  const [savingProtocol, setSavingProtocol] = useState(false)

  // form de início de protocolo p/ paciente
  const [startLeadId, setStartLeadId] = useState('')
  const [startProtocolId, setStartProtocolId] = useState('')
  const [startSessions, setStartSessions] = useState('')
  const [startPrice, setStartPrice] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startNote, setStartNote] = useState('')
  const [starting, setStarting] = useState(false)

  const [sessionNote, setSessionNote] = useState<Record<string, string>>({})

  // Leads do polo ativo, mais recentes primeiro (mesmo recorte da tela de kits).
  const poloLeads = useMemo(
    () =>
      crm.leads
        .filter((l) => !l.tenantId || l.tenantId === tenant.id)
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 200),
    [crm.leads, tenant.id],
  )
  const leadNameById = useMemo(
    () => new Map(crm.leads.map((l) => [l.id, l.patientName] as const)),
    [crm.leads],
  )

  const load = async () => {
    setLoading(true)
    try {
      const [cat, rows] = await Promise.all([listProtocolCatalog(), listLeadProtocols()])
      setCatalog(cat)
      setProtocols(rows)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar protocolos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const saveProtocol = async () => {
    setSavingProtocol(true)
    try {
      await createProtocol({
        name: pName,
        category: pCategory,
        sessionsPlanned: Number(pSessions) || 0,
        intervalDays: pInterval ? Number(pInterval) : null,
        defaultPrice: parseMoney(pPrice),
        description: pDescription,
      })
      toast.success(`Protocolo "${pName.trim()}" criado.`)
      setPName('')
      setPCategory('')
      setPSessions('1')
      setPInterval('')
      setPPrice('')
      setPDescription('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar protocolo')
    } finally {
      setSavingProtocol(false)
    }
  }

  const handleStartProtocolChange = (id: string) => {
    setStartProtocolId(id)
    const proto = catalog.find((c) => c.id === id)
    if (proto) {
      setStartSessions(String(proto.sessionsPlanned))
      setStartPrice(proto.defaultPrice != null ? String(proto.defaultPrice).replace('.', ',') : '')
    }
  }

  const startForPatient = async () => {
    const proto = catalog.find((c) => c.id === startProtocolId)
    if (!proto) {
      toast.error('Escolha um protocolo do catálogo.')
      return
    }
    setStarting(true)
    try {
      await startLeadProtocol({
        leadId: startLeadId,
        protocolId: proto.id,
        name: proto.name,
        sessionsPlanned: Number(startSessions) || proto.sessionsPlanned,
        price: parseMoney(startPrice),
        startedOn: startDate || null,
        note: startNote,
      })
      const patient = leadNameById.get(startLeadId) ?? 'paciente'
      toast.success(`Protocolo "${proto.name}" iniciado para ${patient}.`)
      setStartLeadId('')
      setStartProtocolId('')
      setStartSessions('')
      setStartPrice('')
      setStartDate('')
      setStartNote('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar protocolo')
    } finally {
      setStarting(false)
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

  // Ativos primeiro; dentro do grupo, mais recentes primeiro (ordem do fetch).
  const sortedProtocols = useMemo(() => {
    const weight = (s: string) => (s === 'ativo' ? 0 : s === 'pausado' ? 1 : 2)
    return protocols.slice().sort((a, b) => weight(a.status) - weight(b.status))
  }, [protocols])

  return (
    <AppLayout
      title="Protocolos de tratamento"
      subtitle="Catálogo de protocolos da clínica e acompanhamento das sessões por paciente — além do tratamento capilar."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <NotebookPen className="size-4 text-primary" /> Novo protocolo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="proto-name">Nome</Label>
                <Input
                  id="proto-name"
                  value={pName}
                  onChange={(e) => setPName(e.target.value)}
                  placeholder="Ex.: Protocolo intradermoterapia"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="proto-category">Categoria</Label>
                  <Input
                    id="proto-category"
                    value={pCategory}
                    onChange={(e) => setPCategory(e.target.value)}
                    placeholder="Ex.: capilar, facial…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="proto-sessions">Sessões</Label>
                  <Input
                    id="proto-sessions"
                    value={pSessions}
                    onChange={(e) => setPSessions(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="proto-interval">Intervalo (dias)</Label>
                  <Input
                    id="proto-interval"
                    value={pInterval}
                    onChange={(e) => setPInterval(e.target.value)}
                    inputMode="numeric"
                    placeholder="Opcional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="proto-price">Preço base (R$)</Label>
                  <Input
                    id="proto-price"
                    value={pPrice}
                    onChange={(e) => setPPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="Opcional"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proto-desc">Descrição</Label>
                <Textarea
                  id="proto-desc"
                  value={pDescription}
                  onChange={(e) => setPDescription(e.target.value)}
                  placeholder="O que inclui, indicações, observações…"
                  rows={2}
                />
              </div>
              <Button className="w-full" onClick={saveProtocol} disabled={savingProtocol}>
                {savingProtocol ? 'Salvando…' : 'Criar protocolo'}
              </Button>
            </CardContent>
          </Card>

          {catalog.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Catálogo ({catalog.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {catalog.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.sessionsPlanned} {c.sessionsPlanned === 1 ? 'sessão' : 'sessões'}
                        {c.intervalDays ? ` · a cada ${c.intervalDays} dias` : ''}
                        {c.category ? ` · ${c.category}` : ''}
                        {c.defaultPrice != null
                          ? ` · ${c.defaultPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                          : ''}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      onClick={() => void deactivateProtocol(c.id).then(load)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Play className="size-4 text-primary" /> Iniciar protocolo p/ paciente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Paciente (lead do CRM)</Label>
                  <Select value={startLeadId || undefined} onValueChange={(v) => setStartLeadId(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolher paciente" />
                    </SelectTrigger>
                    <SelectContent>
                      {poloLeads.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.patientName}
                          {l.phone ? ` · ${l.phone}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Protocolo</Label>
                  <Select value={startProtocolId || undefined} onValueChange={(v) => v && handleStartProtocolChange(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder={catalog.length === 0 ? 'Cadastre um protocolo primeiro' : 'Escolher protocolo'} />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.sessionsPlanned} {c.sessionsPlanned === 1 ? 'sessão' : 'sessões'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="start-sessions">Sessões</Label>
                  <Input
                    id="start-sessions"
                    value={startSessions}
                    onChange={(e) => setStartSessions(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="start-price">Valor (R$)</Label>
                  <Input
                    id="start-price"
                    value={startPrice}
                    onChange={(e) => setStartPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="Opcional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="start-date">Início</Label>
                  <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="start-note">Observações</Label>
                <Input
                  id="start-note"
                  value={startNote}
                  onChange={(e) => setStartNote(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <Button className="w-full sm:w-auto" onClick={startForPatient} disabled={starting || !startLeadId || !startProtocolId}>
                {starting ? 'Iniciando…' : 'Iniciar protocolo'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListChecks className="size-4 text-primary" /> Pacientes em protocolo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {sortedProtocols.length === 0 ? (
                <EmptyState
                  icon={ListChecks}
                  title={loading ? 'Carregando…' : 'Nenhum paciente em protocolo'}
                  description="Cadastre os protocolos da clínica no catálogo e inicie o acompanhamento por paciente — as sessões ficam registradas aqui e na ficha do lead."
                />
              ) : (
                sortedProtocols.map((p) => {
                  const done = p.sessions.length
                  const pct = p.sessionsPlanned > 0 ? Math.min(100, (done / p.sessionsPlanned) * 100) : 0
                  const patient = leadNameById.get(p.leadId) ?? 'Paciente'
                  return (
                    <div key={p.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{patient}</span>
                          <span className="text-sm text-muted-foreground">· {p.name}</span>
                          <Badge variant="secondary" className={PROTOCOL_STATUS_STYLE[p.status]}>
                            {p.status}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Sessões {done}/{p.sessionsPlanned}
                          {p.price != null
                            ? ` · ${p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                            : ''}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      {p.sessions.length > 0 ? (
                        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                          {p.sessions.map((s) => (
                            <li key={s.id}>
                              Sessão {s.sessionNumber} —{' '}
                              {new Date(`${s.performedOn}T12:00:00`).toLocaleDateString('pt-BR')}
                              {s.performedBy ? ` · ${s.performedBy}` : ''}
                              {s.note ? ` · ${s.note}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {p.status === 'ativo' ? (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <Input
                            value={sessionNote[p.id] ?? ''}
                            onChange={(e) => setSessionNote((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            placeholder="Obs. da sessão (opcional)"
                            className="h-8 max-w-64 text-xs"
                          />
                          <Button size="sm" onClick={() => void addSession(p)}>
                            <Plus className="size-3.5" /> Registrar sessão
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void changeStatus(p, 'concluido')}>
                            <CheckCircle2 className="size-3.5" /> Concluir
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void changeStatus(p, 'cancelado')}>
                            <Ban className="size-3.5" /> Cancelar
                          </Button>
                        </div>
                      ) : p.status !== 'concluido' ? (
                        <div className="mt-2.5">
                          <Button size="sm" variant="outline" onClick={() => void changeStatus(p, 'ativo')}>
                            <Play className="size-3.5" /> Reativar
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
