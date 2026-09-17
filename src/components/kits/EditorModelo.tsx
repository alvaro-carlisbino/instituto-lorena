import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { SearchPicker } from '@/components/ui/search-picker'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, itemEhEscolha, ordenarPorNome, produtosParaBusca, semCodigoBipado } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { cn } from '@/lib/utils'
import type { StockItem } from '@/services/estoqueCompras'
import { type KitTemplate, createKitTemplate, updateKitTemplate } from '@/services/estoqueKits'

type Linha = { itemId: string; qty: number }

/** Lista padrão da bandeja, numa tela própria (era um popup). Bipar de novo soma +1. */
export function EditorModelo({
  modelo,
  items,
  voltarPara,
  onSalvo,
  onItemAtualizado,
}: {
  /** null = modelo novo. */
  modelo: KitTemplate | null
  items: StockItem[]
  voltarPara: string
  onSalvo: () => void
  onItemAtualizado: (item: StockItem) => void
}) {
  const [nome, setNome] = useState(modelo?.name ?? '')
  const [linhas, setLinhas] = useState<Linha[]>(() => (modelo?.items ?? []).map((i) => ({ itemId: i.itemId, qty: i.qty })))
  const [codigo, setCodigo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [pesquisa, setPesquisa] = useState('')
  const termo = useDeferredValue(pesquisa)
  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const busca = useMemo(() => produtosParaBusca(items), [items])
  // Em ordem alfabética na tela; o índice é o da lista guardada, que é o que as ações alteram.
  const visiveis = ordenarPorNome(
    linhas
      .map((l, idx) => ({ l, idx }))
      .filter(({ l }) => {
        const item = porId.get(l.itemId)
        return combinaBusca(termo, item?.name, item?.sku, item?.barcode)
      }),
    ({ l }) => porId.get(l.itemId)?.name,
  )

  const adicionar = (itemId: string) =>
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.itemId === itemId)
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, { itemId, qty: 1 }]
    })

  const onCode = (code: string) => {
    setPesquisa((p) => semCodigoBipado(p, code))
    const item = acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    beep(true)
    adicionar(item.id)
    toast.success(`${item.name} no modelo`)
  }

  const salvar = async () => {
    const validas = linhas.filter((l) => l.itemId && l.qty > 0)
    if (nome.trim().length < 2 || validas.length === 0) {
      toast.error('Informe o nome e ao menos um item.')
      return
    }
    setSalvando(true)
    try {
      if (modelo) await updateKitTemplate({ id: modelo.id, name: nome, items: validas })
      else await createKitTemplate({ name: nome, items: validas })
      toast.success(modelo ? 'Modelo atualizado.' : `Modelo "${nome.trim()}" criado.`)
      onSalvo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar modelo')
      setSalvando(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="space-y-1.5">
          <Label htmlFor="modelo-nome">Nome do modelo</Label>
          <Input id="modelo-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Kit Biópsia Ambulatório" className="h-9" />
        </div>
        <ScanBar onCode={onCode} placeholder="Bipe para adicionar item" />
        <SearchPicker
          title="Adicionar item ao modelo"
          placeholder="Adicionar item pelo nome"
          searchPlaceholder="Nome, SKU ou código…"
          items={busca}
          value={null}
          onPick={(p) => adicionar(p.id)}
        />
      </section>

      <section className="rounded-xl border border-border bg-card">
        {linhas.length > 0 ? (
          <div className="sticky top-0 z-10 rounded-t-xl border-b border-border bg-card p-3 sm:p-4">
            <SearchField
              value={pesquisa}
              onChange={setPesquisa}
              label={`Buscar entre os ${linhas.length} itens do modelo`}
              resultados={visiveis.length}
            />
          </div>
        ) : null}
        <ul className="divide-y divide-border">
          {visiveis.map(({ l, idx }) => {
            const item = porId.get(l.itemId)
            const escolha = itemEhEscolha(item?.name)
            return (
              <li key={`${l.itemId}-${idx}`} className="flex items-center gap-2 px-3 py-2 sm:px-4">
                <div className="min-w-0 flex-1">
                  <SearchPicker
                    size="sm"
                    title="Trocar item"
                    placeholder="Escolher item"
                    searchPlaceholder="Nome, SKU ou código…"
                    items={busca}
                    value={l.itemId ? { id: l.itemId, label: item?.name ?? 'Item' } : null}
                    onPick={(p) => setLinhas((prev) => prev.map((x, j) => (j === idx ? { ...x, itemId: p.id } : x)))}
                  />
                  <p className={cn('mt-0.5 text-xs text-muted-foreground', escolha && 'text-amber-700 dark:text-amber-300')}>
                    {escolha ? 'É uma escolha, não um produto: troque ou escolha na montagem' : `saldo ${formatQtd(item?.qty ?? 0)} ${item?.unit ?? ''}`}
                  </p>
                </div>
                <QtyStepper
                  value={l.qty}
                  min={1}
                  label={item?.name ?? 'item'}
                  onChange={(qty) => setLinhas((prev) => prev.map((x, j) => (j === idx ? { ...x, qty } : x)))}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0"
                  onClick={() => setLinhas((prev) => prev.filter((_, j) => j !== idx))}
                  aria-label={`Tirar ${item?.name ?? 'item'} do modelo`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            )
          })}
          {linhas.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum item ainda. Bipe ou busque pelo nome.</li>
          ) : null}
          {linhas.length > 0 && visiveis.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum item com "{termo}" no modelo.</li>
          ) : null}
        </ul>
      </section>

      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.25)] sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{linhas.length} itens</p>
          <Link to={voltarPara} className={cn(buttonVariants({ variant: 'outline' }), 'h-10 shrink-0', salvando && 'pointer-events-none opacity-50')}>
            Cancelar
          </Link>
          <Button onClick={() => void salvar()} disabled={salvando} className="h-10 shrink-0 px-4">
            {salvando ? 'Salvando…' : 'Salvar modelo'}
          </Button>
        </div>
      </div>

      <VincularCodigoDialog
        codigo={codigo}
        itens={items}
        onClose={() => setCodigo(null)}
        onVinculado={(item) => {
          setCodigo(null)
          onItemAtualizado(item)
          adicionar(item.id)
        }}
      />
    </div>
  )
}
