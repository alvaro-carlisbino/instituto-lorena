import { DEFAULT_CLINIC_TIMEZONE } from '@/lib/sameLocalDayInTimezone'

function formatPartsLookup(d: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const g = (ty: Intl.DateTimeFormatPartTypes) =>
    Number((p.find((x) => x.type === ty)?.value ?? '0').replace(/^0+(?=\d)/, ''))
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), min: g('minute') }
}

function wallClockMatchesUtcMs(ms: number, year: number, month: number, day: number, hour: number, minute: number, timeZone: string): boolean {
  const { y, m, d, h, min } = formatPartsLookup(new Date(ms), timeZone)
  return y === year && m === month && d === day && h === hour && min === minute
}

/** Converte data/hora civil em `timeZone` para instante UTC (ISO). */
export function wallTimeInTimezoneToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const start = Date.UTC(year, month - 1, day - 1, 0, 0, 0)
  const end = Date.UTC(year, month - 1, day + 2, 23, 59, 59)
  for (let ms = start; ms <= end; ms += 60 * 1000) {
    if (wallClockMatchesUtcMs(ms, year, month, day, hour, minute, timeZone)) {
      return new Date(ms).toISOString()
    }
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0)).toISOString()
}

/** Valor para `<input type="datetime-local" />` a partir de ISO UTC (componentes no fuso da clínica). */
export function isoToDatetimeLocalValue(isoUtc: string, timeZone: string = DEFAULT_CLINIC_TIMEZONE): string {
  const d = new Date(isoUtc)
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (ty: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === ty)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

/** Interpreta o valor do `datetime-local` como horário civil em `timeZone` e devolve ISO UTC. */
export function datetimeLocalValueToIso(value: string, timeZone: string = DEFAULT_CLINIC_TIMEZONE): string {
  const trimmed = value.trim()
  const [dp, tp] = trimmed.split('T')
  if (!dp || !tp) return new Date(trimmed).toISOString()
  const [y, m, d] = dp.split('-').map(Number)
  const [hh, mm] = tp.split(':').map(Number)
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return new Date(trimmed).toISOString()
  return wallTimeInTimezoneToUtcIso(y, m, d, hh, mm, timeZone)
}

export function addMinutesToIso(isoUtc: string, minutes: number): string {
  return new Date(new Date(isoUtc).getTime() + minutes * 60 * 1000).toISOString()
}
