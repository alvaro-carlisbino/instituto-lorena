import { ShieldAlert } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { formatQtd } from '@/components/kits/kitUi'
import { cn } from '@/lib/utils'
import type { ControlledLogRow } from '@/services/estoqueKits'

export function LivroControlados({ rows, nomes }: { rows: ControlledLogRow[]; nomes: Map<string, string> }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Sem movimentos de controlados"
        description="Marque o item como controlado no cadastro do estoque para rastrear entrada, saída e devolução aqui."
      />
    )
  }
  return (
    <ul className="mx-auto w-full max-w-3xl divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((row) => {
        const saida = row.action === 'saida'
        return (
          <li key={row.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
            <span
              className={cn(
                'w-14 shrink-0 text-right text-sm font-semibold tabular-nums',
                saida ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300',
              )}
            >
              {saida ? '−' : '+'}
              {formatQtd(row.qty)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug">{nomes.get(row.itemId) ?? '?'}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[row.patientName, row.note].filter(Boolean).join(' · ') || (saida ? 'Saída' : 'Entrada')}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {new Date(row.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
