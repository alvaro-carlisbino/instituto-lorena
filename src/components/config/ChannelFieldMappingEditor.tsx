import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkflowField } from '@/mocks/crmMock'

const CORE_LEAD_FIELDS: { key: string; label: string }[] = [
  { key: 'patient_name', label: 'Nome do contato' },
  { key: 'phone', label: 'Telefone' },
  { key: 'source', label: 'Origem' },
  { key: 'summary', label: 'Resumo' },
  { key: 'temperature', label: 'Interesse' },
  { key: 'score', label: 'Pontuação' },
]

type Row = { fieldKey: string; path: string }

function rowsFromMapping(mapping: Record<string, string>): Row[] {
  const entries = Object.entries(mapping)
  if (entries.length === 0) return [{ fieldKey: 'patient_name', path: '' }]
  return entries.map(([fieldKey, path]) => ({ fieldKey, path }))
}

function mappingFromRows(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.fieldKey.trim()
    const p = r.path.trim()
    if (k && p) out[k] = p
  }
  return out
}

type Props = {
  channelId: string
  fieldMapping: Record<string, string>
  workflowFields: WorkflowField[]
  onApply: (next: Record<string, string>) => void
}

/** Liga campos do CRM a caminhos no payload do webhook, sem JSON. */
export function ChannelFieldMappingEditor({ channelId, fieldMapping, workflowFields, onApply }: Props) {
  const [rows, setRows] = useState<Row[]>(() => rowsFromMapping(fieldMapping))
  const [message, setMessage] = useState<string>('')

  const fieldOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { key: string; label: string }[] = []
    for (const o of CORE_LEAD_FIELDS) {
      if (!seen.has(o.key)) {
        seen.add(o.key)
        opts.push(o)
      }
    }
    for (const f of workflowFields) {
      if (!seen.has(f.fieldKey)) {
        seen.add(f.fieldKey)
        opts.push({ key: f.fieldKey, label: f.label })
      }
    }
    return opts
  }, [workflowFields])

  const apply = () => {
    const next = mappingFromRows(rows)
    const invalid = rows.some((r) => r.fieldKey.trim() && !r.path.trim())
    if (invalid) {
      setMessage('Cada campo escolhido precisa de um caminho no dado recebido (texto à direita).')
      return
    }
    setMessage('Mapeamento salvo.')
    onApply(next)
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border/80 bg-muted/15 p-3">
      <p className="text-xs text-muted-foreground">
        Indique onde cada dado chega no aviso do canal (ex.: <code className="rounded bg-muted px-1">entry.changes.0.value</code>).
        Use uma linha por campo — não é necessário JSON completo.
      </p>
      <ul className="m-0 list-none space-y-2 p-0">
        {rows.map((row, index) => (
          <li key={`${channelId}-row-${index}`} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="grid min-w-0 flex-1 gap-1">
              <Label className="text-xs">Campo no CRM</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={row.fieldKey}
                onChange={(e) => {
                  const v = e.target.value
                  setRows((prev) => prev.map((r, i) => (i === index ? { ...r, fieldKey: v } : r)))
                }}
              >
                {fieldOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-0 flex-[2] gap-1">
              <Label className="text-xs">Caminho no dado recebido</Label>
              <Input
                value={row.path}
                onChange={(e) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, path: e.target.value } : r)))}
                placeholder="ex.: entry.messaging.0.message.text"
                className="text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
              disabled={rows.length <= 1}
            >
              Remover linha
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows((prev) => [...prev, { fieldKey: fieldOptions[0]?.key ?? 'patient_name', path: '' }])}
        >
          Adicionar linha
        </Button>
        <Button type="button" size="sm" onClick={apply}>
          Salvar mapeamento
        </Button>
      </div>
      {message ? <p className="m-0 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}
