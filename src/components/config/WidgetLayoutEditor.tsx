import { Label } from '@/components/ui/label'

type LayoutMode = 'auto' | 'grid'

function readLayout(layout: Record<string, unknown> | undefined): { mode: LayoutMode; col: number; row: number; span: number } {
  const g = layout && typeof layout === 'object' ? String((layout as { grid?: unknown }).grid ?? '') : ''
  const mode: LayoutMode = g === 'legacy' || !layout || Object.keys(layout).length === 0 ? 'auto' : 'grid'
  const col = typeof layout?.col === 'number' ? layout.col : Number(layout?.col) || 1
  const row = typeof layout?.row === 'number' ? layout.row : Number(layout?.row) || 1
  const span = typeof layout?.span === 'number' ? layout.span : Number(layout?.span) || 1
  return { mode, col: Math.min(12, Math.max(1, col)), row: Math.max(1, row), span: Math.min(12, Math.max(1, span)) }
}

function buildLayout(mode: LayoutMode, col: number, row: number, span: number): Record<string, unknown> {
  if (mode === 'auto') {
    return { grid: 'legacy', col: 1, row: 1, span: 1 }
  }
  return { grid: '12col', col, row, span }
}

type Props = {
  layout: Record<string, unknown>
  onLayoutChange: (next: Record<string, unknown>) => void
  helpId: string
}

/** Controle simples da grade do painel TV. */
export function WidgetLayoutEditor({ layout, onLayoutChange, helpId }: Props) {
  const { mode, col, row, span } = readLayout(layout)

  return (
    <div className="grid gap-3 rounded-lg border border-border/80 bg-muted/20 p-3">
      <p id={helpId} className="text-xs text-muted-foreground">
        Na grade de 12 colunas, defina em que célula o bloco aparece. Em modo automático, o painel reparte o espaço sozinho.
      </p>
      <div className="grid gap-2">
        <Label className="text-xs font-medium">Posição no painel</Label>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-describedby={helpId}
          value={mode}
          onChange={(e) => {
            const nextMode = e.target.value as LayoutMode
            onLayoutChange(buildLayout(nextMode, col, row, span))
          }}
        >
          <option value="auto">Automático (reparte o espaço)</option>
          <option value="grid">Grade personalizada (12 colunas)</option>
        </select>
      </div>
      {mode === 'grid' ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Coluna (1–12)</Label>
            <input
              type="number"
              min={1}
              max={12}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={col}
              onChange={(e) => {
                const v = Math.min(12, Math.max(1, Number(e.target.value) || 1))
                onLayoutChange(buildLayout('grid', v, row, span))
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Linha (≥1)</Label>
            <input
              type="number"
              min={1}
              max={99}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={row}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value) || 1)
                onLayoutChange(buildLayout('grid', col, v, span))
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Largura (span 1–12)</Label>
            <input
              type="number"
              min={1}
              max={12}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={span}
              onChange={(e) => {
                const v = Math.min(12, Math.max(1, Number(e.target.value) || 1))
                onLayoutChange(buildLayout('grid', col, row, v))
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
