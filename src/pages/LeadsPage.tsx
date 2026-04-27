import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { archiveImportFileToStorage } from '@/lib/importArchiveStorage'
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
  const csvInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const [csvFileLabel, setCsvFileLabel] = useState<string | null>(null)
  const [jsonFileLabel, setJsonFileLabel] = useState<string | null>(null)
  const [csvPreviewRows, setCsvPreviewRows] = useState<number | null>(null)
  const [jsonPreviewCount, setJsonPreviewCount] = useState<number | null>(null)
  const [pendingCsvFile, setPendingCsvFile] = useState<File | null>(null)
  const [pendingJsonFile, setPendingJsonFile] = useState<File | null>(null)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [visibleColumns, setVisibleColumns] = useState<(typeof TABLE_COLUMNS)[number][]>([...TABLE_COLUMNS])
  const [bulkOwnerId, setBulkOwnerId] = useState<string>('all')
  const [bulkStageId, setBulkStageId] = useState<string>('all')

  const leadIdParam = searchParams.get('leadId')

  const stagesInFilterPipeline = useMemo(() => {
    const p = crm.pipelineCatalog.find((x) => x.id === pipelineFilter)
    return p?.stages ?? []
  }, [crm.pipelineCatalog, pipelineFilter])
  const stagesForBulk = useMemo(() => {
    const p = crm.pipelineCatalog.find((x) => x.id === crm.selectedPipelineId) ?? crm.selectedPipeline
    return p?.stages ?? []
  }, [crm.pipelineCatalog, crm.selectedPipeline, crm.selectedPipelineId])

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
  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds((prev) => (prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]))
  }

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

  const runCsvImportFromFile = async (file: File) => {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.csv')) {
      toast.error('Escolha um ficheiro com extensão .csv.')
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      toast.error('Não foi possível ler o ficheiro.')
      return
    }
    const grid = parseCsv(text.trim())
    if (grid.length < 2) {
      toast.error('O CSV precisa de cabeçalho e pelo menos uma linha de dados.')
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
    if (ok) {
      toast.success(`${ok} lead(s) importado(s).`)
      try {
        await archiveImportFileToStorage(file, 'csv')
      } catch (e) {
        toast.message('Importação concluída, mas o arquivo não foi guardado no armazenamento.', {
          description: e instanceof Error ? e.message : String(e),
        })
      }
    }
    setCsvFileLabel(null)
    setCsvPreviewRows(null)
    setPendingCsvFile(null)
    if (csvInputRef.current) csvInputRef.current.value = ''
  }

  const runJsonImportFromFile = async (file: File) => {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.json')) {
      toast.error('Escolha um ficheiro com extensão .json.')
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      toast.error('Não foi possível ler o ficheiro.')
      return
    }
    try {
      const parsed = parseInteractionsImportJson(text.trim())
      const { ok, errors } = await crm.importInteractionsFromPayload(parsed.interactions)
      if (errors.length) toast.error(errors[0] ?? 'Erro na importação.')
      if (ok) {
        toast.success(`${ok} interação(ões) importada(s).`)
        try {
          await archiveImportFileToStorage(file, 'json')
        } catch (e) {
          toast.message('Importação concluída, mas o arquivo não foi guardado no armazenamento.', {
            description: e instanceof Error ? e.message : String(e),
          })
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Arquivo de conversas inválido.')
    }
    setJsonFileLabel(null)
    setJsonPreviewCount(null)
    setPendingJsonFile(null)
    if (jsonInputRef.current) jsonInputRef.current.value = ''
  }

  const onCsvInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingCsvFile(file)
    setCsvFileLabel(file.name)
    void file.text().then((t) => {
      const rows = parseCsv(t.trim()).length
      setCsvPreviewRows(rows > 0 ? rows - 1 : 0)
    })
  }

  const onJsonInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingJsonFile(file)
    setJsonFileLabel(file.name)
    void file.text().then((t) => {
      try {
        const parsed = parseInteractionsImportJson(t.trim())
        setJsonPreviewCount(parsed.interactions.length)
      } catch {
        setJsonPreviewCount(null)
      }
    })
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
      subtitle="Filtros, importação por ficheiros e detalhe em painel lateral."
    >
      {crm.isLoading ? <SkeletonBlocks rows={3} /> : null}

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm backdrop-blur-sm lg:flex-row lg:flex-wrap lg:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="leads-search">Busca</Label>
          <Input
            id="leads-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Nome, telefone, resumo…"
            className="min-w-[12rem] rounded-xl border-border/70"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Funil</Label>
          <Select value={pipelineFilter} onValueChange={(v) => { if (v) { setPipelineFilter(v); setStageFilter('all') } }}>
            <SelectTrigger className="w-[min(100%,14rem)] rounded-xl border-border/70">
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
            <SelectTrigger className="w-[min(100%,14rem)] rounded-xl border-border/70">
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
            <SelectTrigger className="w-[min(100%,14rem)] rounded-xl border-border/70">
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
            <SelectTrigger className="w-[min(100%,14rem)] rounded-xl border-border/70">
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
        <div className="grid gap-1.5">
          <Label>Colunas visíveis</Label>
          <div className="flex flex-wrap gap-2">
            {TABLE_COLUMNS.map((col) => {
              const active = visibleColumns.includes(col)
              return (
                <Button
                  key={col}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  onClick={() =>
                    setVisibleColumns((prev) => (active ? prev.filter((c) => c !== col) : [...prev, col]))
                  }
                >
                  {columnLabel(col, crm.workflowFields)}
                </Button>
              )
            })}
          </div>
        </div>
      </div>

      <Card className="mb-4 rounded-2xl border-border/70 bg-card/80 shadow-sm backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ações em lote</CardTitle>
          <CardDescription>Selecione leads e aplique alterações de forma rápida.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label>Responsável</Label>
            <Select value={bulkOwnerId} onValueChange={(value) => setBulkOwnerId(value ?? 'all')}>
            <SelectTrigger className="w-[14rem] rounded-xl border-border/70">
                <SelectValue placeholder="Responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Escolher responsável</SelectItem>
                {crm.users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Etapa</Label>
            <Select value={bulkStageId} onValueChange={(value) => setBulkStageId(value ?? 'all')}>
            <SelectTrigger className="w-[14rem] rounded-xl border-border/70">
                <SelectValue placeholder="Etapa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Escolher etapa</SelectItem>
                {stagesForBulk.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={selectedLeadIds.length === 0}
            onClick={() => {
              const patch: Record<string, unknown> = {}
              if (bulkOwnerId !== 'all') patch.ownerId = bulkOwnerId
              if (bulkStageId !== 'all') patch.stageId = bulkStageId
              if (Object.keys(patch).length === 0) {
                toast.error('Selecione ao menos uma alteração para aplicar.')
                return
              }
              crm.bulkUpdateLeads(selectedLeadIds, patch)
              toast.success(`${selectedLeadIds.length} lead(s) atualizados.`)
              setSelectedLeadIds([])
            }}
          >
            Aplicar em selecionados ({selectedLeadIds.length})
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-8 overflow-hidden rounded-2xl border-border/70 bg-card/80 shadow-sm backdrop-blur-sm">
        <CardHeader className="border-b border-border/60 bg-muted/20 py-3">
          <CardTitle className="text-base">Lista ({filteredLeads.length})</CardTitle>
          <CardDescription>Clique em uma linha para abrir o painel de detalhe.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="w-10 p-2.5" />
                {visibleColumns.map((col) => (
                  <th key={col} className="p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {columnLabel(col, crm.workflowFields)}
                  </th>
                ))}
                <th className="p-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Conversa</th>
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
                      'cursor-pointer border-b border-border/70 transition-all duration-200 hover:bg-muted/40 focus-within:bg-muted/40',
                      crm.selectedLeadId === lead.id && 'bg-primary/5',
                    )}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir detalhes do lead ${lead.patientName}`}
                    onClick={() => openLead(lead.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openLead(lead.id)
                      }
                    }}
                  >
                    <td className="p-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.includes(lead.id)}
                        onChange={() => toggleLeadSelection(lead.id)}
                        aria-label={`Selecionar ${lead.patientName}`}
                      />
                    </td>
                    {visibleColumns.map((col) => (
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
                    <td className="p-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <Link to={`/chat?leadId=${encodeURIComponent(lead.id)}`} className="inline-flex rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors underline-offset-2 hover:bg-primary/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        Abrir conversa
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredLeads.length === 0 ? (
            <div className="p-8 text-center">
              <p className="m-0 text-sm font-medium text-foreground">Nenhum lead encontrado</p>
              <p className="m-0 mt-1 text-sm text-muted-foreground">Ajuste os filtros ou limpe a busca para ver mais resultados.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importar leads (CSV)</CardTitle>
            <CardDescription>
              Selecione um ficheiro .csv: primeira linha com cabeçalhos (ex.: patient_name, phone, summary, source,
              temperature). O funil escolhido nos filtros acima define o destino; usa-se a primeira etapa desse funil.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Ficheiro CSV de leads"
              onChange={onCsvInputChange}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => csvInputRef.current?.click()}>
                Escolher ficheiro CSV
              </Button>
              {csvFileLabel ? (
                <span className="text-sm text-muted-foreground">
                  {csvFileLabel}
                  {csvPreviewRows != null ? ` · ${csvPreviewRows} linha(s) de dados` : null}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Nenhum ficheiro selecionado.</span>
              )}
            </div>
            <Button
              type="button"
              disabled={!pendingCsvFile}
              onClick={() => {
                if (!pendingCsvFile) {
                  toast.error('Selecione um ficheiro CSV primeiro.')
                  return
                }
                void runCsvImportFromFile(pendingCsvFile)
              }}
            >
              Importar leads
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importar conversas</CardTitle>
            <CardDescription>
              Selecione um arquivo de conversas já exportado pelo sistema para incluir o histórico dos atendimentos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-label="Arquivo de conversas"
              onChange={onJsonInputChange}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => jsonInputRef.current?.click()}>
                Escolher arquivo de conversas
              </Button>
              {jsonFileLabel ? (
                <span className="text-sm text-muted-foreground">
                  {jsonFileLabel}
                  {jsonPreviewCount != null ? ` · ${jsonPreviewCount} interação(ões)` : null}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Nenhum ficheiro selecionado.</span>
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!pendingJsonFile}
              onClick={() => {
                if (!pendingJsonFile) {
                  toast.error('Selecione um arquivo primeiro.')
                  return
                }
                void runJsonImportFromFile(pendingJsonFile)
              }}
            >
              Importar interações
            </Button>
          </CardContent>
        </Card>
      </div>

      <LeadDetailSheet open={sheetOpen} onOpenChange={handleSheetChange} />
    </AppLayout>
  )
}
