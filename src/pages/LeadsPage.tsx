import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MessageCircle, Search, Users } from 'lucide-react'
import { toast } from 'sonner'

import { LeadDetailSheet } from '@/components/leads/LeadDetailSheet'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'
import { columnLabel } from '@/lib/leadColumnLabels'
import { parseCsv, rowsToObjects } from '@/lib/csvParse'
import { getLeadFieldValue } from '@/lib/leadFields'
import { formatTemperature } from '@/lib/fieldLabels'
import { archiveImportFileToStorage } from '@/lib/importArchiveStorage'
import { labelForIdName, labelForKeyMap } from '@/lib/selectDisplay'
import { parseInteractionsImportJson } from '@/lib/interactionsImportSchema'
import { cn } from '@/lib/utils'

const TABLE_COLUMNS = ['patient_name', 'phone', 'pipeline_id', 'stage_id', 'owner_id', 'source', 'temperature', 'summary'] as const

function temperatureBadgeClass(t: string): string {
  const x = t.toLowerCase()
  if (x === 'hot' || x === 'quente') {
    return 'border-rose-200/80 bg-rose-50/90 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-100'
  }
  if (x === 'warm' || x === 'morno') {
    return 'border-amber-200/80 bg-amber-50/90 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-100'
  }
  if (x === 'cold' || x === 'frio') {
    return 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200'
  }
  return 'border-border bg-muted/50 text-foreground'
}

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

  const pipelineSelectLabel = useMemo(
    () =>
      labelForIdName(
        pipelineFilter,
        crm.pipelineCatalog.map((p) => ({ id: p.id, name: p.name })),
        { value: 'all', label: 'Todos os funis' },
        'Funil',
      ),
    [pipelineFilter, crm.pipelineCatalog],
  )
  const stageSelectLabel = useMemo(
    () =>
      labelForIdName(
        stageFilter,
        stagesInFilterPipeline.map((s) => ({ id: s.id, name: s.name })),
        { value: 'all', label: 'Todas' },
        'Etapa',
      ),
    [stageFilter, stagesInFilterPipeline],
  )
  const ownerSelectLabel = useMemo(
    () =>
      labelForIdName(
        ownerFilter,
        crm.users.map((u) => ({ id: u.id, name: u.name })),
        { value: 'all', label: 'Todos' },
        'Responsável',
      ),
    [ownerFilter, crm.users],
  )
  const sourceSelectLabel = useMemo(
    () =>
      labelForKeyMap(
        sourceFilter,
        sourceLabel,
        { value: 'all', label: 'Todas' },
        'Origem',
      ),
    [sourceFilter],
  )
  const bulkOwnerLabel = useMemo(
    () =>
      labelForIdName(
        bulkOwnerId,
        crm.users.map((u) => ({ id: u.id, name: u.name })),
        { value: 'all', label: 'Escolher responsável' },
        'Responsável',
      ),
    [bulkOwnerId, crm.users],
  )
  const bulkStageLabel = useMemo(
    () =>
      labelForIdName(
        bulkStageId,
        stagesForBulk.map((s) => ({ id: s.id, name: s.name })),
        { value: 'all', label: 'Escolher etapa' },
        'Etapa',
      ),
    [bulkStageId, stagesForBulk],
  )

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

  useEffect(() => {
    if (pipelineFilter !== 'all' && !crm.pipelineCatalog.some((p) => p.id === pipelineFilter)) {
      setPipelineFilter('all')
      setStageFilter('all')
    }
  }, [crm.pipelineCatalog, pipelineFilter])

  useEffect(() => {
    if (pipelineFilter === 'all') return
    if (stageFilter !== 'all' && !stagesInFilterPipeline.some((s) => s.id === stageFilter)) {
      setStageFilter('all')
    }
  }, [pipelineFilter, stagesInFilterPipeline, stageFilter])

  useEffect(() => {
    if (ownerFilter !== 'all' && !crm.users.some((u) => u.id === ownerFilter)) {
      setOwnerFilter('all')
    }
  }, [crm.users, ownerFilter])

  useEffect(() => {
    if (sourceFilter !== 'all' && !(sourceFilter in sourceLabel)) {
      setSourceFilter('all')
    }
  }, [sourceFilter])

  useEffect(() => {
    if (bulkOwnerId !== 'all' && !crm.users.some((u) => u.id === bulkOwnerId)) {
      setBulkOwnerId('all')
    }
  }, [crm.users, bulkOwnerId])

  useEffect(() => {
    if (bulkStageId !== 'all' && !stagesForBulk.some((s) => s.id === bulkStageId)) {
      setBulkStageId('all')
    }
  }, [stagesForBulk, bulkStageId])

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
      subtitle="Filtros, tabela, importação e ficha no painel."
    >
      {crm.isLoading ? <SkeletonBlocks rows={3} /> : null}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-gradient-to-r from-primary/[0.06] to-transparent px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Users className="size-4 sm:size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold sm:text-base">Resumo</p>
            <p className="m-0 text-xs text-muted-foreground sm:text-sm">
              <span className="font-medium text-foreground">{filteredLeads.length}</span> de{' '}
              <span className="text-foreground">{crm.leads.length}</span> visíveis com os filtros atuais
            </p>
          </div>
        </div>
      </div>

      <div className="mb-4 grid w-full max-w-full gap-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur-sm sm:p-5 lg:grid-cols-2 lg:items-end xl:grid-cols-3 2xl:grid-cols-4">
        <div className="grid min-w-0 gap-1.5 lg:col-span-2 xl:col-span-1 2xl:col-span-2">
          <Label htmlFor="leads-search" className="text-xs sm:text-sm">
            Busca
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="leads-search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Nome, telefone, resumo, campos personalizados…"
              className="h-10 min-w-0 rounded-xl border-border/70 pl-9 pr-3 text-sm sm:h-11 sm:text-base"
            />
          </div>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label className="text-xs sm:text-sm">Funil</Label>
          <Select value={pipelineFilter} onValueChange={(v) => { if (v) { setPipelineFilter(v); setStageFilter('all') } }}>
            <LabeledSelectTrigger className="h-10 w-full min-w-0 rounded-xl border-border/70 sm:h-11" size="default">
              {pipelineSelectLabel}
            </LabeledSelectTrigger>
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
        <div className="grid min-w-0 gap-1.5">
          <Label className="text-xs sm:text-sm">Etapa</Label>
          <Select value={stageFilter} onValueChange={(v) => v && setStageFilter(v)} disabled={pipelineFilter === 'all'}>
            <LabeledSelectTrigger className="h-10 w-full min-w-0 rounded-xl border-border/70 sm:h-11" size="default">
              {stageSelectLabel}
            </LabeledSelectTrigger>
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
        <div className="grid min-w-0 gap-1.5">
          <Label className="text-xs sm:text-sm">Responsável</Label>
          <Select value={ownerFilter} onValueChange={(v) => v && setOwnerFilter(v)}>
            <LabeledSelectTrigger className="h-10 w-full min-w-0 rounded-xl border-border/70 sm:h-11" size="default">
              {ownerSelectLabel}
            </LabeledSelectTrigger>
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
        <div className="grid min-w-0 gap-1.5">
          <Label className="text-xs sm:text-sm">Origem</Label>
          <Select value={sourceFilter} onValueChange={(v) => v && setSourceFilter(v)}>
            <LabeledSelectTrigger className="h-10 w-full min-w-0 rounded-xl border-border/70 sm:h-11" size="default">
              {sourceSelectLabel}
            </LabeledSelectTrigger>
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
        <div className="grid min-w-0 gap-1.5 sm:col-span-2 lg:col-span-2 2xl:col-span-4">
          <Label className="text-xs sm:text-sm">Colunas visíveis (tabela)</Label>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {TABLE_COLUMNS.map((col) => {
              const active = visibleColumns.includes(col)
              return (
                <Button
                  key={col}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  className="rounded-lg text-xs sm:text-sm"
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

      <Card className="mb-4 rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
        <CardHeader className="pb-2 sm:pb-3">
          <CardTitle className="text-base sm:text-lg">Ações em lote</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Marque linhas; depois mude etapa e/ou responsável e aplique.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col flex-wrap items-stretch gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-[16rem]">
            <Label className="text-xs sm:text-sm">Responsável</Label>
            <Select value={bulkOwnerId} onValueChange={(value) => setBulkOwnerId(value ?? 'all')}>
            <LabeledSelectTrigger className="h-10 w-full rounded-xl border-border/70 sm:h-11" size="default">
                {bulkOwnerLabel}
              </LabeledSelectTrigger>
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
          <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-[16rem]">
            <Label className="text-xs sm:text-sm">Etapa</Label>
            <Select value={bulkStageId} onValueChange={(value) => setBulkStageId(value ?? 'all')}>
            <LabeledSelectTrigger className="h-10 w-full rounded-xl border-border/70 sm:h-11" size="default">
                {bulkStageLabel}
              </LabeledSelectTrigger>
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
            className="h-10 w-full shrink-0 sm:mt-6 sm:h-11 sm:w-auto"
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

      <Card className="mb-6 overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-sm backdrop-blur-sm sm:mb-8">
        <CardHeader className="space-y-1 border-b border-border/60 bg-muted/15 px-4 py-3 sm:px-5 sm:py-4">
          <CardTitle className="text-base sm:text-lg">Leads — {filteredLeads.length} resultado(s)</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Abre o lead com um toque. Caixa à esquerda: seleção em lote.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="m-0 flex list-none flex-col divide-y divide-border/60 md:hidden">
            {filteredLeads.map((lead) => {
              const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
              const stage = pipe?.stages.find((s) => s.id === lead.stageId)
              return (
                <li key={lead.id} className="bg-card">
                  <div className="flex gap-3 p-4">
                    <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.includes(lead.id)}
                        onChange={() => toggleLeadSelection(lead.id)}
                        className="size-4"
                        aria-label={`Selecionar ${lead.patientName}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-xl p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      onClick={() => openLead(lead.id)}
                    >
                      <p className="m-0 text-base font-semibold leading-tight text-foreground">{lead.patientName}</p>
                      <p className="m-0 mt-0.5 text-sm text-muted-foreground">{lead.phone}</p>
                      <p className="m-0 mt-1 line-clamp-2 text-xs text-muted-foreground sm:text-sm">{lead.summary || '—'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] sm:text-xs">
                          {stage?.name ?? lead.stageId}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] sm:text-xs">
                          {sourceLabel[lead.source]}
                        </Badge>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-4xl border px-2 py-0.5 text-[10px] font-medium sm:text-xs',
                            temperatureBadgeClass(lead.temperature),
                          )}
                        >
                          {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                        </span>
                        <span className="text-[10px] text-muted-foreground sm:text-xs">{crm.getOwnerName(lead.ownerId)}</span>
                      </div>
                    </button>
                    <Link
                      to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-xl text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Abrir conversa com ${lead.patientName}`}
                    >
                      <MessageCircle className="size-5" />
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
          {filteredLeads.length === 0 ? (
            <div className="p-8 text-center md:p-12">
              <p className="m-0 text-base font-medium text-foreground">Nenhum lead com estes filtros</p>
              <p className="m-0 mt-1 text-sm text-muted-foreground">Limpe a busca ou mude o funil / etapa / origem.</p>
            </div>
          ) : null}

          <div className="hidden w-full min-w-0 max-w-full overflow-x-auto md:block">
            <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-border/80 bg-muted/40 text-left shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-muted/30">
                  <th className="w-10 p-2.5 pl-3 sm:pl-4" scope="col" />
                  {visibleColumns.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className="p-2.5 pl-0 pr-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:p-3 sm:text-xs"
                    >
                      {columnLabel(col, crm.workflowFields)}
                    </th>
                  ))}
                  <th className="p-2.5 pr-3 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:p-3 sm:text-xs" scope="col">
                    Conversa
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead, index) => {
                  const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
                  const stage = pipe?.stages.find((s) => s.id === lead.stageId)
                  return (
                    <tr
                      key={lead.id}
                      className={cn(
                        'cursor-pointer border-b border-border/50 transition-colors hover:bg-primary/[0.04] focus-within:bg-muted/20',
                        index % 2 === 1 && 'bg-muted/10',
                        crm.selectedLeadId === lead.id && 'bg-primary/[0.08]',
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
                      <td className="p-2.5 pl-3 align-middle sm:p-3 sm:pl-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={selectedLeadIds.includes(lead.id)}
                          onChange={() => toggleLeadSelection(lead.id)}
                          aria-label={`Selecionar ${lead.patientName}`}
                        />
                      </td>
                      {visibleColumns.map((col) => (
                        <td
                          key={col}
                          className="max-w-[20rem] p-2.5 pr-3 text-[13px] align-middle text-foreground/90 sm:max-w-[18rem] sm:p-3 sm:text-sm"
                        >
                          {col === 'patient_name' ? <span className="font-medium text-foreground">{lead.patientName}</span> : null}
                          {col === 'phone' ? <span className="whitespace-nowrap text-muted-foreground">{lead.phone}</span> : null}
                          {col === 'summary' ? (
                            <span className="line-clamp-2 text-muted-foreground" title={String(lead.summary ?? '')}>
                              {String(lead.summary ?? '')}
                            </span>
                          ) : null}
                          {col === 'pipeline_id' ? <span>{pipe?.name ?? lead.pipelineId}</span> : null}
                          {col === 'stage_id' ? <span>{stage?.name ?? lead.stageId}</span> : null}
                          {col === 'owner_id' ? <span className="text-muted-foreground">{crm.getOwnerName(lead.ownerId)}</span> : null}
                          {col === 'source' ? (
                            <Badge variant="secondary" className="font-normal">
                              {sourceLabel[lead.source]}
                            </Badge>
                          ) : null}
                          {col === 'temperature' ? (
                            <span
                              className={cn(
                                'inline-flex items-center rounded-4xl border px-2 py-0.5 text-xs font-medium',
                                temperatureBadgeClass(lead.temperature),
                              )}
                            >
                              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                            </span>
                          ) : null}
                          {![
                            'patient_name',
                            'phone',
                            'summary',
                            'pipeline_id',
                            'stage_id',
                            'owner_id',
                            'source',
                            'temperature',
                          ].includes(col) ? (
                            <span className="truncate text-muted-foreground">{String(getLeadFieldValue(lead, col) ?? '')}</span>
                          ) : null}
                        </td>
                      ))}
                      <td className="p-2.5 pr-3 text-right align-middle sm:p-3" onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-9 sm:px-3"
                        >
                          <MessageCircle className="size-4" />
                          Chat
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importar leads (CSV)</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              .csv com cabeçalho; primeira etapa = a do funil ativo no filtro do topo.
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
            <CardDescription className="text-xs sm:text-sm">JSON de conversa exportado por este CRM.</CardDescription>
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
