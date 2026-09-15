import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, ClipboardList, PackagePlus, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchPicker } from '@/components/ui/search-picker'
import { Switch } from '@/components/ui/switch'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatBRL, formatQtd, itemEhEscolha, produtosParaBusca } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { type LinhaMontagem, aplicarBipe, novaChave, resumirMontagem } from '@/lib/kitMontagem'
import { cn } from '@/lib/utils'
import { searchLeadsByName } from '@/services/clinicalNotes'
import type { StockItem } from '@/services/estoqueCompras'
import { type KitTemplate, createKit } from '@/services/estoqueKits'

type Rascunho = {
  templateId: string
  leadId: string
  leadName: string
  paciente: string
  procedimento: string
  data: string
  linhas: LinhaMontagem[]
}

const VAZIO: Rascunho = { templateId: '', leadId: '', leadName: '', paciente: '', procedimento: '', data: '', linhas: [] }

// Montar um Kit Cirúrgico CC é bipar 90 itens. A tela do CRM remonta quando a aba volta do
// foco, então sem rascunho guardado uma troca de aba jogava fora a bandeja inteira.
const chaveRascunho = (tenantId: string) => `kits:montagem:${tenantId}`
function lerRascunho(tenantId: string): Rascunho {
  try {
    const bruto = window.localStorage.getItem(chaveRascunho(tenantId))
    return bruto ? { ...VAZIO, ...(JSON.parse(bruto) as Partial<Rascunho>) } : VAZIO
  } catch {
    return VAZIO
  }
}

type Filtro = 'todos' | 'faltam' | 'problema'

export function MontarKit({
  tenantId,
  items,
  templates,
  onMontado,
  onItemAtualizado,
}: {
  tenantId: string
  items: StockItem[]
  templates: KitTemplate[]
  onMontado: () => void
  /** Código novo ensinado a um item: a página troca o item na lista para o próximo bipe achar. */
  onItemAtualizado: (item: StockItem) => void
}) {
  const [r, setR] = useState<Rascunho>(() => lerRascunho(tenantId))
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [editando, setEditando] = useState<string | null>(null)
  const [trocarModelo, setTrocarModelo] = useState<string | null>(null)
  const [codigoDesconhecido, setCodigoDesconhecido] = useState<string | null>(null)
  const [ultimaLeitura, setUltimaLeitura] = useState<string | null>(null)
  const [destaque, setDestaque] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const listaRef = useRef<HTMLUListElement>(null)
  // Leitor USB manda um código atrás do outro mais rápido que o React renderiza: o bipe lê a
  // bandeja daqui, senão o segundo bipe partiria da lista de antes do primeiro e o apagaria.
  const linhasRef = useRef(r.linhas)
  useEffect(() => {
    linhasRef.current = r.linhas
  }, [r.linhas])

  useEffect(() => {
    try {
      window.localStorage.setItem(chaveRascunho(tenantId), JSON.stringify(r))
    } catch {
      /* sem armazenamento: segue sem rascunho */
    }
  }, [r, tenantId])

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const saldo = useMemo(() => new Map(items.map((i) => [i.id, i.qty] as const)), [items])
  const busca = useMemo(() => produtosParaBusca(items), [items])
  const resumo = useMemo(() => resumirMontagem(r.linhas, saldo), [r.linhas, saldo])
  const escolhas = r.linhas.filter((l) => itemEhEscolha(porId.get(l.itemId)?.name))
  const temControlado = r.linhas.some((l) => porId.get(l.itemId)?.controlled)
  const nomePaciente = r.paciente.trim() || r.leadName

  const set = (patch: Partial<Rascunho>) => setR((prev) => ({ ...prev, ...patch }))
  const setLinha = (chave: string, patch: Partial<LinhaMontagem>) =>
    setR((prev) => ({ ...prev, linhas: prev.linhas.map((l) => (l.chave === chave ? { ...l, ...patch } : l)) }))

  const aplicarModelo = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId)
    set({
      templateId,
      linhas: (tpl?.items ?? []).map((i) => ({
        chave: novaChave(),
        itemId: i.itemId,
        qty: i.qty,
        conferido: 0,
        avulso: false,
        cobrancaCents: 0,
      })),
    })
    setFiltro('todos')
  }

  const escolherModelo = (templateId: string) => {
    if (templateId === r.templateId) return
    if (r.linhas.length > 0) setTrocarModelo(templateId)
    else aplicarModelo(templateId)
  }

  // Leva a linha bipada para a vista e pisca: com 90 itens, o bipe precisa mostrar onde caiu.
  useEffect(() => {
    if (!destaque) return
    listaRef.current?.querySelector(`[data-chave="${destaque}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const t = window.setTimeout(() => setDestaque(null), 1400)
    return () => window.clearTimeout(t)
  }, [destaque])

  const bipar = (item: StockItem) => {
    const res = aplicarBipe(linhasRef.current, item.id)
    linhasRef.current = res.linhas
    set({ linhas: res.linhas })
    const linha = res.linhas.find((l) => l.chave === res.chave)
    beep(true)
    setDestaque(res.chave)
    setUltimaLeitura(
      res.resultado === 'novo'
        ? `${item.name}: entrou como avulso`
        : `${item.name}: ${formatQtd(linha?.conferido ?? 0)} de ${formatQtd(linha?.qty ?? 0)}${res.resultado === 'a_mais' ? ' (a mais)' : ''}`,
    )
  }

  const onCode = (code: string) => {
    const item = acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigoDesconhecido(code)
      return
    }
    bipar(item)
  }

  const limpar = () => {
    setR(VAZIO)
    setUltimaLeitura(null)
  }

  const montar = async () => {
    setConfirmar(false)
    const linhas = r.linhas.filter((l) => l.itemId && l.qty > 0)
    setSalvando(true)
    try {
      const tpl = templates.find((t) => t.id === r.templateId)
      const nome = tpl?.name || 'Kit avulso'
      const { movements, controlled } = await createKit({
        templateId: tpl?.id || null,
        name: nome,
        leadId: r.leadId || null,
        patientName: nomePaciente,
        procedureLabel: r.procedimento,
        scheduledFor: r.data || null,
        items: linhas.map((l) => ({ itemId: l.itemId, qty: l.qty, isExtra: l.avulso, chargeCents: l.cobrancaCents })),
        controlledItemIds: new Set(items.filter((i) => i.controlled).map((i) => i.id)),
      })
      toast.success(
        `${nome} montado${nomePaciente ? ` para ${nomePaciente}` : ''}: ${movements} ${movements === 1 ? 'baixa' : 'baixas'} no estoque` +
          (controlled > 0 ? `, ${controlled} no livro de controlados.` : '.'),
      )
      limpar()
      onMontado()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao montar kit')
    } finally {
      setSalvando(false)
    }
  }

  const pedirMontagem = () => {
    if (resumo.linhas === 0) {
      toast.error('Escolha um modelo ou bipe ao menos um item.')
      return
    }
    if (temControlado && !nomePaciente) {
      toast.error('O kit tem item controlado: informe o paciente (livro de controlados).')
      return
    }
    if (resumo.faltaConferir > 0 || resumo.semSaldo.size > 0 || escolhas.length > 0) setConfirmar(true)
    else void montar()
  }

  const linhasVisiveis = r.linhas.filter((l) => {
    if (filtro === 'faltam') return l.conferido < l.qty
    if (filtro === 'problema') return resumo.semSaldo.has(l.itemId) || itemEhEscolha(porId.get(l.itemId)?.name) || !l.itemId
    return true
  })
  const linhaEditada = r.linhas.find((l) => l.chave === editando) ?? null
  const progresso = resumo.linhas > 0 ? Math.round((resumo.completas / resumo.linhas) * 100) : 0

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 sm:p-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Paciente</Label>
          <SearchPicker
            title="Buscar paciente"
            placeholder="Buscar paciente no CRM"
            searchPlaceholder="Nome ou telefone…"
            value={r.leadId ? { id: r.leadId, label: r.leadName || 'Paciente' } : null}
            onSearch={async (q) =>
              (await searchLeadsByName(tenantId, q, 40)).map((p) => ({ id: p.id, label: p.name, hint: p.phone || undefined }))
            }
            onPick={(p) => set({ leadId: p.id, leadName: p.label })}
            onClear={() => set({ leadId: '', leadName: '' })}
          />
          {!r.leadId ? (
            <Input
              value={r.paciente}
              onChange={(e) => set({ paciente: e.target.value })}
              placeholder="Ou digite o nome, se não tiver cadastro"
              aria-label="Nome do paciente"
              className="h-9"
            />
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kit-proc">Procedimento</Label>
          <Input
            id="kit-proc"
            value={r.procedimento}
            onChange={(e) => set({ procedimento: e.target.value })}
            placeholder="Ex.: FUE 2.500 folículos"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kit-data">Data da cirurgia</Label>
          <Input id="kit-data" type="date" value={r.data} onChange={(e) => set({ data: e.target.value })} className="h-9" />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Modelo</h2>
          {r.linhas.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={limpar} className="text-muted-foreground">
              Começar de novo
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => escolherModelo(t.id)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                r.templateId === t.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              <span className="block font-medium">{t.name}</span>
              <span className="block text-xs text-muted-foreground">{t.items.length} itens</span>
            </button>
          ))}
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum modelo ainda. Crie na aba Modelos ou bipe os itens avulsos.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="sticky top-0 z-10 space-y-2.5 rounded-t-xl border-b border-border bg-card p-3 sm:p-4">
          <ScanBar onCode={onCode} ultimaLeitura={ultimaLeitura} placeholder="Bipe cada item que entra na bandeja" />
          {ultimaLeitura ? (
            <p className="truncate text-xs text-muted-foreground" aria-live="polite">
              Último: {ultimaLeitura}
            </p>
          ) : null}
          {resumo.linhas > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {resumo.completas} de {resumo.linhas} conferidos
                </span>
                <span className="text-muted-foreground tabular-nums">{progresso}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${progresso}%` }} />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pt-1">
                {(
                  [
                    ['todos', `Todos ${resumo.linhas}`],
                    ['faltam', `Faltam ${resumo.faltaConferir}`],
                    ['problema', `Atenção ${new Set([...resumo.semSaldo, ...escolhas.map((e) => e.itemId)]).size}`],
                  ] as Array<[Filtro, string]>
                ).map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFiltro(f)}
                    className={cn(
                      'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium',
                      filtro === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {r.linhas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Escolha um modelo ou comece a bipar</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Com modelo, cada bipe marca o item como conferido. Item bipado que não está no modelo entra como avulso.
            </p>
          </div>
        ) : (
          <ul ref={listaRef} className="divide-y divide-border">
            {linhasVisiveis.map((l) => {
              const item = porId.get(l.itemId)
              const completo = l.conferido >= l.qty
              const semSaldo = resumo.semSaldo.has(l.itemId)
              const escolha = itemEhEscolha(item?.name)
              return (
                <li
                  key={l.chave}
                  data-chave={l.chave}
                  className={cn('flex items-center gap-2.5 px-3 py-2.5 transition-colors sm:px-4', destaque === l.chave && 'bg-emerald-500/10')}
                >
                  <button
                    type="button"
                    onClick={() => setLinha(l.chave, { conferido: completo ? 0 : l.qty })}
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums',
                      completo
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : l.conferido > 0
                          ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                          : 'border-border text-muted-foreground',
                    )}
                    aria-label={completo ? `Desmarcar ${item?.name ?? 'item'}` : `Marcar ${item?.name ?? 'item'} como conferido`}
                  >
                    {completo ? <Check className="size-4" aria-hidden /> : l.conferido > 0 ? formatQtd(l.conferido) : null}
                  </button>
                  <button type="button" onClick={() => setEditando(l.chave)} className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-medium leading-snug">{item?.name ?? 'Escolher item'}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className={cn(semSaldo && 'font-medium text-destructive')}>
                        saldo {formatQtd(item?.qty ?? 0)} {item?.unit}
                      </span>
                      {escolha ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">trocar pelo item certo</span>
                      ) : null}
                      {l.avulso ? <span>avulso</span> : null}
                      {l.cobrancaCents > 0 ? <span>{formatBRL(l.cobrancaCents)}</span> : null}
                      {item?.controlled ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                          <ShieldAlert className="size-3" aria-hidden /> controlado
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <QtyStepper
                    value={l.qty}
                    min={0}
                    label={item?.name ?? 'item'}
                    onChange={(qty) => setLinha(l.chave, { qty, conferido: Math.min(l.conferido, qty) })}
                  />
                </li>
              )
            })}
            {linhasVisiveis.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nada neste filtro.</li>
            ) : null}
          </ul>
        )}

        <div className="border-t border-border p-3 sm:p-4">
          <SearchPicker
            title="Adicionar item à bandeja"
            placeholder="Adicionar item sem bipar"
            searchPlaceholder="Nome, SKU ou código…"
            items={busca}
            value={null}
            onPick={(p) => {
              const item = porId.get(p.id)
              if (item) bipar(item)
            }}
          />
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.25)] sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            {resumo.linhas === 0 ? (
              'Nada na bandeja ainda'
            ) : (
              <>
                <span className="font-medium text-foreground">{resumo.linhas} itens</span>
                {resumo.faltaConferir > 0 ? ` · ${resumo.faltaConferir} sem conferir` : ' · tudo conferido'}
                {resumo.semSaldo.size > 0 ? <span className="text-destructive"> · {resumo.semSaldo.size} sem saldo</span> : null}
              </>
            )}
          </div>
          <Button onClick={pedirMontagem} disabled={salvando || resumo.linhas === 0} className="h-10 shrink-0 px-4">
            <PackagePlus className="size-4" aria-hidden />
            {salvando ? 'Montando…' : 'Montar kit'}
          </Button>
        </div>
      </div>

      <Dialog open={linhaEditada != null} onOpenChange={(open) => !open && setEditando(null)}>
        <DialogContent className="sm:max-w-md">
          {linhaEditada ? (
            <>
              <DialogHeader>
                <DialogTitle>Item da bandeja</DialogTitle>
                <DialogDescription>Troque o produto, ajuste a quantidade ou marque cobrança.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Produto</Label>
                  <SearchPicker
                    title="Trocar produto"
                    placeholder="Escolher produto"
                    searchPlaceholder="Nome, SKU ou código…"
                    items={busca}
                    value={
                      linhaEditada.itemId
                        ? { id: linhaEditada.itemId, label: porId.get(linhaEditada.itemId)?.name ?? 'Item' }
                        : null
                    }
                    onPick={(p) => setLinha(linhaEditada.chave, { itemId: p.id })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label>Quantidade</Label>
                  <QtyStepper
                    value={linhaEditada.qty}
                    label="quantidade"
                    onChange={(qty) => setLinha(linhaEditada.chave, { qty, conferido: Math.min(linhaEditada.conferido, qty) })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="linha-avulso" className="font-normal">
                    Avulso (fora do modelo)
                  </Label>
                  <Switch
                    id="linha-avulso"
                    checked={linhaEditada.avulso}
                    onCheckedChange={(v) => setLinha(linhaEditada.chave, { avulso: Boolean(v) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="linha-cobranca">Cobrança do paciente (R$)</Label>
                  <Input
                    key={linhaEditada.chave}
                    id="linha-cobranca"
                    inputMode="decimal"
                    placeholder="0,00"
                    defaultValue={linhaEditada.cobrancaCents > 0 ? (linhaEditada.cobrancaCents / 100).toFixed(2).replace('.', ',') : ''}
                    onBlur={(e) => {
                      const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'))
                      setLinha(linhaEditada.chave, { cobrancaCents: Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0 })
                    }}
                    className="h-9"
                  />
                </div>
              </div>
              <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    set({ linhas: r.linhas.filter((l) => l.chave !== linhaEditada.chave) })
                    setEditando(null)
                  }}
                >
                  <Trash2 className="size-4" aria-hidden /> Tirar da bandeja
                </Button>
                <Button onClick={() => setEditando(null)}>Pronto</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={trocarModelo != null}
        onOpenChange={(open) => !open && setTrocarModelo(null)}
        title="Trocar o modelo?"
        description="A bandeja atual, com o que já foi conferido, será substituída pelos itens do novo modelo."
        confirmLabel="Trocar modelo"
        variant="default"
        onConfirm={() => {
          if (trocarModelo) aplicarModelo(trocarModelo)
          setTrocarModelo(null)
        }}
      />

      <ConfirmDialog
        open={confirmar}
        onOpenChange={setConfirmar}
        title="Montar mesmo assim?"
        description={[
          resumo.faltaConferir > 0 ? `${resumo.faltaConferir} ${resumo.faltaConferir === 1 ? 'item não foi conferido' : 'itens não foram conferidos'}.` : '',
          resumo.semSaldo.size > 0 ? `${resumo.semSaldo.size} ${resumo.semSaldo.size === 1 ? 'item fica' : 'itens ficam'} com saldo negativo.` : '',
          escolhas.length > 0 ? `${escolhas.length} ${escolhas.length === 1 ? 'item ainda é' : 'itens ainda são'} escolha do modelo (ex.: curativo fem/mas) e vai sair do item errado.` : '',
          'A baixa no estoque acontece agora.',
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Montar kit"
        variant="default"
        icon={TriangleAlert}
        onConfirm={() => void montar()}
      />

      <VincularCodigoDialog
        codigo={codigoDesconhecido}
        itens={items}
        onClose={() => setCodigoDesconhecido(null)}
        onVinculado={(item) => {
          setCodigoDesconhecido(null)
          onItemAtualizado(item)
          bipar(item)
        }}
      />
    </div>
  )
}
