import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Camera,
  ScanBarcode,
  ShieldAlert,
  Trash2,
} from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { estoqueTabs } from '@/pages/EstoquePage'
import {
  type StockItem,
  listStockItems,
  registerMovement,
  upsertStockItem,
} from '@/services/estoqueCompras'
import {
  allocateFefo,
  ensureBatch,
  listBatchBalances,
  listBatchCosts,
  listItemLastCosts,
  logControlledEntry,
  logControlledExit,
} from '@/services/estoqueKits'
import { pushBlingStockEntry } from '@/services/crmBling'
import { BarcodeCameraDialog } from '@/components/estoque/BarcodeCameraDialog'
import { useTenant } from '@/context/TenantContext'

// Bipagem contínua com leitor USB (modo teclado: digita o código + Enter).
// Fluxo pensado pra caixa chegando ou material saindo: escolhe Entrada ou Saída,
// bipa item por item (repetir o bipe soma quantidade), ajusta o que precisar e
// confirma tudo de uma vez. Código desconhecido abre o cadastro na hora.

type ScanLine = {
  item: StockItem
  qty: number
  // entrada
  lotCode: string
  expiresOn: string
  unitCost: string
}

const EMPTY_NEW_ITEM = { name: '', category: '', unit: 'un', controlled: false }

/** Beep curto de confirmação (agudo) ou de erro (grave) — feedback sem olhar pra tela. */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 1400 : 260
    gain.gain.value = 0.08
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.09 : 0.25))
    osc.onended = () => void ctx.close()
  } catch {
    /* sem áudio, segue o jogo */
  }
}

export function BipagemPage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(false)

  const [mode, setMode] = useState<'entrada' | 'saida'>('entrada')
  const [lines, setLines] = useState<ScanLine[]>([])
  const [reason, setReason] = useState('')
  const [patient, setPatient] = useState('')
  const [confirming, setConfirming] = useState(false)

  const [scanCode, setScanCode] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const scanRef = useRef<HTMLInputElement | null>(null)

  // cadastro rápido de código desconhecido
  const [newBarcode, setNewBarcode] = useState<string | null>(null)
  const [newForm, setNewForm] = useState({ ...EMPTY_NEW_ITEM })
  const [savingNew, setSavingNew] = useState(false)

  const dialogOpen = cameraOpen || newBarcode != null

  const load = async () => {
    setLoading(true)
    try {
      setItems(await listStockItems())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o estoque')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // O leitor USB "digita" onde estiver o foco — então o campo de bipar segura o
  // foco da tela; quando um dialog fecha, o foco volta sozinho.
  useEffect(() => {
    if (!dialogOpen) {
      const t = window.setTimeout(() => scanRef.current?.focus(), 120)
      return () => window.clearTimeout(t)
    }
  }, [dialogOpen, lines.length, mode])

  const addItem = (item: StockItem) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.item.id === item.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, { item, qty: 1, lotCode: '', expiresOn: '', unitCost: '' }]
    })
  }

  const handleScanned = (raw: string) => {
    const code = raw.trim()
    if (!code) return
    setCameraOpen(false)
    setScanCode('')
    const found = items.find((i) => i.barcode === code) ?? items.find((i) => (i.sku ?? '') === code)
    if (found) {
      addItem(found)
      beep(true)
    } else {
      beep(false)
      setNewForm({ ...EMPTY_NEW_ITEM })
      setNewBarcode(code)
    }
  }

  const handleSaveNew = async () => {
    if (!newBarcode) return
    if (newForm.name.trim().length < 2) {
      toast.error('Informe o nome do item.')
      return
    }
    setSavingNew(true)
    try {
      const id = await upsertStockItem({
        name: newForm.name,
        barcode: newBarcode,
        category: newForm.category || null,
        unit: newForm.unit,
        controlled: newForm.controlled,
      })
      const fresh = await listStockItems()
      setItems(fresh)
      const created = fresh.find((i) => i.id === id)
      if (created) addItem(created)
      toast.success(`Item "${newForm.name.trim()}" cadastrado e adicionado à bipagem.`)
      setNewBarcode(null)
      beep(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cadastrar item')
    } finally {
      setSavingNew(false)
    }
  }

  const setLine = (itemId: string, patch: Partial<Omit<ScanLine, 'item'>>) => {
    setLines((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, ...patch } : l)))
  }

  const removeLine = (itemId: string) => {
    setLines((prev) => prev.filter((l) => l.item.id !== itemId))
  }

  const totalQty = useMemo(() => lines.reduce((acc, l) => acc + l.qty, 0), [lines])
  const hasControlled = lines.some((l) => l.item.controlled)
  const insufficient = mode === 'saida' ? lines.filter((l) => l.qty > l.item.qty) : []

  const handleConfirm = async () => {
    if (lines.length === 0) return
    if (lines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) {
      toast.error('Tem linha com quantidade zerada — ajuste ou remova.')
      return
    }
    if (mode === 'saida' && hasControlled && !patient.trim()) {
      toast.error('Saída de item controlado precisa do nome do paciente (livro de controlados).')
      return
    }
    setConfirming(true)
    try {
      let movements = 0
      if (mode === 'entrada') {
        for (const line of lines) {
          const costNumber = Number(line.unitCost.replace(/\./g, '').replace(',', '.'))
          const unitCostCents = Number.isFinite(costNumber) && costNumber > 0 ? Math.round(costNumber * 100) : null
          const batchId = line.lotCode.trim()
            ? await ensureBatch({ itemId: line.item.id, lotCode: line.lotCode, expiresOn: line.expiresOn || null })
            : null
          const movementId = await registerMovement({
            itemId: line.item.id,
            kind: 'entrada',
            qty: line.qty,
            reason: reason.trim() || 'entrada por bipagem',
            refType: 'bipagem',
            batchId,
            unitCostCents,
          })
          movements += 1
          if (line.item.controlled) {
            await logControlledEntry({ itemId: line.item.id, batchId, movementId, qty: line.qty, note: reason })
          }
          if (line.item.blingProductId) {
            // espelho no Bling é best-effort — falha não trava a entrada local
            try {
              await pushBlingStockEntry({
                blingProductId: line.item.blingProductId,
                qty: line.qty,
                ...(unitCostCents ? { unitCostCents } : {}),
                note: 'entrada por bipagem',
              })
            } catch {
              toast.warning(`${line.item.name}: entrou no CRM, mas o espelho no Bling falhou.`)
            }
          }
        }
      } else {
        const [batchCosts, lastCosts] = await Promise.all([listBatchCosts(), listItemLastCosts()])
        for (const line of lines) {
          const batches = await listBatchBalances(line.item.id)
          const allocation = allocateFefo(batches, line.qty)
          for (const slice of allocation) {
            const unitCostCents =
              (slice.batchId ? batchCosts.get(slice.batchId) : undefined) ?? lastCosts.get(line.item.id) ?? null
            const movementId = await registerMovement({
              itemId: line.item.id,
              kind: 'saida',
              qty: slice.qty,
              reason: reason.trim() || 'saída por bipagem',
              note: patient.trim() ? `Paciente: ${patient.trim()}` : undefined,
              refType: 'bipagem',
              batchId: slice.batchId,
              unitCostCents,
            })
            movements += 1
            if (line.item.controlled) {
              await logControlledExit({
                itemId: line.item.id,
                batchId: slice.batchId,
                movementId,
                qty: slice.qty,
                patientName: patient,
                note: reason || null,
              })
            }
          }
        }
      }
      toast.success(
        mode === 'entrada'
          ? `Entrada registrada: ${totalQty} ${totalQty === 1 ? 'unidade' : 'unidades'} em ${lines.length} ${lines.length === 1 ? 'item' : 'itens'}.`
          : `Saída registrada: ${totalQty} ${totalQty === 1 ? 'unidade' : 'unidades'} de ${lines.length} ${lines.length === 1 ? 'item' : 'itens'} (${movements} ${movements === 1 ? 'movimento' : 'movimentos'} por lote).`,
      )
      setLines([])
      setReason('')
      setPatient('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar movimentos')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <AppLayout
      title="Bipagem"
      subtitle="Entrada e saída contínuas com o leitor de código de barras — bipe tudo, confira e confirme de uma vez."
    >
      <SubTabs tabs={estoqueTabs(isSalesPolo)} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScanBarcode className="size-4 text-primary" /> Bipar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={mode === 'entrada' ? 'default' : 'outline'}
                onClick={() => setMode('entrada')}
                disabled={confirming || lines.length > 0}
              >
                <ArrowDownToLine className="size-4" /> Entrada
              </Button>
              <Button
                variant={mode === 'saida' ? 'default' : 'outline'}
                onClick={() => setMode('saida')}
                disabled={confirming || lines.length > 0}
              >
                <ArrowUpFromLine className="size-4" /> Saída
              </Button>
            </div>
            {lines.length > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Pra trocar entre entrada e saída, confirme ou limpe a lista atual.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="bip-scan">Código de barras</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="bip-scan"
                  ref={scanRef}
                  autoFocus
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleScanned(scanCode)
                    }
                  }}
                  onBlur={() => {
                    // O leitor USB digita onde o cursor estiver, então este campo segura o
                    // foco. MAS só devolve o foco quando ninguém está usando outro campo —
                    // senão clicar em Motivo/Paciente/Qtd/Lote perde o foco na hora (o campo
                    // "desseleciona"). Passados os 120ms, se o foco já está num input/botão/
                    // select da tela, respeita: o operador está digitando lá.
                    if (dialogOpen) return
                    window.setTimeout(() => {
                      const active = document.activeElement as HTMLElement | null
                      if (
                        active &&
                        active !== document.body &&
                        active !== scanRef.current &&
                        active.closest('input, textarea, select, button, [role="combobox"], [contenteditable="true"]')
                      ) {
                        return
                      }
                      scanRef.current?.focus()
                    }, 120)
                  }}
                  placeholder="Bipe com o leitor…"
                  inputMode="numeric"
                  className="h-11 text-base"
                />
                <Button variant="outline" className="h-11 px-3" onClick={() => setCameraOpen(true)} title="Ler pela câmera">
                  <Camera className="size-4" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Bipar o mesmo item de novo soma +1 na quantidade. Código desconhecido abre o cadastro.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bip-reason">Motivo</Label>
              <Input
                id="bip-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={mode === 'entrada' ? 'Ex.: compra avulsa, reposição…' : 'Ex.: uso em procedimento…'}
              />
            </div>

            {mode === 'saida' ? (
              <div className="space-y-1.5">
                <Label htmlFor="bip-patient" className="flex items-center gap-1.5">
                  Paciente
                  {hasControlled ? <ShieldAlert className="size-3.5 text-amber-500" /> : null}
                </Label>
                <Input
                  id="bip-patient"
                  value={patient}
                  onChange={(e) => setPatient(e.target.value)}
                  placeholder={hasControlled ? 'Obrigatório — tem item controlado na lista' : 'Opcional'}
                />
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void handleConfirm()} disabled={confirming || lines.length === 0}>
                {confirming
                  ? 'Registrando…'
                  : lines.length === 0
                    ? mode === 'entrada'
                      ? 'Confirmar entrada'
                      : 'Confirmar saída'
                    : `Confirmar ${mode === 'entrada' ? 'entrada' : 'saída'} (${totalQty})`}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setLines([])
                  setReason('')
                  setPatient('')
                }}
                disabled={confirming || lines.length === 0}
              >
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              {mode === 'entrada' ? (
                <ArrowDownToLine className="size-4 text-emerald-600" />
              ) : (
                <ArrowUpFromLine className="size-4 text-red-500" />
              )}
              {mode === 'entrada' ? 'Itens bipados — entrada' : 'Itens bipados — saída'} ({lines.length})
            </CardTitle>
            {insufficient.length > 0 ? (
              <Badge variant="destructive">
                {insufficient.length === 1 ? 'Saldo insuficiente em 1 item' : `Saldo insuficiente em ${insufficient.length} itens`}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <EmptyState
                icon={ScanBarcode}
                title={loading ? 'Carregando…' : 'Nada bipado ainda'}
                description="Aponte o leitor pro código de barras do produto — cada bipe entra aqui na lista."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="w-[90px] text-right">Qtd</TableHead>
                      {mode === 'entrada' ? (
                        <>
                          <TableHead className="w-[120px]">Lote</TableHead>
                          <TableHead className="w-[140px]">Validade</TableHead>
                          <TableHead className="w-[120px]">Custo un. (R$)</TableHead>
                        </>
                      ) : null}
                      <TableHead className="w-[40px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => {
                      const short = mode === 'saida' && line.qty > line.item.qty
                      return (
                        <TableRow key={line.item.id}>
                          <TableCell>
                            <div className="flex items-center gap-1.5 font-medium">
                              {line.item.name}
                              {line.item.controlled ? <ShieldAlert className="size-3.5 text-amber-500" /> : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {[line.item.barcode, line.item.category].filter(Boolean).join(' · ')}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={short ? 'destructive' : 'secondary'}>
                              {line.item.qty} {line.item.unit}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              value={String(line.qty)}
                              onChange={(e) => {
                                const n = Number(e.target.value.replace(',', '.'))
                                setLine(line.item.id, { qty: Number.isFinite(n) && n >= 0 ? n : 0 })
                              }}
                              inputMode="decimal"
                              className="h-8 text-right"
                            />
                          </TableCell>
                          {mode === 'entrada' ? (
                            <>
                              <TableCell>
                                <Input
                                  value={line.lotCode}
                                  onChange={(e) => setLine(line.item.id, { lotCode: e.target.value })}
                                  placeholder="Opcional"
                                  className="h-8"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="date"
                                  value={line.expiresOn}
                                  onChange={(e) => setLine(line.item.id, { expiresOn: e.target.value })}
                                  className="h-8"
                                  disabled={!line.lotCode.trim()}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={line.unitCost}
                                  onChange={(e) => setLine(line.item.id, { unitCost: e.target.value })}
                                  placeholder="Opcional"
                                  inputMode="decimal"
                                  className="h-8"
                                />
                              </TableCell>
                            </>
                          ) : null}
                          <TableCell>
                            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => removeLine(line.item.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {mode === 'saida' && insufficient.length > 0 ? (
              <p className="mt-2 text-xs text-amber-600">
                A saída vai ficar maior que o saldo em: {insufficient.map((l) => l.item.name).join(', ')}. Dá pra registrar
                mesmo assim (o saldo fica negativo), mas vale conferir a contagem.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={newBarcode != null} onOpenChange={(open) => (!open ? setNewBarcode(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Código não cadastrado</DialogTitle>
            <DialogDescription>
              Código {newBarcode} não está no estoque. Cadastre o item agora pra continuar a bipagem.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bip-new-name">Nome</Label>
              <Input
                id="bip-new-name"
                autoFocus
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSaveNew()
                  }
                }}
                placeholder="Ex.: Luva nitrílica M"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="bip-new-cat">Categoria</Label>
                <Input
                  id="bip-new-cat"
                  value={newForm.category}
                  onChange={(e) => setNewForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unidade</Label>
                <Select value={newForm.unit} onValueChange={(v) => setNewForm((f) => ({ ...f, unit: v ?? 'un' }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['un', 'cx', 'pct', 'ml', 'g', 'kg', 'frasco', 'ampola'].map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newForm.controlled}
                onChange={(e) => setNewForm((f) => ({ ...f, controlled: e.target.checked }))}
                className="size-4 accent-amber-500"
              />
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="size-3.5 text-amber-500" /> Substância controlada
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBarcode(null)} disabled={savingNew}>
              Ignorar bipe
            </Button>
            <Button onClick={() => void handleSaveNew()} disabled={savingNew}>
              {savingNew ? 'Cadastrando…' : 'Cadastrar e adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BarcodeCameraDialog open={cameraOpen} onOpenChange={setCameraOpen} onScan={handleScanned} />
    </AppLayout>
  )
}
