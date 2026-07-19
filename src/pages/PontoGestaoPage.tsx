import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlarmClock,
  CalendarDays,
  Camera,
  Check,
  FileDown,
  MapPin,
  Plus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LEAVE_STATUS_STYLE } from '@/pages/PontoPage'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { downloadCsv } from '@/services/tricopillReports'
import {
  type DayMark,
  type DayMarkKind,
  type HrEmployee,
  type HrSettings,
  type LeaveRequest,
  type TimeEntry,
  type WeekSchedule,
  addManualPunch,
  buildTimesheet,
  deletePunch,
  getHrSettings,
  getSelfieUrl,
  listAppUsersForLink,
  listDayMarks,
  listEmployees,
  listLeaves,
  listTimeEntries,
  minutesToHHMM,
  parsePeriodsText,
  periodsToText,
  removeDayMark,
  reviewLeave,
  saveHrSettings,
  setDayMark,
  upsertEmployee,
} from '@/services/rhPonto'

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monthStart = () => {
  const d = new Date()
  d.setDate(1)
  return ymd(d)
}

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvRow = (cells: unknown[]) => cells.map(csvCell).join(';')

type EmployeeDraft = {
  id?: string
  name: string
  cpf: string
  roleTitle: string
  code: string
  admissionDate: string
  userId: string
  scheduleText: Record<string, string>
}
const EMPTY_DRAFT: EmployeeDraft = {
  name: '',
  cpf: '',
  roleTitle: '',
  code: '',
  admissionDate: '',
  userId: '',
  scheduleText: { '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '0': '' },
}

export function PontoGestaoPage() {
  const crm = useCrm()
  const { tenant } = useTenant()
  const canManage = crm.currentPermission.canManageUsers

  const [employees, setEmployees] = useState<HrEmployee[]>([])
  const [users, setUsers] = useState<Array<{ authUserId: string; name: string; email: string }>>([])
  const [settings, setSettings] = useState<HrSettings | null>(null)
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])

  // form funcionário
  const [draft, setDraft] = useState<EmployeeDraft>({ ...EMPTY_DRAFT })
  const [savingEmp, setSavingEmp] = useState(false)

  // espelho
  const [selEmployeeId, setSelEmployeeId] = useState('')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(ymd(new Date()))
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [marks, setMarks] = useState<DayMark[]>([])

  // dialog do dia (batidas + marcação)
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const [manualTime, setManualTime] = useState('')
  const [markKind, setMarkKind] = useState<DayMarkKind>('folga')
  const [abonoMin, setAbonoMin] = useState('')

  const selEmployee = employees.find((e) => e.id === selEmployeeId) ?? null

  const loadBase = async () => {
    try {
      const [emps, us, st, lv] = await Promise.all([
        listEmployees(true),
        listAppUsersForLink(),
        getHrSettings(),
        listLeaves(),
      ])
      setEmployees(emps)
      setUsers(us)
      setSettings(st)
      setLeaves(lv)
      if (!selEmployeeId && emps.length > 0) setSelEmployeeId(emps[0]!.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar RH')
    }
  }

  const loadTimesheet = async () => {
    if (!selEmployeeId || !from || !to) return
    try {
      const [ent, mk] = await Promise.all([
        listTimeEntries(selEmployeeId, from, to),
        listDayMarks(selEmployeeId, from, to),
      ])
      setEntries(ent)
      setMarks(mk)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o espelho')
    }
  }

  useEffect(() => {
    if (canManage) void loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage])

  useEffect(() => {
    if (canManage) void loadTimesheet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selEmployeeId, from, to, canManage])

  const timesheet = useMemo(
    () =>
      selEmployee
        ? buildTimesheet({
            fromDay: from,
            toDay: to,
            schedule: selEmployee.schedule,
            entries,
            marks,
            approvedLeaves: leaves.filter((l) => l.status === 'aprovado' && l.employeeId === selEmployee.id),
          })
        : null,
    [selEmployee, entries, marks, leaves, from, to],
  )

  const employeeName = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name] as const)),
    [employees],
  )

  const editEmployee = (e: HrEmployee) => {
    setDraft({
      id: e.id,
      name: e.name,
      cpf: e.cpf ?? '',
      roleTitle: e.roleTitle ?? '',
      code: e.code ?? '',
      admissionDate: e.admissionDate ?? '',
      userId: e.userId ?? '',
      scheduleText: Object.fromEntries(
        ['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, periodsToText(e.schedule[d] ?? [])]),
      ),
    })
  }

  const saveEmployee = async () => {
    setSavingEmp(true)
    try {
      const schedule: WeekSchedule = {}
      for (const [day, text] of Object.entries(draft.scheduleText)) {
        const periods = parsePeriodsText(text)
        if (periods.length > 0) schedule[day] = periods
      }
      await upsertEmployee({
        id: draft.id,
        name: draft.name,
        cpf: draft.cpf || null,
        roleTitle: draft.roleTitle || null,
        code: draft.code || null,
        admissionDate: draft.admissionDate || null,
        userId: draft.userId || null,
        schedule,
      })
      toast.success(`Funcionário ${draft.id ? 'atualizado' : 'cadastrado'}.`)
      setDraft({ ...EMPTY_DRAFT, scheduleText: { ...EMPTY_DRAFT.scheduleText } })
      await loadBase()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar funcionário')
    } finally {
      setSavingEmp(false)
    }
  }

  const exportEspelho = () => {
    if (!timesheet || !selEmployee) return
    const head = csvRow(['Dia', 'Semana', 'Pontos', 'Marcação', 'Trabalhadas', 'Abono', 'Previstas', 'Saldo'])
    const lines = timesheet.rows.map((r) =>
      csvRow([
        r.day,
        r.weekdayLabel,
        r.punches.map((p) => `${p.time}${p.manual ? ' (m)' : ''}`).join(' | '),
        r.markLabel ?? '',
        minutesToHHMM(r.workedMin),
        r.abonoMin ? minutesToHHMM(r.abonoMin) : '',
        minutesToHHMM(r.expectedMin),
        minutesToHHMM(r.saldoMin),
      ]),
    )
    const totals = csvRow([
      'TOTAL', '', '', '',
      minutesToHHMM(timesheet.totalWorkedMin),
      minutesToHHMM(timesheet.totalAbonoMin),
      minutesToHHMM(timesheet.totalExpectedMin),
      minutesToHHMM(timesheet.totalSaldoMin),
    ])
    downloadCsv(`ponto-${selEmployee.name.toLowerCase().replace(/\s+/g, '-')}-${from}-a-${to}.csv`, [head, ...lines, totals].join('\n'))
  }

  const openDay = (day: string) => {
    setDayOpen(day)
    setManualTime('')
    setMarkKind('folga')
    setAbonoMin('')
  }

  const dayEntries = useMemo(
    () => entries.filter((e) => e.at.startsWith(dayOpen ?? '—')).sort((a, b) => a.at.localeCompare(b.at)),
    [entries, dayOpen],
  )
  const dayMark = marks.find((m) => m.day === dayOpen) ?? null

  const addManual = async () => {
    if (!dayOpen || !selEmployeeId || !manualTime) return
    try {
      await addManualPunch({ employeeId: selEmployeeId, atIso: `${dayOpen}T${manualTime}:00` })
      toast.success(`Batida manual ${manualTime} adicionada (m).`)
      setManualTime('')
      await loadTimesheet()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no ajuste manual')
    }
  }

  const applyMark = async () => {
    if (!dayOpen || !selEmployeeId) return
    try {
      await setDayMark({
        employeeId: selEmployeeId,
        day: dayOpen,
        mark: markKind,
        abonoMinutes: Number(abonoMin) || 0,
        tenantId: tenant.id,
      })
      toast.success('Dia marcado.')
      await loadTimesheet()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao marcar o dia')
    }
  }

  const viewSelfie = async (path: string) => {
    try {
      window.open(await getSelfieUrl(path), '_blank', 'noopener')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir selfie')
    }
  }

  const useMyLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setSettings((s) =>
          s ? { ...s, lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) } : s,
        ),
      () => toast.error('Não foi possível obter a localização.'),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const saveSettings = async () => {
    if (!settings) return
    try {
      await saveHrSettings(settings, tenant.id)
      toast.success('Configuração da cerca salva.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar configuração')
    }
  }

  if (!canManage) {
    return (
      <AppLayout title="Gestão de ponto" subtitle="Espelho, funcionários, férias e cerca da clínica.">
        <EmptyState icon={AlarmClock} title="Acesso restrito" description="Só administradores e gestores acessam a gestão de ponto." />
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Gestão de ponto" subtitle="Funcionários e horários, espelho de ponto, férias/afastamentos e cerca de geolocalização.">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <UserRound className="size-4 text-primary" /> {draft.id ? 'Editar funcionário' : 'Novo funcionário'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="emp-name">Nome</Label>
                <Input id="emp-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-cpf">CPF</Label>
                  <Input id="emp-cpf" value={draft.cpf} onChange={(e) => setDraft((d) => ({ ...d, cpf: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-role">Função</Label>
                  <Input id="emp-role" value={draft.roleTitle} onChange={(e) => setDraft((d) => ({ ...d, roleTitle: e.target.value }))} placeholder="Ex.: Téc. de Enfermagem" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-code">Código</Label>
                  <Input id="emp-code" value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-adm">Admissão</Label>
                  <Input id="emp-adm" type="date" value={draft.admissionDate} onChange={(e) => setDraft((d) => ({ ...d, admissionDate: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-user">Login do painel (bate o próprio ponto)</Label>
                <Select value={draft.userId || 'nenhum'} onValueChange={(v) => setDraft((d) => ({ ...d, userId: !v || v === 'nenhum' ? '' : v }))}>
                  <SelectTrigger id="emp-user">
                    <SelectValue placeholder="Vincular usuário" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Sem login</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.authUserId} value={u.authUserId}>
                        {u.name} · {u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Quadro de horários (ex.: 07:00-11:00, 11:30-15:30)</Label>
                {['1', '2', '3', '4', '5', '6', '0'].map((d) => (
                  <div key={d} className="flex items-center gap-2">
                    <Label htmlFor={`sched-${d}`} className="w-16 shrink-0 text-xs font-normal text-muted-foreground">
                      {WEEKDAY_LABELS[Number(d)]}
                    </Label>
                    <Input
                      id={`sched-${d}`}
                      value={draft.scheduleText[d] ?? ''}
                      onChange={(e) => setDraft((dr) => ({ ...dr, scheduleText: { ...dr.scheduleText, [d]: e.target.value } }))}
                      placeholder="folga"
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={saveEmployee} disabled={savingEmp}>
                  {savingEmp ? 'Salvando…' : draft.id ? 'Salvar alterações' : 'Cadastrar funcionário'}
                </Button>
                {draft.id ? (
                  <Button variant="ghost" onClick={() => setDraft({ ...EMPTY_DRAFT, scheduleText: { ...EMPTY_DRAFT.scheduleText } })}>
                    Cancelar
                  </Button>
                ) : null}
              </div>
              {employees.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  {employees.map((e) => (
                    <Button
                      key={e.id}
                      type="button"
                      variant="ghost"
                      onClick={() => editEmployee(e)}
                      className="h-auto w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm font-normal whitespace-normal hover:bg-muted/40"
                    >
                      <span>
                        <span className="font-medium">{e.name}</span>
                        {e.roleTitle ? <span className="text-xs text-muted-foreground"> · {e.roleTitle}</span> : null}
                      </span>
                      {!e.userId ? <Badge variant="secondary" className="bg-amber-500/15 text-amber-600">sem login</Badge> : null}
                    </Button>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarDays className="size-4 text-primary" /> Solicitações ({leaves.filter((l) => l.status === 'pendente').length} pendentes)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {leaves.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">Sem solicitações.</p>
              ) : (
                leaves.slice(0, 20).map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{employeeName.get(l.employeeId) ?? '?'}</span>{' '}
                      <span className="text-xs text-muted-foreground">
                        {l.type} · {new Date(`${l.startDate}T12:00:00`).toLocaleDateString('pt-BR')} a{' '}
                        {new Date(`${l.endDate}T12:00:00`).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    {l.status === 'pendente' ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => void reviewLeave(l.id, 'aprovado').then(loadBase)}>
                          <Check className="size-3.5" /> Aprovar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void reviewLeave(l.id, 'negado').then(loadBase)}>
                          <X className="size-3.5" /> Negar
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="secondary" className={LEAVE_STATUS_STYLE[l.status]}>
                        {l.status}
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <MapPin className="size-4 text-primary" /> Cerca da clínica
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {settings ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="cfg-lat">Latitude</Label>
                      <Input id="cfg-lat" value={settings.lat ?? ''} onChange={(e) => setSettings((s) => (s ? { ...s, lat: e.target.value ? Number(e.target.value) : null } : s))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cfg-lng">Longitude</Label>
                      <Input id="cfg-lng" value={settings.lng ?? ''} onChange={(e) => setSettings((s) => (s ? { ...s, lng: e.target.value ? Number(e.target.value) : null } : s))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cfg-radius">Raio (m)</Label>
                      <Input id="cfg-radius" value={settings.radiusM} onChange={(e) => setSettings((s) => (s ? { ...s, radiusM: Number(e.target.value) || 150 } : s))} inputMode="numeric" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="cfg-fence"
                        checked={settings.enforceFence}
                        onCheckedChange={(checked) => setSettings((s) => (s ? { ...s, enforceFence: checked } : s))}
                      />
                      <Label htmlFor="cfg-fence" className="font-normal">Bloquear batida fora da cerca</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="cfg-selfie"
                        checked={settings.requireSelfie}
                        onCheckedChange={(checked) => setSettings((s) => (s ? { ...s, requireSelfie: checked } : s))}
                      />
                      <Label htmlFor="cfg-selfie" className="font-normal">Exigir selfie</Label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={useMyLocation}>
                      <MapPin className="size-3.5" /> Usar minha localização (estando na clínica)
                    </Button>
                    <Button size="sm" onClick={() => void saveSettings()}>Salvar</Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlarmClock className="size-4 text-primary" /> Espelho de ponto
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              <Select value={selEmployeeId || undefined} onValueChange={(v) => v && setSelEmployeeId(v)}>
                <SelectTrigger className="h-8 w-[190px]" aria-label="Funcionário">
                  <SelectValue placeholder="Funcionário" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Data inicial" className="h-8 w-[140px]" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Data final" className="h-8 w-[140px]" />
              <Button size="sm" variant="outline" onClick={exportEspelho} disabled={!timesheet}>
                <FileDown className="size-3.5" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!selEmployee || !timesheet ? (
              <EmptyState icon={AlarmClock} title="Cadastre um funcionário" description="O espelho aparece aqui com trabalhadas × previstas × saldo, no formato da folha de ponto." />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-4 text-sm">
                  <span>Trabalhadas: <strong>{minutesToHHMM(timesheet.totalWorkedMin)}</strong></span>
                  <span>Abono: <strong>{minutesToHHMM(timesheet.totalAbonoMin)}</strong></span>
                  <span>Previstas: <strong>{minutesToHHMM(timesheet.totalExpectedMin)}</strong></span>
                  <span>
                    Saldo:{' '}
                    <strong className={timesheet.totalSaldoMin < 0 ? 'text-red-500' : 'text-emerald-600'}>
                      {minutesToHHMM(timesheet.totalSaldoMin)}
                    </strong>
                  </span>
                  <span className="text-xs text-muted-foreground">clique no dia p/ batidas, selfies, ajuste manual e folga/abono</span>
                </div>
                <div className="max-h-[620px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dia</TableHead>
                        <TableHead>Pontos</TableHead>
                        <TableHead className="text-right">Trabalhadas</TableHead>
                        <TableHead className="text-right">Previstas</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timesheet.rows.map((r) => (
                        <TableRow
                          key={r.day}
                          tabIndex={0}
                          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          onClick={() => openDay(r.day)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openDay(r.day)
                            }
                          }}
                        >
                          <TableCell className="whitespace-nowrap text-xs">
                            {new Date(`${r.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}{' '}
                            <span className="text-muted-foreground">{r.weekdayLabel.slice(0, 3)}</span>
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.markLabel ? <Badge variant="secondary">{r.markLabel}</Badge> : null}{' '}
                            {r.punches.map((p) => `${p.time}${p.manual ? ' (m)' : ''}`).join(' | ') || (r.markLabel ? '' : '—')}
                          </TableCell>
                          <TableCell className="text-right text-xs">{r.workedMin > 0 || r.abonoMin > 0 ? minutesToHHMM(r.workedMin + r.abonoMin) : '—'}</TableCell>
                          <TableCell className="text-right text-xs">{r.expectedMin > 0 ? minutesToHHMM(r.expectedMin) : '—'}</TableCell>
                          <TableCell className={`text-right text-xs font-medium ${r.saldoMin < 0 ? 'text-red-500' : r.saldoMin > 0 ? 'text-emerald-600' : ''}`}>
                            {r.expectedMin > 0 || r.workedMin > 0 ? minutesToHHMM(r.saldoMin) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dayOpen != null} onOpenChange={(open) => (!open ? setDayOpen(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dayOpen ? new Date(`${dayOpen}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }) : ''}{' '}
              · {selEmployee?.name}
            </DialogTitle>
            <DialogDescription>Batidas do dia, ajuste manual e marcação (folga/feriado/atestado/abono).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              {dayEntries.length === 0 ? (
                <p className="text-muted-foreground">Sem batidas neste dia.</p>
              ) : (
                dayEntries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {e.manual ? <Badge variant="secondary" className="bg-amber-500/15 text-amber-600">(m) manual</Badge> : null}
                      {e.withinFence === false ? <Badge variant="secondary" className="bg-red-500/15 text-red-600">fora da cerca</Badge> : null}
                      {e.distanceM != null ? <span className="text-xs text-muted-foreground">{e.distanceM}m</span> : null}
                    </div>
                    <div className="flex gap-1">
                      {e.selfiePath ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => void viewSelfie(e.selfiePath!)}
                          aria-label="Ver selfie da batida"
                        >
                          <Camera className="size-3.5" aria-hidden />
                        </Button>
                      ) : null}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => void deletePunch(e.id).then(loadTimesheet)}
                        aria-label={`Excluir batida das ${new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="manual-time">Batida manual (m)</Label>
                <Input id="manual-time" type="time" value={manualTime} onChange={(e) => setManualTime(e.target.value)} className="h-9 w-[130px]" />
              </div>
              <Button size="sm" onClick={() => void addManual()} disabled={!manualTime}>
                <Plus className="size-3.5" /> Adicionar
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="mark-kind">Marcar dia</Label>
                <Select value={markKind} onValueChange={(v) => setMarkKind((v ?? 'folga') as DayMarkKind)}>
                  <SelectTrigger id="mark-kind" className="h-9 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['folga', 'feriado', 'atestado', 'abono'] as DayMarkKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {markKind === 'abono' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="abono-min">Minutos</Label>
                  <Input id="abono-min" value={abonoMin} onChange={(e) => setAbonoMin(e.target.value)} inputMode="numeric" className="h-9 w-[100px]" placeholder="480" />
                </div>
              ) : null}
              <Button size="sm" onClick={() => void applyMark()}>Aplicar</Button>
              {dayMark ? (
                <Button size="sm" variant="ghost" onClick={() => void removeDayMark(dayMark.id).then(loadTimesheet)}>
                  <Trash2 className="size-3.5" /> Remover marcação ({dayMark.mark})
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
