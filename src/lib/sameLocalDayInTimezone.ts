/** Compara a data de calendário (YYYY-MM-DD) de um instante ISO com "hoje" nesse fuso. */
export function isSameLocalDayInTimezone(
  isoUtc: string,
  timeZone: string,
  nowRef: Date = new Date(),
): boolean {
  if (!isoUtc) return false
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone })
  return day(new Date(isoUtc)) === day(nowRef)
}
