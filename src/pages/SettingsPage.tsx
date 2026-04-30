import { useEffect, useState } from 'react'
import { BellIcon, Building2, Clock, FileTextIcon, GripVertical, Mail, MapPin, Phone, ShieldIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { HelpDrawer } from '@/components/page/HelpDrawer'
import { pageQuietCardClass } from '@/components/page/PageSection'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { ConversationModeSwitch } from '@/components/leads/ConversationModeSwitch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  { value: 'text', label: '📝 Texto livre' },
  { value: 'select', label: '📋 Lista de opções' },
  { value: 'number', label: '🔢 Número' },
  { value: 'date', label: '📅 Data' },
  { value: 'boolean', label: '✅ Sim / Não' },
] as const

const ROLE_OPTIONS = [
  { value: 'admin', label: '👑 Administrador' },
  { value: 'gestor', label: '📊 Gestor comercial' },
  { value: 'sdr', label: '💬 Atendente' },
] as const

const CHANNEL_OPTIONS = [
  { value: 'in_app', label: 'No próprio app' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
] as const

const VISIBILITY_CONTEXTS: { value: FieldVisibilityContext; label: string; description: string }[] = [
  { value: 'kanban_card', label: 'Quadro Kanban', description: 'Aparece nos cartões do quadro' },
  { value: 'lead_detail', label: 'Ficha do lead', description: 'Aparece ao abrir o lead' },
  { value: 'list', label: 'Lista de leads', description: 'Aparece na tabela de leads' },
  { value: 'capture_form', label: 'Formulário', description: 'Aparece no formulário de captura' },
]

const PERMISSION_LABELS: Record<string, { label: string; description: string; emoji: string }> = {
  canRouteLeads: {
    emoji: '🎯',
    label: 'Gerenciar leads',
    description: 'Ver, mover e editar fichas de leads. Encaminhar entre funis.',
  },
  canEditBoards: {
    emoji: '🗂️',
    label: 'Configurar funis e etapas',
    description: 'Criar e editar funis, etapas e automações de mensagem.',
  },
  canViewTvPanel: {
    emoji: '📺',
    label: 'Ver painel de TV',
    description: 'Acesso à tela de painel para exibição em monitor.',
  },
  canManageUsers: {
    emoji: '👥',
    label: 'Administrar usuários',
    description: 'Convidar usuários, alterar papéis e configurações gerais.',
  },
}

type DeleteTarget = { type: 'field' | 'profile' | 'rule'; id: string; name?: string } | null

const SETTINGS_HELP = [
  {
    icon: '🤖',
    title: 'Atendimento com IA',
    content: (
      <p>
        Controla se a assistente pode enviar respostas automáticas. O prompt define o tom
        e o comportamento. Limite por hora evita spam.
      </p>
    ),
  },
  {
    icon: '📝',
    title: 'Campos personalizados',
    content: (
      <p>
        Crie campos extras para guardar informações específicas de cada lead — como
        convênio, procedimento desejado ou data de retorno. Arraste para reordenar.
      </p>
    ),
  },
  {
    icon: '🔐',
    title: 'Permissões por papel',
    content: (
      <p>
        Define o que cada tipo de usuário pode fazer. Um Atendente, por exemplo, pode
        gerenciar leads mas não criar funis ou convidar outros usuários.
      </p>
    ),
  },
  {
    icon: '🔔',
    title: 'Notificações',
    content: (
      <p>
        Crie regras para avisar a equipe sobre eventos — ex.: quando um lead fica parado
        mais de 2 horas ou quando uma etapa é concluída.
      </p>
    ),
  },
]

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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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

  if (!canAccessSettings) {
    return (
      <AppLayout title="Configurações gerais">
        <Card className="border-border shadow-none bg-muted/10 rounded-none">
          <CardContent className="pt-6 text-sm text-destructive font-bold uppercase tracking-widest">
            <p className="m-0">Peça acesso a um administrador (workflow, perfis de permissão e notificações).</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Configurações gerais"
      actions={
        <HelpDrawer title="Como usar as configurações" sections={SETTINGS_HELP} />
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

      <Card className={cn('mb-6', pageQuietCardClass)}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            Identidade da Clínica
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                <Building2 className="size-3 text-muted-foreground" />
                Nome da Clínica
              </Label>
              <Input
                placeholder="Ex: Instituto Lorena"
                value={crm.orgSettings.clinicName || ''}
                onChange={(e) => crm.updateOrgSettings({ clinicName: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                <Phone className="size-3 text-muted-foreground" />
                Telefone Principal
              </Label>
              <Input
                placeholder="(11) 99999-9999"
                value={crm.orgSettings.clinicPhone || ''}
                onChange={(e) => crm.updateOrgSettings({ clinicPhone: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                <Mail className="size-3 text-muted-foreground" />
                E-mail de Contato
              </Label>
              <Input
                placeholder="contato@lorena.com"
                value={crm.orgSettings.clinicEmail || ''}
                onChange={(e) => crm.updateOrgSettings({ clinicEmail: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                <MapPin className="size-3 text-muted-foreground" />
                Endereço
              </Label>
              <Input
                placeholder="Rua Exemplo, 123"
                value={crm.orgSettings.clinicAddress || ''}
                onChange={(e) => crm.updateOrgSettings({ clinicAddress: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={cn('mb-6', pageQuietCardClass)}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            Horário de Funcionamento
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Abertura</Label>
              <Input
                type="time"
                value={crm.orgSettings.workingHours?.start || '08:00'}
                onChange={(e) => crm.updateOrgSettings({
                  workingHours: { ...crm.orgSettings.workingHours!, start: e.target.value }
                })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Fechamento</Label>
              <Input
                type="time"
                value={crm.orgSettings.workingHours?.end || '18:00'}
                onChange={(e) => crm.updateOrgSettings({
                  workingHours: { ...crm.orgSettings.workingHours!, end: e.target.value }
                })}
              />
            </div>
          </div>
          <div className="space-y-3">
            <Label>Dias de Atendimento</Label>
            <div className="flex flex-wrap gap-2">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, idx) => {
                const isSelected = crm.orgSettings.workingHours?.days.includes(idx)
                return (
                  <Button
                    key={day}
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    className={cn(
                      "w-12 h-9 rounded-xl transition-all",
                      isSelected ? "shadow-md shadow-primary/20" : "opacity-60 hover:opacity-100"
                    )}
                    onClick={() => {
                      const currentDays = crm.orgSettings.workingHours?.days || []
                      const newDays = isSelected
                        ? currentDays.filter(d => d !== idx)
                        : [...currentDays, idx].sort()
                      crm.updateOrgSettings({
                        workingHours: { ...crm.orgSettings.workingHours!, days: newDays }
                      })
                    }}
                  >
                    {day}
                  </Button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

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
        <Card className="border border-border/40 shadow-none bg-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/20">
            <div>
              <CardTitle className="text-lg font-medium">Campos personalizados</CardTitle>
              <p className="mt-1 m-0 max-w-xl text-xs text-muted-foreground">
                Crie campos para guardar informações específicas dos seus pacientes. Arraste para reordenar.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { crm.addWorkflowField(); toast.success('Campo criado.') }} className="rounded-md font-medium">
              + Novo campo
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  const { active, over } = event
                  if (!over || active.id === over.id) return
                  const fields = crm.workflowFields
                  const oldIdx = fields.findIndex((f) => f.id === active.id)
                  const newIdx = fields.findIndex((f) => f.id === over.id)
                  if (oldIdx === -1 || newIdx === -1) return
                  const reordered = arrayMove(fields, oldIdx, newIdx)
                  reordered.forEach((f, i) => crm.updateWorkflowField(f.id, { sortOrder: i }))
                }}
              >
                <SortableContext
                  items={crm.workflowFields.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="m-0 list-none space-y-0 p-0 divide-y divide-border">
                    {crm.workflowFields.map((field) => {
                      const toggleVis = (ctx: FieldVisibilityContext, checked: boolean) => {
                        const next = checked
                          ? Array.from(new Set([...field.visibleIn, ctx]))
                          : field.visibleIn.filter((c) => c !== ctx)
                        crm.updateWorkflowField(field.id, { visibleIn: next as FieldVisibilityContext[] })
                      }
                      return <SortableFieldRow key={field.id} field={field} toggleVis={toggleVis} setDeleteTarget={setDeleteTarget} workflowKeyManual={workflowKeyManual} setWorkflowKeyManual={setWorkflowKeyManual} crm={crm} />
                    })}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/40 shadow-none bg-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/20">
            <div>
              <CardTitle className="text-lg font-medium">O que cada papel pode fazer</CardTitle>
              <p className="mt-1 m-0 text-xs text-muted-foreground">Configure as permissões de cada tipo de usuário no sistema.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { crm.addPermissionProfile(); toast.success('Perfil criado.') }} className="rounded-md font-medium">
              + Novo perfil
            </Button>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {crm.permissions.length === 0 ? (
              <EmptyState
                icon={ShieldIcon}
                title="Nenhum perfil configurado"
                description="Crie perfis para definir o que cada tipo de usuário pode fazer."
                className="py-8"
              />
            ) : (
              <ul className="m-0 list-none p-0 divide-y divide-border">
                {crm.permissions.map((profile) => (
                  <li key={profile.id} className="p-5 space-y-4 hover:bg-muted/5 transition-colors">
                    {/* Role selector */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Select
                        value={profile.role}
                        onValueChange={(value) =>
                          crm.updatePermissionProfile(profile.id, { role: value as 'admin' | 'gestor' | 'sdr' })
                        }
                      >
                        <SelectTrigger className="w-full sm:w-[220px] font-semibold h-9 border-border/40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button" variant="ghost" size="sm"
                        className="text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget({ type: 'profile', id: profile.id })}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                    {/* Permission cards */}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {([
                        { key: 'canRouteLeads', value: profile.canRouteLeads, onChange: (v: boolean) => crm.updatePermissionProfile(profile.id, { canRouteLeads: v }) },
                        { key: 'canEditBoards', value: profile.canEditBoards, onChange: (v: boolean) => crm.updatePermissionProfile(profile.id, { canEditBoards: v }) },
                        { key: 'canViewTvPanel', value: profile.canViewTvPanel, onChange: (v: boolean) => crm.updatePermissionProfile(profile.id, { canViewTvPanel: v }) },
                        { key: 'canManageUsers', value: profile.canManageUsers, onChange: (v: boolean) => crm.updatePermissionProfile(profile.id, { canManageUsers: v }) },
                      ] as const).map(({ key, value, onChange }) => {
                        const meta = PERMISSION_LABELS[key]!
                        return (
                          <div
                            key={key}
                            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors cursor-pointer ${
                              value ? 'border-primary/30 bg-primary/5' : 'border-border/40 bg-muted/5'
                            }`}
                            onClick={() => onChange(!value)}
                          >
                            <Switch
                              checked={value}
                              onCheckedChange={onChange}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-tight">
                                {meta.emoji} {meta.label}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                {meta.description}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>


        <Card className="border border-border/40 shadow-none bg-card lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/20">
            <div>
              <CardTitle className="text-lg font-medium">Notificações</CardTitle>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => { crm.addNotificationRule(); toast.success('Regra criada.') }} className="rounded-md font-medium">
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
                          <SelectTrigger className="w-full sm:w-[180px]">
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
                          className="w-full sm:max-w-[12rem]"
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

function SortableFieldRow({
  field,
  toggleVis,
  setDeleteTarget,
  workflowKeyManual,
  setWorkflowKeyManual,
  crm,
}: {
  field: WorkflowField
  toggleVis: (ctx: FieldVisibilityContext, checked: boolean) => void
  setDeleteTarget: (target: DeleteTarget) => void
  workflowKeyManual: Record<string, boolean>
  setWorkflowKeyManual: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  crm: CrmApi
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-col gap-5 p-5 bg-card transition-colors border-b last:border-0",
        isDragging && "shadow-xl border-primary/20 bg-muted/20"
      )}
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          className="mt-1 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-primary transition-colors"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-5" />
        </button>

        <div className="flex-1 grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Nome do campo
              </Label>
              <Input
                value={field.label}
                onChange={(e) => crm.updateWorkflowField(field.id, { label: e.target.value })}
                onBlur={(e) => {
                  const label = e.target.value.trim()
                  if (!workflowKeyManual[field.id] && label) {
                    crm.updateWorkflowField(field.id, { fieldKey: slugifyLabel(label) })
                  }
                }}
                className="h-9 border-border/60 bg-background/50 focus:bg-background"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tipo de dado
              </Label>
              <Select
                value={field.fieldType}
                onValueChange={(value) => {
                  const ft = value as WorkflowField['fieldType']
                  const updates: Partial<WorkflowField> = { fieldType: ft }
                  if (ft === 'select' && field.options.length === 0) {
                    updates.options = [{ value: 'opcao-1', label: 'Opção 1' }]
                  }
                  crm.updateWorkflowField(field.id, updates)
                }}
              >
                <SelectTrigger className="h-9 border-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end gap-3 pb-0.5">
              <div className="flex items-center gap-2 rounded-md border border-border/40 px-3 h-9 bg-muted/10">
                <Switch
                  id={`req-${field.id}`}
                  checked={field.required}
                  onCheckedChange={(v) => crm.updateWorkflowField(field.id, { required: v })}
                />
                <Label htmlFor={`req-${field.id}`} className="text-sm cursor-pointer whitespace-nowrap">Obrigatório</Label>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Onde este campo deve aparecer?
            </Label>
            <div className="flex flex-wrap gap-2">
              {VISIBILITY_CONTEXTS.map((ctx) => (
                <div
                  key={ctx.value}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1 transition-colors cursor-pointer",
                    field.visibleIn.includes(ctx.value)
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border/40 bg-muted/5 text-muted-foreground hover:bg-muted/10"
                  )}
                  onClick={() => toggleVis(ctx.value, !field.visibleIn.includes(ctx.value))}
                >
                  <Switch
                    size="sm"
                    checked={field.visibleIn.includes(ctx.value)}
                    onCheckedChange={(v) => toggleVis(ctx.value, v)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-xs font-medium">{ctx.label}</span>
                </div>
              ))}
            </div>
          </div>

          {field.fieldType === 'select' && (
            <div className="space-y-3 rounded-xl border border-dashed border-border/60 p-4 bg-muted/5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Opções da lista
                </Label>
                <Button
                  size="sm" variant="ghost"
                  className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10"
                  onClick={() => {
                    const pairs = normalizeFieldSelectOptions(field.options)
                    const used = new Set(pairs.map(p => p.value))
                    const label = `Nova opção ${pairs.length + 1}`
                    pairs.push({ value: ensureOptionValue(label, used), label })
                    crm.updateWorkflowField(field.id, { options: toStoredOptions(pairs) })
                  }}
                >
                  + Adicionar opção
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {normalizeFieldSelectOptions(field.options).map((opt, i) => (
                  <div key={i} className="flex items-center gap-2 group">
                    <Input
                      value={opt.label}
                      onChange={(e) => {
                        const pairs = normalizeFieldSelectOptions(field.options)
                        const others = new Set(pairs.filter((_, idx) => idx !== i).map(p => p.value))
                        const label = e.target.value
                        let value = pairs[i]!.value
                        if (!value || value === slugifyLabel(pairs[i]!.label)) {
                          value = ensureOptionValue(label || 'opcao', others)
                        }
                        pairs[i] = { value, label }
                        crm.updateWorkflowField(field.id, { options: toStoredOptions(pairs) })
                      }}
                      placeholder="Nome da opção"
                      className="h-8 text-xs border-border/40 bg-background"
                    />
                    <Button
                      size="icon" variant="ghost"
                      className="size-8 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        const pairs = normalizeFieldSelectOptions(field.options)
                        if (pairs.length <= 1) return
                        pairs.splice(i, 1)
                        crm.updateWorkflowField(field.id, { options: toStoredOptions(pairs) })
                      }}
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-2">
            <details className="group">
              <summary className="text-[10px] uppercase font-bold text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform">▶</span> Configurações avançadas
              </summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase">Chave técnica (API)</Label>
                  <Input
                    value={field.fieldKey}
                    onChange={(e) => {
                      setWorkflowKeyManual(m => ({ ...m, [field.id]: true }))
                      crm.updateWorkflowField(field.id, { fieldKey: e.target.value })
                    }}
                    className="h-8 text-xs font-mono bg-muted/10 border-border/40"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[10px] text-muted-foreground uppercase">Seção de agrupamento</Label>
                  <Input
                    value={field.section}
                    onChange={(e) => crm.updateWorkflowField(field.id, { section: e.target.value })}
                    className="h-8 text-xs border-border/40"
                  />
                </div>
              </div>
            </details>

            <Button
              variant="ghost" size="sm"
              className="text-destructive/60 hover:text-destructive hover:bg-destructive/10 h-8"
              onClick={() => setDeleteTarget({ type: 'field', id: field.id, name: field.label })}
            >
              <Trash2Icon className="size-4 mr-1.5" />
              Remover campo
            </Button>
          </div>
        </div>
      </div>
    </li>
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
