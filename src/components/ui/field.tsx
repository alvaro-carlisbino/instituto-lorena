import * as React from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FieldContextValue = {
  controlId: string
  descriptionId?: string
  errorId?: string
  error?: string
  inputSize: 'compact' | 'comfortable'
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

function useFieldContext() {
  const ctx = React.useContext(FieldContext)
  if (!ctx) {
    throw new Error('Field components must be used within <Field>')
  }
  return ctx
}

type FieldProps = {
  label: React.ReactNode
  description?: React.ReactNode
  error?: string
  /** compact = altura padrão do design system (listas, CRM); comfortable = fluxos longos e login */
  inputSize?: 'compact' | 'comfortable'
  className?: string
  children: React.ReactNode
}

export function Field({
  label,
  description,
  error,
  inputSize = 'compact',
  className,
  children,
}: FieldProps) {
  const uid = React.useId()
  const controlId = `field-${uid.replace(/:/g, '')}`
  const descriptionId = description ? `${controlId}-description` : undefined
  const errorId = error ? `${controlId}-error` : undefined

  const value = React.useMemo<FieldContextValue>(
    () => ({
      controlId,
      descriptionId,
      errorId,
      error,
      inputSize,
    }),
    [controlId, descriptionId, errorId, error, inputSize]
  )

  return (
    <FieldContext.Provider value={value}>
      <div className={cn('grid gap-2', inputSize === 'comfortable' && 'gap-2.5', className)}>
        <Label htmlFor={controlId}>{label}</Label>
        {description ? (
          <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

const inputSizeClass: Record<FieldContextValue['inputSize'], string> = {
  compact: 'h-8',
  comfortable: 'h-11',
}

type FieldControlProps = React.ComponentProps<typeof Input>

/** Use dentro de Field; aplica id, aria-describedby, aria-invalid e altura conforme inputSize do Field. */
export function FieldControl({ className, ...props }: FieldControlProps) {
  const ctx = useFieldContext()
  const describedBy = [ctx.descriptionId, ctx.error ? ctx.errorId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <Input
      id={ctx.controlId}
      aria-describedby={describedBy}
      aria-invalid={ctx.error ? true : undefined}
      className={cn(inputSizeClass[ctx.inputSize], className)}
      {...props}
    />
  )
}

