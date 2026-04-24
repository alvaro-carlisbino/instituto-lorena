import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { normalizeFieldSelectOptions } from '@/lib/workflowFieldOptions'
import { getLeadFieldValue, setLeadFieldValue } from '@/lib/leadFields'
import { cn } from '@/lib/utils'
import type { Lead, WorkflowField } from '@/mocks/crmMock'
import { sourceLabel } from '@/mocks/crmMock'

const EMPTY_SELECT = '__empty__'

type Props = {
  field: WorkflowField
  lead: Lead
  compact?: boolean
  onChange: (next: Lead) => void
}

export function DynamicFieldRenderer({ field, lead, compact, onChange }: Props) {
  const raw = getLeadFieldValue(lead, field.fieldKey)

  const apply = (value: unknown) => {
    onChange(setLeadFieldValue(lead, field.fieldKey, value))
  }

  const selectTriggerClass = cn(
    'w-full min-w-0 justify-between',
    compact ? 'h-7' : 'h-9'
  )
  const selectSize = compact ? 'sm' : 'default'

  if (field.fieldType === 'select' && field.fieldKey === 'source') {
    const keys = Object.keys(sourceLabel) as Lead['source'][]
    const rawStr = raw == null ? '' : String(raw)
    const value = keys.includes(rawStr as Lead['source']) ? rawStr : keys[0]
    return (
      <div className={compact ? 'contents' : 'grid gap-2'}>
        {!compact ? <Label className="text-xs text-muted-foreground">{field.label}</Label> : null}
        <Select value={value} onValueChange={(v) => v && apply(v)}>
          <SelectTrigger className={selectTriggerClass} size={selectSize}>
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(sourceLabel) as Lead['source'][]).map((key) => (
              <SelectItem key={key} value={key}>
                {sourceLabel[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.fieldType === 'select' && field.options.length > 0) {
    const pairs = normalizeFieldSelectOptions(field.options as unknown[])
    const hasValue = raw !== undefined && raw !== null && String(raw).length > 0
    const rawStr = hasValue ? String(raw) : ''
    const known = pairs.some((p) => p.value === rawStr)
    const selectValue = !hasValue ? EMPTY_SELECT : known ? rawStr : rawStr || EMPTY_SELECT
    return (
      <div className={compact ? 'contents' : 'grid gap-2'}>
        {!compact ? <Label className="text-xs text-muted-foreground">{field.label}</Label> : null}
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (!v) return
            apply(v === EMPTY_SELECT ? '' : v)
          }}
        >
          <SelectTrigger className={selectTriggerClass} size={selectSize}>
            <SelectValue placeholder="Selecionar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY_SELECT}>—</SelectItem>
            {hasValue && !known && rawStr ? (
              <SelectItem value={rawStr}>
                {rawStr} (valor fora da lista)
              </SelectItem>
            ) : null}
            {pairs.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.fieldType === 'number') {
    return (
      <div className={compact ? 'contents' : 'grid gap-2'}>
        {!compact ? <Label className="text-xs text-muted-foreground">{field.label}</Label> : null}
        <Input
          type="number"
          value={raw === undefined || raw === null ? '' : Number(raw)}
          onChange={(e) => apply(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      </div>
    )
  }

  if (field.fieldType === 'date') {
    return (
      <div className={compact ? 'contents' : 'grid gap-2'}>
        {!compact ? <Label className="text-xs text-muted-foreground">{field.label}</Label> : null}
        <Input type="date" value={raw ? String(raw).slice(0, 10) : ''} onChange={(e) => apply(e.target.value)} />
      </div>
    )
  }

  return (
    <div className={compact ? 'contents' : 'grid gap-2'}>
      {!compact ? <Label className="text-xs text-muted-foreground">{field.label}</Label> : null}
      <Input value={raw === undefined || raw === null ? '' : String(raw)} onChange={(e) => apply(e.target.value)} />
    </div>
  )
}
