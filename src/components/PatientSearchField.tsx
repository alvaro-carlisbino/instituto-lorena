import { useEffect, useId, useState } from 'react'
import { Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { searchLeadsByName } from '@/services/clinicalNotes'
import { useTenant } from '@/context/TenantContext'

export type PatientPick = { id: string; name: string; phone: string }

type Props = {
  value?: string
  onPick: (patient: PatientPick) => void
  onClear?: () => void
  picked?: PatientPick | null
  placeholder?: string
  className?: string
  /** default 40 — pensado p/ ~1000 clientes */
  limit?: number
  autoFocus?: boolean
  size?: 'lg' | 'xl'
}

/**
 * Busca de paciente bem grande (as-you-type), pensada p/ volume alto de clientes.
 * Usar em ficha, notas, conta cirúrgica, kits etc.
 */
export function PatientSearchField({
  value,
  onPick,
  onClear,
  picked,
  placeholder = 'Buscar paciente pelo nome ou telefone…',
  className,
  limit = 40,
  autoFocus,
  size = 'xl',
}: Props) {
  const { tenant } = useTenant()
  const listId = useId()
  const [term, setTerm] = useState(value ?? picked?.name ?? '')
  const [results, setResults] = useState<PatientPick[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (picked) setTerm(picked.name)
  }, [picked])

  useEffect(() => {
    if (picked) {
      setResults([])
      return
    }
    const q = term.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(() => {
      searchLeadsByName(tenant.id, q, limit)
        .then((r) => {
          if (!cancelled) setResults(r)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [term, picked, tenant.id, limit])

  const inputH = size === 'xl' ? 'h-14 text-base' : 'h-12 text-sm'

  return (
    <div className={cn('w-full', className)}>
      <div className="relative">
        <Search
          className={cn(
            'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground',
            size === 'xl' ? 'size-5' : 'size-4',
          )}
          aria-hidden
        />
        <Input
          type="search"
          autoFocus={autoFocus}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value)
            if (picked && onClear) onClear()
          }}
          placeholder={placeholder}
          aria-label="Buscar paciente"
          aria-autocomplete="list"
          aria-controls={listId}
          className={cn(
            'w-full rounded-2xl border-border/60 bg-muted/20 pl-12 pr-12 font-medium shadow-sm',
            'placeholder:text-muted-foreground/55',
            inputH,
          )}
        />
        {(term || picked) && onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full p-0"
            onClick={() => {
              setTerm('')
              setResults([])
              onClear()
            }}
            aria-label="Limpar busca"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      {!picked && results.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          className="mt-2 max-h-72 overflow-auto rounded-2xl border border-border bg-card shadow-md"
        >
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-4 py-3.5 text-left last:border-0 hover:bg-muted/50"
              onClick={() => {
                onPick(r)
                setTerm(r.name)
                setResults([])
              }}
            >
              <span className="min-w-0 truncate text-base font-semibold">{r.name}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{r.phone || '—'}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!picked && term.trim().length >= 2 && !loading && results.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhum paciente encontrado para “{term.trim()}”.</p>
      ) : null}
    </div>
  )
}
