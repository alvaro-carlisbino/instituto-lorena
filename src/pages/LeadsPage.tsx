import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { LeadDetailSheet } from '@/components/leads/LeadDetailSheet'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'
import { columnLabel } from '@/lib/leadColumnLabels'
import { parseCsv, rowsToObjects } from '@/lib/csvParse'
import { getLeadFieldValue } from '@/lib/leadFields'
import { formatTemperature } from '@/lib/fieldLabels'
import { parseInteractionsImportJson } from '@/lib/interactionsImportSchema'
import { cn } from '@/lib/utils'

const TABLE_COLUMNS = ['patient_name', 'phone', 'pipeline_id', 'stage_id', 'owner_id', 'source', 'temperature', 'summary'] as const

export function LeadsPage() {
  const crm = useCrm()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [pipelineFilter, setPipelineFilter] = useState<string>('all')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [csvText, setCsvText] = useState('')
  const [jsonInteractions, setJsonInteractions] = useState('')

  const leadIdParam = searchParams.get('leadId')

  const stagesInFilterPipeline = useMemo(() => {
    const p = crm.pipelineCatalog.find((x) => x.id === pipelineFilter)
    return p?.stages ?? []
  }, [crm.pipelineCatalog, pipelineFilter])

  const filteredLeads = useMemo(() => {
    const n = searchTerm.trim().toLowerCase()
    return crm.leads.filter((lead) => {
      if (pipelineFilter !== 'all' && lead.pipelineId !== pipelineFilter) return false
      if (stageFilter !== 'all' && lead.stageId !== stageFilter) return false
      if (ownerFilter !== 'all' && lead.ownerId !== ownerFilter) return false
      if (sourceFilter !== 'all' && lead.source !== sourceFilter) return false
      if (!n) return true
      const custom = Object.values(lead.customFields as Record<string, unknown>)
        .map((v) => (v != null ? String(v) : ''))
        .join(' ')
      const hay = [lead.patientName, lead.summary, lead.phone, custom].join(' ').toLowerCase()
      return hay.includes(n)
    })
  }, [crm.leads, searchTerm, pipelineFilter, stageFilter, ownerFilter, sourceFilter])

  const openLead = useCallback(
    (id: string) => {
      crm.setSelectedLeadId(id)
      setSheetOpen(true)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('leadId', id)
        return next
      })
    },
    [crm, setSearchParams],
  )

  useEffect(() => {
    if (leadIdParam && crm.leads.some((l) => l.id === leadIdParam)) {
      crm.setSelectedLeadId(leadIdParam)
      setSheetOpen(true)
    }
  }, [leadIdParam, crm])

  const handleSheetChange = (open: boolean) => {
    setSheetOpen(open)
    if (!open) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('leadId')
        return next
      })
    }
  }

  const runCsvImport = async () => {
    const trimmed = csvText.trim()
    if (!trimmed) {
      toast.error('Cole o conteúdo CSV.')
      return
    }
    const grid = parseCsv(trimmed)
    if (grid.length < 2) {
      toast.error('CSV precisa de cabeçalho e ao menos uma linha.')
      return
    }
    const header = grid[0]!.map((h) => h.trim())
    const objects = rowsToObjects(header, grid.slice(1))
    const defaultPipeline = pipelineFilter !== 'all' ? pipelineFilter : crm.selectedPipelineId
    const pipe = crm.pipelineCatalog.find((p) => p.id === defaultPipeline) ?? crm.pipelineCatalog[0]
    const defaultStage = pipe?.stages[0]?.id ?? ''
    const { ok, errors } = await crm.importLeadsFromParsed(objects, defaultPipeline, defaultStage)
    if (errors.length) {
      toast.error(`${errors.length} erro(s). Primeiro: ${errors[0]}`)
    }
    if (ok) toast.success(`${ok} lead(s) importado(s).`)
    setCsvText('')
  }

  const runJsonImport = async () => {
    try {
      const parsed = parseInteractionsImportJson(jsonInteractions.trim())
      const { ok, errors } = await crm.importInteractionsFromPayload(parsed.interactions)
      if (errors.length) toast.error(errors[0] ?? 'Erro na importação.')
      if (ok) toast.success(`${ok} interação(ões) importada(s).`)
      setJsonInteractions('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'JSON inválido.')
    }
  }

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Leads" subtitle="Lista global de leads.">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não tem permissão para gerenciar leads.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Todos os leads"
      subtitle="Filtros, importação CSV e detalhe em painel lateral."
    >
      {crm.isLoading ? <SkeletonBlocks rows={3} /> : null}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="leads-search">Busca</Label>
          <Input
            id="leads-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Nome, telefone, resumo…"
            className="min-w-[12rem]"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Funil</Label>
          <Select value={pipelineFilter} onValueChange={(v) => { if (v) { setPipelineFilter(v); setStageFilter('all') } }}>
            <SelectTrigger className="w-[min(100%,14rem)]">
              <SelectValue placeholder="Funil" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os funis</SelectItem>
              {crm.pipelineCatalog.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Etapa</Label>
          <Select value={stageFilter} onValueChange={(v) => v && setStageFilter(v)} disabled={pipelineFilter === 'all'}>
            <SelectTrigger className="w-[min(100%,14rem)]">
              <SelectValue placeholder="Etapa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {stagesInFilterPipeline.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Responsável</Label>
          <Select value={ownerFilter} onValueChange={(v) => v && setOwnerFilter(v)}>
            <SelectTrigger className="w-[min(100%,14rem)]">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {crm.users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Origem</Label>
          <Select value={sourceFilter} onValueChange={(v) => v && setSourceFilter(v)}>
            <SelectTrigger className="w-[min(100%,14rem)]">
              <SelectValue placeholder="Origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(Object.keys(sourceLabel) as (keyof typeof sourceLabel)[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {sourceLabel[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="mb-8 overflow-hidden border-border shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/20 py-3">
          <CardTitle className="text-base">Lista ({filteredLeads.length})</CardTitle>
          <CardDescription>Clique em uma linha para abrir o painel de detalhe.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                {TABLE_COLUMNS.map((col) => (
                  <th key={col} className="p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {columnLabel(col, crm.workflowFields)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => {
                const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
                const stage = pipe?.stages.find((s) => s.id === lead.stageId)
                return (
                  <tr
                    key={lead.id}
                    className={cn(
                      'cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40',
                      crm.selectedLeadId === lead.id && 'bg-primary/5',
                    )}
                    onClick={() => openLead(lead.id)}
                  >
                    {TABLE_COLUMNS.map((col) => (
                      <td key={col} className="max-w-[14rem] truncate p-2.5 text-muted-foreground">
                        {col === 'pipeline_id'
                          ? (pipe?.name ?? lead.pipelineId)
                          : col === 'stage_id'
                            ? (stage?.name ?? lead.stageId)
                            : col === 'owner_id'
                              ? crm.getOwnerName(lead.ownerId)
                              : col === 'source'
                                ? sourceLabel[lead.source]
                                : col === 'temperature'
                                  ? formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)
                                  : String(getLeadFieldValue(lead, col) ?? '')}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredLeads.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nenhum lead com estes filtros.</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importar leads (CSV)</CardTitle>
            <CardDescription>
              Primeira linha: cabeçalhos como patient_name, phone, summary, source, temperature. Use o funil selecionado acima
              (filtro &quot;Funil&quot;) como destino; primeira etapa do funil será aplicada.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label htmlFor="csv-paste">Cole o CSV</Label>
            <textarea
              id="csv-paste"
              className="min-h-[8rem] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <Button type="button" onClick={() => void runCsvImport()}>
              Importar leads
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importar conversas (JSON)</CardTitle>
            <CardDescription>
              Formato: {'{'} &quot;interactions&quot;: [ {'{'} &quot;leadId&quot;, &quot;patientName&quot;, &quot;channel&quot;,
              &quot;direction&quot;, &quot;author&quot;, &quot;content&quot;, &quot;happenedAt&quot; {'}'} ] {'}'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label htmlFor="json-paste">Cole o JSON</Label>
            <textarea
              id="json-paste"
              className="min-h-[8rem] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              value={jsonInteractions}
              onChange={(e) => setJsonInteractions(e.target.value)}
            />
            <Button type="button" variant="secondary" onClick={() => void runJsonImport()}>
              Importar interações
            </Button>
          </CardContent>
        </Card>
      </div>

      <LeadDetailSheet open={sheetOpen} onOpenChange={handleSheetChange} />
    </AppLayout>
  )
}
