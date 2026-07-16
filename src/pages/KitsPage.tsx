import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Boxes, Plus, Trash2, PackageCheck, Ban, ShieldAlert, Layers } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { useCrm } from '@/context/CrmContext'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type ControlledLogRow,
  type KitCost,
  type KitTemplate,
  type StockKit,
  cancelKit,
  consumeKit,
  createKit,
  createKitTemplate,
  deactivateKitTemplate,
  listControlledLog,
  listItemLastCosts,
  listKitCosts,
  listKitTemplates,
  listKits,
} from '@/services/estoqueKits'

type DraftRow = { itemId: string; qty: string }
const EMPTY_ROW: DraftRow = { itemId: '', qty: '' }

const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function KitsPage() {
  const { tenant } = useTenant()
  const crm = useCrm()
  const [items, setItems] = useState<StockItem[]>([])
  const [templates, setTemplates] = useState<KitTemplate[]>([])
  const [kits, setKits] = useState<StockKit[]>([])
  const [controlledLog, setControlledLog] = useState<ControlledLogRow[]>([])
  const [kitCosts, setKitCosts] = useState<Map<string, KitCost>>(new Map())
  const [lastCosts, setLastCosts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)

  // form de modelo
  const [tplName, setTplName] = useState('')
  const [tplRows, setTplRows] = useState<DraftRow[]>([{ ...EMPTY_ROW }])
  const [savingTpl, setSavingTpl] = useState(false)

  // form de kit montado
  const [kitTemplateId, setKitTemplateId] = useState('')
  const [kitLeadId, setKitLeadId] = useState('')
  const [kitPatient, setKitPatient] = useState('')
  const [kitProcedure, setKitProcedure] = useState('')
  const [kitDate, setKitDate] = useState('')
  const [savingKit, setSavingKit] = useState(false)

  // Leads do polo ativo, mais recentes primeiro — pra vincular o kit ao paciente do CRM.
  const poloLeads = useMemo(
    () =>
      crm.leads
        .filter((l) => !l.tenantId || l.tenantId === tenant.id)
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 200),
    [crm.leads, tenant.id],
  )
  const leadNameById = useMemo(
    () => new Map(crm.leads.map((l) => [l.id, l.patientName] as const)),
    [crm.leads],
  )

  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.name] as const)), [items])
  const controlledIds = useMemo(
    () => new Set(items.filter((i) => i.controlled).map((i) => i.id)),
    [items],
  )

  const load = async () => {
    setLoading(true)
    try {
      const [it, tpls, ks, log, costs, last] = await Promise.all([
        listStockItems(),
        listKitTemplates(),
        listKits(),
        listControlledLog(),
        listKitCosts(),
        listItemLastCosts(),
      ])
      setItems(it)
      setTemplates(tpls)
      setKits(ks)
      setControlledLog(log)
      setKitCosts(costs)
      setLastCosts(last)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar kits')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const saveTemplate = async () => {
    const rows = tplRows
      .map((r) => ({ itemId: r.itemId, qty: Number(r.qty.replace(',', '.')) || 0 }))
      .filter((r) => r.itemId && r.qty > 0)
    if (tplName.trim().length < 2 || rows.length === 0) {
      toast.error('Informe o nome e ao menos um item.')
      return
    }
    setSavingTpl(true)
    try {
      await createKitTemplate({ name: tplName, items: rows })
      toast.success(`Modelo "${tplName.trim()}" criado.`)
      setTplName('')
      setTplRows([{ ...EMPTY_ROW }])
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar modelo')
    } finally {
      setSavingTpl(false)
    }
  }

  const mountKit = async () => {
    const tpl = templates.find((t) => t.id === kitTemplateId)
    if (!tpl) {
      toast.error('Escolha um modelo de kit.')
      return
    }
    setSavingKit(true)
    try {
      // Se vinculou um lead e não digitou paciente, usa o nome do lead.
      const patientName = kitPatient.trim() || (kitLeadId ? leadNameById.get(kitLeadId) ?? '' : '')
      const { movements, controlled } = await createKit({
        templateId: tpl.id,
        name: tpl.name,
        leadId: kitLeadId || null,
        patientName,
        procedureLabel: kitProcedure,
        scheduledFor: kitDate || null,
        items: tpl.items.map((i) => ({ itemId: i.itemId, qty: i.qty })),
        controlledItemIds: controlledIds,
      })
      toast.success(
        `Kit "${tpl.name}" montado${patientName ? ` para ${patientName}` : ''} — ` +
          `${movements} ${movements === 1 ? 'baixa' : 'baixas'} no estoque (FEFO)` +
          (controlled > 0 ? `, ${controlled} no livro de controlados` : '') + '.',
      )
      setKitTemplateId('')
      setKitLeadId('')
      setKitPatient('')
      setKitProcedure('')
      setKitDate('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao montar kit')
    } finally {
      setSavingKit(false)
    }
  }

  // Conferência: confirma que o kit foi usado. O material JÁ saiu na montagem — aqui é só o
  // carimbo de "cirurgia aconteceu" (fecha o custo do procedimento).
  const consume = async (kit: StockKit) => {
    try {
      await consumeKit(kit)
      toast.success(`Kit confirmado como usado${kit.patientName ? ` em ${kit.patientName}` : ''}.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao confirmar kit')
    }
  }

  // Cancelar DEVOLVE o material pro estoque (a baixa foi na montagem).
  const handleCancel = async (kit: StockKit) => {
    try {
      const { restored } = await cancelKit(kit)
      toast.success(
        restored > 0
          ? `Kit cancelado — ${restored} ${restored === 1 ? 'item devolvido' : 'itens devolvidos'} ao estoque.`
          : 'Kit cancelado.',
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar')
    }
  }

  return (
    <AppLayout
      title="Kits cirúrgicos"
      subtitle="Monte o kit do paciente e o material já baixa do estoque (FEFO + livro de controlados). Cancelar devolve."
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers className="size-4 text-primary" /> Novo modelo de kit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Nome do modelo</Label>
                <Input
                  id="tpl-name"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="Ex.: Kit transplante capilar"
                />
              </div>
              <div className="space-y-2">
                <Label>Itens</Label>
                {tplRows.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <Select value={row.itemId} onValueChange={(v) => setTplRows((prev) => prev.map((r, j) => (j === i ? { ...r, itemId: v ?? '' } : r)))}>
                      <SelectTrigger className="h-8 flex-1">
                        <SelectValue placeholder="Item" />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((it) => (
                          <SelectItem key={it.id} value={it.id}>
                            {it.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={row.qty}
                      onChange={(e) => setTplRows((prev) => prev.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))}
                      placeholder="Qtd"
                      inputMode="decimal"
                      className="h-8 w-20"
                    />
                    {tplRows.length > 1 ? (
                      <Button variant="ghost" size="sm" className="px-2" onClick={() => setTplRows((prev) => prev.filter((_, j) => j !== i))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setTplRows((prev) => [...prev, { ...EMPTY_ROW }])}>
                  <Plus className="size-3.5" /> Adicionar item
                </Button>
              </div>
              <Button className="w-full" onClick={saveTemplate} disabled={savingTpl}>
                {savingTpl ? 'Salvando…' : 'Criar modelo'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Boxes className="size-4 text-primary" /> Montar kit p/ paciente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Modelo</Label>
                <Select value={kitTemplateId} onValueChange={(v) => setKitTemplateId(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolher modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.items.length} itens)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Lead do CRM (opcional)</Label>
                <Select value={kitLeadId || 'nenhum'} onValueChange={(v) => setKitLeadId(!v || v === 'nenhum' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vincular a um lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Sem vínculo</SelectItem>
                    {poloLeads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.patientName}
                        {l.phone ? ` · ${l.phone}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="kit-patient">Paciente</Label>
                  <Input
                    id="kit-patient"
                    value={kitPatient}
                    onChange={(e) => setKitPatient(e.target.value)}
                    placeholder={kitLeadId ? leadNameById.get(kitLeadId) ?? 'Nome' : 'Nome'}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kit-date">Data</Label>
                  <Input id="kit-date" type="date" value={kitDate} onChange={(e) => setKitDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kit-proc">Procedimento</Label>
                <Input id="kit-proc" value={kitProcedure} onChange={(e) => setKitProcedure(e.target.value)} placeholder="Ex.: FUE 2500 folículos" />
              </div>
              <Button className="w-full" onClick={mountKit} disabled={savingKit}>
                {savingKit ? 'Montando…' : 'Montar kit'}
              </Button>
            </CardContent>
          </Card>

          {templates.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Modelos ({templates.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.items.map((i) => `${i.qty}× ${itemName.get(i.itemId) ?? '?'}`).join(', ')}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="px-2" onClick={() => void deactivateKitTemplate(t.id).then(load)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <PackageCheck className="size-4 text-primary" /> Kits montados
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {kits.length === 0 ? (
                <EmptyState
                  icon={PackageCheck}
                  title={loading ? 'Carregando…' : 'Nenhum kit montado'}
                  description="Crie um modelo e monte o kit para um paciente. A baixa acontece só quando a enfermagem confirma o consumo."
                />
              ) : (
                kits.map((kit) => {
                  const hasControlled = kit.items.some((i) => controlledIds.has(i.itemId))
                  // Custo em materiais: real (movimentos valorados) p/ consumido;
                  // estimado pelo último custo de compra p/ kit ainda montado.
                  const realCost = kit.status === 'consumido' ? kitCosts.get(kit.id) : undefined
                  const estimate = kit.items.reduce(
                    (acc, i) => {
                      const c = lastCosts.get(i.itemId)
                      if (c == null || c <= 0) return { cents: acc.cents, missing: acc.missing + 1 }
                      return { cents: acc.cents + Math.round(i.qty * c), missing: acc.missing }
                    },
                    { cents: 0, missing: 0 },
                  )
                  return (
                    <div key={kit.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{kit.name}</span>
                          <Badge
                            variant="secondary"
                            className={
                              kit.status === 'consumido'
                                ? 'bg-emerald-500/15 text-emerald-600'
                                : kit.status === 'cancelado'
                                  ? 'bg-red-500/15 text-red-600'
                                  : 'bg-sky-500/15 text-sky-600'
                            }
                          >
                            {kit.status}
                          </Badge>
                          {hasControlled ? (
                            <Badge variant="secondary" className="bg-amber-500/15 text-amber-600">
                              <ShieldAlert className="mr-1 size-3" /> controlado
                            </Badge>
                          ) : null}
                        </div>
                        {kit.scheduledFor ? (
                          <span className="text-xs text-muted-foreground">
                            {new Date(`${kit.scheduledFor}T12:00:00`).toLocaleDateString('pt-BR')}
                          </span>
                        ) : null}
                      </div>
                      {kit.patientName || kit.procedureLabel ? (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{[kit.patientName, kit.procedureLabel].filter(Boolean).join(' · ')}</span>
                          {kit.leadId ? (
                            <Badge variant="secondary" className="bg-primary/10 text-primary">
                              lead vinculado
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                      <ul className="mt-2 space-y-0.5 text-sm">
                        {kit.items.map((i) => (
                          <li key={i.id} className="flex justify-between gap-2">
                            <span>{i.qty}× {itemName.get(i.itemId) ?? '?'}</span>
                            {controlledIds.has(i.itemId) ? <ShieldAlert className="size-3.5 text-amber-500" /> : null}
                          </li>
                        ))}
                      </ul>
                      {realCost ? (
                        <div className="mt-1.5 text-xs font-medium">
                          Materiais: <span className="font-semibold">{formatBRL(realCost.totalCostCents)}</span>
                          {!realCost.fullyCosted ? (
                            <span className="ml-1 text-muted-foreground">(parcial — há item sem custo)</span>
                          ) : null}
                        </div>
                      ) : kit.status === 'montado' && estimate.cents > 0 ? (
                        <div className="mt-1.5 text-xs font-medium text-muted-foreground">
                          Materiais: ≈ {formatBRL(estimate.cents)}
                          {estimate.missing > 0 ? ` (${estimate.missing} ${estimate.missing === 1 ? 'item' : 'itens'} sem custo)` : ''}
                        </div>
                      ) : null}
                      {kit.status === 'montado' ? (
                        <div className="mt-2.5 flex gap-1.5">
                          <Button size="sm" onClick={() => void consume(kit)}>
                            <PackageCheck className="size-3.5" /> Confirmar uso
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void handleCancel(kit)} title="Devolve o material ao estoque">
                            <Ban className="size-3.5" /> Cancelar (devolve ao estoque)
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldAlert className="size-4 text-amber-500" /> Livro de controlados ({controlledLog.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {controlledLog.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Sem movimentos de substâncias controladas. Marque um item como “controlado” no cadastro para rastreá-lo aqui.
                </p>
              ) : (
                controlledLog.map((row) => (
                  <div key={row.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <span className={row.action === 'saida' ? 'font-semibold text-red-500' : 'font-semibold text-emerald-600'}>
                        {row.action === 'saida' ? '−' : '+'}{row.qty}
                      </span>{' '}
                      <span>{itemName.get(row.itemId) ?? '?'}</span>
                      {row.patientName ? <span className="text-xs text-muted-foreground"> · {row.patientName}</span> : null}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
