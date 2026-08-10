import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, MessageCircle } from 'lucide-react'
import { HelpDrawer } from '@/components/page/HelpDrawer'

const LEADS_HELP = [
  {
    icon: '',
    title: 'Gestão de Pacientes',
    content: (
      <p>
        Esta é a lista central de todos os seus leads. Você pode filtrar por funil, etapa,
        responsável ou origem para encontrar exatamente quem procura.
      </p>
    ),
  },
  {
    icon: '',
    title: 'Ações em Lote',
    content: (
      <p>
        Selecione vários leads usando as caixas de seleção à esquerda para mudar o responsável
        ou a etapa de todos ao mesmo tempo. Economiza tempo em redistribuições de equipe.
      </p>
    ),
  },
  {
    icon: '',
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

import { PaymentBadge, PoloBadge } from '@/components/leads/PaymentBadge'
import { BulkActionBar } from '@/components/page/BulkActionBar'
import { ColumnVisibilityMenu } from '@/components/page/ColumnVisibilityMenu'
import { FilterBar, type FilterDef } from '@/components/page/FilterBar'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'
import { columnLabel } from '@/lib/leadColumnLabels'
import { parseCsv, rowsToObjects } from '@/lib/csvParse'
import { downloadCsv } from '@/lib/csvExport'
import { hojeLocal } from '@/lib/diaLocal'
import { getLeadFieldValue, getLeadPhoneDisplay } from '@/lib/leadFields'
import { formatTemperature } from '@/lib/fieldLabels'
import { archiveImportFileToStorage } from '@/lib/importArchiveStorage'
import { labelForIdName } from '@/lib/selectDisplay'
import { parseInteractionsImportJson } from '@/lib/interactionsImportSchema'
import { cn } from '@/lib/utils'

const TABLE_COLUMNS = ['patient_name', 'phone', 'pipeline_id', 'stage_id', 'owner_id', 'source', 'temperature', 'summary'] as const

/**
 * Largura por coluna. Sem isto o navegador reparte a largura por igual entre as dez
 * colunas: "Telefone" ficava com 95px, `+55 11 91234-2222` quebrava em TRÊS linhas e a
 * linha inteira ia a 101px de altura — cinco leads por tela em 800px, e a tabela ainda
 * estourava para o lado. Quem tem texto de tamanho conhecido (telefone, etiquetas) ganha
 * largura fixa; o resumo fica com o que sobrar, porque é o único que pode ser cortado
 * sem prejuízo (a linha inteira abre o lead).
 */
const COLUMN_WIDTH: Record<string, string> = {
  patient_name: 'w-[9rem]',
  // Telefone não encolhe abaixo disto: `+55 11 91234-2222` a 13px mede ~118px e é o
  // dado que a atendente copia para ligar. Foi ele que, espremido a 95px, quebrava em
  // três linhas e levava a linha inteira a 101px.
  phone: 'w-[8.5rem]',
  pipeline_id: 'w-[6rem]',
  stage_id: 'w-[5.5rem]',
  owner_id: 'w-[6rem]',
  source: 'w-[6rem]',
  temperature: 'w-[4.75rem]',
  // Sem largura: fica com a sobra. É a única coluna que pode ser cortada sem prejuízo,
  // porque a linha inteira abre o lead com o resumo completo.
  summary: '',
}

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
  const { availableTenants } = useTenant()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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

  // Filtro de Polo (tenant) — só aparece quando o login enxerga ≥2 polos (super-admin).
  const tenantNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of availableTenants) m.set(t.id, t.name)
    return m
  }, [availableTenants])
  const poloOptions = useMemo(() => {
    const ids: string[] = []
    for (const l of crm.leads) {
      if (l.tenantId && !ids.includes(l.tenantId)) ids.push(l.tenantId)
    }
    return ids.map((id) => ({ id, name: tenantNameById.get(id) ?? id }))
  }, [crm.leads, tenantNameById])
  const showPolo = poloOptions.length >= 2
  const poloNameForLead = (tenantId?: string) =>
    showPolo && crm.tenantFilter === 'all' && tenantId ? tenantNameById.get(tenantId) ?? tenantId : undefined
  const stagesInFilterPipeline = useMemo(() => {
    const p = crm.pipelineCatalog.find((x) => x.id === pipelineFilter)
    return p?.stages ?? []
  }, [crm.pipelineCatalog, pipelineFilter])
  const stagesForBulk = useMemo(() => {
    const p = crm.pipelineCatalog.find((x) => x.id === crm.selectedPipelineId) ?? crm.selectedPipeline
    return p?.stages ?? []
  }, [crm.pipelineCatalog, crm.selectedPipeline, crm.selectedPipelineId])

  // Filtros declarados uma vez: a FilterBar cuida de rótulo, etiqueta ativa e limpeza.
  const leadFilters = useMemo<FilterDef[]>(() => {
    const sourceOptions = (() => {
      const seen = new Set<string>()
      return (Object.keys(sourceLabel) as (keyof typeof sourceLabel)[])
        .filter((key) => {
          const label = sourceLabel[key]
          if (seen.has(label)) return false
          seen.add(label)
          return true
        })
        .map((key) => ({ value: key as string, label: sourceLabel[key] }))
    })()

    const defs: FilterDef[] = []

    if (showPolo) {
      defs.push({
        id: 'polo',
        label: 'Polo',
        value: crm.tenantFilter,
        onChange: (value) => crm.setTenantFilter(value),
        options: [
          { value: 'all', label: 'Todos os polos' },
          ...poloOptions.map((p) => ({ value: p.id, label: p.name })),
        ],
      })
    }

    defs.push(
      {
        id: 'pipeline',
        label: 'Funil',
        value: pipelineFilter,
        onChange: (value) => {
          setPipelineFilter(value)
          setStageFilter('all')
        },
        options: [
          { value: 'all', label: 'Todos os funis' },
          ...crm.pipelineCatalog.map((p) => ({ value: p.id, label: p.name })),
        ],
      },
      {
        id: 'stage',
        label: 'Etapa',
        value: stageFilter,
        onChange: setStageFilter,
        disabled: pipelineFilter === 'all',
        options: [
          { value: 'all', label: 'Todas as etapas' },
          ...stagesInFilterPipeline.map((s) => ({ value: s.id, label: s.name })),
        ],
      },
      {
        id: 'owner',
        label: 'Responsável',
        value: ownerFilter,
        onChange: setOwnerFilter,
        options: [
          { value: 'all', label: 'Todos' },
          ...crm.users.map((u) => ({ value: u.id, label: u.name })),
        ],
      },
      {
        id: 'source',
        label: 'Origem',
        value: sourceFilter,
        onChange: setSourceFilter,
        options: [{ value: 'all', label: 'Todas' }, ...sourceOptions],
      },
    )

    return defs
  }, [
    showPolo,
    poloOptions,
    crm,
    pipelineFilter,
    stageFilter,
    stagesInFilterPipeline,
    ownerFilter,
    sourceFilter,
  ])

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
      if (crm.tenantFilter !== 'all' && lead.tenantId !== crm.tenantFilter) return false
      if (pipelineFilter !== 'all' && lead.pipelineId !== pipelineFilter) return false
      if (stageFilter !== 'all' && lead.stageId !== stageFilter) return false
      if (ownerFilter !== 'all' && lead.ownerId !== ownerFilter) return false
      if (sourceFilter !== 'all') {
        // Tratar 'whatsapp' (Evolution direta) e 'meta_whatsapp' (ManyChat WhatsApp) como a mesma família.
        const wa = (s: string) => s === 'whatsapp' || s === 'meta_whatsapp'
        const matches = lead.source === sourceFilter || (wa(sourceFilter) && wa(lead.source))
        if (!matches) return false
      }
      if (!n) return true
      const custom = Object.values(lead.customFields as Record<string, unknown>)
        .map((v) => (v != null ? String(v) : ''))
        .join(' ')
      const hay = [lead.patientName, lead.summary, lead.phone, custom].join(' ').toLowerCase()
      return hay.includes(n)
    })
  }, [crm.leads, crm.tenantFilter, searchTerm, pipelineFilter, stageFilter, ownerFilter, sourceFilter])

  /**
   * Exporta exatamente o que os filtros da tela deixaram na lista. É assim que sai a
   * pergunta do dia a dia ("quem passou em consulta este ano e não fechou") sem
   * ninguém precisar de acesso ao banco: filtra na tela, exporta, manda a campanha.
   *
   * O telefone sai pelo mesmo formatador da tela: os leads de ManyChat sem número real
   * têm um `888001…` sintético no banco, e um CSV que os entregasse como telefone
   * viraria uma lista de discagem para números que não existem.
   */
  const exportarCsv = () => {
    const header = [
      'Nome',
      'Telefone',
      'Origem',
      'Funil',
      'Etapa',
      'Responsável',
      'Temperatura',
      'Criado em',
      'Último contato',
      'Resumo',
    ]
    if (showPolo) header.splice(1, 0, 'Polo')

    const body = filteredLeads.map((lead) => {
      const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
      const stage = pipe?.stages.find((s) => s.id === lead.stageId)
      const linha = [
        lead.patientName,
        getLeadPhoneDisplay(lead).label,
        sourceLabel[lead.source] ?? lead.source,
        pipe?.name ?? lead.pipelineId,
        stage?.name ?? lead.stageId,
        crm.getOwnerName(lead.ownerId),
        formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature),
        lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('pt-BR') : '',
        lead.last_interaction_at ? new Date(lead.last_interaction_at).toLocaleDateString('pt-BR') : '',
        lead.summary ?? '',
      ]
      if (showPolo) linha.splice(1, 0, poloNameForLead(lead.tenantId) ?? '')
      return linha
    })

    downloadCsv(`leads-${hojeLocal()}.csv`, [header, ...body])
    toast.success(`${body.length} ${body.length === 1 ? 'lead exportado' : 'leads exportados'}.`)
  }

  const crmRef = useRef(crm)
  crmRef.current = crm

  const openLead = useCallback(
    (id: string) => {
      navigate(`/leads/${id}`)
    },
    [navigate],
  )
  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds((prev) => (prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]))
  }

  useEffect(() => {
    if (!leadIdParam) return
    // Compatibilidade com links antigos /leads?leadId=… → redireciona para a tela dedicada.
    navigate(`/leads/${leadIdParam}`, { replace: true })
  }, [leadIdParam, navigate])

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

  const runCsvImportFromFile = async (file: File) => {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.csv')) {
      toast.error('Escolha um arquivo com extensão .csv.')
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      toast.error('Não foi possível ler o arquivo.')
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
      toast.error('Escolha um arquivo com extensão .json.')
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      toast.error('Não foi possível ler o arquivo.')
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
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={exportarCsv}
            disabled={filteredLeads.length === 0}
          >
            <Download className="size-3.5" aria-hidden /> Exportar CSV
          </Button>
          <HelpDrawer title="Ajuda com Leads" sections={LEADS_HELP} />
        </div>
      }
    >
      {crm.isLoading ? <SkeletonBlocks rows={3} /> : null}

      <FilterBar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Buscar por nome, telefone ou contexto…"
        searchLabel="Buscar leads"
        filters={leadFilters}
        trailing={
          <>
            {/* A contagem morava numa faixa própria de 45px dentro do card, abaixo de um
                <h2> "Leads" que repetia o título da página logo acima. Aqui ela não custa
                altura nenhuma e fica ao lado dos filtros que a mudam. */}
            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {filteredLeads.length} {filteredLeads.length === 1 ? 'lead' : 'leads'}
            </span>
            <ColumnVisibilityMenu
              columns={TABLE_COLUMNS}
              visible={visibleColumns}
              labelFor={(col) => columnLabel(col, crm.workflowFields)}
              onToggle={(col) =>
                setVisibleColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]))
              }
            />
          </>
        }
      />

      <Card className="mb-8 overflow-hidden">
        <CardContent className="p-0">
          <ul className="m-0 flex list-none flex-col divide-y divide-border/10 md:hidden">
            {filteredLeads.map((lead) => {
              const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
              const stage = pipe?.stages.find((s) => s.id === lead.stageId)
              return (
                <li key={lead.id} className="px-3 py-2.5 transition-colors active:bg-muted/20">
                  <div className="flex items-start gap-2.5">
                    {/* shrink-0 no EMBRULHO, não só no Checkbox: o filho tem shrink-0, mas
                        quem é item do flex é esta div, e sem isso ela era espremida a 2px de
                        largura pelo texto ao lado. No celular ninguém conseguia selecionar. */}
                    <div className="shrink-0 pt-0.5">
                      <Checkbox
                        checked={selectedLeadIds.includes(lead.id)}
                        onCheckedChange={() => toggleLeadSelection(lead.id)}
                        aria-label={`Selecionar ${lead.patientName}`}
                        className="size-5 rounded-md border-border/40"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => openLead(lead.id)}
                      className="block h-auto min-w-0 flex-1 whitespace-normal rounded-none border-0 p-0 text-left font-normal hover:bg-transparent hover:text-foreground"
                    >
                      {/* Nome e telefone na mesma linha: o telefone é o que a atendente lê
                          para ligar, não precisa de linha própria nem de negrito. */}
                      <div className="flex min-w-0 items-baseline gap-2">
                        <h3 className="truncate text-sm font-semibold leading-tight text-foreground">{lead.patientName}</h3>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{lead.phone}</span>
                      </div>
                      {lead.summary && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">{lead.summary}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <PoloBadge name={poloNameForLead(lead.tenantId)} />
                        <PaymentBadge payment={crm.paymentByLeadId[lead.id] ?? null} />
                        <Badge variant="outline" className="rounded text-[9px] font-semibold uppercase tracking-tight border-border/40">
                          {stage?.name ?? lead.stageId}
                        </Badge>
                        <Badge variant="secondary" className="rounded text-[9px] font-semibold uppercase tracking-tight bg-muted/40 text-muted-foreground">
                          {sourceLabel[lead.source]}
                        </Badge>
                        <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider', temperatureBadgeClass(lead.temperature))}>
                          {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                        </span>
                      </div>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      nativeButton={false}
                      render={
                        <Link
                          to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                          aria-label={`Abrir conversa com ${lead.patientName}`}
                        />
                      }
                      className="size-10 shrink-0 rounded-xl bg-primary/[0.08] text-primary transition-colors hover:bg-primary/20 hover:text-primary active:scale-95"
                    >
                      <MessageCircle className="size-5" aria-hidden />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="hidden w-full overflow-x-auto md:block">
            {/* table-fixed: sem isto o navegador reparte a largura pelo CONTEÚDO e ignora
                as larguras acima — era assim que "Telefone" ganhava 95px e o número
                quebrava em três linhas enquanto "Resumo" sobrava. Toda célula corta
                (truncate/line-clamp), então fixar é seguro. */}
            <Table className="w-full min-w-[56rem] table-fixed border-collapse text-left">
              <TableHeader>
                <TableRow className="border-b border-border/20 bg-muted/10 text-xs font-medium text-muted-foreground">
                  <TableHead className="w-10">
                    <div className="flex items-center justify-center">
                      <div className="size-4 rounded border-border/40 border" aria-hidden />
                      <span className="sr-only">Seleção</span>
                    </div>
                  </TableHead>
                  {visibleColumns.map((col) => (
                    <TableHead key={col} className={cn('font-semibold', COLUMN_WIDTH[col])}>
                      {columnLabel(col, crm.workflowFields)}
                    </TableHead>
                  ))}
                  {/* Rótulo só para leitor de tela: "Interação" por extenso não cabe na
                      coluna do botão e, com table-fixed, transbordava por cima de "Resumo". */}
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Interação</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/5">
                {filteredLeads.map((lead) => {
                  const pipe = crm.pipelineCatalog.find((p) => p.id === lead.pipelineId)
                  const stage = pipe?.stages.find((s) => s.id === lead.stageId)
                  const selected = selectedLeadIds.includes(lead.id)
                  return (
                    <TableRow
                      key={lead.id}
                      className={cn(
                        'group transition-all duration-200 cursor-pointer',
                        selected ? 'bg-primary/[0.03]' : 'hover:bg-muted/20'
                      )}
                      onClick={() => openLead(lead.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={() => toggleLeadSelection(lead.id)}
                            aria-label={`Selecionar ${lead.patientName}`}
                            className="size-4 rounded border-border/40"
                          />
                        </div>
                      </TableCell>
                      {visibleColumns.map((col) => (
                        <TableCell key={col}>
                          {col === 'patient_name' && (
                            // Nome e etiquetas na MESMA linha: empilhados, cada lead custava
                            // duas alturas de texto mesmo quando não havia etiqueta nenhuma.
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-foreground/90 transition-colors group-hover:text-primary">
                                {lead.patientName}
                              </span>
                              <PoloBadge name={poloNameForLead(lead.tenantId)} />
                              <PaymentBadge payment={crm.paymentByLeadId[lead.id] ?? null} />
                            </div>
                          )}
                          {col === 'phone' && <span className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">{lead.phone}</span>}
                          {col === 'summary' && <span className="line-clamp-1 text-xs text-muted-foreground/70">{lead.summary || '·'}</span>}
                          {col === 'pipeline_id' && <span className="line-clamp-1 text-xs text-muted-foreground">{pipe?.name ?? lead.pipelineId}</span>}
                          {col === 'stage_id' && <span className="line-clamp-1 text-xs text-muted-foreground">{stage?.name ?? lead.stageId}</span>}
                          {col === 'owner_id' && <span className="line-clamp-1 text-xs text-muted-foreground">{crm.getOwnerName(lead.ownerId)}</span>}
                          {col === 'source' && (
                            <Badge variant="secondary" className="bg-muted/40 text-muted-foreground/80 text-[9px] font-semibold uppercase tracking-tight rounded-md border-border/20">
                              {sourceLabel[lead.source]}
                            </Badge>
                          )}
                          {col === 'temperature' && (
                            <span className={cn('px-2.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider', temperatureBadgeClass(lead.temperature))}>
                              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                            </span>
                          )}
                          {![
                            'patient_name', 'phone', 'summary', 'pipeline_id', 'stage_id', 'owner_id', 'source', 'temperature'
                          ].includes(col) && (
                            <span className="text-xs font-medium text-muted-foreground/60">{String(getLeadFieldValue(lead, col) ?? '·')}</span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          nativeButton={false}
                          render={
                            <Link
                              to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                              aria-label={`Abrir conversa com ${lead.patientName}`}
                            />
                          }
                          className="size-7 rounded-lg bg-primary/[0.08] text-primary transition-colors hover:bg-primary/20 hover:text-primary"
                        >
                          <MessageCircle className="size-4" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {!crm.isLoading && filteredLeads.length === 0 && (
            <EmptyState
              title="Nenhum lead encontrado"
              description={
                crm.leads.length === 0 &&
                pipelineFilter === 'all' &&
                stageFilter === 'all' &&
                ownerFilter === 'all' &&
                sourceFilter === 'all' &&
                !searchTerm.trim()
                  ? 'Ainda não há leads na base. Importe um CSV abaixo, conecte canais que criem leads ou, se for administrador, use Laboratório para dados de demonstração.'
                  : 'Tente ajustar filtros ou o termo de busca.'
              }
              className="py-20"
            />
          )}
        </CardContent>
      </Card>

      <BulkActionBar
        count={selectedLeadIds.length}
        onClear={() => setSelectedLeadIds([])}
        noun={['lead', 'leads']}
      >
        <Select value={bulkOwnerId} onValueChange={(value) => setBulkOwnerId(value ?? 'all')}>
          <LabeledSelectTrigger aria-label="Novo responsável" className="h-8 w-44" size="sm">
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
        <Select value={bulkStageId} onValueChange={(value) => setBulkStageId(value ?? 'all')}>
          <LabeledSelectTrigger aria-label="Nova etapa" className="h-8 w-40" size="sm">
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
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => {
            const patch: Record<string, unknown> = {}
            if (bulkOwnerId !== 'all') patch.ownerId = bulkOwnerId
            if (bulkStageId !== 'all') patch.stageId = bulkStageId
            if (Object.keys(patch).length === 0) {
              toast.error('Escolha um responsável ou uma etapa para aplicar.')
              return
            }
            crm.bulkUpdateLeads(selectedLeadIds, patch)
            toast.success(`${selectedLeadIds.length} lead(s) atualizados.`)
            setSelectedLeadIds([])
          }}
        >
          Aplicar
        </Button>
      </BulkActionBar>

      <section className="grid gap-6 lg:grid-cols-2 mb-20">
        <Card className="rounded-xl border-border/30 bg-card/40 overflow-hidden">
          <CardHeader className="p-8 border-b border-border/10">
            <CardTitle className="text-sm font-semibold text-foreground">Importação (CSV)</CardTitle>
          </CardHeader>
          <CardContent className="p-8 flex flex-col gap-6">
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Selecionar arquivo CSV de leads" onChange={onCsvInputChange} />
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border/40 rounded-xl p-8 transition-all hover:bg-muted/20">
              <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-4 text-xl">CSV</div>
              <Button type="button" variant="link" className="font-bold text-primary" onClick={() => csvInputRef.current?.click()}>
                Selecionar Arquivo CSV
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {csvFileLabel || "Nenhum arquivo selecionado"}
                {csvPreviewRows != null && ` · ${csvPreviewRows} leads`}
              </p>
            </div>
            <Button
              type="button"
              className="h-11 rounded-xl"
              disabled={!pendingCsvFile}
              onClick={() => pendingCsvFile && runCsvImportFromFile(pendingCsvFile)}
            >
              Iniciar Importação
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/30 bg-card/40 overflow-hidden">
          <CardHeader className="p-8 border-b border-border/10">
            <CardTitle className="text-sm font-semibold text-foreground">Histórico de Conversas (JSON)</CardTitle>
          </CardHeader>
          <CardContent className="p-8 flex flex-col gap-6">
            <input ref={jsonInputRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Selecionar arquivo JSON de conversas" onChange={onJsonInputChange} />
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border/40 rounded-xl p-8 transition-all hover:bg-muted/20">
              <div className="size-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4 text-xl">JSON</div>
              <Button type="button" variant="link" className="font-bold text-amber-600" onClick={() => jsonInputRef.current?.click()}>
                Selecionar Arquivo JSON
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {jsonFileLabel || "Nenhum arquivo selecionado"}
                {jsonPreviewCount != null && ` · ${jsonPreviewCount} interações`}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded-xl bg-amber-500 text-white hover:bg-amber-600 border-none"
              disabled={!pendingJsonFile}
              onClick={() => pendingJsonFile && runJsonImportFromFile(pendingJsonFile)}
            >
              Importar Conversas
            </Button>
          </CardContent>
        </Card>
      </section>

    </AppLayout>
  )
}
