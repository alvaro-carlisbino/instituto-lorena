import { useMemo, useState } from 'react'
import { CaretRight, Plus, Trash } from 'phosphor-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { WorkflowField } from '@/mocks/crmMock'

/** Dica curta (equipe geral) + detalhe técnico (só na área colapsável). */
const CORE_LEAD_FIELDS: {
  key: string
  label: string
  pathHintSimple: string
  pathHintTechnical: string
  placeholder: string
}[] = [
  {
    key: 'patient_name',
    label: 'Nome do contato',
    pathHintSimple: 'O nome costuma vir em um campo como full_name ou name no aviso do canal.',
    pathHintTechnical:
      'Meta Lead Ads: field_data com nome. Webhooks genéricos: muitas vezes em entry.0.changes.0.value (estrutura varia).',
    placeholder: 'ex.: full_name',
  },
  {
    key: 'phone',
    label: 'Telefone',
    pathHintSimple: 'O telefone em geral vem como phone_number ou em campo parecido no aviso.',
    pathHintTechnical:
      'WhatsApp Cloud API: caminhos longos como entry.0.changes.0.value.messages.0... (varia com a versão do aviso).',
    placeholder: 'ex.: phone_number',
  },
  {
    key: 'source',
    label: 'Origem',
    pathHintSimple: 'A origem pode vir em source, utm_source ou nome definido pelo provedor.',
    pathHintTechnical: 'Ajuste ao formato exato do aviso (planilha de integração do fornecedor).',
    placeholder: 'ex.: source',
  },
  {
    key: 'summary',
    label: 'Resumo',
    pathHintSimple: 'O texto do contato costuma vir em message, text ou body.',
    pathHintTechnical: 'Caminho depende do corpo do aviso (ver documentação do canal).',
    placeholder: 'ex.: text',
  },
  {
    key: 'temperature',
    label: 'Interesse',
    pathHintSimple: 'Só preencha se o aviso traz um campo de interesse/temperatura; senão deixe vazio ou peça suporte à TI.',
    pathHintTechnical: 'Nome exato do campo no objeto recebido (pontos para níveis, ex.: parent.child).',
    placeholder: 'ex.: temperature',
  },
  {
    key: 'score',
    label: 'Pontuação',
    pathHintSimple: 'Se o canal envia pontuação, use o nome do campo correspondente (score, points, etc.).',
    pathHintTechnical: 'Caminho no objeto do aviso onde vem a pontuação, se existir.',
    placeholder: 'ex.: score',
  },
]

const TECHNICAL_REFERENCE: { title: string; code: string }[] = [
  { title: 'Aviso cujo dado fica em entry.changes[0].value (comum em integrações por URL):', code: 'entry.0.changes.0.value' },
  { title: 'Apenas o identificador do nome (formulário / aviso):', code: 'full_name' },
  { title: 'Apenas o identificador do telefone (formulário / aviso):', code: 'phone_number' },
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
    return {
      text: core.pathHintSimple,
      placeholder: core.placeholder,
    }
  }
  const wf = fieldOptions.find((f) => f.key === fieldKey)
  if (wf) {
    return {
      text: `Campo “${wf.label}”: o nome no aviso costuma lembrar o código do campo. A equipe de integração ajuda a confirmar o caminho exato (ex.: custom_fields.${fieldKey}).`,
      placeholder: `ex.: custom_fields.${fieldKey}`,
    }
  }
  return {
    text: 'Preencha o que o aviso traz com esse dado, usando ponto se for um caminho (ex.: parte1.parte2).',
    placeholder: 'ex.: campo.no.aviso',
  }
}

type Props = {
  channelId: string
  fieldMapping: Record<string, string>
  workflowFields: WorkflowField[]
  onApply: (next: Record<string, string>) => void
}

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
      setMessage('Cada linha com campo escolhido precisa do caminho preenchido à direita.')
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
        Aqui a equipe liga o que o <strong className="font-medium text-foreground">cadastro</strong> do lead a como o
        dado <strong className="font-medium text-foreground">chega no aviso do canal</strong> (o pacote de informação
        após o envio de formulário, WhatsApp, etc.). Preencha uma linha por campo, com o <strong
          className="font-medium text-foreground"
        >
          nome do campo no aviso
        </strong>
        &nbsp;(às vezes em forma de <span className="whitespace-nowrap">parte1.parte2</span>).
      </p>

      <details className="group rounded-xl border border-border/50 bg-muted/25 px-3 py-2 text-left text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-foreground/90">
          <CaretRight className="size-4 shrink-0 transition group-open:rotate-90" weight="bold" />
          <span>Referência técnica (integração / API / formato do aviso)</span>
        </summary>
        <div className="mt-2 space-y-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          <p className="m-0">
            Para integração, apoio de TI. Não é preciso colar o arquivo completo: só o caminho até o valor (notação com
            pontos). Em guias técnicos isso costuma ser chamado de JSON ou payload; aqui basta o trecho com o dado.
          </p>
          <ul className="m-0 list-none space-y-2 p-0">
            {CORE_LEAD_FIELDS.map((f) => (
              <li key={f.key} className="rounded-md bg-background/80 px-2 py-1.5">
                <span className="font-medium text-foreground">{f.label}:</span> {f.pathHintTechnical}
              </li>
            ))}
            {TECHNICAL_REFERENCE.map((ref) => (
              <li key={ref.title} className="rounded-md bg-background/80 px-2 py-1.5">
                <p className="m-0 mb-1 text-[11px] text-muted-foreground">{ref.title}</p>
                <code className="block w-full break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">{ref.code}</code>
              </li>
            ))}
          </ul>
        </div>
      </details>

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
                  <Label className="text-xs font-medium">Nome do campo no aviso</Label>
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
                <span className="font-medium text-foreground/90">Dica: </span>
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
