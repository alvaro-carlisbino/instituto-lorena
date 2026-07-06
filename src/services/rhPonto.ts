import { supabase } from '@/lib/supabaseClient'

// RH / Ponto eletrônico: funcionários com quadro de horários, batidas com selfie
// e cerca de geolocalização, espelho (trabalhadas × previstas × saldo, formato da
// Folha de Ponto), folga/feriado/abono, férias e formulários de RH.
// Controle INTERNO de jornada — ponto com validade jurídica plena (REP-P,
// Portaria 671/2021) tem requisitos formais fora deste escopo.

const BUCKET = 'crm-lead-attachments'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

// ------------------------------------------------------------------ horários

export type SchedulePeriod = { start: string; end: string }
/** chave = dia da semana JS (0=domingo … 6=sábado) */
export type WeekSchedule = Record<string, SchedulePeriod[]>

const HHMM = /^(\d{1,2}):(\d{2})$/

export const hhmmToMinutes = (v: string): number | null => {
  const m = HHMM.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** "07:00-11:00, 11:30-15:30" → períodos (inválidos são ignorados). */
export function parsePeriodsText(text: string): SchedulePeriod[] {
  return text
    .split(',')
    .map((part) => {
      const [start, end] = part.split('-').map((s) => s.trim())
      if (!start || !end) return null
      if (hhmmToMinutes(start) == null || hhmmToMinutes(end) == null) return null
      const s = hhmmToMinutes(start)!
      const e = hhmmToMinutes(end)!
      return e > s ? { start, end } : null
    })
    .filter((p): p is SchedulePeriod => p != null)
}

export const periodsToText = (periods: SchedulePeriod[]): string =>
  periods.map((p) => `${p.start}-${p.end}`).join(', ')

export function scheduleMinutesForWeekday(schedule: WeekSchedule, weekday: number): number {
  const periods = schedule[String(weekday)] ?? []
  return periods.reduce((acc, p) => {
    const s = hhmmToMinutes(p.start)
    const e = hhmmToMinutes(p.end)
    return s != null && e != null && e > s ? acc + (e - s) : acc
  }, 0)
}

/** Minutos → "hh:mm" (com sinal quando negativo — saldo do espelho). */
export function minutesToHHMM(min: number): string {
  const sign = min < 0 ? '-' : ''
  const abs = Math.abs(Math.round(min))
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

// ------------------------------------------------------------------- geodesia

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

// ---------------------------------------------------------------- funcionários

export type HrEmployee = {
  id: string
  userId: string | null
  name: string
  cpf: string | null
  roleTitle: string | null
  code: string | null
  admissionDate: string | null
  schedule: WeekSchedule
  active: boolean
}

const mapEmployee = (r: Record<string, unknown>): HrEmployee => ({
  id: String(r.id),
  userId: r.user_id != null ? String(r.user_id) : null,
  name: String(r.name),
  cpf: r.cpf != null ? String(r.cpf) : null,
  roleTitle: r.role_title != null ? String(r.role_title) : null,
  code: r.code != null ? String(r.code) : null,
  admissionDate: r.admission_date != null ? String(r.admission_date) : null,
  schedule: (r.schedule ?? {}) as WeekSchedule,
  active: Boolean(r.active),
})

const EMPLOYEE_COLS = 'id, user_id, name, cpf, role_title, code, admission_date, schedule, active'

export async function listEmployees(includeInactive = false): Promise<HrEmployee[]> {
  const client = assertClient()
  let query = client.from('hr_employees').select(EMPLOYEE_COLS).order('name')
  if (!includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapEmployee)
}

/** Registro de funcionário do usuário logado (null = não cadastrado no RH). */
export async function getMyEmployee(): Promise<HrEmployee | null> {
  const client = assertClient()
  const { data: session } = await client.auth.getUser()
  const uid = session.user?.id
  if (!uid) return null
  const { data, error } = await client
    .from('hr_employees')
    .select(EMPLOYEE_COLS)
    .eq('user_id', uid)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapEmployee(data as Record<string, unknown>) : null
}

export async function upsertEmployee(payload: {
  id?: string
  userId?: string | null
  name: string
  cpf?: string | null
  roleTitle?: string | null
  code?: string | null
  admissionDate?: string | null
  schedule: WeekSchedule
  active?: boolean
}): Promise<void> {
  const client = assertClient()
  if (payload.name.trim().length < 2) throw new Error('Informe o nome do funcionário.')
  const row = {
    user_id: payload.userId || null,
    name: payload.name.trim(),
    cpf: payload.cpf?.trim() || null,
    role_title: payload.roleTitle?.trim() || null,
    code: payload.code?.trim() || null,
    admission_date: payload.admissionDate || null,
    schedule: payload.schedule,
    active: payload.active ?? true,
    updated_at: new Date().toISOString(),
  }
  const query = payload.id
    ? client.from('hr_employees').update(row).eq('id', payload.id)
    : client.from('hr_employees').insert(row)
  const { error } = await query
  if (error) throw new Error(error.message)
}

/** Logins do painel (app_users) pra vincular ao funcionário. */
export async function listAppUsersForLink(): Promise<Array<{ authUserId: string; name: string; email: string }>> {
  const client = assertClient()
  const { data, error } = await client
    .from('app_users')
    .select('name, email, auth_user_id, active')
    .eq('active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter((r) => r.auth_user_id != null)
    .map((r) => ({
      authUserId: String(r.auth_user_id),
      name: String(r.name ?? r.email ?? ''),
      email: String(r.email ?? ''),
    }))
}

// ------------------------------------------------------------------- settings

export type HrSettings = {
  lat: number | null
  lng: number | null
  radiusM: number
  enforceFence: boolean
  requireSelfie: boolean
}

export async function getHrSettings(): Promise<HrSettings> {
  const client = assertClient()
  const { data, error } = await client
    .from('hr_settings')
    .select('lat, lng, radius_m, enforce_fence, require_selfie')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    lat: data?.lat != null ? Number(data.lat) : null,
    lng: data?.lng != null ? Number(data.lng) : null,
    radiusM: Number(data?.radius_m ?? 150),
    enforceFence: Boolean(data?.enforce_fence ?? true),
    requireSelfie: Boolean(data?.require_selfie ?? true),
  }
}

export async function saveHrSettings(payload: HrSettings, tenantId: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('hr_settings').upsert(
    {
      tenant_id: tenantId,
      lat: payload.lat,
      lng: payload.lng,
      radius_m: Math.max(20, Math.round(payload.radiusM)),
      enforce_fence: payload.enforceFence,
      require_selfie: payload.requireSelfie,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  )
  if (error) throw new Error(error.message)
}

// -------------------------------------------------------------------- batidas

export type TimeEntry = {
  id: string
  employeeId: string
  at: string
  distanceM: number | null
  withinFence: boolean | null
  selfiePath: string | null
  manual: boolean
  note: string | null
}

const mapEntry = (r: Record<string, unknown>): TimeEntry => ({
  id: String(r.id),
  employeeId: String(r.employee_id),
  at: String(r.at),
  distanceM: r.distance_m != null ? Number(r.distance_m) : null,
  withinFence: r.within_fence != null ? Boolean(r.within_fence) : null,
  selfiePath: r.selfie_path != null ? String(r.selfie_path) : null,
  manual: Boolean(r.manual),
  note: r.note != null ? String(r.note) : null,
})

export async function listTimeEntries(
  employeeId: string,
  fromDay: string,
  toDay: string,
): Promise<TimeEntry[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('hr_time_entries')
    .select('id, employee_id, at, distance_m, within_fence, selfie_path, manual, note')
    .eq('employee_id', employeeId)
    .gte('at', `${fromDay}T00:00:00`)
    .lte('at', `${toDay}T23:59:59.999`)
    .order('at')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapEntry(r as Record<string, unknown>))
}

/** Bate o ponto do próprio funcionário (selfie opcional conforme config). */
export async function registerPunch(payload: {
  employeeId: string
  lat: number | null
  lng: number | null
  distanceM: number | null
  withinFence: boolean | null
  selfieBlob?: Blob | null
}): Promise<void> {
  const client = assertClient()
  let selfiePath: string | null = null
  if (payload.selfieBlob) {
    selfiePath = `hr-ponto/${payload.employeeId}/${Date.now()}.jpg`
    const { error: upErr } = await client.storage.from(BUCKET).upload(selfiePath, payload.selfieBlob, {
      contentType: 'image/jpeg',
      upsert: false,
    })
    if (upErr) throw new Error(`Falha ao enviar a selfie: ${upErr.message}`)
  }
  const { error } = await client.from('hr_time_entries').insert({
    employee_id: payload.employeeId,
    lat: payload.lat,
    lng: payload.lng,
    distance_m: payload.distanceM,
    within_fence: payload.withinFence,
    selfie_path: selfiePath,
  })
  if (error) throw new Error(error.message)
}

/** Ajuste manual do gestor — vira "(m)" no espelho. */
export async function addManualPunch(payload: {
  employeeId: string
  atIso: string
  note?: string
}): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('hr_time_entries').insert({
    employee_id: payload.employeeId,
    at: payload.atIso,
    manual: true,
    note: payload.note?.trim() || 'ajuste manual',
  })
  if (error) throw new Error(error.message)
}

export async function deletePunch(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('hr_time_entries').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getSelfieUrl(path: string): Promise<string> {
  const client = assertClient()
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

// -------------------------------------------------------------- dia / marcações

export type DayMarkKind = 'folga' | 'feriado' | 'atestado' | 'abono'
export type DayMark = {
  id: string
  employeeId: string
  day: string
  mark: DayMarkKind
  abonoMinutes: number
  note: string | null
}

export async function listDayMarks(employeeId: string, fromDay: string, toDay: string): Promise<DayMark[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('hr_day_marks')
    .select('id, employee_id, day, mark, abono_minutes, note')
    .eq('employee_id', employeeId)
    .gte('day', fromDay)
    .lte('day', toDay)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    employeeId: String(r.employee_id),
    day: String(r.day),
    mark: (['folga', 'feriado', 'atestado', 'abono'].includes(String(r.mark))
      ? String(r.mark)
      : 'folga') as DayMarkKind,
    abonoMinutes: Number(r.abono_minutes ?? 0),
    note: r.note != null ? String(r.note) : null,
  }))
}

export async function setDayMark(payload: {
  employeeId: string
  day: string
  mark: DayMarkKind
  abonoMinutes?: number
  note?: string
  tenantId: string
}): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('hr_day_marks').upsert(
    {
      tenant_id: payload.tenantId,
      employee_id: payload.employeeId,
      day: payload.day,
      mark: payload.mark,
      abono_minutes: payload.mark === 'abono' ? Math.max(0, Math.round(payload.abonoMinutes ?? 0)) : 0,
      note: payload.note?.trim() || null,
    },
    { onConflict: 'tenant_id,employee_id,day' },
  )
  if (error) throw new Error(error.message)
}

export async function removeDayMark(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('hr_day_marks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ------------------------------------------------------------ férias/afastamentos

export type LeaveType = 'ferias' | 'atestado' | 'folga' | 'outro'
export type LeaveStatus = 'pendente' | 'aprovado' | 'negado'
export type LeaveRequest = {
  id: string
  employeeId: string
  type: LeaveType
  startDate: string
  endDate: string
  status: LeaveStatus
  note: string | null
  createdAt: string
}

const mapLeave = (r: Record<string, unknown>): LeaveRequest => ({
  id: String(r.id),
  employeeId: String(r.employee_id),
  type: (['ferias', 'atestado', 'folga', 'outro'].includes(String(r.type))
    ? String(r.type)
    : 'outro') as LeaveType,
  startDate: String(r.start_date),
  endDate: String(r.end_date),
  status: (['pendente', 'aprovado', 'negado'].includes(String(r.status))
    ? String(r.status)
    : 'pendente') as LeaveStatus,
  note: r.note != null ? String(r.note) : null,
  createdAt: String(r.created_at ?? ''),
})

export async function listLeaves(employeeId?: string): Promise<LeaveRequest[]> {
  const client = assertClient()
  let query = client
    .from('hr_leave_requests')
    .select('id, employee_id, type, start_date, end_date, status, note, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (employeeId) query = query.eq('employee_id', employeeId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapLeave(r as Record<string, unknown>))
}

export async function createLeave(payload: {
  employeeId: string
  type: LeaveType
  startDate: string
  endDate: string
  note?: string
}): Promise<void> {
  const client = assertClient()
  if (!payload.startDate || !payload.endDate || payload.endDate < payload.startDate) {
    throw new Error('Período inválido.')
  }
  const { error } = await client.from('hr_leave_requests').insert({
    employee_id: payload.employeeId,
    type: payload.type,
    start_date: payload.startDate,
    end_date: payload.endDate,
    note: payload.note?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function reviewLeave(id: string, status: 'aprovado' | 'negado'): Promise<void> {
  const client = assertClient()
  const { data: session } = await assertClient().auth.getUser()
  const { error } = await client
    .from('hr_leave_requests')
    .update({ status, reviewed_by: session.user?.id ?? null, reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ------------------------------------------------------------------ formulários

export type FormQuestion = {
  id: string
  text: string
  type: 'likert' | 'choice' | 'text'
  options?: string[]
}
export type FormTemplate = {
  id: string
  name: string
  kind: string
  description: string | null
  questions: FormQuestion[]
  active: boolean
}
export type FormResponse = {
  id: string
  templateId: string
  employeeId: string
  answers: Record<string, unknown>
  submittedAt: string
}

export async function listFormTemplates(): Promise<FormTemplate[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('hr_form_templates')
    .select('id, name, kind, description, questions, active')
    .eq('active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: String(r.kind ?? 'outro'),
    description: r.description != null ? String(r.description) : null,
    questions: (Array.isArray(r.questions) ? r.questions : []) as FormQuestion[],
    active: Boolean(r.active),
  }))
}

export async function listFormResponses(employeeId?: string): Promise<FormResponse[]> {
  const client = assertClient()
  let query = client
    .from('hr_form_responses')
    .select('id, template_id, employee_id, answers, submitted_at')
    .order('submitted_at', { ascending: false })
    .limit(300)
  if (employeeId) query = query.eq('employee_id', employeeId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    templateId: String(r.template_id),
    employeeId: String(r.employee_id),
    answers: (r.answers ?? {}) as Record<string, unknown>,
    submittedAt: String(r.submitted_at ?? ''),
  }))
}

export async function submitFormResponse(payload: {
  templateId: string
  employeeId: string
  answers: Record<string, unknown>
}): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('hr_form_responses').insert({
    template_id: payload.templateId,
    employee_id: payload.employeeId,
    answers: payload.answers,
  })
  if (error) throw new Error(error.message)
}

// ------------------------------------------------------------------- espelho

export type TimesheetRow = {
  day: string
  weekdayLabel: string
  punches: Array<{ time: string; manual: boolean }>
  markLabel: string | null
  workedMin: number
  abonoMin: number
  expectedMin: number
  saldoMin: number
}

export type Timesheet = {
  rows: TimesheetRow[]
  totalWorkedMin: number
  totalAbonoMin: number
  totalExpectedMin: number
  totalSaldoMin: number
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MARK_LABEL: Record<string, string> = {
  folga: 'Folga',
  feriado: 'Feriado',
  atestado: 'Atestado',
  abono: 'Abono',
}
const LEAVE_LABEL: Record<string, string> = {
  ferias: 'Férias',
  atestado: 'Atestado',
  folga: 'Folga',
  outro: 'Afastamento',
}

const dayOfIso = (iso: string): string => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const timeOfIso = (iso: string): string => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Monta o espelho no formato da Folha de Ponto: batidas pareadas na ordem
 * (1ª entrada, 2ª saída, …; batida ímpar sobrando não conta), previstas do
 * quadro de horários, folga/feriado/atestado/férias zeram as previstas e
 * abono soma ao trabalhado. Saldo = trabalhadas + abono − previstas.
 */
export function buildTimesheet(params: {
  fromDay: string
  toDay: string
  schedule: WeekSchedule
  entries: TimeEntry[]
  marks: DayMark[]
  approvedLeaves: LeaveRequest[]
}): Timesheet {
  const { fromDay, toDay, schedule, entries, marks, approvedLeaves } = params
  const byDay = new Map<string, TimeEntry[]>()
  for (const e of entries) {
    const key = dayOfIso(e.at)
    const list = byDay.get(key) ?? []
    list.push(e)
    byDay.set(key, list)
  }
  const markByDay = new Map(marks.map((m) => [m.day, m] as const))

  const rows: TimesheetRow[] = []
  const cursor = new Date(`${fromDay}T12:00:00`)
  const end = new Date(`${toDay}T12:00:00`)
  while (cursor <= end) {
    const day = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const weekday = cursor.getDay()
    const dayEntries = (byDay.get(day) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at))
    const punches = dayEntries.map((e) => ({ time: timeOfIso(e.at), manual: e.manual }))

    let workedMin = 0
    for (let i = 0; i + 1 < dayEntries.length; i += 2) {
      workedMin += Math.max(
        0,
        Math.round((new Date(dayEntries[i + 1]!.at).getTime() - new Date(dayEntries[i]!.at).getTime()) / 60000),
      )
    }

    const mark = markByDay.get(day)
    const leave = approvedLeaves.find((l) => l.startDate <= day && day <= l.endDate)
    const zeroExpected = mark ? mark.mark !== 'abono' : Boolean(leave)
    const expectedMin = zeroExpected ? 0 : scheduleMinutesForWeekday(schedule, weekday)
    const abonoMin = mark?.mark === 'abono' ? mark.abonoMinutes : 0
    const markLabel = mark
      ? MARK_LABEL[mark.mark] ?? mark.mark
      : leave
        ? LEAVE_LABEL[leave.type] ?? 'Afastamento'
        : null

    rows.push({
      day,
      weekdayLabel: WEEKDAYS[weekday]!,
      punches,
      markLabel,
      workedMin,
      abonoMin,
      expectedMin,
      saldoMin: workedMin + abonoMin - expectedMin,
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return {
    rows,
    totalWorkedMin: rows.reduce((a, r) => a + r.workedMin, 0),
    totalAbonoMin: rows.reduce((a, r) => a + r.abonoMin, 0),
    totalExpectedMin: rows.reduce((a, r) => a + r.expectedMin, 0),
    totalSaldoMin: rows.reduce((a, r) => a + r.saldoMin, 0),
  }
}
