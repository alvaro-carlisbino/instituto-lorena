import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { temperaturePillClass } from '@/components/kanban/temperatureClass'
import { sourceLabel } from '@/hooks/useCrmState'
import { getSourceStyle } from '@/lib/channelStyles'
import { getLeadFieldValue } from '@/lib/leadFields'
import { formatDurationFromMinutes } from '@/lib/formatDuration'
import { formatTemperature } from '@/lib/fieldLabels'
import { cn } from '@/lib/utils'
import type { Lead, Stage } from '@/mocks/crmMock'

type TagPill = { id: string; name: string; color?: string }

type Props = {
  stages: Stage[]
  leads: Lead[]
  isLoading: boolean
  selectedLeadId: string | null
  onSelectLead: (leadId: string) => void
  getOwnerName: (ownerId: string) => string
  tagPillsForLead: (leadId: string) => TagPill[]
  stageSlaMinutes: Record<string, number> | undefined
  getLastAiSnippet?: (leadId: string) => string | undefined
}

function effectiveTemperature(lead: Lead): 'hot' | 'warm' | 'cold' {
  const raw = getLeadFieldValue(lead, 'temperature')
  if (raw === 'cold' || raw === 'warm' || raw === 'hot') return raw
  if (lead.temperature === 'cold' || lead.temperature === 'warm' || lead.temperature === 'hot') {
    return lead.temperature
  }
  return 'cold'
}

/** Quantas linhas de cada etapa nascem montadas. O resto espera o "mostrar mais". */
const TETO_INICIAL = 25

export function KanbanListView({
  stages,
  leads,
  isLoading,
  selectedLeadId,
  onSelectLead,
  getOwnerName,
  tagPillsForLead,
  stageSlaMinutes,
  getLastAiSnippet,
}: Props) {
  /**
   * Qual etapa está na tela.
   *
   * A lista empilhava TODAS as etapas com TODOS os leads: no funil da clínica são
   * 2.269 leads, e como cada linha é desenhada duas vezes (cartão no celular,
   * tabela no desktop), a última etapa ficava a dezenas de telas da primeira. Os
   * atalhos em cima levam direto — e uma etapa por vez é o normal de quem
   * trabalha uma fila.
   */
  const [foco, setFoco] = useState<string>('todas')
  const [teto, setTeto] = useState<Record<string, number>>({})

  if (isLoading) {
    return (
      <div className="col-span-full rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm">
        <SkeletonBlocks rows={8} card={false} />
      </div>
    )
  }

  const byStage = new Map<string, Lead[]>()
  for (const s of stages) {
    byStage.set(
      s.id,
      leads.filter((l) => l.stageId === s.id).sort((a, b) => a.patientName.localeCompare(b.patientName, 'pt')),
    )
  }

  const etapasNaTela = foco === 'todas' ? stages : stages.filter((s) => s.id === foco)

  return (
    <div className="col-span-full space-y-4 pb-10">
      <nav
        aria-label="Etapas do funil"
        className="flex flex-wrap gap-1.5 rounded-xl border border-border/40 bg-card/60 p-2"
      >
        <Button
          size="sm"
          variant={foco === 'todas' ? 'default' : 'ghost'}
          className="h-7 px-2.5 text-xs"
          onClick={() => setFoco('todas')}
        >
          Todas <span className="ml-1 tabular-nums opacity-70">{leads.length}</span>
        </Button>
        {stages.map((stage) => (
          <Button
            key={stage.id}
            size="sm"
            variant={foco === stage.id ? 'default' : 'ghost'}
            className="h-7 px-2.5 text-xs"
            onClick={() => setFoco(stage.id)}
          >
            {stage.name}
            <span className="ml-1 tabular-nums opacity-70">{(byStage.get(stage.id) ?? []).length}</span>
          </Button>
        ))}
      </nav>

      {etapasNaTela.map((stage) => {
        const stageLeads = byStage.get(stage.id) ?? []
        const limite = teto[stage.id] ?? TETO_INICIAL
        const mostrados = stageLeads.slice(0, limite)
        const restam = stageLeads.length - mostrados.length
        return (
          <section
            key={stage.id}
            className="overflow-hidden rounded-xl border border-border/30 bg-card shadow-sm transition-all duration-300 hover:shadow-md"
            aria-labelledby={`list-stage-${stage.id}`}
          >
            <header
              className="flex flex-wrap items-center justify-between gap-4 border-b border-border/20 bg-muted/20 px-6 py-4 "
            >
              <div className="flex items-center gap-3">
                <div className="size-2.5 rounded-full bg-primary" aria-hidden />
                <h2 id={`list-stage-${stage.id}`} className="m-0 text-[14px] font-semibold uppercase tracking-[0.15em] text-foreground/80">
                  {stage.name}
                </h2>
              </div>
              <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {stageSlaMinutes?.[stage.id] != null ? (
                  <span className="flex items-center gap-1.5 text-destructive ring-1 ring-destructive/20 bg-destructive/5 px-2.5 py-1 rounded-full">
                    <RefreshCw className="size-3" />
                    Prazo: {formatDurationFromMinutes(stageSlaMinutes[stage.id])}
                  </span>
                ) : null}
                <span className="flex items-center justify-center min-w-[28px] h-7 rounded-full bg-primary/10 px-2.5 text-primary tabular-nums font-semibold">
                  {stageLeads.length}
                </span>
              </div>
            </header>

            {stageLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center opacity-30">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">Vazio por aqui</p>
              </div>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col divide-y divide-border/20 md:hidden">
                  {mostrados.map((lead) => {
                    const temp = effectiveTemperature(lead)
                    const selected = selectedLeadId === lead.id
                    return (
                      <li key={lead.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => onSelectLead(lead.id)}
                          className={cn(
                            'block h-auto w-full whitespace-normal rounded-none p-5 text-left font-normal duration-200',
                            selected
                              ? 'bg-primary/[0.03] ring-inset ring-1 ring-primary/20 hover:bg-primary/[0.03]'
                              : 'hover:bg-muted/30',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="m-0 text-[15px] font-bold text-foreground/90 leading-tight">{lead.patientName}</p>
                            <span className={cn('shrink-0 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider', temperaturePillClass(temp))}>
                              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                            </span>
                          </div>
                          <p className="m-0 mt-1.5 line-clamp-2 text-xs text-muted-foreground/70 font-medium">{lead.summary || 'Sem resumo disponível'}</p>
                          {getLastAiSnippet?.(lead.id)?.trim() ? (
                            <p className="m-0 mt-1 line-clamp-2 text-[10px] text-muted-foreground/80">
                              IA: {getLastAiSnippet(lead.id)}
                            </p>
                          ) : null}
                          {lead.lost_reason?.trim() ? (
                            <p className="m-0 mt-1 line-clamp-2 text-[10px] font-semibold text-destructive/90">
                              Motivo: {lead.lost_reason}
                            </p>
                          ) : null}
                          <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                            <span>{getOwnerName(lead.ownerId)}</span>
                            <div className="size-1 rounded-full bg-border" aria-hidden />
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                                getSourceStyle(lead.source).pill,
                              )}
                            >
                              <span className={cn('h-1 w-1 rounded-full', getSourceStyle(lead.source).dot)} aria-hidden />
                              {sourceLabel[lead.source]}
                            </span>
                          </div>
                          {tagPillsForLead(lead.id).length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {tagPillsForLead(lead.id).map((t) => (
                                <Badge
                                  key={t.id}
                                  variant="secondary"
                                  className="h-5 px-2 rounded-md border-border/40 text-[9px] font-semibold uppercase tracking-tight"
                                  style={{ color: t.color, backgroundColor: `${t.color}11`, borderColor: `${t.color}33` }}
                                >
                                  {t.name}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </Button>
                      </li>
                    )
                  })}
                </ul>

                <div className="hidden overflow-x-auto md:block">
                  <Table className="w-full min-w-[50rem] border-collapse text-left">
                    <TableHeader>
                      <TableRow className="border-b border-border/20 bg-muted/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
                        <TableHead>Paciente</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-center">Responsável</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead>Etiquetas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border/10">
                      {mostrados.map((lead) => {
                        const temp = effectiveTemperature(lead)
                        const selected = selectedLeadId === lead.id
                        return (
                          <TableRow
                            key={lead.id}
                            className={cn(
                              'group cursor-pointer transition-all duration-200',
                              selected ? 'bg-primary/[0.04] ring-inset ring-1 ring-primary/20' : 'hover:bg-muted/30'
                            )}
                            onClick={() => onSelectLead(lead.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onSelectLead(lead.id)
                              }
                            }}
                            tabIndex={0}
                            role="button"
                          >
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="text-[14px] font-bold text-foreground/90 group-hover:text-primary transition-colors">{lead.patientName}</span>
                                {lead.summary ? (
                                  <p className="m-0 mt-0.5 line-clamp-1 text-[11px] font-medium text-muted-foreground/60">{lead.summary}</p>
                                ) : null}
                                {getLastAiSnippet?.(lead.id)?.trim() ? (
                                  <p className="m-0 mt-0.5 line-clamp-1 text-[10px] text-muted-foreground/75">
                                    IA: {getLastAiSnippet(lead.id)}
                                  </p>
                                ) : null}
                                {lead.lost_reason?.trim() ? (
                                  <p className="m-0 mt-0.5 line-clamp-1 text-[10px] font-semibold text-destructive/85">
                                    Motivo: {lead.lost_reason}
                                  </p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className={cn('inline-flex px-2.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider', temperaturePillClass(temp))}>
                                {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80">{getOwnerName(lead.ownerId)}</span>
                            </TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                                  getSourceStyle(lead.source).pill,
                                )}
                              >
                                <span className={cn('h-1.5 w-1.5 rounded-full', getSourceStyle(lead.source).dot)} aria-hidden />
                                {sourceLabel[lead.source]}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5 max-w-[15rem]">
                                {tagPillsForLead(lead.id).map((t) => (
                                  <Badge
                                    key={t.id}
                                    variant="secondary"
                                    className="h-5 px-2 rounded-md border-border/40 text-[9px] font-semibold uppercase tracking-tight"
                                    style={{ color: t.color, backgroundColor: `${t.color}11`, borderColor: `${t.color}33` }}
                                  >
                                    {t.name}
                                  </Badge>
                                ))}
                                {tagPillsForLead(lead.id).length === 0 ? <span className="text-[10px] font-bold text-muted-foreground/30 uppercase tracking-widest">Sem etiquetas</span> : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {restam > 0 ? (
                  <div className="border-t border-border/20 p-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        setTeto((atual) => ({
                          ...atual,
                          [stage.id]: (atual[stage.id] ?? TETO_INICIAL) + 50,
                        }))
                      }
                    >
                      Mostrar mais 50 · faltam {restam} em {stage.name}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}
