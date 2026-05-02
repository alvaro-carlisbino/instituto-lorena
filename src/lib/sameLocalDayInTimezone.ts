/** Fuso padrão da operação (agenda / marcações no CRM). */
export const DEFAULT_CLINIC_TIMEZONE = 'America/Sao_Paulo'

/** Chave YYYY-MM-DD do dia civil num fuso (para comparar marcações com o dia escolhido na UI). */
export function calendarDayKeyInTimezone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Compara a data de calendário (YYYY-MM-DD) de um instante ISO com "hoje" nesse fuso. */
export function isSameLocalDayInTimezone(
  isoUtc: string,
  timeZone: string,
  nowRef: Date = new Date(),
): boolean {
  if (!isoUtc) return false
  const day = (dt: Date) => calendarDayKeyInTimezone(dt, timeZone)
  return day(new Date(isoUtc)) === day(nowRef)
}

/** Mesmo dia civil que `anchor` quando ambos são interpretados em `timeZone`. */
export function isSameCalendarDayAsAnchor(
  isoUtc: string,
  anchor: Date,
  timeZone: string,
): boolean {
  if (!isoUtc) return false
  return (
    calendarDayKeyInTimezone(new Date(isoUtc), timeZone) === calendarDayKeyInTimezone(anchor, timeZone)
  )
}

/** Minutos desde meia-noite no fuso indicado (para grelha da agenda). */
export function minutesSinceMidnightInTimezone(isoUtc: string, timeZone: string): number {
  const d = new Date(isoUtc)
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const hour = Number(p.find((x) => x.type === 'hour')?.value ?? 0)
  const minute = Number(p.find((x) => x.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** Avança o dia civil em `timeZone` (usa meio-dia UTC estável para evitar saltos). */
export function addCalendarDaysInTimezone(anchor: Date, deltaDays: number, timeZone: string): Date {
  const key = calendarDayKeyInTimezone(anchor, timeZone)
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0))
}
