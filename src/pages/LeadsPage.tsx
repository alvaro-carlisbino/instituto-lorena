import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MessageCircle, Search } from 'lucide-react'
import { HelpDrawer } from '@/components/page/HelpDrawer'

const LEADS_HELP = [
  {
    icon: '👥',
    title: 'Gestão de Pacientes',
    content: (
      <p>
        Esta é a lista central de todos os seus leads. Você pode filtrar por funil, etapa,
        responsável ou origem para encontrar exatamente quem procura.
      </p>
    ),
  },
  {
    icon: '📦',
    title: 'Ações em Lote',
    content: (
      <p>
        Selecione vários leads usando as caixas de seleção à esquerda para mudar o responsável
        ou a etapa de todos ao mesmo tempo. Economiza tempo em redistribuições de equipe.
      </p>
    ),
  },
  {
    icon: '📥',
    title: 'Importação',
    content: (
      <p>
        Você pode trazer leads de outras planilhas via CSV ou importar históricos de conversas
        via JSON no final desta página.
      </p>
    ),
  },
]
import { toast } from 'sonner'

import { LeadDetailModal } from '@/components/leads/LeadDetailModal'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
      <AppLayout title="Leads">
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
      title="Leads"
      actions={<HelpDrawer title="Ajuda com Leads" sections={LEADS_HELP} />}
    >
      {crm.isLoading ? <SkeletonBlocks rows={3} /> : null}

      <div className="mb-6 grid w-full max-w-full gap-4 rounded-[2rem] border border-border/30 bg-card/40 p-6 shadow-sm backdrop-blur-md lg:grid-cols-4 lg:items-end">
        <div className="flex flex-col gap-2 lg:col-span-2">
          <Label htmlFor="leads-search" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">
            Pesquisa Inteligente
          </Label>
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
            <Input
              id="leads-search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, telefone ou contexto..."
              className="h-12 rounded-2xl border-border/40 bg-muted/20 pl-11 pr-4 text-sm font-medium transition-all focus:bg-background"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Funil</Label>
          <Select value={pipelineFilter} onValueChange={(v) => { if (v) { setPipelineFilter(v); setStageFilter('all') } }}>
            <LabeledSelectTrigger className="h-12 rounded-2xl border-border/40 bg-muted/20 text-xs font-bold uppercase" size="default">
              {pipelineSelectLabel}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase">Todos os funis</SelectItem>
              {crm.pipelineCatalog.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs font-bold uppercase">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Etapa</Label>
          <Select value={stageFilter} onValueChange={(v) => v && setStageFilter(v)} disabled={pipelineFilter === 'all'}>
            <LabeledSelectTrigger className="h-12 rounded-2xl border-border/40 bg-muted/20 text-xs font-bold uppercase" size="default">
              {stageSelectLabel}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase">Todas as etapas</SelectItem>
              {stagesInFilterPipeline.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs font-bold uppercase">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Responsável</Label>
          <Select value={ownerFilter} onValueChange={(v) => v && setOwnerFilter(v)}>
            <LabeledSelectTrigger className="h-12 rounded-2xl border-border/40 bg-muted/20 text-xs font-bold uppercase" size="default">
              {ownerSelectLabel}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase">Todos</SelectItem>
              {crm.users.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs font-bold uppercase">
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Origem</Label>
          <Select value={sourceFilter} onValueChange={(v) => v && setSourceFilter(v)}>
            <LabeledSelectTrigger className="h-12 rounded-2xl border-border/40 bg-muted/20 text-xs font-bold uppercase" size="default">
              {sourceSelectLabel}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase">Todas</SelectItem>
              {(Object.keys(sourceLabel) as (keyof typeof sourceLabel)[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs font-bold uppercase">
                  {sourceLabel[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-3">
          <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 ml-1">Visibilidade de Colunas</Label>
          <div className="flex flex-wrap gap-2">
            {TABLE_COLUMNS.map((col) => {
              const active = visibleColumns.includes(col)
              return (
                <Button
                  key={col}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  className={cn(
                    "h-8 rounded-xl text-[10px] font-bold uppercase tracking-tight transition-all",
                    active ? "bg-primary shadow-lg shadow-primary/20 border-transparent" : "border-border/40 hover:bg-muted/30"
                  )}
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

      <Card className="mb-6 rounded-[2rem] border-border/30 bg-card/40 shadow-sm backdrop-blur-md overflow-hidden">
        <CardHeader className="px-8 pt-8 pb-4 border-b border-border/10">
          <div className="flex items-center gap-3">
            <div className="size-2 rounded-full bg-primary" />
            <CardTitle className="text-base font-black uppercase tracking-[0.15em] text-foreground/80">Ações em Lote</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-8 flex flex-col lg:flex-row lg:items-end gap-6">
          <div className="flex flex-col gap-2 flex-1">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 ml-1">Novo Responsável</Label>
            <Select value={bulkOwnerId} onValueChange={(value) => setBulkOwnerId(value ?? 'all')}>
              <LabeledSelectTrigger className="h-12 rounded-2xl border-border/40 bg-muted/20 text-xs font-bold uppercase" size="default">
                {bulkOwnerLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs font-bold uppercase">Escolher responsável</SelectItem>
                {crm.users.map((u) => (
                  <SelectItem key={u.id} value={u.id} className="text-xs font-bold uppercase">
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 flex-1">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 ml-1">Nova Etapa</Label>
            <Select value={bulkStageId} onValueChange={(value) => setBulkStageId(value ?? 'all')}>
              <LabeledSelectTrigger className="h-12 rounded-2xl border-border/40 bg-muted/20 text-xs font-bold uppercase" size="default">
                {bulkStageLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs font-bold uppercase">Escolher etapa</SelectItem>
                {stagesForBulk.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs font-bold uppercase">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            className="h-12 px-8 rounded-2xl bg-primary shadow-xl shadow-primary/20 font-black uppercase tracking-[0.1em] text-[11px] disabled:opacity-30 transition-all hover:-translate-y-0.5 active:translate-y-0"
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
            Atualizar Selecionados ({selectedLeadIds.length})
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-8 overflow-hidden rounded-[2.5rem] border-border/30 bg-card/60 shadow-xl backdrop-blur-xl">
        <header className="px-8 py-6 border-b border-border/10 bg-muted/10 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-black tracking-tight text-foreground/90">Repositório de Leads</h2>
            <span className="flex items-center justify-center min-w-[32px] h-8 rounded-full bg-primary/10 px-3 text-sm font-black text-primary">
              {filteredLeads.length}
            </span>
          </div>
        </header>
        
        <CardContent className="p-0">
          <ul className="m-0 flex list-none flex-col divide-y divide-border/10 md:hidden">
            {filteredLeads.map((lead) => {
              const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
              const stage = pipe?.stages.find((s) => s.id === lead.stageId)
              return (
                <li key={lead.id} className="p-6 transition-all active:bg-muted/20">
                  <div className="flex gap-4">
                    <div className="pt-1">
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.includes(lead.id)}
                        onChange={() => toggleLeadSelection(lead.id)}
                        className="size-5 rounded-lg border-border/40"
                      />
                    </div>
                    <div className="flex-1 min-w-0" onClick={() => openLead(lead.id)}>
                      <h3 className="text-lg font-bold text-foreground/90 leading-tight">{lead.patientName}</h3>
                      <p className="text-[13px] font-bold text-muted-foreground/60 mt-0.5">{lead.phone}</p>
                      {lead.summary && <p className="mt-2 text-xs font-medium text-muted-foreground/80 line-clamp-2 leading-relaxed">{lead.summary}</p>}
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[9px] font-black uppercase tracking-tight rounded-md border-border/40">
                          {stage?.name ?? lead.stageId}
                        </Badge>
                        <Badge variant="secondary" className="text-[9px] font-black uppercase tracking-tight rounded-md bg-muted/40 text-muted-foreground">
                          {sourceLabel[lead.source]}
                        </Badge>
                        <span className={cn('px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider', temperatureBadgeClass(lead.temperature))}>
                          {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                      className="size-11 rounded-2xl bg-primary/[0.08] text-primary flex items-center justify-center transition-all hover:bg-primary/20 active:scale-90"
                    >
                      <MessageCircle className="size-5" />
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="hidden w-full overflow-x-auto md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/20 bg-muted/10 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">
                  <th className="w-16 px-8 py-5">
                    <div className="flex items-center justify-center">
                      <div className="size-4 rounded border-border/40 border" />
                    </div>
                  </th>
                  {visibleColumns.map((col) => (
                    <th key={col} className="px-4 py-5 font-black">
                      {columnLabel(col, crm.workflowFields)}
                    </th>
                  ))}
                  <th className="px-8 py-5 text-right">Interação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/5">
                {filteredLeads.map((lead) => {
                  const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
                  const stage = pipe?.stages.find((s) => s.id === lead.stageId)
                  const selected = selectedLeadIds.includes(lead.id)
                  return (
                    <tr
                      key={lead.id}
                      className={cn(
                        'group transition-all duration-200 cursor-pointer',
                        selected ? 'bg-primary/[0.03]' : 'hover:bg-muted/20'
                      )}
                      onClick={() => openLead(lead.id)}
                    >
                      <td className="px-8 py-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleLeadSelection(lead.id)}
                            className="size-5 rounded-lg border-border/40 checked:bg-primary"
                          />
                        </div>
                      </td>
                      {visibleColumns.map((col) => (
                        <td key={col} className="px-4 py-5 max-w-[20rem]">
                          {col === 'patient_name' && (
                            <div className="flex flex-col">
                              <span className="text-[14px] font-bold text-foreground/90 group-hover:text-primary transition-colors">{lead.patientName}</span>
                            </div>
                          )}
                          {col === 'phone' && <span className="text-[13px] font-bold tabular-nums text-muted-foreground/70">{lead.phone}</span>}
                          {col === 'summary' && <span className="text-xs font-medium text-muted-foreground/60 line-clamp-1">{lead.summary || '—'}</span>}
                          {col === 'pipeline_id' && <span className="text-[10px] font-black uppercase tracking-tight text-muted-foreground/80">{pipe?.name ?? lead.pipelineId}</span>}
                          {col === 'stage_id' && <span className="text-[10px] font-black uppercase tracking-tight text-muted-foreground/80">{stage?.name ?? lead.stageId}</span>}
                          {col === 'owner_id' && <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">{crm.getOwnerName(lead.ownerId)}</span>}
                          {col === 'source' && (
                            <Badge variant="secondary" className="bg-muted/40 text-muted-foreground/80 text-[9px] font-black uppercase tracking-tight rounded-md border-border/20">
                              {sourceLabel[lead.source]}
                            </Badge>
                          )}
                          {col === 'temperature' && (
                            <span className={cn('px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider', temperatureBadgeClass(lead.temperature))}>
                              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                            </span>
                          )}
                          {![
                            'patient_name', 'phone', 'summary', 'pipeline_id', 'stage_id', 'owner_id', 'source', 'temperature'
                          ].includes(col) && (
                            <span className="text-xs font-medium text-muted-foreground/60">{String(getLeadFieldValue(lead, col) ?? '—')}</span>
                          )}
                        </td>
                      ))}
                      <td className="px-8 py-5 text-right" onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                          className="inline-flex size-10 items-center justify-center rounded-2xl bg-primary/[0.08] text-primary transition-all hover:bg-primary/20 active:scale-90"
                        >
                          <MessageCircle className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredLeads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center opacity-30">
              <div className="mb-4 text-5xl">🔭</div>
              <h3 className="text-sm font-black uppercase tracking-[0.3em]">Nenhum lead encontrado</h3>
              <p className="text-xs font-bold text-muted-foreground mt-2">Tente ajustar seus filtros de busca</p>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-6 lg:grid-cols-2 mb-20">
        <Card className="rounded-[2.5rem] border-border/30 bg-card/40 backdrop-blur-md overflow-hidden">
          <CardHeader className="p-8 border-b border-border/10">
            <CardTitle className="text-base font-black uppercase tracking-widest text-foreground/80">Importação (CSV)</CardTitle>
          </CardHeader>
          <CardContent className="p-8 flex flex-col gap-6">
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onCsvInputChange} />
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border/40 rounded-[2rem] p-8 transition-all hover:bg-muted/20">
              <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 text-xl">📄</div>
              <Button type="button" variant="link" className="font-bold text-primary" onClick={() => csvInputRef.current?.click()}>
                Selecionar Ficheiro CSV
              </Button>
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest text-center mt-2">
                {csvFileLabel || "Nenhum ficheiro selecionado"}
                {csvPreviewRows != null && ` · ${csvPreviewRows} leads`}
              </p>
            </div>
            <Button
              type="button"
              className="h-14 rounded-2xl bg-foreground text-background font-black uppercase tracking-widest text-[11px] disabled:opacity-30 transition-all hover:scale-[1.02]"
              disabled={!pendingCsvFile}
              onClick={() => pendingCsvFile && runCsvImportFromFile(pendingCsvFile)}
            >
              Iniciar Importação
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-[2.5rem] border-border/30 bg-card/40 backdrop-blur-md overflow-hidden">
          <CardHeader className="p-8 border-b border-border/10">
            <CardTitle className="text-base font-black uppercase tracking-widest text-foreground/80">Histórico de Conversas (JSON)</CardTitle>
          </CardHeader>
          <CardContent className="p-8 flex flex-col gap-6">
            <input ref={jsonInputRef} type="file" accept=".json,application/json" className="sr-only" onChange={onJsonInputChange} />
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border/40 rounded-[2rem] p-8 transition-all hover:bg-muted/20">
              <div className="size-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4 text-xl">💬</div>
              <Button type="button" variant="link" className="font-bold text-amber-600" onClick={() => jsonInputRef.current?.click()}>
                Selecionar Ficheiro JSON
              </Button>
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest text-center mt-2">
                {jsonFileLabel || "Nenhum ficheiro selecionado"}
                {jsonPreviewCount != null && ` · ${jsonPreviewCount} interações`}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-14 rounded-2xl bg-amber-500 text-white font-black uppercase tracking-widest text-[11px] disabled:opacity-30 transition-all hover:scale-[1.02] border-none"
              disabled={!pendingJsonFile}
              onClick={() => pendingJsonFile && runJsonImportFromFile(pendingJsonFile)}
            >
              Importar Conversas
            </Button>
          </CardContent>
        </Card>
      </section>

      {leadIdParam && (
        <LeadDetailModal
          open={sheetOpen}
          onOpenChange={handleSheetChange}
        />
      )}
    </AppLayout>
  )
}
