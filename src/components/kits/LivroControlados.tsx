import { useDeferredValue, useState } from 'react'
import { ShieldAlert } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { formatQtd } from '@/components/kits/kitUi'
import { combinaBusca } from '@/lib/busca'
import { cn } from '@/lib/utils'
import type { ControlledLogRow } from '@/services/estoqueKits'

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

type Sentido = 'tudo' | 'saida' | 'entrada'

export function LivroControlados({ rows, nomes }: { rows: ControlledLogRow[]; nomes: Map<string, string> }) {
  const [busca, setBusca] = useState('')
  const termo = useDeferredValue(busca)
  const [sentido, setSentido] = useState<Sentido>('tudo')
  // Remédio, paciente, observação ou dia ("fentanil", "closneir", "22/09").
  const visiveis = rows.filter(
    (r) =>
      (sentido === 'tudo' || r.action === sentido) &&
      combinaBusca(termo, nomes.get(r.itemId), r.patientName, r.note, quando(r.createdAt)),
  )

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
    <div className="mx-auto w-full max-w-3xl space-y-2">
      <SearchField value={busca} onChange={setBusca} label="Buscar remédio, paciente ou dia" resultados={termo ? visiveis.length : undefined} />
      <div className="flex gap-1.5" role="group" aria-label="Entradas ou saídas">
        {(
          [
            ['tudo', 'Tudo'],
            ['saida', 'Saídas'],
            ['entrada', 'Entradas'],
          ] as Array<[Sentido, string]>
        ).map(([s, rotulo]) => (
          <button
            key={s}
            type="button"
            aria-pressed={sentido === s}
            onClick={() => setSentido(s)}
            className={cn(
              'min-h-9 rounded-full border px-3 text-xs font-medium',
              sentido === s ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {visiveis.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          Nada com esse filtro.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {visiveis.map((row) => {
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
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{quando(row.createdAt)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
