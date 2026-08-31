import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
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

import { LeadCard, LeadTableRow } from '@/components/leads/LeadListRows'
import { BulkActionBar } from '@/components/page/BulkActionBar'
import { ColumnVisibilityMenu } from '@/components/page/ColumnVisibilityMenu'
import { FilterBar, type FilterDef } from '@/components/page/FilterBar'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { useIsMobile } from '@/hooks/use-mobile'
import { sourceLabel } from '@/hooks/useCrmState'
import { PORTA_LABEL, PORTA_ORDEM, portaDoLead } from '@/lib/portaDeEntrada'
import { useVirtualRows } from '@/hooks/useVirtualRows'
import { AppLayout } from '@/layouts/AppLayout'
import { columnLabel } from '@/lib/leadColumnLabels'
import { parseCsv, rowsToObjects } from '@/lib/csvParse'
import { downloadCsv } from '@/lib/csvExport'
import { hojeLocal } from '@/lib/diaLocal'
import { getLeadFieldValue, getLeadPhoneDisplay } from '@/lib/leadFields'
import { formatTemperature } from '@/lib/fieldLabels'
import { archiveImportFileToStorage } from '@/lib/importArchiveStorage'
import { LEAD_CARD_HEIGHT, LEAD_TABLE_ROW_HEIGHT } from '@/lib/leadRowStyles'
import { labelForIdName } from '@/lib/selectDisplay'
import { parseInteractionsImportJson } from '@/lib/interactionsImportSchema'
import { cn } from '@/lib/utils'
import type { Lead } from '@/mocks/crmMock'

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

/**
 * Texto de busca por lead, calculado UMA VEZ por objeto de lead.
 *
 * A busca varre nome, telefone, resumo e todos os campos personalizados — e
 * `custom_fields` sozinho são 563 kB no banco. Fazer isso dentro do filtro significava
 * remontar essa string para os 2.680 leads a cada tecla digitada. O WeakMap é chaveado
 * pelo próprio objeto do lead: quem não mudou reaproveita o texto já montado, e quem
 * mudou (objeto novo vindo do realtime) recalcula sozinho. Sem invalidação manual e
 * sem segurar memória de lead que saiu da lista.
 */
const haystackCache = new WeakMap<Lead, string>()
const leadHaystack = (lead: Lead): string => {
  const cached = haystackCache.get(lead)
  if (cached !== undefined) return cached
  const custom = Object.values(lead.customFields as Record<string, unknown>)
    .map((v) => (v != null ? String(v) : ''))
    .join(' ')
  const built = [lead.patientName, lead.summary, lead.phone, custom].join(' ').toLowerCase()
  haystackCache.set(lead, built)
  return built
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
  const [portaFilter, setPortaFilter] = useState<string>('all')
  const csvInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const [csvFileLabel, setCsvFileLabel] = useState<string | null>(null)
  const [jsonFileLabel, setJsonFileLabel] = useState<string | null>(null)
  const [csvPreviewRows, setCsvPreviewRows] = useState<number | null>(null)
  const [jsonPreviewCount, setJsonPreviewCount] = useState<number | null>(null)
  const [pendingCsvFile, setPendingCsvFile] = useState<File | null>(null)
  const [pendingJsonFile, setPendingJsonFile] = useState<File | null>(null)
  // Set, não array: a linha pergunta "estou selecionada?" uma vez por lead a cada
  // render. Com `array.includes` isso era O(n²) — 2.680 linhas × 2.680 comparações a
  // cada clique numa caixinha.
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set())
  const [visibleColumns, setVisibleColumns] = useState<(typeof TABLE_COLUMNS)[number][]>([...TABLE_COLUMNS])
  const [bulkOwnerId, setBulkOwnerId] = useState<string>('all')
  const [bulkStageId, setBulkStageId] = useState<string>('all')

  const leadIdParam = searchParams.get('leadId')
  const isMobile = useIsMobile()
  // O campo de busca responde na hora; a varredura dos 2.680 leads roda em prioridade
  // baixa e pode ser interrompida pela tecla seguinte. Sem isto, digitar "maria"
  // enfileirava cinco filtragens completas e a tela travava entre as letras.
  const deferredSearch = useDeferredValue(searchTerm)

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
      // Porta de entrada NÃO é a mesma coisa que Origem, e por isso são dois filtros.
      // "Origem" é o `source` do lead, que diz o CANAL e é regravado pela conversa: o
      // lead da landing /consulta nasce `manual` e vira `whatsapp` no primeiro "oi".
      // A porta sai do carimbo em `custom_fields`, que sobrevive (o upsert faz merge),
      // e é a mesma regra do relatório de `/resultados` — ver `portaDoLead`.
      {
        id: 'porta',
        label: 'Porta de entrada',
        value: portaFilter,
        onChange: setPortaFilter,
        options: [
          { value: 'all', label: 'Todas' },
          ...PORTA_ORDEM.map((id) => ({ value: id as string, label: PORTA_LABEL[id] })),
        ],
      },
    )

    return defs
    // `crm` inteiro estava aqui — e o `useCrmState` devolve um objeto NOVO a cada
    // render, então este memo nunca segurava nada: remontava as cinco listas de opções
    // (incluindo a de usuários) a cada mensagem que chegava. Agora só os campos que a
    // barra de filtros realmente lê.
  }, [
    showPolo,
    poloOptions,
    crm.tenantFilter,
    crm.setTenantFilter,
    crm.pipelineCatalog,
    crm.users,
    pipelineFilter,
    stageFilter,
    stagesInFilterPipeline,
    ownerFilter,
    sourceFilter,
    portaFilter,
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
    const n = deferredSearch.trim().toLowerCase()
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
      if (portaFilter !== 'all' && portaDoLead(lead) !== portaFilter) return false
      if (!n) return true
      return leadHaystack(lead).includes(n)
    })
  }, [crm.leads, crm.tenantFilter, deferredSearch, pipelineFilter, stageFilter, ownerFilter, sourceFilter, portaFilter])

  /**
   * Nome do funil e da etapa por id, de uma vez. Cada linha fazia
   * `pipelineCatalog.find()` e depois `stages.find()` — com 6 funis, 41 etapas e 2.680
   * linhas dava ~130 mil comparações por render, e o render acontece a cada mensagem
   * que chega.
   */
  const pipelineNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of crm.pipelineCatalog) m.set(p.id, p.name)
    return m
  }, [crm.pipelineCatalog])
  const stageNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of crm.pipelineCatalog) for (const s of p.stages) m.set(s.id, s.name)
    return m
  }, [crm.pipelineCatalog])
  // Mesma fonte e mesmo fallback do `crm.getOwnerName` (sdrMembers, 'Sem dono'), só que
  // indexado — o original é um `.find()` por linha.
  const ownerNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of crm.sdrMembers) m.set(s.id, s.name)
    return m
  }, [crm.sdrMembers])

  // A janela do que está montado. Só uma das duas roda por vez (a outra fica `enabled:
  // false`), porque só um dos layouts existe no DOM.
  const listRef = useRef<HTMLDivElement>(null)
  // Caixa de seleção + colunas visíveis + botão de conversa.
  const spacerColSpan = visibleColumns.length + 2
  const rowWindow = useVirtualRows({
    count: filteredLeads.length,
    rowHeight: LEAD_TABLE_ROW_HEIGHT,
    containerRef: listRef,
    enabled: !isMobile,
  })
  const cardWindow = useVirtualRows({
    count: filteredLeads.length,
    rowHeight: LEAD_CARD_HEIGHT,
    containerRef: listRef,
    enabled: isMobile,
  })

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
      'Porta de entrada',
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
        PORTA_LABEL[portaDoLead(lead)],
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
  // useCallback: é prop de todas as linhas memoizadas. Se mudar de identidade a cada
  // render, o memo delas nunca segura nada.
  const toggleLeadSelection = useCallback((leadId: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev)
      if (!next.delete(leadId)) next.add(leadId)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedLeadIds(new Set()), [])

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
        <CardContent className="p-0" ref={listRef}>
          {/* Uma lista OU a outra. Antes as duas eram montadas e uma ficava escondida no
              CSS (`md:hidden` / `hidden md:block`) — o navegador criava os nós das duas,
              então cada lead custava DOIS blocos de DOM e ninguém via metade deles. */}
          {isMobile ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-border/10">
              <li aria-hidden style={{ height: cardWindow.padTop }} />
              {filteredLeads.slice(cardWindow.start, cardWindow.end).map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  stageName={stageNameById.get(lead.stageId) ?? lead.stageId}
                  payment={crm.paymentByLeadId[lead.id] ?? null}
                  poloName={poloNameForLead(lead.tenantId)}
                  selected={selectedLeadIds.has(lead.id)}
                  onToggle={toggleLeadSelection}
                  onOpen={openLead}
                />
              ))}
              <li aria-hidden style={{ height: cardWindow.padBottom }} />
            </ul>
          ) : (
            <div className="w-full overflow-x-auto">
              {/* table-fixed: sem isto o navegador reparte a largura pelo CONTEÚDO e ignora
                  as larguras acima — era assim que "Telefone" ganhava 95px e o número
                  quebrava em três linhas enquanto "Resumo" sobrava. Toda célula corta
                  (truncate/line-clamp), então fixar é seguro — e é também o que torna a
                  altura de linha previsível o bastante para virtualizar. */}
              <Table className="w-full min-w-[56rem] table-fixed border-collapse text-left">
                <TableHeader>
                  <TableRow className="border-b border-border/20 bg-muted/10 text-xs font-medium text-muted-foreground">
                    <TableHead className="w-10">
                      <div className="flex items-center justify-center">
                        <div className="size-4 rounded border border-border/40" aria-hidden />
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
                  {/* Linhas-espaçador no lugar das que não foram montadas: seguram a altura
                      total para a barra de rolagem continuar honesta.

                      A célula com colSpan é OBRIGATÓRIA. Um <tr> vazio com `height` no
                      estilo colapsa para zero — o navegador só dá altura à linha se
                      houver célula dentro. Sem ela a tabela inteira media 720px de
                      altura, não rolava, e só os ~35 primeiros leads eram alcançáveis. */}
                  <TableRow aria-hidden className="hover:bg-transparent">
                    <TableCell colSpan={spacerColSpan} className="p-0" style={{ height: rowWindow.padTop }} />
                  </TableRow>
                  {filteredLeads.slice(rowWindow.start, rowWindow.end).map((lead) => (
                    <LeadTableRow
                      key={lead.id}
                      lead={lead}
                      columns={visibleColumns}
                      pipelineName={pipelineNameById.get(lead.pipelineId) ?? lead.pipelineId}
                      stageName={stageNameById.get(lead.stageId) ?? lead.stageId}
                      ownerName={ownerNameById.get(lead.ownerId) ?? 'Sem dono'}
                      payment={crm.paymentByLeadId[lead.id] ?? null}
                      poloName={poloNameForLead(lead.tenantId)}
                      selected={selectedLeadIds.has(lead.id)}
                      onToggle={toggleLeadSelection}
                      onOpen={openLead}
                    />
                  ))}
                  <TableRow aria-hidden className="hover:bg-transparent">
                    <TableCell colSpan={spacerColSpan} className="p-0" style={{ height: rowWindow.padBottom }} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          {!crm.isLoading && filteredLeads.length === 0 && (
            <EmptyState
              title="Nenhum lead encontrado"
              description={
                crm.leads.length === 0 &&
                pipelineFilter === 'all' &&
                stageFilter === 'all' &&
                ownerFilter === 'all' &&
                sourceFilter === 'all' &&
                portaFilter === 'all' &&
                !searchTerm.trim()
                  ? 'Ainda não há leads na base. Importe um CSV abaixo, conecte canais que criem leads ou, se for administrador, use Laboratório para dados de demonstração.'
                  : 'Tente ajustar filtros ou o termo de busca.'
              }
              className="py-20"
            />
          )}
        </CardContent>
      </Card>

      <BulkActionBar count={selectedLeadIds.size} onClear={clearSelection} noun={['lead', 'leads']}>
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
            crm.bulkUpdateLeads(Array.from(selectedLeadIds), patch)
            toast.success(`${selectedLeadIds.size} lead(s) atualizados.`)
            clearSelection()
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
