import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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

function fieldControlId(field: WorkflowField): string {
  return `wf-${field.id}`
}

function FieldBlock({
  field,
  compact,
  children,
  layout = 'stack',
}: {
  field: WorkflowField
  compact?: boolean
  children: React.ReactNode
  layout?: 'stack' | 'boolean-row'
}) {
  if (layout === 'boolean-row') {
    return (
      <div
        className={cn(
          'flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/90 p-2.5 shadow-sm ring-1 ring-black/[0.04] dark:border-border dark:bg-muted/15 dark:ring-white/[0.06]',
          !compact && 'mt-1 border-border/80 bg-transparent p-0 shadow-none ring-0',
        )}
      >
        <Label
          htmlFor={fieldControlId(field)}
          className={cn('cursor-pointer font-medium text-foreground', compact ? 'text-xs leading-snug' : 'text-sm')}
        >
          {field.label}
          {field.required ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
        {children}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'min-w-0 flex flex-col gap-1.5',
        compact &&
          'rounded-lg border border-border/60 bg-background/90 p-2.5 shadow-sm ring-1 ring-black/[0.04] dark:border-border dark:bg-muted/15 dark:ring-white/[0.06]',
      )}
    >
      <Label
        htmlFor={fieldControlId(field)}
        className={cn(
          'font-medium leading-snug text-foreground',
          compact ? 'text-xs' : 'text-xs text-muted-foreground',
        )}
      >
        {field.label}
        {field.required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  )
}

export function DynamicFieldRenderer({ field, lead, compact, onChange }: Props) {
  const raw = getLeadFieldValue(lead, field.fieldKey)
  const controlId = fieldControlId(field)

  const apply = (value: unknown) => {
    onChange(setLeadFieldValue(lead, field.fieldKey, value))
  }

  const selectTriggerClass = cn(
    'w-full min-w-0 max-w-full justify-between [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate',
    compact ? 'h-8' : 'h-9',
  )
  const selectSize = compact ? 'sm' : 'default'

  if (field.fieldType === 'select' && field.fieldKey === 'source') {
    const keys = Object.keys(sourceLabel) as Lead['source'][]
    const rawStr = raw == null ? '' : String(raw)
    const value = keys.includes(rawStr as Lead['source']) ? rawStr : keys[0]
    const selectedSourceLabel = sourceLabel[value as Lead['source']] ?? 'Origem'
    return (
      <FieldBlock field={field} compact={compact}>
        <Select value={value} onValueChange={(v) => v && apply(v)}>
          <SelectTrigger id={controlId} className={selectTriggerClass} size={selectSize}>
            <SelectValue>{selectedSourceLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(sourceLabel) as Lead['source'][]).map((key) => (
              <SelectItem key={key} value={key}>
                {sourceLabel[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldBlock>
    )
  }

  if (field.fieldType === 'select' && field.options.length > 0) {
    const pairs = normalizeFieldSelectOptions(field.options as unknown[])
    const hasValue = raw !== undefined && raw !== null && String(raw).length > 0
    const rawStr = hasValue ? String(raw) : ''
    const known = pairs.some((p) => p.value === rawStr)
    const selectValue = !hasValue ? EMPTY_SELECT : known ? rawStr : rawStr || EMPTY_SELECT
    const selectedOptionLabel = !hasValue
      ? '—'
      : pairs.find((p) => p.value === rawStr)?.label ?? `${rawStr} (valor fora da lista)`
    return (
      <FieldBlock field={field} compact={compact}>
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (!v) return
            apply(v === EMPTY_SELECT ? '' : v)
          }}
        >
          <SelectTrigger id={controlId} className={selectTriggerClass} size={selectSize}>
            <SelectValue>{selectedOptionLabel}</SelectValue>
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
      </FieldBlock>
    )
  }

  if (field.fieldType === 'number') {
    const numVal = raw === undefined || raw === null ? '' : String(raw)
    return (
      <FieldBlock field={field} compact={compact}>
        <Input
          id={controlId}
          type="number"
          inputMode="decimal"
          className="h-9 font-mono text-sm tabular-nums"
          value={numVal}
          onChange={(e) => {
            const v = e.target.value
            apply(v === '' ? '' : Number(v))
          }}
        />
      </FieldBlock>
    )
  }

  if (field.fieldType === 'date') {
    return (
      <FieldBlock field={field} compact={compact}>
        <Input
          id={controlId}
          type="date"
          className="h-9 font-mono text-sm"
          value={raw ? String(raw).slice(0, 10) : ''}
          onChange={(e) => apply(e.target.value)}
        />
      </FieldBlock>
    )
  }

  if (field.fieldType === 'boolean') {
    const isChecked = Boolean(raw === 'true' || raw === true || raw === 1)
    if (compact) {
      return (
        <FieldBlock field={field} compact layout="boolean-row">
          <Switch id={controlId} checked={isChecked} onCheckedChange={(checked) => apply(checked)} />
        </FieldBlock>
      )
    }
    return (
      <div className="mt-1 flex items-center gap-3">
        <Label htmlFor={controlId} className="cursor-pointer text-sm font-medium">
          {field.label}
        </Label>
        <Switch id={controlId} checked={isChecked} onCheckedChange={(checked) => apply(checked)} />
      </div>
    )
  }

  return (
    <FieldBlock field={field} compact={compact}>
      <Input
        id={controlId}
        className="min-h-9 text-sm"
        value={raw === undefined || raw === null ? '' : String(raw)}
        onChange={(e) => apply(e.target.value)}
      />
    </FieldBlock>
  )
}
