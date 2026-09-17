import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Layers, Pencil, Plus, Printer, SprayCan, Trash2, TriangleAlert } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { formatQtd, itemEhEscolha, ordenarPorNome } from '@/components/kits/kitUi'
import { cn } from '@/lib/utils'
import type { StockItem } from '@/services/estoqueCompras'
import { type KitTemplate, deactivateKitTemplate, imprimirFolhaDeItens } from '@/services/estoqueKits'

export function ModelosKit({
  templates,
  items,
  onMudou,
}: {
  templates: KitTemplate[]
  items: StockItem[]
  onMudou: () => void
}) {
  const [desativando, setDesativando] = useState<KitTemplate | null>(null)
  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])

  const desativar = async (t: KitTemplate) => {
    setDesativando(null)
    try {
      await deactivateKitTemplate(t.id)
      toast.success(`Modelo "${t.name}" desativado. Kits já montados não mudam.`)
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desativar')
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">O modelo é a lista padrão da bandeja. Na montagem dá para ajustar tudo.</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Link to="/kits/consumo-do-setor" className={buttonVariants({ variant: 'outline' })}>
            <SprayCan className="size-4" aria-hidden /> Consumo do setor
          </Link>
          <Link to="/kits/modelos/novo" className={buttonVariants()}>
            <Plus className="size-4" aria-hidden /> Novo modelo
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState icon={Layers} title="Nenhum modelo de kit" description="Crie o primeiro modelo com os itens que vão na bandeja." />
      ) : (
        <ul className="space-y-2.5">
          {templates.map((t) => {
            const escolhas = t.items.filter((i) => itemEhEscolha(porId.get(i.itemId)?.name)).length
            const semSaldo = t.items.filter((i) => (porId.get(i.itemId)?.qty ?? 0) < i.qty).length
            const kitsPossiveis = t.items.length
              ? Math.max(0, Math.min(...t.items.map((i) => Math.floor((porId.get(i.itemId)?.qty ?? 0) / (i.qty || 1)))))
              : 0
            return (
              <li key={t.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {t.name}
                      {t.setor ? (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {t.setor === 'spa' ? 'SPA' : 'Centro cirúrgico'}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.items.length} itens · dá para montar {kitsPossiveis} com o saldo atual
                    </p>
                    {semSaldo > 0 || escolhas > 0 ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                        <TriangleAlert className="size-3.5" aria-hidden />
                        {[
                          semSaldo > 0 ? `${semSaldo} sem saldo para 1 kit` : null,
                          escolhas > 0 ? `${escolhas} para escolher na montagem` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : null}
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                      {ordenarPorNome(t.items, (i) => porId.get(i.itemId)?.name)
                        .map((i) => `${formatQtd(i.qty)}× ${porId.get(i.itemId)?.name ?? '?'}`)
                        .join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() =>
                        void imprimirFolhaDeItens({ kitNome: t.name, linhas: t.items, itens: new Map(items.map((i) => [i.id, { name: i.name, controlled: i.controlled, category: i.category }] as const)) }).catch((e) =>
                          toast.error(e instanceof Error ? e.message : 'Falha ao imprimir'),
                        )
                      }
                    >
                      <Printer className="size-3.5" aria-hidden /> Imprimir
                    </Button>
                    <Link to={`/kits/modelos/${t.id}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8')}>
                      <Pencil className="size-3.5" aria-hidden /> Editar
                    </Link>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setDesativando(t)} aria-label={`Desativar ${t.name}`}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={desativando != null}
        onOpenChange={(open) => !open && setDesativando(null)}
        title="Desativar modelo?"
        description="O modelo some da montagem. Kits já montados com ele continuam como estão."
        confirmLabel="Desativar"
        onConfirm={() => desativando && void desativar(desativando)}
      />
    </div>
  )
}
