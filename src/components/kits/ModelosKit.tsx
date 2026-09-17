import { useDeferredValue, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Layers, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { SearchPicker } from '@/components/ui/search-picker'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, itemEhEscolha, ordenarPorNome, produtosParaBusca } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { cn } from '@/lib/utils'
import type { StockItem } from '@/services/estoqueCompras'
import { type KitTemplate, createKitTemplate, deactivateKitTemplate, updateKitTemplate } from '@/services/estoqueKits'

type Linha = { itemId: string; qty: number }
type Edicao = { id: string | null; nome: string; linhas: Linha[] }

export function ModelosKit({
  templates,
  items,
  onMudou,
  onItemAtualizado,
}: {
  templates: KitTemplate[]
  items: StockItem[]
  onMudou: () => void
  onItemAtualizado: (item: StockItem) => void
}) {
  const [edicao, setEdicao] = useState<Edicao | null>(null)
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
        <Button onClick={() => setEdicao({ id: null, nome: '', linhas: [] })} className="shrink-0">
          <Plus className="size-4" aria-hidden /> Novo modelo
        </Button>
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
                    <p className="text-sm font-semibold">{t.name}</p>
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
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setEdicao({ id: t.id, nome: t.name, linhas: t.items.map((i) => ({ itemId: i.itemId, qty: i.qty })) })}
                    >
                      <Pencil className="size-3.5" aria-hidden /> Editar
                    </Button>
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

      {edicao ? (
        <EditorModelo
          key={edicao.id ?? 'novo'}
          inicial={edicao}
          items={items}
          onClose={() => setEdicao(null)}
          onSalvo={() => {
            setEdicao(null)
            onMudou()
          }}
          onItemAtualizado={onItemAtualizado}
        />
      ) : null}

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

function EditorModelo({
  inicial,
  items,
  onClose,
  onSalvo,
  onItemAtualizado,
}: {
  inicial: Edicao
  items: StockItem[]
  onClose: () => void
  onSalvo: () => void
  onItemAtualizado: (item: StockItem) => void
}) {
  const [nome, setNome] = useState(inicial.nome)
  const [linhas, setLinhas] = useState<Linha[]>(inicial.linhas)
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
    const item = acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    beep(true)
    adicionar(item.id)
  }

  const salvar = async () => {
    const validas = linhas.filter((l) => l.itemId && l.qty > 0)
    if (nome.trim().length < 2 || validas.length === 0) {
      toast.error('Informe o nome e ao menos um item.')
      return
    }
    setSalvando(true)
    try {
      if (inicial.id) await updateKitTemplate({ id: inicial.id, name: nome, items: validas })
      else await createKitTemplate({ name: nome, items: validas })
      toast.success(inicial.id ? 'Modelo atualizado.' : `Modelo "${nome.trim()}" criado.`)
      onSalvo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar modelo')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !salvando && onClose()}>
      <DialogContent className="flex max-h-[min(100dvh-1rem,52rem)] flex-col gap-0 p-0 sm:max-w-2xl max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none">
        <DialogHeader className="border-b border-border p-4 pr-12">
          <DialogTitle>{inicial.id ? 'Editar modelo' : 'Novo modelo de kit'}</DialogTitle>
          <DialogDescription>Bipe os itens da bandeja ou busque pelo nome. Bipar de novo soma +1.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 border-b border-border p-3 sm:p-4">
          <div className="space-y-1.5">
            <Label htmlFor="modelo-nome">Nome</Label>
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
          {linhas.length > 0 ? (
            <SearchField
              value={pesquisa}
              onChange={setPesquisa}
              label={`Buscar entre os ${linhas.length} itens do modelo`}
              resultados={visiveis.length}
            />
          ) : null}
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
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
          {linhas.length === 0 ? <li className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum item ainda.</li> : null}
          {linhas.length > 0 && visiveis.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum item com "{termo}" no modelo.</li>
          ) : null}
        </ul>
        <DialogFooter className="flex-row items-center gap-3 border-t border-border p-3 sm:p-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{linhas.length} itens</p>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar modelo'}
          </Button>
        </DialogFooter>

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
      </DialogContent>
    </Dialog>
  )
}
