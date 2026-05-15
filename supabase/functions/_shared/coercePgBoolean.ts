/** Postgres / JSON por vezes devolvem boolean como string; evita `Boolean("false") === true`. */
export function coercePgBoolean(raw: unknown, defaultWhenUnset = true): boolean {
  if (raw === true) return true
  if (raw === false) return false
  if (raw === null || raw === undefined) return defaultWhenUnset
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase()
    if (s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'sim') return true
    if (s === 'false' || s === 'f' || s === '0' || s === 'no' || s === 'não' || s === 'nao') return false
    return defaultWhenUnset
  }
  return defaultWhenUnset
}
