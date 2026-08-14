import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, CheckCircle2, ListChecks, NotebookPen, Play, Plus, Stethoscope, Trash2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchPicker } from '@/components/ui/search-picker'
import { Textarea } from '@/components/ui/textarea'
import { PROTOCOL_STATUS_STYLE } from '@/components/leads/LeadProtocolsSection'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { listSurgicalStaff } from '@/services/clinicSales'
import { searchLeadsByName } from '@/services/clinicalNotes'
import {
  type LeadProtocol,
  type TreatmentProtocol,
  createProtocol,
  deactivateProtocol,
  indicacoesPorMedico,
  lerSessoesDigitadas,
  listLeadProtocols,
  listProtocolCatalog,
  registerSession,
  rotuloProgresso,
  rotuloSessoes,
  sessoesDefinidas,
  sessoesIniciaisDoCatalogo,
  setLeadProtocolReferral,
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
  const [startReferral, setStartReferral] = useState('')
  const [starting, setStarting] = useState(false)

  const [sessionNote, setSessionNote] = useState<Record<string, string>>({})
  /** Quem aplicou a sessão. A lista já mostrava esse nome, mas nada nunca o preenchia. */
  const [sessionBy, setSessionBy] = useState<Record<string, string>>({})
  // Edição da indicação de um protocolo já existente: {id, rascunho}.
  const [editandoIndicacao, setEditandoIndicacao] = useState<{ id: string; valor: string } | null>(null)
  const [medicosDaCasa, setMedicosDaCasa] = useState<string[]>([])

  // O nome do paciente escolhido vem do próprio resultado da busca, não do crm.leads:
  // a busca é no servidor e alcança os 2.620 pacientes, enquanto o estado do CRM só
  // carrega uma fatia. Sem isso o botão mostraria "Paciente" para quem está fora dela.
  const [startLeadName, setStartLeadName] = useState('')

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
    // Os médicos vêm do espelho do centro cirúrgico, mesma fonte da Central de
    // Vendas: quem entra ou sai da equipe é cadastrado lá, não numa lista aqui.
    listSurgicalStaff()
      .then((staff) => setMedicosDaCasa(staff.filter((s) => s.tipo === 'MEDICO').map((s) => s.nome)))
      .catch(() => setMedicosDaCasa([]))
  }, [])

  /**
   * Sugestões do campo de indicação: médicos da casa + quem já foi digitado antes.
   * O segundo grupo existe porque paciente encaminhado de fora traz nome que não
   * está no cadastro da equipe, e digitar duas grafias diferentes do mesmo médico
   * quebra o relatório de indicações.
   */
  const sugestoesIndicacao = useMemo(() => {
    const nomes = new Set(medicosDaCasa)
    for (const p of protocols) if (p.referredBy) nomes.add(p.referredBy)
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [medicosDaCasa, protocols])

  const porIndicacao = useMemo(() => indicacoesPorMedico(protocols), [protocols])
  const semIndicacao = useMemo(() => protocols.filter((p) => !p.referredBy).length, [protocols])

  const salvarIndicacao = async () => {
    if (!editandoIndicacao) return
    const { id, valor } = editandoIndicacao
    try {
      await setLeadProtocolReferral(id, valor)
      setProtocols((prev) => prev.map((p) => (p.id === id ? { ...p, referredBy: valor.trim() || null } : p)))
      setEditandoIndicacao(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar a indicação')
    }
  }

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
      setStartSessions(sessoesIniciaisDoCatalogo(proto.sessionsPlanned))
      setStartPrice(proto.defaultPrice != null ? String(proto.defaultPrice).replace('.', ',') : '')
    }
  }

  const startForPatient = async () => {
    const proto = catalog.find((c) => c.id === startProtocolId)
    if (!proto) {
      toast.error('Escolha um protocolo do catálogo.')
      return
    }
    const sessoes = lerSessoesDigitadas(startSessions)
    if (sessoes == null) {
      toast.error('Informe quantas sessões este paciente vai fazer.')
      return
    }
    setStarting(true)
    try {
      await startLeadProtocol({
        leadId: startLeadId,
        protocolId: proto.id,
        name: proto.name,
        sessionsPlanned: sessoes,
        price: parseMoney(startPrice),
        startedOn: startDate || null,
        note: startNote,
        referredBy: startReferral,
      })
      const patient = startLeadName || leadNameById.get(startLeadId) || 'paciente'
      toast.success(`Protocolo "${proto.name}" iniciado para ${patient}.`)
      setStartLeadId('')
      setStartLeadName('')
      setStartProtocolId('')
      setStartSessions('')
      setStartPrice('')
      setStartDate('')
      setStartNote('')
      setStartReferral('')
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
        performedBy: sessionBy[p.id] || undefined,
      })
      toast.success(
        sessoesDefinidas(p.sessionsPlanned)
          ? `Sessão ${nextNumber}/${p.sessionsPlanned} registrada.`
          : `Sessão ${nextNumber} registrada.`,
      )
      setSessionNote((prev) => ({ ...prev, [p.id]: '' }))
      setSessionBy((prev) => ({ ...prev, [p.id]: '' }))
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
      subtitle="Catálogo de protocolos da clínica e acompanhamento das sessões por paciente, além do tratamento capilar."
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
                        {/* 0 sessões não quer dizer "nenhuma", quer dizer que ninguém definiu
                            ainda. O catálogo nasceu das vendas, e a planilha nunca registrou
                            quantas sessões cada protocolo tem. Chutar seria inventar
                            protocolo clínico. */}
                        {rotuloSessoes(c.sessionsPlanned)}
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
                  {/* Busca no servidor: são 2.620 pacientes, não cabem num dropdown.
                      O telefone aparece na lista porque é o que desempata homônimo. */}
                  <SearchPicker
                    title="Buscar paciente"
                    placeholder="Escolher paciente"
                    searchPlaceholder="Nome ou telefone do paciente…"
                    value={
                      startLeadId
                        ? {
                            id: startLeadId,
                            label: startLeadName || leadNameById.get(startLeadId) || 'Paciente',
                          }
                        : null
                    }
                    onSearch={async (q) =>
                      (await searchLeadsByName(tenant.id, q, 40)).map((p) => ({
                        id: p.id,
                        label: p.name,
                        hint: p.phone || undefined,
                      }))
                    }
                    onPick={(item) => {
                      setStartLeadId(item.id)
                      setStartLeadName(item.label)
                    }}
                    onClear={() => {
                      setStartLeadId('')
                      setStartLeadName('')
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Protocolo</Label>
                  <SearchPicker
                    title="Escolher protocolo"
                    placeholder={catalog.length === 0 ? 'Cadastre um protocolo primeiro' : 'Escolher protocolo'}
                    searchPlaceholder="Nome ou categoria do protocolo…"
                    disabled={catalog.length === 0}
                    value={
                      startProtocolId
                        ? {
                            id: startProtocolId,
                            label: catalog.find((c) => c.id === startProtocolId)?.name ?? 'Protocolo',
                          }
                        : null
                    }
                    items={catalog.map((c) => ({
                      id: c.id,
                      label: c.name,
                      hint: [rotuloSessoes(c.sessionsPlanned), c.category].filter(Boolean).join(' · '),
                      meta:
                        c.defaultPrice != null
                          ? c.defaultPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                          : undefined,
                    }))}
                    onPick={(item) => handleStartProtocolChange(item.id)}
                    onClear={() => setStartProtocolId('')}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="start-sessions">Sessões deste paciente</Label>
                  <Input
                    id="start-sessions"
                    value={startSessions}
                    onChange={(e) => setStartSessions(e.target.value)}
                    inputMode="numeric"
                    placeholder="Ex.: 6"
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
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="start-referral">Médico que indicou</Label>
                  <Input
                    id="start-referral"
                    list="medicos-indicacao"
                    value={startReferral}
                    onChange={(e) => setStartReferral(e.target.value)}
                    placeholder="Quem prescreveu o protocolo"
                  />
                  <datalist id="medicos-indicacao">
                    {sugestoesIndicacao.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
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
              </div>
              <Button className="w-full sm:w-auto" onClick={startForPatient} disabled={starting || !startLeadId || !startProtocolId}>
                {starting ? 'Iniciando…' : 'Iniciar protocolo'}
              </Button>
            </CardContent>
          </Card>

          {porIndicacao.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Stethoscope className="size-4 text-primary" /> Indicações por médico
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quem prescreveu o protocolo, não quem fechou a venda.
                  {semIndicacao > 0
                    ? ` ${semIndicacao} protocolo${semIndicacao > 1 ? 's' : ''} sem médico informado, fora desta conta.`
                    : ''}
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Médico</TableHead>
                        <TableHead className="text-right">Indicou</TableHead>
                        <TableHead className="text-right">Em andamento</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="text-right">Cancelados</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {porIndicacao.map((m) => (
                        <TableRow key={m.medico}>
                          <TableCell className="font-medium">{m.medico}</TableCell>
                          <TableCell className="text-right">{m.total}</TableCell>
                          <TableCell className="text-right">{m.ativos}</TableCell>
                          <TableCell className="text-right">
                            {m.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">{m.cancelados}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}

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
                  description="Cadastre os protocolos da clínica no catálogo e inicie o acompanhamento por paciente, as sessões ficam registradas aqui e na ficha do lead."
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
                          {rotuloProgresso(done, p.sessionsPlanned)}
                          {p.price != null
                            ? ` · ${p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
                            : ''}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <Stethoscope className="size-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">Indicação:</span>
                        {editandoIndicacao?.id === p.id ? (
                          <>
                            <Input
                              list="medicos-indicacao"
                              autoFocus
                              value={editandoIndicacao.valor}
                              onChange={(e) => setEditandoIndicacao({ id: p.id, valor: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void salvarIndicacao()
                                if (e.key === 'Escape') setEditandoIndicacao(null)
                              }}
                              className="h-7 max-w-56 text-xs"
                              placeholder="Médico que indicou"
                            />
                            <Button size="sm" className="h-7" onClick={() => void salvarIndicacao()}>
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() => setEditandoIndicacao(null)}
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="rounded px-1 py-0.5 underline decoration-dotted underline-offset-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
                            onClick={() => setEditandoIndicacao({ id: p.id, valor: p.referredBy ?? '' })}
                          >
                            {p.referredBy ?? 'sem médico — clique para informar'}
                          </button>
                        )}
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
                            value={sessionBy[p.id] ?? ''}
                            onChange={(e) => setSessionBy((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            list="medicos-indicacao"
                            placeholder="Quem aplicou"
                            className="h-8 max-w-44 text-xs"
                          />
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
