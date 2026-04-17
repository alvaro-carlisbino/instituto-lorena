import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getLeadFieldValue, setLeadFieldValue } from '@/lib/leadFields'
import type { Lead, WorkflowField } from '@/mocks/crmMock'
import { sourceLabel } from '@/mocks/crmMock'

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

  if (field.fieldType === 'select' && field.fieldKey === 'source') {
    return (
      <div className={compact ? 'contents' : 'grid gap-2'}>
        {!compact ? <Label className="text-xs text-muted-foreground">{field.label}</Label> : null}
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={String(raw ?? '')}
          onChange={(e) => apply(e.target.value)}
        >
          {(Object.keys(sourceLabel) as Lead['source'][]).map((key) => (
            <option key={key} value={key}>
              {sourceLabel[key]}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.fieldType === 'select' && field.options.length > 0) {
    return (
      <div className={compact ? 'contents' : 'grid gap-2'}>
        {!compact ? <Label className="text-xs text-muted-foreground">{field.label}</Label> : null}
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={raw === undefined || raw === null ? '' : String(raw)}
          onChange={(e) => apply(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
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
