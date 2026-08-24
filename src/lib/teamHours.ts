/**
 * HORÁRIO DA EQUIPE no front — mesma regra que decide, no servidor, se a IA responde.
 *
 * DENTRO da janela quem atende é a equipe (a IA cala); FORA dela a IA assume o plantão.
 * Guardado em `crm_ai_configs.ai_team_hours` e ligado por `ai_offhours_only`; o gate de
 * verdade é `evaluateCrmAiAutoReplyGate`. Aqui a regra serve só para a TELA não mentir:
 * indicador "IA a escrever", rótulo do modo de atendimento e o editor em Configurações.
 *
 * Formato do jsonb: dia 0=domingo … 6=sábado → intervalos `["HH:MM","HH:MM"]`, fim exclusivo.
 * Dia ausente = ninguém atende (domingo, por omissão).
 *
 * ⚠️ Cópia deliberada de `supabase/functions/_shared/teamHours.ts` (Edge não importa de src/).
 * Mexeu numa, mexe na outra — os testes desta tabela-verdade estão em `teamHours.test.ts`.
 */
export type TeamHoursSchedule = Record<number, Array<[number, number]>>

export const TEAM_HOURS_TIME_ZONE = 'America/Sao_Paulo'

/** Seg–sex 08:00–18:00, sábado 08:00–12:00, domingo ninguém. */
export const DEFAULT_TEAM_HOURS: TeamHoursSchedule = {
  1: [[8 * 60, 18 * 60]],
  2: [[8 * 60, 18 * 60]],
  3: [[8 * 60, 18 * 60]],
  4: [[8 * 60, 18 * 60]],
  5: [[8 * 60, 18 * 60]],
  6: [[8 * 60, 12 * 60]],
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

const WEEKDAY_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** "HH:MM" (ou "HH:MM:SS") → minutos desde a meia-noite. `null` se não der para ler. */
function parseHhMm(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Tolera hora inteira (8 → 08:00), que é como é fácil escrever à mão no jsonb.
    const h = Math.trunc(value)
    return h >= 0 && h <= 24 ? h * 60 : null
  }
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  if (h < 0 || h > 24 || min < 0 || min > 59) return null
  return h * 60 + min
}

function pushRange(into: Array<[number, number]>, raw: unknown): void {
  if (!Array.isArray(raw) || raw.length < 2) return
  const start = parseHhMm(raw[0])
  const end = parseHhMm(raw[1])
  if (start == null || end == null) return
  // Fim <= início seria janela vazia (ou virada de meia-noite, que a equipe não faz):
  // descartar é melhor do que inventar um intervalo que cala a IA o dia todo.
  if (end <= start) return
  into.push([start, end])
}

/**
 * Lê o jsonb da config. Valor ausente/ilegível cai no padrão — nunca numa grade vazia, que
 * faria a IA responder 24h em silêncio depois de alguém salvar um JSON torto na tela.
 */
export function parseTeamHours(raw: unknown): TeamHoursSchedule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_TEAM_HOURS
  const out: TeamHoursSchedule = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(key)
    if (!Number.isInteger(day) || day < 0 || day > 6) continue
    const ranges: Array<[number, number]> = []
    if (Array.isArray(value) && value.length >= 2 && !Array.isArray(value[0])) {
      // Forma curta: ["08:00","18:00"] em vez de [["08:00","18:00"]].
      pushRange(ranges, value)
    } else if (Array.isArray(value)) {
      for (const range of value) pushRange(ranges, range)
    }
    if (ranges.length) out[day] = ranges
  }
  return Object.keys(out).length ? out : DEFAULT_TEAM_HOURS
}

/**
 * Dia da semana e minuto do dia no fuso indicado.
 *
 * A Edge corre em UTC: `Date#getDay()`/`getHours()` aqui devolveriam sábado 21h quando em
 * Maringá ainda é sábado 18h. Tem de passar pelo Intl.
 */
export function zonedWeekdayMinutes(date: Date, timeZone = TEAM_HOURS_TIME_ZONE): { weekday: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const weekdayRaw = parts.find((p) => p.type === 'weekday')?.value ?? ''
    const weekday = WEEKDAY_INDEX[weekdayRaw.slice(0, 3).toLowerCase()]
    let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '')
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '')
    if (weekday == null || !Number.isFinite(hour) || !Number.isFinite(minute)) return null
    if (hour === 24) hour = 0
    return { weekday, minutes: hour * 60 + minute }
  } catch {
    return null
  }
}

/** A equipe está de plantão neste instante? */
export function isWithinTeamHours(
  date: Date,
  schedule: TeamHoursSchedule = DEFAULT_TEAM_HOURS,
  timeZone = TEAM_HOURS_TIME_ZONE,
): boolean {
  const now = zonedWeekdayMinutes(date, timeZone)
  // Fuso ilegível: assumir que a equipe NÃO está, para nunca deixar o cliente sem ninguém.
  if (!now) return false
  const ranges = schedule[now.weekday]
  if (!ranges?.length) return false
  return ranges.some(([start, end]) => now.minutes >= start && now.minutes < end)
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Texto curto para o hint do painel: "segunda a sexta 08:00–18:00, sábado 08:00–12:00". */
export function describeTeamHours(schedule: TeamHoursSchedule = DEFAULT_TEAM_HOURS): string {
  const partes: string[] = []
  for (let day = 0; day <= 6; day += 1) {
    const ranges = schedule[day]
    if (!ranges?.length) continue
    partes.push(`${WEEKDAY_PT[day]} ${ranges.map(([s, e]) => `${hhmm(s)}–${hhmm(e)}`).join(' e ')}`)
  }
  return partes.join(', ')
}

/** Volta ao formato do jsonb (`{"1":[["08:00","18:00"]]}`) para gravar em `crm_ai_configs`. */
export function serializeTeamHours(schedule: TeamHoursSchedule): Record<string, string[][]> {
  const out: Record<string, string[][]> = {}
  for (let day = 0; day <= 6; day += 1) {
    const ranges = schedule[day]
    if (!ranges?.length) continue
    out[String(day)] = ranges.map(([s, e]) => [hhmm(s), hhmm(e)])
  }
  return out
}

/** "HH:MM" → minutos; devolve `null` no que não der para ler (input vazio na tela). */
export function hhmmToMinutes(value: string): number | null {
  return parseHhMm(value)
}

/** minutos → "HH:MM", para preencher os `<input type="time">`. */
export function minutesToHhmm(minutes: number): string {
  return hhmm(minutes)
}

export const WEEKDAY_LABELS_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
