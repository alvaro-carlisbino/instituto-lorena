import { memo } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'

import { PaymentBadge, PoloBadge } from '@/components/leads/PaymentBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TableCell, TableRow } from '@/components/ui/table'
import { sourceLabel } from '@/hooks/useCrmState'
import { formatTemperature } from '@/lib/fieldLabels'
import { getLeadFieldValue } from '@/lib/leadFields'
import { LEAD_CARD_HEIGHT, LEAD_TABLE_ROW_HEIGHT, temperatureBadgeClass } from '@/lib/leadRowStyles'
import { cn } from '@/lib/utils'
import type { Lead } from '@/mocks/crmMock'
import type { LeadPaymentSummary } from '@/services/crmLeadPayments'

type RowProps = {
  lead: Lead
  columns: readonly string[]
  pipelineName: string
  stageName: string
  ownerName: string
  payment: LeadPaymentSummary | null
  poloName?: string
  selected: boolean
  onToggle: (leadId: string) => void
  onOpen: (leadId: string) => void
}

/**
 * `memo` aqui é o que sustenta a tela viva: chega mensagem, o estado dos leads é
 * reconstruído, mas só o lead que mudou tem objeto novo — todas as outras linhas
 * recebem exatamente as mesmas props e o React pula o re-render delas.
 */
export const LeadTableRow = memo(function LeadTableRow({
  lead,
  columns,
  pipelineName,
  stageName,
  ownerName,
  payment,
  poloName,
  selected,
  onToggle,
  onOpen,
}: RowProps) {
  return (
    <TableRow
      style={{ height: LEAD_TABLE_ROW_HEIGHT }}
      className={cn(
        'group cursor-pointer transition-colors',
        selected ? 'bg-primary/[0.03]' : 'hover:bg-muted/20',
      )}
      onClick={() => onOpen(lead.id)}
    >
      <TableCell className="py-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center">
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(lead.id)}
            aria-label={`Selecionar ${lead.patientName}`}
            className="size-4 rounded border-border/40"
          />
        </div>
      </TableCell>
      {columns.map((col) => (
        <TableCell key={col} className="py-0">
          {col === 'patient_name' && (
            // Nome e etiquetas na MESMA linha: empilhados, cada lead custava
            // duas alturas de texto mesmo quando não havia etiqueta nenhuma.
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-foreground/90 transition-colors group-hover:text-primary">
                {lead.patientName}
              </span>
              <PoloBadge name={poloName} />
              <PaymentBadge payment={payment} />
            </div>
          )}
          {col === 'phone' && (
            <span className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">{lead.phone}</span>
          )}
          {col === 'summary' && (
            <span className="line-clamp-1 text-xs text-muted-foreground/70">{lead.summary || '·'}</span>
          )}
          {col === 'pipeline_id' && <span className="line-clamp-1 text-xs text-muted-foreground">{pipelineName}</span>}
          {col === 'stage_id' && <span className="line-clamp-1 text-xs text-muted-foreground">{stageName}</span>}
          {col === 'owner_id' && <span className="line-clamp-1 text-xs text-muted-foreground">{ownerName}</span>}
          {col === 'source' && (
            <Badge
              variant="secondary"
              className="rounded-md border-border/20 bg-muted/40 text-[9px] font-semibold uppercase tracking-tight text-muted-foreground/80"
            >
              {sourceLabel[lead.source]}
            </Badge>
          )}
          {col === 'temperature' && (
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                temperatureBadgeClass(lead.temperature),
              )}
            >
              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
            </span>
          )}
          {!['patient_name', 'phone', 'summary', 'pipeline_id', 'stage_id', 'owner_id', 'source', 'temperature'].includes(
            col,
          ) && (
            <span className="text-xs font-medium text-muted-foreground/60">
              {String(getLeadFieldValue(lead, col) ?? '·')}
            </span>
          )}
        </TableCell>
      ))}
      <TableCell className="py-0 text-right" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={
            <Link to={`/chat?leadId=${encodeURIComponent(lead.id)}`} aria-label={`Abrir conversa com ${lead.patientName}`} />
          }
          className="size-7 rounded-lg bg-primary/[0.08] text-primary transition-colors hover:bg-primary/20 hover:text-primary"
        >
          <MessageCircle className="size-4" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  )
})

type CardProps = Omit<RowProps, 'columns' | 'pipelineName' | 'ownerName'>

export const LeadCard = memo(function LeadCard({
  lead,
  stageName,
  payment,
  poloName,
  selected,
  onToggle,
  onOpen,
}: CardProps) {
  return (
    <li
      style={{ height: LEAD_CARD_HEIGHT }}
      className="overflow-hidden px-3 py-2.5 transition-colors active:bg-muted/20"
    >
      <div className="flex items-start gap-2.5">
        {/* shrink-0 no EMBRULHO, não só no Checkbox: o filho tem shrink-0, mas
            quem é item do flex é esta div, e sem isso ela era espremida a 2px de
            largura pelo texto ao lado. No celular ninguém conseguia selecionar. */}
        <div className="shrink-0 pt-0.5">
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(lead.id)}
            aria-label={`Selecionar ${lead.patientName}`}
            className="size-5 rounded-md border-border/40"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpen(lead.id)}
          className="block h-auto min-w-0 flex-1 whitespace-normal rounded-none border-0 p-0 text-left font-normal hover:bg-transparent hover:text-foreground"
        >
          {/* Nome e telefone na mesma linha: o telefone é o que a atendente lê
              para ligar, não precisa de linha própria nem de negrito. */}
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="truncate text-sm font-semibold leading-tight text-foreground">{lead.patientName}</h3>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{lead.phone}</span>
          </div>
          {/* O resumo ocupa a linha mesmo vazio (o '·'): a virtualização depende de
              todo cartão ter a mesma altura, e sem isso quem não tem resumo encolhia
              e desalinhava a rolagem. */}
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">{lead.summary || '·'}</p>
          <div className="mt-1.5 flex flex-nowrap items-center gap-1 overflow-hidden">
            <PoloBadge name={poloName} />
            <PaymentBadge payment={payment} />
            <Badge
              variant="outline"
              className="shrink-0 rounded border-border/40 text-[9px] font-semibold uppercase tracking-tight"
            >
              {stageName}
            </Badge>
            <Badge
              variant="secondary"
              className="shrink-0 rounded bg-muted/40 text-[9px] font-semibold uppercase tracking-tight text-muted-foreground"
            >
              {sourceLabel[lead.source]}
            </Badge>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                temperatureBadgeClass(lead.temperature),
              )}
            >
              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
            </span>
          </div>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={
            <Link to={`/chat?leadId=${encodeURIComponent(lead.id)}`} aria-label={`Abrir conversa com ${lead.patientName}`} />
          }
          className="size-10 shrink-0 rounded-xl bg-primary/[0.08] text-primary transition-colors hover:bg-primary/20 hover:text-primary active:scale-95"
        >
          <MessageCircle className="size-5" aria-hidden />
        </Button>
      </div>
    </li>
  )
})
