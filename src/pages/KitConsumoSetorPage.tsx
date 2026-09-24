import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchPicker } from '@/components/ui/search-picker'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { EstadoDaTela } from '@/components/kits/TelaDoKit'
import { formatFracao, formatQtd, produtosParaBusca } from '@/components/kits/kitUi'
import { cn } from '@/lib/utils'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import { type ConsumoSetor, listConsumoSetor, salvarConsumoSetor } from '@/services/estoqueKits'

const LISTA_DE_MODELOS = '/kits/modelos'
const numero = (texto: string) => {
  const n = Number(texto.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/**
 * /kits/consumo-do-setor: o que o setor gasta em todo atendimento e não vai na bandeja (álcool,
 * luvas, toca). Cada linha diz como a equipe conta ("par") e quanto isso tira do estoque
 * (caixa de 100 luvas: 1 par = 0,02 caixa). Os padrões preenchem o registro de uso.
 */
export function KitConsumoSetorPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<StockItem[]>([])
  const [linhas, setLinhas] = useState<Array<ConsumoSetor & { chave: string; fatorTexto: string }>>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let vivo = true
    Promise.all([listStockItems(), listConsumoSetor()])
      .then(([it, cfg]) => {
        if (!vivo) return
        setItems(it)
        setLinhas(cfg.map((c) => ({ ...c, chave: c.id ?? c.itemId, fatorTexto: String(c.fator).replace('.', ',') })))
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [])

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const busca = useMemo(() => produtosParaBusca(items), [items])

  const mudar = (chave: string, patch: Partial<ConsumoSetor & { fatorTexto: string }>) =>
    setLinhas((prev) => prev.map((l) => (l.chave === chave ? { ...l, ...patch } : l)))

  const salvar = async () => {
    const invalida = linhas.find((l) => !l.itemId || !l.rotulo.trim() || !(numero(l.fatorTexto) > 0))
    if (invalida) {
      toast.error(`Complete a linha "${invalida.rotulo || 'sem nome'}": item, nome e conversão maior que zero.`)
      return
    }
    setSalvando(true)
    try {
      await salvarConsumoSetor(linhas.map((l) => ({ ...l, fator: numero(l.fatorTexto) })))
      toast.success('Consumo do setor salvo. Vale para os próximos registros de uso.')
      navigate(LISTA_DE_MODELOS, { replace: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
      setSalvando(false)
    }
  }

  return (
    <AppLayout title="Consumo do setor" subtitle="O que o setor gasta em cada cirurgia ou SPA e entra na conta do paciente.">
      <EstadoDaTela carregando={carregando} erro={erro} vazio={null}>
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <ul className="space-y-3">
            {linhas.map((l) => {
              const item = porId.get(l.itemId)
              const fator = numero(l.fatorTexto)
              return (
                <li key={l.chave} className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
                  <div className="flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="block text-xs font-medium text-muted-foreground">Nome na tela</span>
                        <Input value={l.rotulo} onChange={(e) => mudar(l.chave, { rotulo: e.target.value })} placeholder="Ex.: Luva nitrílica" className="h-9" />
                      </label>
                      <div className="min-w-0 space-y-1">
                        <span className="block text-xs font-medium text-muted-foreground">Item do estoque</span>
                        <SearchPicker
                          title="Item do estoque"
                          placeholder="Escolher item"
                          searchPlaceholder="Nome, SKU ou código…"
                          items={busca}
                          value={l.itemId ? { id: l.itemId, label: item?.name ?? 'Item' } : null}
                          onPick={(p) => mudar(l.chave, { itemId: p.id, rotulo: l.rotulo || (porId.get(p.id)?.name ?? '') })}
                        />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-muted-foreground"
                      onClick={() => setLinhas((prev) => prev.filter((x) => x.chave !== l.chave))}
                      aria-label={`Tirar ${l.rotulo || 'linha'} da lista`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="space-y-1">
                      <span className="block text-xs font-medium text-muted-foreground">A equipe conta em</span>
                      <Input value={l.unidade} onChange={(e) => mudar(l.chave, { unidade: e.target.value })} placeholder="par, ml, un" className="h-9" />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs font-medium text-muted-foreground">Tira do estoque</span>
                      <Input
                        value={l.fatorTexto}
                        onChange={(e) => mudar(l.chave, { fatorTexto: e.target.value })}
                        inputMode="decimal"
                        className={cn('h-9 tabular-nums', !(fator > 0) && 'border-destructive')}
                      />
                    </label>
                    <div className="space-y-1">
                      <span className="block text-xs font-medium text-muted-foreground">Padrão cirurgia</span>
                      <QtyStepper value={l.padraoCirurgia} label={`padrão de ${l.rotulo} na cirurgia`} onChange={(n) => mudar(l.chave, { padraoCirurgia: n })} />
                    </div>
                    <div className="space-y-1">
                      <span className="block text-xs font-medium text-muted-foreground">Padrão SPA</span>
                      <QtyStepper value={l.padraoSpa} label={`padrão de ${l.rotulo} no SPA`} onChange={(n) => mudar(l.chave, { padraoSpa: n })} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {fator > 0 && item
                      ? `1 ${l.unidade || 'un'} tira ${formatFracao(fator)} ${item.unit} de ${item.name} (saldo ${formatQtd(item.qty)} ${item.unit}).`
                      : 'Escolha o item e quanto do estoque sai a cada unidade lançada.'}
                  </p>
                </li>
              )
            })}
          </ul>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              setLinhas((prev) => [
                ...prev,
                { id: null, chave: `nova-${Date.now()}`, itemId: '', rotulo: '', unidade: 'un', fator: 1, fatorTexto: '1', padraoCirurgia: 0, padraoSpa: 0 },
              ])
            }
          >
            <Plus className="size-4" aria-hidden /> Incluir item de consumo
          </Button>

          <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.25)] sm:mx-0 sm:rounded-xl sm:border sm:px-4">
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">{linhas.length} itens de consumo</p>
              <Link to={LISTA_DE_MODELOS} className={cn(buttonVariants({ variant: 'outline' }), 'h-10 shrink-0', salvando && 'pointer-events-none opacity-50')}>
                Cancelar
              </Link>
              <Button onClick={() => void salvar()} disabled={salvando} className="h-10 shrink-0 px-4">
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </div>
        </div>
      </EstadoDaTela>
    </AppLayout>
  )
}
