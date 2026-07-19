import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, RefreshCw, ShieldAlert, CheckCircle2, XCircle, Loader2, Settings2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { financeiroTabs } from '@/pages/EstoquePage'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type NfeRow,
  getBlingOrderConfig,
  setBlingOrderConfig,
  nfeList,
  nfeEmit,
} from '@/services/crmBling'
import { useTenant } from '@/context/TenantContext'

// Emissão de NF-e em lote: depois da conciliação do dia, o operador filtra as vendas pagas,
// marca as que quer, e emite todas de uma vez pelo Bling. Cada linha volta com o desfecho
// (número da nota ou o motivo da rejeição do SEFAZ). Só o polo Tricopill tem Bling/NF-e.

const todayStr = () => {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtCpf = (v: string) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : (d || '—')
}
const fmtDate = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR')
}

type RowState = NfeRow & { emitting?: boolean }

export function NfePage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [emitting, setEmitting] = useState(false)

  // Config fiscal (o contador informa o ID da natureza de operação no Bling).
  const [naturezaId, setNaturezaId] = useState('')
  const [transmit, setTransmit] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const savedNaturezaRef = useRef('')

  useEffect(() => {
    if (!isSalesPolo) return
    let alive = true
    void getBlingOrderConfig()
      .then((c) => {
        if (!alive) return
        setNaturezaId(c.naturezaOperacaoId)
        savedNaturezaRef.current = c.naturezaOperacaoId
        setTransmit(c.autoNfeTransmit)
      })
      .catch(() => {})
      .finally(() => { if (alive) setConfigLoaded(true) })
    return () => { alive = false }
  }, [isSalesPolo])

  const load = async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      const list = await nfeList(from, to)
      setRows(list)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar as vendas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isSalesPolo) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSalesPolo])

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      await setBlingOrderConfig({ naturezaOperacaoId: naturezaId.trim(), autoNfeTransmit: transmit })
      savedNaturezaRef.current = naturezaId.trim()
      toast.success('Configuração fiscal salva.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSavingConfig(false)
    }
  }

  // Só dá pra emitir quem ainda não tem nota. Já emitidas ficam travadas.
  const pending = useMemo(() => rows.filter((r) => !r.nfeNumero), [rows])
  const emitidas = rows.length - pending.length
  const selectableIds = useMemo(() => pending.map((r) => r.paymentId), [pending])
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  const toggleAll = () => {
    setSelected((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set()
      return new Set(selectableIds)
    })
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const patchRow = (paymentId: string, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.paymentId === paymentId ? { ...r, ...patch } : r)))
  }

  const emitSelected = async () => {
    const ids = [...selected].filter((id) => selectableIds.includes(id))
    if (ids.length === 0) return
    if (!naturezaId.trim()) {
      toast.error('Configure a natureza de operação da NF-e antes de emitir (seção Configuração fiscal).')
      return
    }
    setEmitting(true)
    let ok = 0
    let fail = 0
    // Sequencial: o Bling limita ~3 req/s e a emissão fiscal não deve correr em paralelo.
    for (const id of ids) {
      patchRow(id, { emitting: true, nfeError: null })
      try {
        const res = await nfeEmit(id, transmit)
        if (res.ok || res.alreadyEmitted) {
          ok += 1
          patchRow(id, {
            emitting: false,
            nfeNumero: res.numero ?? 'gerada',
            nfeStatus: res.alreadyEmitted ? 'emitida' : (res.status ?? 'emitida'),
            nfeError: null,
          })
          setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
        } else {
          fail += 1
          patchRow(id, { emitting: false, nfeStatus: 'erro', nfeError: res.message ?? 'Falha ao emitir' })
        }
      } catch (e) {
        fail += 1
        patchRow(id, { emitting: false, nfeStatus: 'erro', nfeError: e instanceof Error ? e.message : 'Falha ao emitir' })
      }
    }
    setEmitting(false)
    if (fail === 0) toast.success(`${ok} ${ok === 1 ? 'nota emitida' : 'notas emitidas'} com sucesso.`)
    else if (ok === 0) toast.error(`Nenhuma nota emitida. ${fail} com erro (veja o motivo em cada linha).`)
    else toast.warning(`${ok} emitida(s), ${fail} com erro. Confira as linhas em vermelho.`)
  }

  const selectedCount = [...selected].filter((id) => selectableIds.includes(id)).length
  const naturezaMissing = configLoaded && !savedNaturezaRef.current

  if (!isSalesPolo) {
    return (
      <AppLayout title="Emissão de NF-e" subtitle="Disponível no polo Tricopill (onde fica a integração com o Bling).">
        <EmptyState icon={FileText} title="NF-e é do polo Tricopill" description="Troque para o workspace Tricopill para emitir notas." />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Emissão de NF-e"
      subtitle="Depois da conciliação, marque as vendas pagas e emita as notas no Bling de uma vez."
    >
      <SubTabs tabs={financeiroTabs(isSalesPolo)} />

      {/* Pré-requisito fiscal */}
      {naturezaMissing ? (
        <Card className="mb-4 border-amber-300 bg-amber-50/60">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-800">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Falta a configuração fiscal para emitir.</p>
              <p className="text-amber-700">
                Informe a natureza de operação abaixo e garanta que os produtos no Bling tenham NCM, CFOP e origem
                preenchidos (isso o contador faz). Sem isso o SEFAZ rejeita a nota.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Configuração fiscal */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="size-4 text-primary" /> Configuração fiscal
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nfe-natureza">ID da natureza de operação (Bling)</Label>
            <Input
              id="nfe-natureza"
              value={naturezaId}
              onChange={(e) => setNaturezaId(e.target.value.replace(/\D/g, ''))}
              placeholder="Ex.: 12345678"
              inputMode="numeric"
              className="w-[200px]"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id="nfe-transmit" checked={transmit} onCheckedChange={(checked) => setTransmit(checked)} />
            <Label htmlFor="nfe-transmit" className="font-normal">
              Transmitir ao SEFAZ na hora (senão fica em rascunho no Bling)
            </Label>
          </div>
          <Button variant="outline" onClick={() => void saveConfig()} disabled={savingConfig}>
            {savingConfig ? 'Salvando...' : 'Salvar configuração'}
          </Button>
        </CardContent>
      </Card>

      {/* Filtro de período */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="nfe-from">De</Label>
            <Input id="nfe-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nfe-to">Até</Label>
            <Input id="nfe-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /> Carregar
          </Button>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {rows.length > 0 ? (
              <span>{pending.length} sem nota · {emitidas} já emitidas</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="size-4 text-primary" /> Vendas pagas ({rows.length})
          </CardTitle>
          <Button onClick={() => void emitSelected()} disabled={emitting || selectedCount === 0}>
            {emitting ? (
              <><Loader2 className="size-4 animate-spin" /> Emitindo...</>
            ) : (
              <>Emitir selecionadas ({selectedCount})</>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={loading ? 'Carregando...' : 'Nenhuma venda paga com pedido no Bling no período'}
              description="Ajuste as datas e clique em Carregar. Aparecem aqui as vendas pagas que já têm pedido no Bling."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todas" />
                    </TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>CPF</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Pedido Bling</TableHead>
                    <TableHead>NF-e</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const done = !!r.nfeNumero
                    const err = r.nfeStatus === 'erro' && !done
                    return (
                      <TableRow key={r.paymentId} className={err ? 'bg-red-50/50' : done ? 'bg-emerald-50/40' : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(r.paymentId)}
                            onCheckedChange={() => toggleOne(r.paymentId)}
                            disabled={done || r.emitting}
                            aria-label={`Selecionar ${r.name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="tabular-nums">{fmtCpf(r.cpf)}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(r.valueCents)}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(r.paidAt)}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">#{r.blingOrderId}</TableCell>
                        <TableCell>
                          {r.emitting ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" /> Emitindo...
                            </span>
                          ) : done ? (
                            <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700">
                              <CheckCircle2 className="size-3.5" /> {r.nfeNumero === 'gerada' ? 'Emitida' : `Nº ${r.nfeNumero}`}
                            </Badge>
                          ) : err ? (
                            <span className="inline-flex items-start gap-1 text-xs text-red-600" title={r.nfeError ?? ''}>
                              <XCircle className="mt-0.5 size-3.5 shrink-0" />
                              <span className="line-clamp-2 max-w-[280px]">{r.nfeError ?? 'Erro'}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem nota</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
