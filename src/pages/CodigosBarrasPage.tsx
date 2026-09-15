import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Printer, ScanBarcode, Search, Tag } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd } from '@/components/kits/kitUi'
import { useTenant } from '@/context/TenantContext'
import { beep } from '@/lib/beep'
import { codigoInterno, ean13Svg, ean13Valido, proximaSequencia } from '@/lib/codigoBarras'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { escaparHtml, imprimirHtml } from '@/lib/exportar'
import { cn } from '@/lib/utils'
import { estoqueTabs } from '@/pages/EstoquePage'
import { type StockItem, listStockItems, vincularCodigoAoItem } from '@/services/estoqueCompras'
import { listKitTemplates } from '@/services/estoqueKits'

type Filtro = 'kit_sem' | 'sem' | 'com' | 'todos'
const normalizar = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Preparar o estoque para bipar. Dois caminhos, porque o material chega de dois jeitos:
 *  - caixa com código de fábrica: toca no item e bipa a caixa, o código fica guardado;
 *  - sem código (gaze em pacote, fracionado): gera um código interno e imprime a etiqueta.
 * A lista começa pelos itens dos kits sem código, que são os que travam a montagem bipando.
 */
export function CodigosBarrasPage() {
  const { tenant } = useTenant()
  const [items, setItems] = useState<StockItem[]>([])
  const [emKit, setEmKit] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('kit_sem')
  const [busca, setBusca] = useState('')
  const [alvo, setAlvo] = useState<StockItem | null>(null)
  const [codigoSolto, setCodigoSolto] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [imprimindo, setImprimindo] = useState(false)

  useEffect(() => {
    Promise.all([listStockItems(), listKitTemplates()])
      .then(([its, tpls]) => {
        setItems(its)
        setEmKit(new Set(tpls.flatMap((t) => t.items.map((i) => i.itemId))))
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao carregar o estoque'))
      .finally(() => setCarregando(false))
  }, [])

  const trocar = (item: StockItem) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))

  const comCodigo = items.filter((i) => i.barcode).length
  const kitSemCodigo = items.filter((i) => emKit.has(i.id) && !i.barcode).length

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim())
    return items
      .filter((i) => {
        if (filtro === 'kit_sem' && !(emKit.has(i.id) && !i.barcode)) return false
        if (filtro === 'sem' && i.barcode) return false
        if (filtro === 'com' && !i.barcode) return false
        return !q || normalizar(`${i.name} ${i.category ?? ''} ${i.barcode ?? ''}`).includes(q)
      })
      .sort((a, b) => Number(emKit.has(b.id)) - Number(emKit.has(a.id)) || a.name.localeCompare(b.name))
  }, [items, emKit, filtro, busca])

  // Depois de ensinar um código, a lista "sem código" encolhe: o próximo alvo é o primeiro que sobrou.
  const proximoSemCodigo = (depoisDe: string) => visiveis.find((i) => i.id !== depoisDe && !i.barcode) ?? null

  const onCode = async (code: string) => {
    const dono = acharItemPorCodigo(items, code)
    if (alvo) {
      if (dono && dono.id !== alvo.id) {
        beep(false)
        toast.error(`Este código já é de "${dono.name}". Confira a caixa.`)
        return
      }
      try {
        const atualizado = await vincularCodigoAoItem(alvo, code)
        trocar(atualizado)
        beep(true)
        toast.success(`Código salvo em "${alvo.name}".`)
        setAlvo(filtro === 'com' || filtro === 'todos' ? null : proximoSemCodigo(alvo.id))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao salvar o código')
      }
      return
    }
    if (dono) {
      beep(true)
      toast.info(`Código de "${dono.name}".`)
      return
    }
    beep(false)
    setCodigoSolto(code)
  }

  const imprimirEtiquetas = async () => {
    const escolhidos = items.filter((i) => selecionados.has(i.id))
    if (escolhidos.length === 0) return
    setImprimindo(true)
    try {
      // Quem não tem código ganha um interno antes de imprimir: etiqueta sem código salvo
      // seria um adesivo que o sistema não reconhece.
      let seq = proximaSequencia(items.flatMap((i) => [i.barcode, ...i.aliases]))
      const prontos: StockItem[] = []
      for (const item of escolhidos) {
        if (item.barcode && ean13Valido(item.barcode)) {
          prontos.push(item)
          continue
        }
        if (item.barcode) {
          toast.warning(`"${item.name}" já tem código de fábrica fora do padrão EAN-13; use a caixa.`)
          continue
        }
        const atualizado = await vincularCodigoAoItem(item, codigoInterno(seq))
        seq += 1
        trocar(atualizado)
        prontos.push(atualizado)
      }
      const etiquetas = prontos
        .map(
          (i) => `<div class="et"><div class="nome">${escaparHtml(i.name)}</div>${ean13Svg(i.barcode ?? '', { altura: 40, modulo: 1.6 })}<div class="cod">${i.barcode}</div></div>`,
        )
        .join('')
      imprimirHtml(`<!doctype html><html><head><meta charset="utf-8"/><title>Etiquetas de estoque</title>
        <style>
          @page{size:A4;margin:8mm}
          body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif}
          .grade{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
          .et{border:1px dashed #bbb;border-radius:2mm;padding:2.5mm;text-align:center;page-break-inside:avoid;height:30mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;align-items:center}
          .nome{font-size:9pt;font-weight:600;line-height:1.15;max-height:2.3em;overflow:hidden}
          .et svg{max-width:100%;height:12mm}
          .cod{font-size:8pt;letter-spacing:1px;font-variant-numeric:tabular-nums}
        </style></head><body><div class="grade">${etiquetas}</div></body></html>`)
      toast.success(`${prontos.length} ${prontos.length === 1 ? 'etiqueta pronta' : 'etiquetas prontas'} para imprimir.`)
      setSelecionados(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar etiquetas')
    } finally {
      setImprimindo(false)
    }
  }

  return (
    <AppLayout title="Códigos de barras" subtitle="Deixe o estoque pronto para bipar: ensine o código da caixa ou imprima etiqueta para o que não tem.">
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Com código', `${comCodigo} de ${items.length}`],
            ['Itens de kit sem código', String(kitSemCodigo)],
            ['Sem código', String(items.length - comCodigo)],
          ].map(([r, v]) => (
            <div key={r} className="rounded-xl border border-border bg-card px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r}</p>
              <p className="text-lg font-semibold tabular-nums">{carregando ? '…' : v}</p>
            </div>
          ))}
        </div>

        <section className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
          {alvo ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">Bipe a caixa de</span>
                <span className="block truncate font-semibold">{alvo.name}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setAlvo(null)}>
                Parar
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Toque em <strong>Bipar</strong> num item e passe o leitor na caixa. Ou bipe qualquer caixa para ver de quem é o código.
            </p>
          )}
          <ScanBar onCode={(c) => void onCode(c)} placeholder={alvo ? `Bipe a caixa de ${alvo.name}` : 'Bipe um código'} />
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5 overflow-x-auto">
            {(
              [
                ['kit_sem', `Kits sem código ${kitSemCodigo}`],
                ['sem', 'Sem código'],
                ['com', 'Com código'],
                ['todos', 'Todos'],
              ] as Array<[Filtro, string]>
            ).map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFiltro(f)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium',
                  filtro === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item" className="h-9 pl-9" aria-label="Buscar item" />
          </div>
        </div>

        {visiveis.length === 0 ? (
          <EmptyState icon={Tag} title={carregando ? 'Carregando…' : 'Nada neste filtro'} description={filtro === 'kit_sem' ? 'Todos os itens de kit já têm código.' : undefined} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {visiveis.map((i) => (
              <li key={i.id} className={cn('flex items-center gap-3 px-3 py-2.5 sm:px-4', alvo?.id === i.id && 'bg-primary/5')}>
                <Checkbox
                  checked={selecionados.has(i.id)}
                  onCheckedChange={(v) =>
                    setSelecionados((prev) => {
                      const next = new Set(prev)
                      if (v) next.add(i.id)
                      else next.delete(i.id)
                      return next
                    })
                  }
                  aria-label={`Selecionar ${i.name} para etiqueta`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{i.name}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {i.barcode ? (
                      <span className="inline-flex items-center gap-1 font-mono text-emerald-700 dark:text-emerald-300">
                        <Check className="size-3" aria-hidden /> {i.barcode}
                        {i.aliases.filter((a) => /^\d{8,14}$/.test(a)).length > 0 ? ` +${i.aliases.filter((a) => /^\d{8,14}$/.test(a)).length}` : ''}
                      </span>
                    ) : (
                      <span>sem código</span>
                    )}
                    <span>
                      saldo {formatQtd(i.qty)} {i.unit}
                    </span>
                    {emKit.has(i.id) ? <Badge variant="secondary">em kit</Badge> : null}
                  </p>
                </div>
                <Button variant={alvo?.id === i.id ? 'default' : 'outline'} size="sm" className="h-8 shrink-0" onClick={() => setAlvo(i)}>
                  <ScanBarcode className="size-4" aria-hidden /> Bipar
                </Button>
              </li>
            ))}
          </ul>
        )}

        {selecionados.size > 0 ? (
          <div className="sticky bottom-0 z-10 -mx-3 flex items-center gap-3 border-t border-border bg-background px-3 py-3 sm:mx-0 sm:rounded-xl sm:border">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {selecionados.size} {selecionados.size === 1 ? 'item selecionado' : 'itens selecionados'}. Quem não tem código ganha um interno (começa com 20).
            </p>
            <Button onClick={() => void imprimirEtiquetas()} disabled={imprimindo} className="h-10 shrink-0">
              <Printer className="size-4" aria-hidden /> {imprimindo ? 'Gerando…' : 'Imprimir etiquetas'}
            </Button>
          </div>
        ) : null}
      </div>

      <VincularCodigoDialog
        codigo={codigoSolto}
        itens={[...items].sort((a, b) => Number(!a.barcode) - Number(!b.barcode)).reverse()}
        onClose={() => setCodigoSolto(null)}
        onVinculado={(item) => {
          setCodigoSolto(null)
          trocar(item)
        }}
      />
    </AppLayout>
  )
}
