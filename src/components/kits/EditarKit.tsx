import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Printer, ShieldAlert, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { SearchPicker } from '@/components/ui/search-picker'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { STATUS_KIT, formatBRL, formatQtd, itemEhEscolha, ordenarPorNome, produtosParaBusca, semCodigoBipado } from '@/components/kits/kitUi'
import { VendaDoKitPicker } from '@/components/kits/VendaDoKitPicker'
import { vincularKitAVenda } from '@/services/resultadoProcedimentos'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { searchLeadsByName } from '@/services/clinicalNotes'
import type { StockItem } from '@/services/estoqueCompras'
import {
  type StockKit,
  adicionarItemKit,
  alterarLinhaKit,
  alterarVoltouLinhaKit,
  atualizarKit,
  excluirKit,
  imprimirContaDoKit,
  removerLinhaKit,
} from '@/services/estoqueKits'

const reais = (cents: number) => (cents > 0 ? (cents / 100).toFixed(2).replace('.', ',') : '')
const centavos = (texto: string) => {
  const n = Number(texto.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** Espera o dedo parar: cinco toques no + viram uma baixa só. */
const ESPERA_QTD_MS = 650

/**
 * A conta do paciente é o kit: o que saiu, o que voltou e o que se cobra. Aqui a enfermagem
 * corrige tudo depois de montado, sem cancelar e montar de novo, numa tela própria (era um
 * popup). Cada mudança vai ao banco na hora (baixa ou devolve a diferença), em fila, para dois
 * toques rápidos não se atropelarem.
 */
export function EditarKit({
  kit,
  tenantId,
  items,
  lastCosts,
  onMudou,
  onItemAtualizado,
  onConcluir,
  onExcluido,
}: {
  kit: StockKit
  tenantId: string
  items: StockItem[]
  lastCosts: Map<string, number>
  onMudou: () => Promise<void> | void
  onItemAtualizado: (item: StockItem) => void
  /** "Pronto": só depois de tudo gravado. */
  onConcluir: () => void
  onExcluido: () => void
}) {
  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const busca = useMemo(() => produtosParaBusca(items), [items])
  const fila = useRef<Promise<unknown>>(Promise.resolve())
  // Número digitado que ainda espera o dedo parar: "saiu:<linha>" ou "voltou:<linha>" → gravação.
  const esperando = useRef(new Map<string, { timer: number; rotulo: string; gravar: () => Promise<unknown> }>())
  const [pendentes, setPendentes] = useState(0)
  // Valor na tela antes de o banco confirmar, pela mesma chave de `esperando`.
  const [local, setLocal] = useState<Record<string, number>>({})
  const [removendo, setRemovendo] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [concluindo, setConcluindo] = useState(false)
  const [imprimindo, setImprimindo] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [pesquisa, setPesquisa] = useState('')
  const termo = useDeferredValue(pesquisa)

  const [dados, setDados] = useState(() => ({
    leadId: kit.leadId ?? '',
    leadName: kit.patientName ?? '',
    paciente: kit.patientName ?? '',
    procedimento: kit.procedureLabel ?? '',
    data: kit.scheduledFor ?? '',
  }))
  const dadosMudaram =
    (dados.leadId || null) !== kit.leadId ||
    (dados.paciente.trim() || null) !== (kit.patientName ?? null) ||
    (dados.procedimento.trim() || null) !== (kit.procedureLabel ?? null) ||
    (dados.data || null) !== (kit.scheduledFor ?? null)

  // Saiu da tela (voltar do navegador) com número ainda esperando: grava assim mesmo.
  // Antes o timer era só cancelado, e a mudança feita no último meio segundo sumia.
  useEffect(() => {
    const mapa = esperando.current
    return () => {
      mapa.forEach(({ timer, rotulo, gravar }) => {
        window.clearTimeout(timer)
        void gravar().catch((e) => toast.error(`${rotulo}: ${e instanceof Error ? e.message : 'falhou'}`))
      })
      mapa.clear()
    }
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

  const editavel = kit.status !== 'cancelado'

  const gravar = (chave: string) => {
    const espera = esperando.current.get(chave)
    if (!espera) return
    window.clearTimeout(espera.timer)
    esperando.current.delete(chave)
    void enfileirar(espera.rotulo, espera.gravar).then(() =>
      setLocal((prev) => {
        const next = { ...prev }
        delete next[chave]
        return next
      }),
    )
  }

  const agendar = (chave: string, valor: number, rotulo: string, gravarNoBanco: () => Promise<unknown>) => {
    setLocal((prev) => ({ ...prev, [chave]: valor }))
    const anterior = esperando.current.get(chave)
    if (anterior) window.clearTimeout(anterior.timer)
    esperando.current.set(chave, { rotulo, gravar: gravarNoBanco, timer: window.setTimeout(() => gravar(chave), ESPERA_QTD_MS) })
  }

  const mudarQtd = (linhaId: string, qty: number) =>
    agendar(`saiu:${linhaId}`, qty, 'Quantidade', () => alterarLinhaKit({ kitItemId: linhaId, qty }))

  // Sobra da bandeja, para mais ou para menos: voltar a 0 desfaz devolução marcada por engano.
  const mudarVoltou = (linha: StockKit['items'][number], voltou: number) =>
    agendar(`voltou:${linha.id}`, voltou, 'Voltou', () => alterarVoltouLinhaKit(kit.id, linha.id, voltou))

  const concluir = async () => {
    setConcluindo(true)
    for (const chave of [...esperando.current.keys()]) gravar(chave)
    await fila.current.catch(() => undefined)
    onConcluir()
  }

  const incluir = (item: StockItem) => {
    const existente = kit.items.find((l) => l.itemId === item.id)
    beep(true)
    if (existente) {
      const atual = local[`saiu:${existente.id}`] ?? existente.qty
      mudarQtd(existente.id, atual + 1)
      toast.success(`${item.name}: ${formatQtd(atual + 1)} no kit`)
    } else {
      void enfileirar('Incluir item', () => adicionarItemKit({ kitId: kit.id, itemId: item.id, qty: 1 }))
      toast.success(`${item.name} incluído no kit`)
    }
  }

  const onCode = (code: string) => {
    setPesquisa((p) => semCodigoBipado(p, code))
    const item = acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    incluir(item)
  }

  const custo = kit.items.reduce(
    (s, l) =>
      s + Math.round(Math.max(0, (local[`saiu:${l.id}`] ?? l.qty) - (local[`voltou:${l.id}`] ?? l.returnedQty)) * (lastCosts.get(l.itemId) ?? 0)),
    0,
  )
  const cobrado = kit.items.reduce((s, l) => s + Math.max(0, l.chargeCents), 0)
  const status = STATUS_KIT[kit.status]
  const nomeDaLinha = (l: StockKit['items'][number]) => l.label || porId.get(l.itemId)?.name
  const linhasVisiveis = ordenarPorNome(
    kit.items.filter((l) => {
      const item = porId.get(l.itemId)
      return combinaBusca(termo, l.label, item?.name, item?.sku, item?.barcode)
    }),
    nomeDaLinha,
  )
  const ocupado = pendentes > 0 || concluindo

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 sm:p-4">
        <div className="flex items-center gap-2 sm:col-span-2">
          <Badge variant="secondary" className={status.className}>
            {status.label}
          </Badge>
          <span className="text-xs text-muted-foreground">Mude o que saiu, o que voltou ou a cobrança: o estoque acerta na hora.</span>
        </div>
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

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-2 gap-px bg-border text-center">
          <div className="bg-card px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Custo dos materiais</p>
            <p className="text-base font-semibold tabular-nums">{formatBRL(custo)}</p>
          </div>
          <div className="bg-card px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cobrado do paciente</p>
            <p className="text-base font-semibold tabular-nums">{formatBRL(cobrado)}</p>
          </div>
        </div>
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            className="h-9 w-full"
            disabled={ocupado || imprimindo}
            onClick={() => {
              setImprimindo(true)
              void imprimirContaDoKit(
                kit,
                new Map(items.map((i) => [i.id, { name: i.name, controlled: i.controlled }] as const)),
                lastCosts,
              )
                .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao imprimir'))
                .finally(() => setImprimindo(false))
            }}
          >
            <Printer className="size-4" aria-hidden /> {pendentes > 0 ? 'Aguarde salvar para imprimir' : 'Imprimir ou salvar a conta (PDF)'}
          </Button>
        </div>
      </section>

      {editavel ? (
        <section className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
          <h2 className="text-sm font-semibold">Incluir item</h2>
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

      <section className="rounded-xl border border-border bg-card">
        <div className="sticky top-0 z-10 rounded-t-xl border-b border-border bg-card p-3 sm:p-4">
          <SearchField
            value={pesquisa}
            onChange={setPesquisa}
            label={`Buscar entre os ${kit.items.length} itens do kit`}
            resultados={linhasVisiveis.length}
          />
        </div>

        <ul className="divide-y divide-border">
          {linhasVisiveis.map((l) => {
            const item = porId.get(l.itemId)
            const nome = l.label || item?.name || 'Item'
            const saiu = local[`saiu:${l.id}`] ?? l.qty
            const voltou = local[`voltou:${l.id}`] ?? l.returnedQty
            const usado = Math.max(0, saiu - voltou)
            const escolha = itemEhEscolha(item?.name)
            return (
              <li key={l.id} className="space-y-2 px-3 py-3 sm:px-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-sm font-medium leading-snug">
                      {nome}
                      {item?.controlled ? <ShieldAlert className="size-3.5 shrink-0 text-amber-500" aria-label="controlado" /> : null}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {l.isExtra ? 'avulso · ' : ''}
                      <span className="font-medium text-foreground">usado {formatQtd(usado)}</span>
                      {' · '}custo {formatBRL(Math.round(usado * (lastCosts.get(l.itemId) ?? 0)))}
                      {escolha ? <span className="text-amber-700 dark:text-amber-300"> · item de escolha, troque</span> : null}
                    </p>
                  </div>
                  {editavel ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0 text-muted-foreground"
                      onClick={() => setRemovendo(l.id)}
                      aria-label={`Tirar ${nome} do kit`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 items-end gap-x-3 gap-y-2 sm:grid-cols-[auto_auto_1fr]">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Saiu</span>
                    {editavel ? (
                      <QtyStepper value={saiu} min={Math.max(voltou, 0.01)} label={`saída de ${nome}`} onChange={(n) => mudarQtd(l.id, n)} />
                    ) : (
                      <span className="text-sm tabular-nums">{formatQtd(saiu)}</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Voltou</span>
                    {editavel ? (
                      <QtyStepper value={voltou} max={saiu} label={`devolução de ${nome}`} onChange={(n) => mudarVoltou(l, n)} />
                    ) : (
                      <span className="text-sm tabular-nums">{formatQtd(voltou)}</span>
                    )}
                  </div>
                  <div className="col-span-2 space-y-1 sm:col-span-1 sm:justify-self-end">
                    <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-right">Cobrar do paciente</span>
                    <div className="relative sm:w-36">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                      <Input
                        key={`${l.id}-${l.chargeCents}`}
                        defaultValue={reais(l.chargeCents)}
                        placeholder="0,00"
                        inputMode="decimal"
                        disabled={!editavel}
                        aria-label={`Cobrança de ${nome}`}
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
                </div>
              </li>
            )
          })}
          {termo && linhasVisiveis.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum item com "{termo}" neste kit.</li>
          ) : null}
        </ul>
      </section>

      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.25)] sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="h-10 shrink-0 text-destructive" onClick={() => setExcluindo(true)} disabled={ocupado}>
            <Trash2 className="size-4" aria-hidden /> Excluir kit
          </Button>
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground" aria-live="polite">
            {pendentes > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" aria-hidden /> salvando
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3" aria-hidden /> tudo salvo
              </span>
            )}
          </span>
          <Button onClick={() => void concluir()} disabled={concluindo} className="h-10 shrink-0 px-5">
            {concluindo ? 'Salvando…' : 'Pronto'}
          </Button>
        </div>
      </div>

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
            .then(() => {
              toast.success('Kit excluído e material devolvido ao estoque.')
              onExcluido()
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
    </div>
  )
}
