import { useEffect, useState } from 'react'
import { BellIcon, FileTextIcon, ShieldIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PageHelp } from '@/components/page/PageHelp'
import { pageQuietCardClass } from '@/components/page/PageSection'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { ConversationModeSwitch } from '@/components/leads/ConversationModeSwitch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import {
  ensureOptionValue,
  normalizeFieldSelectOptions,
  toStoredOptions,
} from '@/lib/workflowFieldOptions'
import { slugifyLabel } from '@/lib/utils'
import type { FieldVisibilityContext, WorkflowField, Room } from '@/mocks/crmMock'
import { getAiConfig, saveAiConfig, type ConversationOwnerMode } from '@/services/conversationControl'

const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Texto livre' },
  { value: 'select', label: 'Lista de opções' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
] as const

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrador' },
  { value: 'gestor', label: 'Gestor comercial' },
  { value: 'sdr', label: 'Atendente' },
] as const

const CHANNEL_OPTIONS = [
  { value: 'in_app', label: 'No próprio app' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
] as const

const VISIBILITY_CONTEXTS: { value: FieldVisibilityContext; label: string }[] = [
  { value: 'kanban_card', label: 'Quadro' },
  { value: 'lead_detail', label: 'Detalhe' },
  { value: 'list', label: 'Lista' },
  { value: 'capture_form', label: 'Formulário' },
]

type DeleteTarget = { type: 'field' | 'profile' | 'rule'; id: string; name?: string } | null

export function SettingsPage() {
  const crm = useCrm()
  const [workflowKeyManual, setWorkflowKeyManual] = useState<Record<string, boolean>>({})
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiDefaultMode, setAiDefaultMode] = useState<ConversationOwnerMode>('auto')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiMaxPerHour, setAiMaxPerHour] = useState(2)
  const [aiCooldownSeconds, setAiCooldownSeconds] = useState(240)
  const [aiLoading, setAiLoading] = useState(false)

  const canAccessSettings = crm.currentPermission.canEditBoards || crm.currentPermission.canManageUsers

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    if (deleteTarget.type === 'field') {
      crm.removeWorkflowField(deleteTarget.id)
      toast.success('Campo removido com sucesso.')
    } else if (deleteTarget.type === 'profile') {
      crm.removePermissionProfile(deleteTarget.id)
      toast.success('Perfil de permissão removido.')
    } else if (deleteTarget.type === 'rule') {
      crm.removeNotificationRule(deleteTarget.id)
      toast.success('Regra de notificação removida.')
    }
    setDeleteTarget(null)
  }

  if (!canAccessSettings) {
    return (
      <AppLayout title="Configurações gerais" subtitle="Sem permissão para editar configurações estruturais.">
        <Card className="border-border shadow-none bg-muted/10 rounded-none">
          <CardContent className="pt-6 text-sm text-destructive font-bold uppercase tracking-widest">
            <p className="m-0">Peça acesso a um administrador (workflow, perfis de permissão e notificações).</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  const loadAiConfig = () => {
    if (crm.dataMode !== 'supabase') return
    setAiLoading(true)
    void getAiConfig()
      .then((cfg) => {
        if (!cfg) return
        setAiEnabled(Boolean(cfg.enabled))
        setAiDefaultMode(cfg.default_owner_mode)
        setAiPrompt(cfg.system_prompt ?? '')
        setAiMaxPerHour(Number(cfg.max_ai_replies_per_hour ?? 2))
        setAiCooldownSeconds(Number(cfg.min_seconds_between_ai_replies ?? 240))
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Falha ao carregar configuração da IA.'))
      .finally(() => setAiLoading(false))
  }

  useEffect(() => {
    if (crm.dataMode !== 'supabase') return
    void (async () => {
      setAiLoading(true)
      try {
        const cfg = await getAiConfig()
        if (!cfg) return
        setAiEnabled(Boolean(cfg.enabled))
        setAiDefaultMode(cfg.default_owner_mode)
        setAiPrompt(cfg.system_prompt ?? '')
        setAiMaxPerHour(Number(cfg.max_ai_replies_per_hour ?? 2))
        setAiCooldownSeconds(Number(cfg.min_seconds_between_ai_replies ?? 240))
      } catch {
        // noop
      } finally {
        setAiLoading(false)
      }
    })()
  }, [crm.dataMode])

  return (
    <AppLayout
      title="Configurações gerais"
      subtitle="Estrutura do CRM, atendimento com IA e regras da equipe."
      actions={
        <PageHelp title="Blocos desta página" label="Ajuda, configurações gerais">
          <p>
            <strong>IA</strong> — liga a assistente, modo padrão, prompt e limites. <strong>Etiquetas e salas</strong> — apoio
            ao Kanban e à agenda. <strong>Campos</strong> — dados extra por lead; chave técnica fica no avançado.{' '}
            <strong>Permissões</strong> — o que admin, gestor e atendente podem fazer. <strong>Notificações</strong> — canal
            (app, e-mail, WhatsApp) e gatilho. <strong>Organização</strong> — fuso e formatos de data/hora.
          </p>
        </PageHelp>
      }
    >
      <NoticeBanner
        message={crm.syncNotice}
        variant={noticeVariantFromMessage(crm.syncNotice)}
        className="mb-2"
      />

      {crm.currentPermission.canManageUsers ? (
        <Card className={cn('mb-6', pageQuietCardClass)}>
          <CardHeader>
            <CardTitle className="text-base">Atendimento com IA</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-gradient-to-r from-primary/[0.04] to-transparent p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 space-y-1 sm:pr-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="ai-enabled"
                    checked={aiEnabled}
                    onCheckedChange={setAiEnabled}
                    className="shrink-0"
                  />
                  <Label htmlFor="ai-enabled" className="cursor-pointer text-sm font-medium sm:text-base">
                    Permitir respostas automáticas da IA
                  </Label>
                </div>
                <p className="m-0 text-xs text-muted-foreground sm:text-sm">
                  Desligado: a assistente nunca gera, mesmo com modo <strong>IA</strong> ou <strong>Misto</strong> na ficha.
                </p>
              </div>
            </div>
            <div className="min-w-0 max-w-2xl">
              <ConversationModeSwitch
                title="Modo padrão de novas conversas"
                value={aiDefaultMode}
                loading={false}
                showFooterHint
                onChange={setAiDefaultMode}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ai-prompt">Prompt global da IA</Label>
              <textarea
                id="ai-prompt"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="min-h-32 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="Defina como a IA deve se comportar no atendimento..."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl">
              <div className="grid gap-2">
                <Label htmlFor="ai-max-hour">Máximo de respostas IA por hora</Label>
                <Input
                  id="ai-max-hour"
                  type="number"
                  min={1}
                  max={20}
                  value={aiMaxPerHour}
                  onChange={(e) => setAiMaxPerHour(Number(e.target.value) || 2)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai-cooldown">Cooldown mínimo entre respostas IA (segundos)</Label>
                <Input
                  id="ai-cooldown"
                  type="number"
                  min={30}
                  max={3600}
                  value={aiCooldownSeconds}
                  onChange={(e) => setAiCooldownSeconds(Number(e.target.value) || 240)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={aiLoading}
                onClick={() => {
                  setAiLoading(true)
                  void saveAiConfig({
                    enabled: aiEnabled,
                    defaultOwnerMode: aiDefaultMode,
                    systemPrompt: aiPrompt,
                    maxAiRepliesPerHour: aiMaxPerHour,
                    minSecondsBetweenAiReplies: aiCooldownSeconds,
                  })
                    .then(() => toast.success('Configuração da IA salva com sucesso.'))
                    .catch((error) => toast.error(error instanceof Error ? error.message : 'Falha ao salvar configuração da IA.'))
                    .finally(() => setAiLoading(false))
                }}
              >
                {aiLoading ? 'Salvando...' : 'Salvar configuração da IA'}
              </Button>
              <Button type="button" variant="outline" disabled={aiLoading} onClick={loadAiConfig}>
                Recarregar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {crm.currentPermission.canRouteLeads ? (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <Card className={pageQuietCardClass}>
            <CardHeader>
              <CardTitle className="text-base">Etiquetas (Kanban)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ul className="m-0 list-none space-y-1 p-0 text-sm">
                {crm.leadTagDefinitions.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: t.color }} />
                    {t.name} <code className="text-xs text-muted-foreground">{t.id}</code>
                  </li>
                ))}
              </ul>
              <TagDefForm crm={crm} />
            </CardContent>
          </Card>
          <Card className={pageQuietCardClass}>
            <CardHeader>
              <CardTitle className="text-base">Salas (agenda)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ul className="m-0 list-none space-y-1 p-0 text-sm">
                {crm.rooms.map((r) => (
                  <li key={r.id}>
                    {r.name} {r.active ? '' : '(inactiva)'}
                  </li>
                ))}
              </ul>
              <RoomForm crm={crm} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border shadow-none rounded-none bg-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/50 bg-muted/10">
            <div>
              <CardTitle className="tracking-widest uppercase text-base font-bold">Campos personalizados</CardTitle>
              <p className="mt-1 m-0 max-w-xl text-xs text-muted-foreground">Nome exibido; a chave nasce sozinha (detalhe técnico no bloco de cada campo).</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { crm.addWorkflowField(); toast.success('Campo criado.') }} className="rounded-none uppercase tracking-widest font-bold">
              Novo campo
            </Button>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {crm.workflowFields.length === 0 ? (
              <EmptyState
                icon={FileTextIcon}
                title="Nenhum campo personalizado"
                description="Crie campos para capturar informações personalizadas dos leads."
                className="py-8"
              />
            ) : (
              <ul className="m-0 list-none space-y-0 p-0 divide-y divide-border">
                {crm.workflowFields.map((field) => {
                  const toggleVis = (ctx: FieldVisibilityContext, checked: boolean) => {
                    const next = checked
                      ? Array.from(new Set([...field.visibleIn, ctx]))
                      : field.visibleIn.filter((c) => c !== ctx)
                    crm.updateWorkflowField(field.id, { visibleIn: next as FieldVisibilityContext[] })
                  }
                  return (
                    <li
                      key={field.id}
                      data-testid={`workflow-field-${field.fieldKey}`}
                      className="flex flex-col gap-6 bg-transparent hover:bg-muted/5 transition-colors p-6"
                    >
                      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
                          <Label className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                            Nome no cadastro
                          </Label>
                          <Input
                            value={field.label}
                            onChange={(event) => crm.updateWorkflowField(field.id, { label: event.target.value })}
                            onBlur={(event) => {
                              const label = event.target.value.trim()
                              if (!workflowKeyManual[field.id] && label) {
                                crm.updateWorkflowField(field.id, { fieldKey: slugifyLabel(label) })
                              }
                            }}
                            className="rounded-none border-foreground/20 font-medium"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs text-muted-foreground">Seção / ordem</Label>
                          <div className="flex gap-2">
                            <Input
                              value={field.section}
                              onChange={(event) => crm.updateWorkflowField(field.id, { section: event.target.value })}
                              placeholder="Seção"
                            />
                            <Input
                              type="number"
                              className="w-20"
                              value={field.sortOrder}
                              onChange={(event) =>
                                crm.updateWorkflowField(field.id, { sortOrder: Number(event.target.value) || 0 })
                              }
                            />
                          </div>
                        </div>
                        <details className="sm:col-span-2 lg:col-span-3 rounded-md border border-dashed border-border/80 bg-muted/10 p-3">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            Identificador interno (avançado)
                          </summary>
                          <div className="mt-3 grid gap-2 max-w-md">
                            <Label className="text-[10px] uppercase text-muted-foreground">Chave técnica (não alterar sem orientação)</Label>
                            <Input
                              value={field.fieldKey}
                              onChange={(event) => {
                                setWorkflowKeyManual((m) => ({ ...m, [field.id]: true }))
                                crm.updateWorkflowField(field.id, { fieldKey: event.target.value })
                              }}
                              className="text-sm rounded-none border-foreground/20"
                            />
                          </div>
                        </details>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Select
                          value={field.fieldType}
                          onValueChange={(value) => {
                            const fieldType = value as 'text' | 'select' | 'number' | 'date'
                            const updates: Partial<WorkflowField> = { fieldType }
                            if (fieldType === 'select' && field.options.length === 0) {
                              updates.options = [{ value: 'nova-opcao', label: 'Nova opção' }]
                            }
                            crm.updateWorkflowField(field.id, updates)
                          }}
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_TYPE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={field.required}
                            onCheckedChange={(checked) => crm.updateWorkflowField(field.id, { required: checked })}
                          />
                          <Label className="text-sm cursor-pointer">Obrigatório</Label>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs">
                        <span className="text-muted-foreground">Visível em:</span>
                        {VISIBILITY_CONTEXTS.map(({ value: ctx, label }) => (
                          <label key={ctx} className="flex cursor-pointer items-center gap-1.5">
                            <Switch
                              size="sm"
                              checked={field.visibleIn.includes(ctx)}
                              onCheckedChange={(checked) => toggleVis(ctx, checked)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      {field.fieldType === 'select' ? (
                        <div className="grid gap-2 rounded-md border border-border/60 bg-muted/5 p-3 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            Opções (valor interno estável + rótulo exibido)
                          </Label>
                          <ul className="m-0 list-none space-y-2 p-0">
                            {(field.options.length > 0 ? normalizeFieldSelectOptions(field.options as unknown[]) : [{ value: '', label: '' }]).map((pair, optIndex) => (
                              <li key={`${field.id}-opt-${optIndex}`} className="grid gap-2 rounded-md border border-border/40 p-2 sm:grid-cols-2">
                                <div className="grid gap-1">
                                  <Label className="text-[10px] uppercase text-muted-foreground">Rótulo</Label>
                                  <Input
                                    value={pair.label}
                                    onChange={(event) => {
                                      const pairs = normalizeFieldSelectOptions(
                                        field.options.length > 0 ? (field.options as unknown[]) : [''],
                                      )
                                      const nextPairs = [...pairs]
                                      const label = event.target.value
                                      const others = new Set(
                                        pairs.map((p, i) => (i !== optIndex ? p.value : '')).filter(Boolean),
                                      )
                                      let value = nextPairs[optIndex]?.value ?? ''
                                      if (!value || value === slugifyLabel(pair.label)) {
                                        value = ensureOptionValue(label || 'opcao', others)
                                      }
                                      nextPairs[optIndex] = { value, label }
                                      crm.updateWorkflowField(field.id, { options: toStoredOptions(nextPairs) })
                                    }}
                                    placeholder={`Opção ${optIndex + 1}`}
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label className="text-[10px] uppercase text-muted-foreground">Valor (chave)</Label>
                                  <Input
                                    value={pair.value}
                                    onChange={(event) => {
                                      const pairs = normalizeFieldSelectOptions(field.options as unknown[])
                                      const nextPairs = [...pairs]
                                      nextPairs[optIndex] = { ...nextPairs[optIndex]!, value: event.target.value }
                                      crm.updateWorkflowField(field.id, { options: toStoredOptions(nextPairs) })
                                    }}
                                    className="font-mono text-xs"
                                  />
                                </div>
                                <div className="sm:col-span-2 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const pairs = normalizeFieldSelectOptions(field.options as unknown[])
                                      pairs.splice(optIndex, 1)
                                      crm.updateWorkflowField(field.id, {
                                        options: toStoredOptions(pairs.length ? pairs : [{ value: 'a', label: 'Nova opção' }]),
                                      })
                                    }}
                                    disabled={normalizeFieldSelectOptions(field.options as unknown[]).length <= 1}
                                  >
                                    Remover
                                  </Button>
                                </div>
                              </li>
                            ))}
                          </ul>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="w-fit"
                            onClick={() => {
                              const pairs = normalizeFieldSelectOptions(field.options as unknown[])
                              const used = new Set(pairs.map((p) => p.value))
                              const label = `Nova opção ${pairs.length + 1}`
                              pairs.push({ value: ensureOptionValue(label, used), label })
                              crm.updateWorkflowField(field.id, { options: toStoredOptions(pairs) })
                            }}
                          >
                            Adicionar opção
                          </Button>
                        </div>
                      ) : null}
                      <div className="flex justify-end">
                        <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget({ type: 'field', id: field.id, name: field.label })}>
                          <Trash2Icon className="size-4 mr-1" />
                          Remover
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none rounded-none bg-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/50 bg-muted/10">
            <div>
              <CardTitle className="tracking-widest uppercase text-base font-bold">Permissões por papel</CardTitle>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { crm.addPermissionProfile(); toast.success('Perfil criado.') }} className="rounded-none uppercase tracking-widest font-bold">
              Novo perfil
            </Button>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {crm.permissions.length === 0 ? (
              <EmptyState
                icon={ShieldIcon}
                title="Nenhum perfil de permissão"
                description="Crie perfis para definir o que cada papel pode fazer no sistema."
                className="py-8"
              />
            ) : (
              <ul className="m-0 list-none space-y-0 p-0 divide-y divide-border">
                {crm.permissions.map((profile) => (
                  <li
                    key={profile.id}
                    className="space-y-6 hover:bg-muted/5 transition-colors p-6"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={profile.role}
                        onValueChange={(value) =>
                          crm.updatePermissionProfile(profile.id, {
                            role: value as 'admin' | 'gestor' | 'sdr',
                          })
                        }
                      >
                        <SelectTrigger className="w-[220px] rounded-none font-semibold uppercase tracking-wide">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={profile.canEditBoards}
                          onCheckedChange={(checked) =>
                            crm.updatePermissionProfile(profile.id, { canEditBoards: checked })
                          }
                        />
                        <Label className="cursor-pointer">Editar quadros e etapas</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={profile.canRouteLeads}
                          onCheckedChange={(checked) =>
                            crm.updatePermissionProfile(profile.id, { canRouteLeads: checked })
                          }
                        />
                        <Label className="cursor-pointer">Roteamento de leads</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={profile.canViewTvPanel}
                          onCheckedChange={(checked) =>
                            crm.updatePermissionProfile(profile.id, { canViewTvPanel: checked })
                          }
                        />
                        <Label className="cursor-pointer">Ver painel TV</Label>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={profile.canManageUsers}
                          onCheckedChange={(checked) =>
                            crm.updatePermissionProfile(profile.id, { canManageUsers: checked })
                          }
                        />
                        <Label className="cursor-pointer">Gerenciar usuários</Label>
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget({ type: 'profile', id: profile.id })}>
                        <Trash2Icon className="size-4 mr-1" />
                        Remover
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none rounded-none bg-card lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/50 bg-muted/10">
            <div>
              <CardTitle className="tracking-widest uppercase text-base font-bold">Notificações</CardTitle>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { crm.addNotificationRule(); toast.success('Regra criada.') }} className="rounded-none uppercase tracking-widest font-bold">
              Nova regra
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {crm.notifications.length === 0 ? (
              <EmptyState
                icon={BellIcon}
                title="Nenhuma regra de notificação"
                description="Crie regras para alertar a equipe sobre eventos importantes."
                className="py-8"
              />
            ) : (
              <ul className="m-0 list-none space-y-3 p-0">
                {crm.notifications.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={rule.name}
                        onChange={(event) => crm.updateNotificationRule(rule.id, { name: event.target.value })}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={rule.channel}
                          onValueChange={(value) =>
                            crm.updateNotificationRule(rule.id, {
                              channel: value as 'email' | 'whatsapp' | 'in_app',
                            })
                          }
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CHANNEL_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={rule.trigger}
                          onChange={(event) => crm.updateNotificationRule(rule.id, { trigger: event.target.value })}
                          placeholder="Quando avisar"
                          className="max-w-[12rem]"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(checked) => crm.updateNotificationRule(rule.id, { enabled: checked })}
                        />
                        <Label className="text-sm cursor-pointer">Ativo</Label>
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget({ type: 'rule', id: rule.id, name: rule.name })}>
                        <Trash2Icon className="size-4 mr-1" />
                        Remover
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {crm.currentPermission.canEditBoards ? (
        <Card className={cn('mt-6', pageQuietCardClass)}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Organização</CardTitle>
            <p className="m-0 mt-1 text-xs text-muted-foreground">Fuso e data para listas e relatórios.</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="org-tz">Fuso horário</Label>
              <Input
                id="org-tz"
                value={crm.orgSettings.timezone}
                onChange={(e) => crm.updateOrgSettings({ timezone: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-df">Formato de data</Label>
              <Input
                id="org-df"
                value={crm.orgSettings.dateFormat}
                onChange={(e) => crm.updateOrgSettings({ dateFormat: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-ws">Semana começa no dia</Label>
              <Select
                value={String(crm.orgSettings.weekStartsOn)}
                onValueChange={(value) => crm.updateOrgSettings({ weekStartsOn: Number(value) })}
              >
                <SelectTrigger id="org-ws">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Domingo</SelectItem>
                  <SelectItem value="1">Segunda-feira</SelectItem>
                  <SelectItem value="2">Terça-feira</SelectItem>
                  <SelectItem value="3">Quarta-feira</SelectItem>
                  <SelectItem value="4">Quinta-feira</SelectItem>
                  <SelectItem value="5">Sexta-feira</SelectItem>
                  <SelectItem value="6">Sábado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={
          deleteTarget?.type === 'field' ? 'Remover campo'
            : deleteTarget?.type === 'profile' ? 'Remover perfil'
              : 'Remover regra'
        }
        description={`Tem certeza que deseja remover${deleteTarget?.name ? ` "${deleteTarget.name}"` : ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={handleConfirmDelete}
      />
    </AppLayout>
  )
}

type CrmApi = ReturnType<typeof useCrm>

function TagDefForm({ crm }: { crm: CrmApi }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor="tag-name">Novo nome</Label>
        <Input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Urgente, parceiro, …" />
      </div>
      <div className="w-24 space-y-1.5">
        <Label htmlFor="tag-color">Cor</Label>
        <Input id="tag-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <Button
        type="button"
        onClick={() => {
          if (!name.trim()) return
          crm.saveTagDefinition({
            id: `tag-${Date.now().toString(36)}`,
            name: name.trim(),
            color,
            createdAt: new Date().toISOString(),
          })
          setName('')
          toast.success('Etiqueta criada')
        }}
      >
        Criar etiqueta
      </Button>
    </div>
  )
}

function RoomForm({ crm }: { crm: CrmApi }) {
  const [name, setName] = useState('')
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor="room-name">Novo nome da sala</Label>
        <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sala 2" />
      </div>
      <Button
        type="button"
        onClick={() => {
          if (!name.trim()) return
          const now = new Date().toISOString()
          const r: Room = {
            id: `room-${Date.now().toString(36)}`,
            name: name.trim(),
            active: true,
            slotMinutes: 30,
            sortOrder: crm.rooms.length,
            createdAt: now,
          }
          crm.saveRoomRow(r)
          setName('')
          toast.success('Sala adicionada')
        }}
      >
        Adicionar sala
      </Button>
    </div>
  )
}
