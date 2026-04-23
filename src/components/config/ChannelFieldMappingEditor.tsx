import { useMemo, useState } from 'react'
import { Plus, Trash } from 'phosphor-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { WorkflowField } from '@/mocks/crmMock'

const CORE_LEAD_FIELDS: { key: string; label: string; pathHint: string; placeholder: string }[] = [
  {
    key: 'patient_name',
    label: 'Nome do contato',
    pathHint:
      'full_name · name · no Meta/Lead Ads costuma vir em field_data; em webhooks genéricos: entry.0.changes.0.value…',
    placeholder: 'ex.: full_name',
  },
  {
    key: 'phone',
    label: 'Telefone',
    pathHint:
      'phone_number · no WhatsApp Cloud: entry.0.changes.0.value.messages.0.contacts.0.wa_id (varia por versão da API)',
    placeholder: 'ex.: phone_number',
  },
  {
    key: 'source',
    label: 'Origem',
    pathHint: 'source · utm_source · origem (conforme o provedor enviar no aviso)',
    placeholder: 'ex.: source',
  },
  {
    key: 'summary',
    label: 'Resumo',
    pathHint: 'message · text · body · resumo (texto principal da mensagem no aviso)',
    placeholder: 'ex.: text',
  },
  {
    key: 'temperature',
    label: 'Interesse',
    pathHint: 'Campo de interesse/temperatura se o provedor enviar (senão deixe vazio na linha ou use valor fixo no canal)',
    placeholder: 'ex.: temperature',
  },
  {
    key: 'score',
    label: 'Pontuação',
    pathHint: 'score · points · pontuacao (se existir no payload do aviso)',
    placeholder: 'ex.: score',
  },
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

function hintForFieldKey(
  fieldKey: string,
  fieldOptions: { key: string; label: string }[],
): { text: string; placeholder: string } {
  const core = CORE_LEAD_FIELDS.find((f) => f.key === fieldKey)
  if (core) {
    return { text: core.pathHint, placeholder: core.placeholder }
  }
  const wf = fieldOptions.find((f) => f.key === fieldKey)
  if (wf) {
    return {
      text: `Campo personalizado “${wf.label}”: use o caminho no dado recebido (ex.: custom_fields.${fieldKey}).`,
      placeholder: `ex.: custom_fields.${fieldKey}`,
    }
  }
  return {
    text: 'Indique o caminho no aviso, em notação com pontos (ex.: entry.changes.0.value). Uma linha por campo.',
    placeholder: 'ex.: campo.no.aviso',
  }
}

type Props = {
  channelId: string
  fieldMapping: Record<string, string>
  workflowFields: WorkflowField[]
  onApply: (next: Record<string, string>) => void
}

/** Liga campos do cadastro a caminhos no dado bruto de cada aviso (Meta, WhatsApp, URL própria, etc.). */
export function ChannelFieldMappingEditor({ channelId, fieldMapping, workflowFields, onApply }: Props) {
  const [rows, setRows] = useState<Row[]>(() => rowsFromMapping(fieldMapping))
  const [message, setMessage] = useState<string>('')

  const fieldOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { key: string; label: string }[] = []
    for (const o of CORE_LEAD_FIELDS) {
      if (!seen.has(o.key)) {
        seen.add(o.key)
        opts.push({ key: o.key, label: o.label })
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
    <div
      className={cn(
        'grid gap-4 rounded-2xl border border-border/60 bg-gradient-to-b from-card to-muted/20 p-4 shadow-sm',
        'sm:p-5',
      )}
    >
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
        Indique <strong className="font-medium text-foreground">onde cada dado chega</strong> no aviso do canal. Use
        notação com pontos (ex.: <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs">entry.changes.0.value</code>
        ), <strong className="font-medium text-foreground">uma linha por campo</strong> — não é necessário colar o JSON
        inteiro.
      </p>
      <ul className="m-0 list-none space-y-3 p-0">
        {rows.map((row, index) => {
          const { text: guideText, placeholder } = hintForFieldKey(row.fieldKey, fieldOptions)
          return (
            <li
              key={`${channelId}-row-${index}`}
              className="rounded-xl border border-border/50 bg-card/80 p-3 shadow-sm sm:p-4"
            >
              <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] min-[480px]:items-end">
                <div className="grid min-w-0 gap-1.5">
                  <Label className="text-xs font-medium">Campo no cadastro</Label>
                  <select
                    className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30"
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
                <div className="grid min-w-0 gap-1.5">
                  <Label className="text-xs font-medium">Caminho no dado recebido</Label>
                  <Input
                    value={row.path}
                    onChange={(e) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, path: e.target.value } : r)))}
                    placeholder={placeholder}
                    className="h-10 w-full min-w-0 font-mono text-sm"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <p className="mt-2.5 m-0 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
                <span className="font-medium text-foreground/90">Onde costuma vir: </span>
                {guideText}
              </p>
              <div className="mt-3 flex justify-stretch min-[480px]:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full min-[480px]:w-auto text-muted-foreground"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                  disabled={rows.length <= 1}
                >
                  <Trash className="mr-1.5 size-4 opacity-70" weight="duotone" />
                  Remover linha
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => setRows((prev) => [...prev, { fieldKey: fieldOptions[0]?.key ?? 'patient_name', path: '' }])}
        >
          <Plus className="mr-1.5 size-4" weight="bold" />
          Adicionar linha
        </Button>
        <Button type="button" size="sm" className="w-full sm:w-auto" onClick={apply}>
          Salvar mapeamento
        </Button>
      </div>
      {message ? <p className="m-0 text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}
