import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Printer, Trash2 } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { SearchPicker } from '@/components/ui/search-picker'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { CabecalhoGrupo } from '@/components/kits/CabecalhoGrupo'
import { agruparMatMed, formatQtd, itemEhEscolha, produtosParaBusca, semCodigoBipado } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { cn } from '@/lib/utils'
import type { StockItem } from '@/services/estoqueCompras'
import { type StockWarehouse, listWarehouses } from '@/services/estoqueArmazens'
import { type KitTemplate, type SetorKit, createKitTemplate, imprimirFolhaDeItens, updateKitTemplate } from '@/services/estoqueKits'

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
  const [setor, setSetor] = useState<SetorKit | null>(modelo?.setor ?? null)
  const [setorEstoque, setSetorEstoque] = useState<string | null>(modelo?.warehouseId ?? null)
  const [setoresEstoque, setSetoresEstoque] = useState<StockWarehouse[]>([])
  useEffect(() => {
    listWarehouses()
      .then(setSetoresEstoque)
      .catch(() => setSetoresEstoque([]))
  }, [])
  const [linhas, setLinhas] = useState<Linha[]>(() => (modelo?.items ?? []).map((i) => ({ itemId: i.itemId, qty: i.qty })))
  const [codigo, setCodigo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [imprimindo, setImprimindo] = useState(false)
  const [pesquisa, setPesquisa] = useState('')
  const termo = useDeferredValue(pesquisa)
  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const busca = useMemo(() => produtosParaBusca(items), [items])
  // Na tela sai em MAT/MED e ordem alfabética; o índice é o da lista guardada, que é o que as ações alteram.
  const visiveis = linhas
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => {
      const item = porId.get(l.itemId)
      return combinaBusca(termo, item?.name, item?.sku, item?.barcode)
    })

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

  // Imprime o que está na tela, mesmo antes de salvar: é a lista que vai para a bandeja.
  const imprimir = () => {
    if (linhas.length === 0) {
      toast.error('O modelo ainda não tem itens para imprimir.')
      return
    }
    setImprimindo(true)
    void imprimirFolhaDeItens({ kitNome: nome.trim() || 'Kit', linhas, itens: new Map(items.map((i) => [i.id, { name: i.name, controlled: i.controlled, category: i.category }] as const)) })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao imprimir'))
      .finally(() => setImprimindo(false))
  }

  const salvar = async () => {
    const validas = linhas.filter((l) => l.itemId && l.qty > 0)
    if (nome.trim().length < 2 || validas.length === 0) {
      toast.error('Informe o nome e ao menos um item.')
      return
    }
    setSalvando(true)
    try {
      if (modelo) await updateKitTemplate({ id: modelo.id, name: nome, setor, warehouseId: setorEstoque, items: validas })
      else await createKitTemplate({ name: nome, setor, warehouseId: setorEstoque, items: validas })
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
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Setor</span>
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Setor do kit">
            {(
              [
                ['cirurgia', 'Centro cirúrgico'],
                ['spa', 'SPA'],
              ] as Array<[SetorKit, string]>
            ).map(([st, rotulo]) => (
              <button
                key={st}
                type="button"
                aria-pressed={setor === st}
                onClick={() => setSetor(setor === st ? null : st)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  setor === st ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Decide o padrão do consumo do setor ao registrar o uso.</p>
        </div>
        {setoresEstoque.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="modelo-setor-estoque">Material sai do estoque de</Label>
            <Select value={setorEstoque ?? 'padrao'} onValueChange={(v) => setSetorEstoque(!v || v === 'padrao' ? null : v)}>
              <SelectTrigger id="modelo-setor-estoque" className="h-9 w-full">
                <span className="truncate text-sm">
                  {setorEstoque
                    ? (setoresEstoque.find((w) => w.id === setorEstoque)?.name ?? 'Setor')
                    : `Setor padrão (${setoresEstoque.find((w) => w.isDefault)?.name ?? 'Principal'})`}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="padrao">Setor padrão ({setoresEstoque.find((w) => w.isDefault)?.name ?? 'Principal'})</SelectItem>
                {setoresEstoque.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Ao montar, o material sai deste setor, lote a lote. Dá para trocar na montagem.</p>
          </div>
        ) : null}
        <Button variant="outline" className="h-10 w-full" onClick={imprimir} disabled={imprimindo || linhas.length === 0}>
          <Printer className="size-4" aria-hidden /> {imprimindo ? 'Preparando…' : 'Imprimir folha do kit (PDF)'}
        </Button>
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
        {agruparMatMed(visiveis, ({ l }) => porId.get(l.itemId)?.name, ({ l }) => porId.get(l.itemId)?.category).map((g) => (
          <div key={g.grupo}>
            <CabecalhoGrupo grupo={g.grupo} rotulo={g.rotulo} total={g.linhas.length} />
            <ul className="divide-y divide-border">
              {g.linhas.map(({ l, idx }) => {
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
            </ul>
          </div>
        ))}
        {linhas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum item ainda. Bipe ou busque pelo nome.</p>
        ) : null}
        {linhas.length > 0 && visiveis.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum item com "{termo}" no modelo.</p>
        ) : null}
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
