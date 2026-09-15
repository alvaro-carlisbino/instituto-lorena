import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { type StockItem, vincularCodigoAoItem } from '@/services/estoqueCompras'
import { cn } from '@/lib/utils'

const normalizar = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Código bipado que nenhum item conhece. A contagem de 14/09 cadastrou os itens pelo nome da
 * enfermagem, quase todos sem código, então no começo este dialog aparece muito: escolher o
 * item uma vez ensina o código, e o próximo bipe do mesmo produto já cai direto.
 */
export function VincularCodigoDialog({
  codigo,
  itens,
  onClose,
  onVinculado,
  titulo = 'Código não cadastrado',
}: {
  codigo: string | null
  /** Onde procurar: o estoque todo na montagem, só as linhas do kit na devolução. */
  itens: StockItem[]
  onClose: () => void
  onVinculado: (item: StockItem) => void
  titulo?: string
}) {
  const [termo, setTermo] = useState('')
  const [salvando, setSalvando] = useState<string | null>(null)

  const resultados = useMemo(() => {
    const q = normalizar(termo.trim())
    const base = q ? itens.filter((i) => normalizar(`${i.name} ${i.category ?? ''} ${i.sku ?? ''}`).includes(q)) : itens
    return base.slice(0, 60)
  }, [itens, termo])

  const vincular = async (item: StockItem) => {
    if (!codigo) return
    setSalvando(item.id)
    try {
      const atualizado = await vincularCodigoAoItem(item, codigo)
      toast.success(`Código salvo em "${item.name}". Da próxima vez ele entra direto.`)
      setTermo('')
      onVinculado(atualizado)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar o código')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <Dialog
      open={codigo != null}
      onOpenChange={(open) => {
        if (!open) {
          setTermo('')
          onClose()
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            O código <span className="font-mono text-foreground">{codigo}</span> ainda não pertence a nenhum item. Escolha
            qual produto é este.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Nome do produto…"
            aria-label="Buscar produto"
            className="h-10 pl-9 text-base sm:text-sm"
          />
        </div>
        <div className="max-h-[50dvh] overflow-y-auto rounded-md border border-border">
          {resultados.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum item com esse nome.</p>
          ) : (
            resultados.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={salvando != null}
                onClick={() => void vincular(item)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 text-left last:border-0 hover:bg-muted disabled:opacity-60',
                  salvando === item.id && 'bg-muted',
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[item.barcode ? 'já tem código' : 'sem código', item.category].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {salvando === item.id ? 'Salvando…' : `${item.qty} ${item.unit}`}
                </span>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Ignorar este bipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
