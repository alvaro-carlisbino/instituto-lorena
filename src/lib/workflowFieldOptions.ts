import { slugifyLabel } from '@/lib/utils'

export type SelectOptionPair = { value: string; label: string }

/** Normaliza item vindo do banco (string legada ou objeto). */
export function parseWorkflowOption(raw: unknown): SelectOptionPair {
  if (raw && typeof raw === 'object' && 'value' in raw) {
    const o = raw as { value?: unknown; label?: unknown }
    const value = String(o.value ?? '').trim()
    const label = String(o.label ?? value).trim()
    return { value: value || label, label: label || value }
  }
  const s = String(raw ?? '').trim()
  return { value: s, label: s }
}

export function normalizeFieldSelectOptions(options: unknown[]): SelectOptionPair[] {
  return options.map((o) => parseWorkflowOption(o)).filter((p) => p.value.length > 0)
}

/** Persistência: mantém objetos { value, label }; strings viram label=value. */
export function toStoredOptions(pairs: SelectOptionPair[]): (string | SelectOptionPair)[] {
  return pairs.map((p) => (p.label === p.value ? p.value : { value: p.value, label: p.label }))
}

export function optionLabelForValue(options: unknown[], storedValue: string): string {
  const pairs = normalizeFieldSelectOptions(options)
  const hit = pairs.find((p) => p.value === storedValue)
  return hit?.label ?? storedValue
}

/** Gera value estável a partir do rótulo quando o usuário só edita o texto. */
export function ensureOptionValue(label: string, existingValues: Set<string>): string {
  const base = slugifyLabel(label) || `opt-${existingValues.size}`
  let v = base
  let n = 0
  while (existingValues.has(v)) {
    n += 1
    v = `${base}-${n}`
  }
  return v
}
