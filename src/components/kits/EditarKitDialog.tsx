import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldAlert, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
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
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { STATUS_KIT, formatBRL, formatQtd, itemEhEscolha, produtosParaBusca } from '@/components/kits/kitUi'
import { VendaDoKitPicker } from '@/components/kits/VendaDoKitPicker'
import { vincularKitAVenda } from '@/services/resultadoProcedimentos'
import { beep } from '@/lib/beep'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { searchLeadsByName } from '@/services/clinicalNotes'
import type { StockItem } from '@/services/estoqueCompras'
import {
  type StockKit,
  adicionarItemKit,
  alterarLinhaKit,
  atualizarKit,
  excluirKit,
  removerLinhaKit,
} from '@/services/estoqueKits'

const reais = (cents: number) => (cents > 0 ? (cents / 100).toFixed(2).replace('.', ',') : '')
const centavos = (texto: string) => {
  const n = Number(texto.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/**
 * A conta do paciente é o kit: o que saiu, o que voltou e o que se cobra. Aqui a enfermagem
 * corrige tudo depois de montado, sem cancelar e montar de novo. Cada mudança vai ao banco na
 * hora (baixa ou devolve a diferença), em fila, para dois toques rápidos não se atropelarem.
 */
export function EditarKitDialog({
  kit,
  tenantId,
  items,
  lastCosts,
  onClose,
  onMudou,
  onItemAtualizado,
}: {
  kit: StockKit | null
  tenantId: string
  items: StockItem[]
  lastCosts: Map<string, number>
  onClose: () => void
  onMudou: () => Promise<void> | void
  onItemAtualizado: (item: StockItem) => void
}) {
  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const busca = useMemo(() => produtosParaBusca(items), [items])
  const fila = useRef<Promise<unknown>>(Promise.resolve())
  const timers = useRef(new Map<string, number>())
  const [pendentes, setPendentes] = useState(0)
  const [qtdLocal, setQtdLocal] = useState<Record<string, number>>({})
  const [removendo, setRemovendo] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)

  const [dados, setDados] = useState(() => ({
    leadId: kit?.leadId ?? '',
    leadName: kit?.patientName ?? '',
    paciente: kit?.patientName ?? '',
    procedimento: kit?.procedureLabel ?? '',
    data: kit?.scheduledFor ?? '',
  }))
  const dadosMudaram =
    kit != null &&
    ((dados.leadId || null) !== kit.leadId ||
      (dados.paciente.trim() || null) !== (kit.patientName ?? null) ||
      (dados.procedimento.trim() || null) !== (kit.procedureLabel ?? null) ||
      (dados.data || null) !== (kit.scheduledFor ?? null))

  useEffect(() => {
    const t = timers.current
    return () => t.forEach((id) => window.clearTimeout(id))
  }, [])

  const enfileirar = (rotulo: string, op: () => Promise<unknown>) => {
    setPendentes((n) => n + 1)
    fila.current = fila.current
      .then(op)
      .then(() => onMudou())
      .catch((e) => {
        toast.error(`${rotulo}: ${e instanceof Error ? e.message : 'falhou'}`)
        return onMudou()
      })
      .finally(() => setPendentes((n) => n - 1))
    return fila.current
  }

  if (!kit) return null
  const editavel = kit.status !== 'cancelado'

  const mudarQtd = (linhaId: string, qty: number) => {
    setQtdLocal((prev) => ({ ...prev, [linhaId]: qty }))
    const anterior = timers.current.get(linhaId)
    if (anterior) window.clearTimeout(anterior)
    // Espera o dedo parar: cinco toques no + viram uma baixa só.
    timers.current.set(
      linhaId,
      window.setTimeout(() => {
        timers.current.delete(linhaId)
        void enfileirar('Quantidade', () => alterarLinhaKit({ kitItemId: linhaId, qty })).then(() =>
          setQtdLocal((prev) => {
            const next = { ...prev }
            delete next[linhaId]
            return next
          }),
        )
      }, 650),
    )
  }

  const incluir = (item: StockItem) => {
    const existente = kit.items.find((l) => l.itemId === item.id)
    beep(true)
    if (existente) {
      const atual = qtdLocal[existente.id] ?? existente.qty
      mudarQtd(existente.id, atual + 1)
      toast.success(`${item.name}: ${formatQtd(atual + 1)} no kit`)
    } else {
      void enfileirar('Incluir item', () => adicionarItemKit({ kitId: kit.id, itemId: item.id, qty: 1 }))
      toast.success(`${item.name} incluído no kit`)
    }
  }

  const onCode = (code: string) => {
    const item = acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    incluir(item)
  }

  const custo = kit.items.reduce((s, l) => s + Math.round((l.qty - l.returnedQty) * (lastCosts.get(l.itemId) ?? 0)), 0)
  const cobrado = kit.items.reduce((s, l) => s + Math.max(0, l.chargeCents), 0)
  const status = STATUS_KIT[kit.status]

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[min(100dvh-1rem,56rem)] flex-col gap-0 p-0 sm:max-w-2xl max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none">
        <DialogHeader className="border-b border-border p-4 pr-12">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {kit.patientName || 'Kit sem paciente'}
            <Badge variant="secondary" className={status.className}>
              {status.label}
            </Badge>
            {pendentes > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden /> salvando
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {kit.name}. Cada mudança baixa ou devolve no estoque na hora.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="grid gap-3 border-b border-border p-3 sm:grid-cols-2 sm:p-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Paciente</Label>
              <SearchPicker
                title="Buscar paciente"
                placeholder="Vincular paciente do CRM"
                searchPlaceholder="Nome ou telefone…"
                disabled={!editavel}
                value={dados.leadId ? { id: dados.leadId, label: dados.leadName || 'Paciente' } : null}
                onSearch={async (q) =>
                  (await searchLeadsByName(tenantId, q, 40)).map((p) => ({ id: p.id, label: p.name, hint: p.phone || undefined }))
                }
                onPick={(p) => setDados((d) => ({ ...d, leadId: p.id, leadName: p.label, paciente: p.label }))}
                onClear={() => setDados((d) => ({ ...d, leadId: '', leadName: '' }))}
              />
              <Input
                value={dados.paciente}
                onChange={(e) => setDados((d) => ({ ...d, paciente: e.target.value }))}
                placeholder="Nome do paciente"
                aria-label="Nome do paciente"
                disabled={!editavel}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ek-proc">Procedimento</Label>
              <Input
                id="ek-proc"
                value={dados.procedimento}
                onChange={(e) => setDados((d) => ({ ...d, procedimento: e.target.value }))}
                disabled={!editavel}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ek-data">Data</Label>
              <Input
                id="ek-data"
                type="date"
                value={dados.data}
                onChange={(e) => setDados((d) => ({ ...d, data: e.target.value }))}
                disabled={!editavel}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Venda da cirurgia</Label>
              <VendaDoKitPicker
                key={kit.leadId ?? 'sem-lead'}
                leadId={kit.leadId}
                data={kit.scheduledFor}
                value={kit.clinicSaleId}
                disabled={!editavel || pendentes > 0}
                onChange={(saleId) =>
                  void enfileirar('Venda do kit', () => vincularKitAVenda(kit.id, saleId)).then(() =>
                    toast.success(saleId ? 'Kit ligado à venda: o custo entra no resultado da cirurgia.' : 'Kit desligado da venda.'),
                  )
                }
              />
            </div>
            {dadosMudaram ? (
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void enfileirar('Dados do kit', () =>
                      atualizarKit({
                        id: kit.id,
                        leadId: dados.leadId || null,
                        patientName: dados.paciente || dados.leadName || null,
                        procedureLabel: dados.procedimento || null,
                        scheduledFor: dados.data || null,
                      }),
                    ).then(() => toast.success('Dados do kit salvos.'))
                  }
                >
                  Salvar paciente e procedimento
                </Button>
              </div>
            ) : null}
          </section>

          <section className="grid grid-cols-2 gap-px border-b border-border bg-border text-center">
            <div className="bg-background px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Custo dos materiais</p>
              <p className="text-base font-semibold tabular-nums">{formatBRL(custo)}</p>
            </div>
            <div className="bg-background px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cobrado do paciente</p>
              <p className="text-base font-semibold tabular-nums">{formatBRL(cobrado)}</p>
            </div>
          </section>

          {editavel ? (
            <section className="space-y-2 border-b border-border p-3 sm:p-4">
              <ScanBar onCode={onCode} placeholder="Bipe para incluir no kit" />
              <SearchPicker
                title="Incluir item no kit"
                placeholder="Incluir item pelo nome"
                searchPlaceholder="Nome, SKU ou código…"
                items={busca}
                value={null}
                onPick={(p) => {
                  const item = porId.get(p.id)
                  if (item) incluir(item)
                }}
              />
            </section>
          ) : null}

          <ul className="divide-y divide-border">
            {kit.items.map((l) => {
              const item = porId.get(l.itemId)
              const qty = qtdLocal[l.id] ?? l.qty
              const escolha = itemEhEscolha(item?.name)
              return (
                <li key={l.id} className="space-y-2 px-3 py-2.5 sm:px-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 text-sm font-medium leading-snug">
                        {l.label || item?.name || 'Item'}
                        {item?.controlled ? <ShieldAlert className="size-3.5 shrink-0 text-amber-500" aria-label="controlado" /> : null}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {l.isExtra ? 'avulso · ' : ''}
                        {l.returnedQty > 0 ? `voltaram ${formatQtd(l.returnedQty)} · ` : ''}
                        custo {formatBRL(Math.round((qty - l.returnedQty) * (lastCosts.get(l.itemId) ?? 0)))}
                        {escolha ? <span className="text-amber-700 dark:text-amber-300"> · item de escolha, troque</span> : null}
                      </p>
                    </div>
                    {editavel ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-muted-foreground"
                        onClick={() => setRemovendo(l.id)}
                        aria-label={`Tirar ${item?.name ?? 'item'} do kit`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    {editavel ? (
                      <QtyStepper value={qty} min={Math.max(l.returnedQty, 0.01)} label={item?.name ?? 'item'} onChange={(n) => mudarQtd(l.id, n)} />
                    ) : (
                      <span className="text-sm tabular-nums">{formatQtd(qty)}</span>
                    )}
                    <div className="relative w-32">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                      <Input
                        key={`${l.id}-${l.chargeCents}`}
                        defaultValue={reais(l.chargeCents)}
                        placeholder="cobrar"
                        inputMode="decimal"
                        disabled={!editavel}
                        aria-label={`Cobrança de ${item?.name ?? 'item'}`}
                        className="h-9 pl-8 text-right tabular-nums"
                        onBlur={(e) => {
                          const cents = centavos(e.target.value)
                          if (cents === l.chargeCents) return
                          void enfileirar('Cobrança', () => alterarLinhaKit({ kitItemId: l.id, qty: l.qty, cobrancaCents: cents }))
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border p-3 sm:justify-between sm:p-4">
          <Button variant="ghost" className="text-destructive" onClick={() => setExcluindo(true)} disabled={pendentes > 0}>
            <Trash2 className="size-4" aria-hidden /> Excluir kit
          </Button>
          <Button onClick={onClose} disabled={pendentes > 0}>
            {pendentes > 0 ? 'Salvando…' : 'Pronto'}
          </Button>
        </DialogFooter>

        <ConfirmDialog
          open={removendo != null}
          onOpenChange={(open) => !open && setRemovendo(null)}
          title="Tirar item do kit?"
          description="O que ainda está fora volta ao estoque agora."
          confirmLabel="Tirar do kit"
          onConfirm={() => {
            const id = removendo
            setRemovendo(null)
            if (id) void enfileirar('Tirar item', () => removerLinhaKit(id))
          }}
        />
        <ConfirmDialog
          open={excluindo}
          onOpenChange={setExcluindo}
          title="Excluir este kit?"
          description="Tudo que ainda está fora volta ao estoque e o kit some da lista e da conta do paciente. Use para kit lançado errado."
          confirmLabel="Excluir kit"
          onConfirm={() => {
            setExcluindo(false)
            void excluirKit(kit.id)
              .then(async () => {
                toast.success('Kit excluído e material devolvido ao estoque.')
                await onMudou()
                onClose()
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao excluir'))
          }}
        />
        <VincularCodigoDialog
          codigo={codigo}
          itens={items}
          onClose={() => setCodigo(null)}
          onVinculado={(item) => {
            setCodigo(null)
            onItemAtualizado(item)
            incluir(item)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
