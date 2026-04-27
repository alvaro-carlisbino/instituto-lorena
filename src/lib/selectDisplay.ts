/**
 * Rótulo para o trigger do Select (Base UI não mostra sempre o item quando o `value` não
 * bate com nenhum SelectItem — fica o id cru). O pai calcula o texto; use com LabeledSelectTrigger.
 */
export function labelForIdName(
  value: string,
  options: readonly { id: string; name: string }[],
  all: { value: string; label: string } | undefined,
  placeholder: string,
): string {
  if (all && value === all.value) return all.label
  return options.find((o) => o.id === value)?.name ?? placeholder
}

export function labelForKeyMap(
  value: string,
  map: Readonly<Record<string, string>>,
  all: { value: string; label: string },
  placeholder: string,
): string {
  if (value === all.value) return all.label
  return map[value] ?? placeholder
}
