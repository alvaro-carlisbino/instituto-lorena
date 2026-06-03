import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHelp } from '@/components/page/PageHelp'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { pageQuietCardClass } from '@/components/page/PageSection'
import { evolutionConnectionAction, evolutionInstanceLifecycle } from '@/services/evolutionConnection'
import { cn } from '@/lib/utils'
import {
  configureEvolutionWebhook,
  deleteWhatsappChannelInstance,
  fetchWhatsappChannelInstances,
  upsertWhatsappChannelInstance,
  type WhatsappChannelInstance,
} from '@/services/whatsappChannelInstances'

function statusLabel(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'manychat') return 'ManyChat'
  if (normalized.includes('open') || normalized.includes('connected')) return 'Conectado'
  if (normalized.includes('close') || normalized.includes('disconnected')) return 'Desconectado'
  if (normalized.includes('connecting') || normalized.includes('pair')) return 'Conectando'
  if (normalized.includes('error') || normalized.includes('unreachable')) return 'Com erro'
  return 'Indefinido'
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'manychat') return 'border-sky-200 bg-sky-50 text-sky-950'
  if (normalized.includes('open') || normalized.includes('connected')) return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (normalized.includes('close') || normalized.includes('disconnected')) return 'border-red-200 bg-red-50 text-red-900'
  if (normalized.includes('connecting') || normalized.includes('pair')) return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-900'
}

function normalizeQrCode(value: string | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('data:image')) return trimmed
  return `data:image/png;base64,${trimmed}`
}

function suggestInstanceNameFromLabel(label: string): string {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32)
  const tail = Date.now().toString(36).slice(-4)
  return base ? `il-${base}-${tail}` : `il-linha-${tail}`
}

function sanitizeManychatKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

type ConnectionAction = 'snapshot' | 'status' | 'qrcode' | 'connect' | 'logout' | 'restart'

export function WhatsappConnectionPage() {
  const crm = useCrm()
  const [instances, setInstances] = useState<WhatsappChannelInstance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [createLabel, setCreateLabel] = useState('')
  const [createTechId, setCreateTechId] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [mcLabel, setMcLabel] = useState('')
  const [mcKey, setMcKey] = useState('')
  const [mcPrompt, setMcPrompt] = useState('')
  const [mcPhone, setMcPhone] = useState('')
  // W-API: instância já é criada no painel da W-API; aqui só registramos as
  // credenciais (instanceId + token) e o prompt da IA pra essa linha.
  const [waLabel, setWaLabel] = useState('')
  const [waInstanceId, setWaInstanceId] = useState('')
  const [waToken, setWaToken] = useState('')
  const [waPhone, setWaPhone] = useState('')
  const [waPrompt, setWaPrompt] = useState('')
  const [waSecret, setWaSecret] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkEvoName, setLinkEvoName] = useState('')
  const [linkPhone, setLinkPhone] = useState('')
  const [savingInstance, setSavingInstance] = useState(false)
  const [removingInstance, setRemovingInstance] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [configuringWebhook, setConfiguringWebhook] = useState(false)
  const [loadingAction, setLoadingAction] = useState<ConnectionAction | null>(null)
  const [routeDraft, setRouteDraft] = useState<Record<string, WhatsappChannelInstance>>({})
  const [savingRouteId, setSavingRouteId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState({
    ok: false,
    provider: 'evolution' as 'evolution' | 'manychat',
    instance: '',
    status: 'unknown',
    connected: null as boolean | null,
    qrCode: '',
    error: '',
    message: '',
  })

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  )

  const loadInstances = useCallback(async () => {
    try {
      const list = await fetchWhatsappChannelInstances()
      setInstances(list)
      setRouteDraft(Object.fromEntries(list.map((i) => [i.id, { ...i }])))
      setSelectedInstanceId((prev) => {
        if (prev && list.some((i) => i.id === prev)) return prev
        return list[0]?.id ?? null
      })
    } catch {
      toast.error('Não foi possível carregar os telefones/instâncias.')
    }
  }, [])

  const refreshSnapshot = async () => {
    setLoadingAction('snapshot')
    try {
      const result = await evolutionConnectionAction('snapshot', { instanceId: selectedInstanceId ?? undefined })
      const provider: 'evolution' | 'manychat' = result.provider === 'manychat' ? 'manychat' : 'evolution'
      setSnapshot({
        ok: result.ok,
        provider,
        instance: result.instance,
        status: result.status,
        connected: result.connected,
        qrCode: normalizeQrCode(result.qrCode),
        error: result.error ?? '',
        message: result.message ?? '',
      })
      if (!result.ok) {
        toast.error(result.message || result.error || 'Não foi possível obter o estado do WhatsApp.')
      }
    } finally {
      setLoadingAction(null)
    }
  }

  const runAction = async (action: ConnectionAction, successMsg: string) => {
    setLoadingAction(action)
    try {
      const result = await evolutionConnectionAction(action, { instanceId: selectedInstanceId ?? undefined })
      if (!result.ok) {
        toast.error(result.message || result.error || 'Não foi possível fazer isso. Tente de novo.')
      } else {
        toast.success(successMsg)
      }
      await refreshSnapshot()
    } finally {
      setLoadingAction(null)
    }
  }

  useEffect(() => {
    void loadInstances()
  }, [loadInstances])

  useEffect(() => {
    if (!selectedInstanceId) return
    const inst = instances.find((i) => i.id === selectedInstanceId)
    if (inst?.channelProvider === 'manychat') {
      setSnapshot({
        ok: true,
        provider: 'manychat',
        instance: '',
        status: 'manychat',
        connected: null,
        qrCode: '',
        error: '',
        message: 'Esta linha atende pelo ManyChat — não há código QR nem Evolution neste ecrã.',
      })
      setLoadingAction(null)
      return
    }
    void refreshSnapshot()
  }, [selectedInstanceId, instances])

  const isBusy = loadingAction !== null
  const qrCode = useMemo(() => normalizeQrCode(snapshot.qrCode), [snapshot.qrCode])

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="WhatsApp">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Apenas administradores podem gerenciar a conexão do WhatsApp.
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  const handleCreateInstanceOnServer = async () => {
    if (!createLabel.trim()) {
      toast.error('Indique o nome da linha (ex.: Recepção).')
      return
    }
    const instanceNameRequest = (createTechId.trim() || suggestInstanceNameFromLabel(createLabel)).trim()
    if (!instanceNameRequest) {
      toast.error('O identificador técnico gerado é inválido. Preencha o nome interno ou ajuste o nome mostrado.')
      return
    }
    setSavingInstance(true)
    try {
      const res = await evolutionInstanceLifecycle('create_instance', { instanceName: instanceNameRequest })
      if (!res.ok) {
        toast.error(res.message || res.error || 'Não foi possível criar o número no servidor. O nome pode já existir — escolha outro.')
        return
      }
      const evoName = (res.instance ?? instanceNameRequest).trim()
      const id = `wa-${Date.now().toString(36)}`
      await upsertWhatsappChannelInstance({
        id,
        label: createLabel.trim(),
        channelProvider: 'evolution',
        evolutionInstanceName: evoName,
        phoneE164: createPhone.trim() || null,
        sortOrder: instances.length,
        entryPipelineId: null,
        entryStageId: null,
        defaultOwnerId: null,
        onLineChange: 'keep_stage',
      })
      setCreateLabel('')
      setCreateTechId('')
      setCreatePhone('')
      await loadInstances()
      setSelectedInstanceId(id)
      toast.success('Número criado. Abaixo, peça o código QR e conecte o celular.')
      // Auto-register the webhook so messages arrive immediately
      configureEvolutionWebhook(id).then((wh) => {
        if (!wh.ok) toast.warning(`Número criado, mas o webhook não foi registado automaticamente: ${wh.message}. Use o botão "Registar Webhook" na área de conexão.`)
      }).catch(() => { /* silent */ })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleLinkExistingInstance = async () => {
    if (!linkLabel.trim() || !linkEvoName.trim()) {
      toast.error('Preencha o nome e o identificador exato que já existe no servidor (Evolution).')
      return
    }
    setSavingInstance(true)
    try {
      const id = `wa-${Date.now().toString(36)}`
      await upsertWhatsappChannelInstance({
        id,
        label: linkLabel.trim(),
        channelProvider: 'evolution',
        evolutionInstanceName: linkEvoName.trim().replace(/\s+/g, '-'),
        phoneE164: linkPhone.trim() || null,
        sortOrder: instances.length,
        entryPipelineId: null,
        entryStageId: null,
        defaultOwnerId: null,
        onLineChange: 'keep_stage',
      })
      setLinkLabel('')
      setLinkEvoName('')
      setLinkPhone('')
      setLinkOpen(false)
      await loadInstances()
      setSelectedInstanceId(id)
      toast.success('Linha associada. Use os botões de QR se precisar de ligação.')
      // Auto-register the webhook so messages arrive immediately
      configureEvolutionWebhook(id).then((wh) => {
        if (!wh.ok) toast.warning(`Linha salva, mas o webhook não foi registado automaticamente: ${wh.message}. Use o botão "Registar Webhook" na área de conexão.`)
      }).catch(() => { /* silent */ })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleAddManychatLine = async () => {
    if (!mcLabel.trim()) {
      toast.error('Indique o nome da linha ManyChat.')
      return
    }
    const label = mcLabel.trim()
    const keyRaw = mcKey.trim() || suggestInstanceNameFromLabel(label)
    const key = sanitizeManychatKey(keyRaw)
    if (!key || key.length < 2) {
      toast.error('Chave inválida — use letras minúsculas, números, _ ou - (ex.: sdr).')
      return
    }
    setSavingInstance(true)
    try {
      const id = `mc-${Date.now().toString(36)}`
      await upsertWhatsappChannelInstance({
        id,
        label,
        channelProvider: 'manychat',
        evolutionInstanceName: null,
        manychatInstanceKey: key,
        aiSystemPrompt: mcPrompt,
        phoneE164: mcPhone.trim() || null,
        sortOrder: instances.length,
        entryPipelineId: null,
        entryStageId: null,
        defaultOwnerId: null,
        onLineChange: 'keep_stage',
      })
      setMcLabel('')
      setMcKey('')
      setMcPrompt('')
      setMcPhone('')
      await loadInstances()
      setSelectedInstanceId(id)
      toast.success(
        `Linha ManyChat criada. No External Request envie "crm_instance_key": "${key}" (ou o id ${id}).`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleAddWapiLine = async () => {
    if (!waLabel.trim()) {
      toast.error('Indique o nome da linha (ex.: Aline – Comercial TC).')
      return
    }
    if (!waInstanceId.trim()) {
      toast.error('Informe o instanceId da W-API (copie do painel da W-API).')
      return
    }
    if (!waToken.trim()) {
      toast.error('Informe o token Bearer da instância (copie do painel da W-API).')
      return
    }
    setSavingInstance(true)
    try {
      const id = `wa-wapi-${Date.now().toString(36)}`
      await upsertWhatsappChannelInstance({
        id,
        label: waLabel.trim(),
        channelProvider: 'wapi',
        wapiInstanceId: waInstanceId.trim(),
        wapiToken: waToken.trim(),
        wapiWebhookSecret: waSecret.trim() || null,
        aiSystemPrompt: waPrompt,
        phoneE164: waPhone.trim() || null,
        sortOrder: instances.length,
        entryPipelineId: null,
        entryStageId: null,
        defaultOwnerId: null,
        onLineChange: 'keep_stage',
      })
      setWaLabel('')
      setWaInstanceId('')
      setWaToken('')
      setWaPhone('')
      setWaPrompt('')
      setWaSecret('')
      await loadInstances()
      setSelectedInstanceId(id)
      toast.success('Linha W-API criada. Agora cole o webhook URL no painel da W-API (instruções abaixo).')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleRemoveInstance = async (id: string) => {
    const target = instances.find((i) => i.id === id)
    const confirmManychat =
      target?.channelProvider === 'manychat'
        ? 'Apagar esta linha ManyChat do CRM? Os fluxos no ManyChat continuam — atualize o External Request se deixar de usar esta chave.'
        : 'Apagar este telefone? O WhatsApp desta linha deixa de receber mensagens no CRM, e a sessão no servidor (se ainda existir) será removida.'
    if (!window.confirm(confirmManychat)) {
      return
    }
    setRemovingInstance(true)
    try {
      if (target?.channelProvider !== 'manychat') {
        const res = await evolutionInstanceLifecycle('delete_instance', { instanceId: id })
        if (!res.ok) {
          toast.error(res.message || res.error || 'Não foi possível apagar no servidor. Tente de novo; o registro do CRM foi mantido.')
          return
        }
      }
      await deleteWhatsappChannelInstance(id)
      if (selectedInstanceId === id) {
        setSelectedInstanceId(null)
      }
      await loadInstances()
      toast.success('Telefone removido: já não aparece no CRM; o servidor removido ou já estava inexistente.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover.')
    } finally {
      setRemovingInstance(false)
    }
  }

  const handleConfigureWebhook = async () => {
    if (!selectedInstanceId) {
      toast.error('Selecione um telefone primeiro.')
      return
    }
    setConfiguringWebhook(true)
    try {
      const res = await configureEvolutionWebhook(selectedInstanceId)
      if (res.ok) {
        toast.success(res.message || 'Webhook configurado! Mensagens novas já chegam ao CRM.')
      } else {
        toast.error(res.message || 'Falha ao configurar o webhook. Verifique os logs.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro inesperado.')
    } finally {
      setConfiguringWebhook(false)
    }
  }

  const updateRouteDraft = (id: string, partial: Partial<WhatsappChannelInstance>) => {
    setRouteDraft((d) => {
      const cur = d[id]
      if (!cur) return d
      return { ...d, [id]: { ...cur, ...partial } }
    })
  }

  const handleSaveRoute = async (id: string) => {
    const row = routeDraft[id]
    if (!row) return
    setSavingRouteId(id)
    try {
      await upsertWhatsappChannelInstance(row)
      await loadInstances()
      toast.success('Regras salvas para este telefone.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar as regras.')
    } finally {
      setSavingRouteId(null)
    }
  }

  return (
    <AppLayout
      title="WhatsApp"
      actions={
        <PageHelp title="Conexão">
          <p>
            Evolution: QR e webhook para WhatsApp directo ao CRM. ManyChat: configure linhas abaixo e envie{' '}
            <span className="font-mono text-xs">crm_instance_key</span> no External Request — sem Evolution neste ecrã.
          </p>
        </PageHelp>
      }
    >
      <Card className={cn('mb-4', pageQuietCardClass)}>
        <CardHeader>
          <CardTitle>Telefones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {instances.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {instances.map((inst) => (
                <Button
                  key={inst.id}
                  type="button"
                  size="sm"
                  variant={selectedInstanceId === inst.id ? 'default' : 'outline'}
                  onClick={() => setSelectedInstanceId(inst.id)}
                >
                  {inst.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">Ainda nenhum. Crie a primeira linha com o formulário e abra o bloco de QR em baixo.</p>
          )}

          {selectedInstance ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="m-0 text-sm font-medium">
                  Trabalhando com: {selectedInstance.label}
                  {selectedInstance.channelProvider === 'manychat' ? (
                    <Badge variant="outline" className="ml-2 border-sky-300 text-sky-900">
                      ManyChat
                    </Badge>
                  ) : null}
                </p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  {selectedInstance.channelProvider === 'manychat' ? (
                    <>
                      Chave webhook:{' '}
                      <span className="font-mono text-[0.7rem]">
                        {selectedInstance.manychatInstanceKey ?? '—'}
                      </span>{' '}
                      — id <span className="font-mono text-[0.7rem]">{selectedInstance.id}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-[0.7rem]">{selectedInstance.evolutionInstanceName ?? '—'}</span>{' '}
                      — Evolution
                    </>
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
                disabled={removingInstance}
                onClick={() => void handleRemoveInstance(selectedInstance.id)}
              >
                {removingInstance ? 'Apagando…' : 'Apagar este telefone'}
              </Button>
            </div>
          ) : null}

          <div className="space-y-3">
            <h3 className="m-0 text-sm font-semibold">Novo telefone</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-create-label">Nome no CRM (obrigatório)</Label>
                <Input
                  id="wa-create-label"
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                  placeholder="ex.: Recepção, Comercial, Campanha X"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-create-tech">Nome interno (opcional)</Label>
                <Input
                  id="wa-create-tech"
                  value={createTechId}
                  onChange={(e) => setCreateTechId(e.target.value)}
                  placeholder="Só se o suporte pediu; senão, deixe vazio"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-create-phone">Número para referência (opcional)</Label>
                <Input
                  id="wa-create-phone"
                  value={createPhone}
                  onChange={(e) => setCreatePhone(e.target.value)}
                  placeholder="+55..."
                />
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button
                  type="button"
                  disabled={savingInstance}
                  onClick={() => void handleCreateInstanceOnServer()}
                >
                  {savingInstance ? 'Adicionando…' : 'Criar e salvar no CRM'}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-border/60 pt-4">
            <h3 className="m-0 text-sm font-semibold">Linha ManyChat (SDR / Meta — sem Evolution)</h3>
            <p className="m-0 text-xs text-muted-foreground">
              Cria a linha aqui, define o prompt da IA abaixo em cada registo e envia no External Request o mesmo JSON com{' '}
              <span className="font-mono">crm_instance_key</span> igual à chave ou ao id da linha.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-mc-label">Nome no CRM</Label>
                <Input
                  id="wa-mc-label"
                  value={mcLabel}
                  onChange={(e) => setMcLabel(e.target.value)}
                  placeholder="ex.: SDR WhatsApp"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-mc-key">Chave no webhook (opcional)</Label>
                <Input
                  id="wa-mc-key"
                  value={mcKey}
                  onChange={(e) => setMcKey(e.target.value)}
                  placeholder="ex.: sdr — omita para gerar automaticamente"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-mc-phone">Número referência (opcional)</Label>
                <Input
                  id="wa-mc-phone"
                  value={mcPhone}
                  onChange={(e) => setMcPhone(e.target.value)}
                  placeholder="+55..."
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="wa-mc-prompt">Prompt de sistema desta linha (obrigatório para IA específica)</Label>
                <Textarea
                  id="wa-mc-prompt"
                  value={mcPrompt}
                  onChange={(e) => setMcPrompt(e.target.value)}
                  placeholder="Instruções da IA para este número / fluxo ManyChat…"
                  rows={5}
                  className="min-h-[120px] text-sm"
                />
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button type="button" disabled={savingInstance} onClick={() => void handleAddManychatLine()}>
                  {savingInstance ? 'Salvando…' : 'Adicionar linha ManyChat'}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-border/60 pt-4">
            <h3 className="m-0 text-sm font-semibold">Linha W-API (recomendado para novas linhas)</h3>
            <p className="m-0 text-xs text-muted-foreground">
              Crie a instância primeiro no painel da{' '}
              <a href="https://app.w-api.app" target="_blank" rel="noreferrer" className="underline">
                W-API
              </a>{' '}
              (faz o QR code e mantém a sessão lá). Depois cole aqui o <span className="font-mono">instanceId</span> e o{' '}
              <span className="font-mono">token</span> da instância, escreva o prompt da IA, e cole o webhook URL abaixo no
              painel da W-API na opção <span className="font-mono">Mensagens recebidas</span>.
            </p>
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-[0.7rem] break-all">
              {(import.meta.env.VITE_SUPABASE_URL ?? '<SUPABASE_URL>').replace(/\/$/, '')}/functions/v1/crm-wapi-webhook
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-wapi-label">Nome no CRM</Label>
                <Input
                  id="wa-wapi-label"
                  value={waLabel}
                  onChange={(e) => setWaLabel(e.target.value)}
                  placeholder="ex.: Aline — Comercial TC"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-wapi-phone">Número (opcional)</Label>
                <Input
                  id="wa-wapi-phone"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  placeholder="+55..."
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-wapi-instance">instanceId da W-API</Label>
                <Input
                  id="wa-wapi-instance"
                  value={waInstanceId}
                  onChange={(e) => setWaInstanceId(e.target.value)}
                  placeholder="copie do painel da W-API"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-wapi-token">Token Bearer</Label>
                <Input
                  id="wa-wapi-token"
                  type="password"
                  value={waToken}
                  onChange={(e) => setWaToken(e.target.value)}
                  placeholder="token da instância (sensível)"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="wa-wapi-prompt">Prompt de sistema desta linha (obrigatório para IA específica)</Label>
                <Textarea
                  id="wa-wapi-prompt"
                  value={waPrompt}
                  onChange={(e) => setWaPrompt(e.target.value)}
                  placeholder="Instruções da IA para este número (persona, escopo, regras de handoff…)"
                  rows={5}
                  className="min-h-[120px] text-sm"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-wapi-secret">Webhook secret (opcional)</Label>
                <Input
                  id="wa-wapi-secret"
                  value={waSecret}
                  onChange={(e) => setWaSecret(e.target.value)}
                  placeholder="se configurar no painel da W-API, cole aqui"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button type="button" disabled={savingInstance} onClick={() => void handleAddWapiLine()}>
                  {savingInstance ? 'Salvando…' : 'Adicionar linha W-API'}
                </Button>
              </div>
            </div>
          </div>

          <Collapsible open={linkOpen} onOpenChange={setLinkOpen} className="border-t border-border/60 pt-4">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground hover:text-foreground">
              O número já estava em outro lugar (só vincular aqui)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 block">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wa-link-label">Nome no CRM</Label>
                  <Input
                    id="wa-link-label"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    placeholder="ex.: Recepção"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wa-link-evo">Nome que o serviço já conhece</Label>
                  <Input
                    id="wa-link-evo"
                    value={linkEvoName}
                    onChange={(e) => setLinkEvoName(e.target.value)}
                    placeholder="mesmo que no painel do fornecedor"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wa-link-phone">Número (opcional)</Label>
                  <Input
                    id="wa-link-phone"
                    value={linkPhone}
                    onChange={(e) => setLinkPhone(e.target.value)}
                    placeholder="+55..."
                  />
                </div>
                <div className="flex items-end sm:col-span-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={savingInstance}
                    onClick={() => void handleLinkExistingInstance()}
                  >
                    Salvar vínculo no CRM
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {instances.length > 0 ? (
        <Card className={cn('mb-4', pageQuietCardClass)}>
          <CardHeader className="space-y-1">
            <div className="flex flex-col gap-2 min-[500px]:flex-row min-[500px]:items-start min-[500px]:justify-between">
              <div>
                <CardTitle>Entrada da primeira conversa</CardTitle>
              </div>
              <PageHelp title="Regras do primeiro contato" label="Regras do primeiro contato, ajuda">
                <p>Só a 1.ª mensagem de um contato novo nesta linha; ajuste o funil/etapa e use Salvar na linha.</p>
              </PageHelp>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {instances.map((inst) => {
              const row = routeDraft[inst.id] ?? inst
              const pipeline = crm.pipelineCatalog.find((p) => p.id === (row.entryPipelineId ?? ''))
              const stages = pipeline?.stages ?? []
              return (
                <div key={inst.id} className="flex flex-col gap-3 border-b border-border/50 pb-4 last:border-0 last:pb-0">
                  <div className="grid gap-3 md:grid-cols-12 md:items-end">
                  <div className="md:col-span-2">
                    <p className="m-0 text-sm font-medium">{row.label}</p>
                    <p className="m-0 text-xs text-muted-foreground">
                      {row.channelProvider === 'manychat' ? (
                        <>
                          ManyChat ·{' '}
                          <span className="font-mono text-[0.65rem]">{row.manychatInstanceKey ?? row.id}</span>
                        </>
                      ) : row.channelProvider === 'wapi' ? (
                        <>
                          W-API ·{' '}
                          <span className="font-mono text-[0.65rem]">{row.wapiInstanceId ?? '—'}</span>
                        </>
                      ) : (
                        <>
                          Evolution ·{' '}
                          <span className="font-mono text-[0.65rem]">{row.evolutionInstanceName ?? '—'}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="md:col-span-3">
                    <Label className="text-xs">Processo (equipe)</Label>
                    <Select
                      value={row.entryPipelineId ?? '__default__'}
                      onValueChange={(v) => {
                        if (v === '__default__') {
                          updateRouteDraft(inst.id, { entryPipelineId: null, entryStageId: null })
                          return
                        }
                        const p = crm.pipelineCatalog.find((x) => x.id === v)
                        const first = p?.stages[0]
                        updateRouteDraft(inst.id, {
                          entryPipelineId: v,
                          entryStageId: first?.id ?? null,
                        })
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9 text-xs">
                        <SelectValue placeholder="Padrão geral" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__" className="text-xs">
                          Mesmo padrão do restante do CRM
                        </SelectItem>
                        {crm.pipelineCatalog.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Fase nesse processo</Label>
                    <Select
                      value={row.entryStageId ?? '__no_stage__'}
                      onValueChange={(v) => {
                        if (v === '__no_stage__') {
                          updateRouteDraft(inst.id, { entryStageId: null })
                          return
                        }
                        updateRouteDraft(inst.id, { entryStageId: v })
                      }}
                      disabled={!row.entryPipelineId}
                    >
                      <SelectTrigger className="mt-1 h-9 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Quem fica com a conversa de entrada</Label>
                    <Select
                      value={row.defaultOwnerId ?? '__balance__'}
                      onValueChange={(v) => {
                        if (v === '__balance__') {
                          updateRouteDraft(inst.id, { defaultOwnerId: null })
                          return
                        }
                        updateRouteDraft(inst.id, { defaultOwnerId: v })
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9 text-xs">
                        <SelectValue placeholder="Dividir entre a equipe" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__balance__" className="text-xs">
                          Alternar de forma justa na equipe
                        </SelectItem>
                        {crm.sdrMembers
                          .filter((s) => s.active)
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">
                              {s.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Se já fala a partir de outro nosso telefone</Label>
                    <Select
                      value={row.onLineChange}
                      onValueChange={(v) => {
                        if (v === 'use_entry' || v === 'keep_stage') {
                          updateRouteDraft(inst.id, { onLineChange: v })
                        }
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keep_stage" className="text-xs">
                          Manter a mesma coluna no quadro
                        </SelectItem>
                        <SelectItem value="use_entry" className="text-xs">
                          Aplicar outra vez as regras desta linha
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-1">
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      disabled={savingRouteId === inst.id}
                      onClick={() => void handleSaveRoute(inst.id)}
                    >
                      {savingRouteId === inst.id ? '…' : 'Salvar'}
                    </Button>
                  </div>
                  </div>
                  <div className="w-full space-y-1.5">
                    <Label className="text-xs">Prompt IA só desta linha (opcional)</Label>
                    <Textarea
                      rows={3}
                      className="min-h-[72px] text-xs"
                      value={row.aiSystemPrompt}
                      onChange={(e) => updateRouteDraft(inst.id, { aiSystemPrompt: e.target.value })}
                      placeholder="Vazio = prompt global (Configurações). Preenchido = respostas da IA usam este texto para esta linha."
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {selectedInstance?.channelProvider === 'manychat' ? (
        <Card className={cn('mb-4', pageQuietCardClass)}>
          <CardHeader>
            <CardTitle>Evolution e código QR</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="m-0 text-sm text-muted-foreground">
              Esta linha atende pelo ManyChat — não há Evolution nem QR aqui. No External Request, inclua no JSON o campo{' '}
              <span className="font-mono text-[0.7rem]">crm_instance_key</span> com o valor{' '}
              <span className="font-mono text-[0.7rem]">
                {selectedInstance.manychatInstanceKey ?? selectedInstance.id}
              </span>{' '}
              para a IA usar o prompt desta linha.
            </p>
          </CardContent>
        </Card>
      ) : (
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className={cn('lg:col-span-2', pageQuietCardClass)}>
          <CardHeader>
            <CardTitle>Estado e conexão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="m-0 flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Está ligado agora</span>
                <Badge className={statusBadgeClass(snapshot.status)}>{statusLabel(snapshot.status)}</Badge>
              </p>
              <p className="m-0 text-sm">
                <span className="text-muted-foreground">Recebe e envia no CRM: </span>
                {snapshot.connected === null
                  ? 'Ainda verificando'
                  : snapshot.connected
                    ? 'Sim'
                    : 'Ainda não. Use o QR ao lado'}
              </p>
            </div>
            {snapshot.instance ? (
              <p className="m-0 text-xs text-muted-foreground">
                Linha com nome interno <span className="font-mono">{snapshot.instance}</span> (não muda o que a equipe
                vê)
              </p>
            ) : null}

            {(snapshot.error || snapshot.message) ? (
              <div
                className={
                  'rounded-lg border p-3 text-sm ' +
                  (snapshot.error
                    ? 'border-destructive/30 bg-destructive/5 text-destructive'
                    : 'border-amber-200/60 bg-amber-50/80 text-amber-950')
                }
              >
                {snapshot.message || snapshot.error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={isBusy} onClick={() => void refreshSnapshot()}>
                {loadingAction === 'snapshot' ? 'Atualizando…' : 'Atualizar agora'}
              </Button>
              <Button
                type="button"
                disabled={isBusy}
                onClick={() => void runAction('connect', 'Código de ligação pedido. Se não aparecer o QR, toque de novo.')}
              >
                Pedir código (QR) para ligação
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => void runAction('restart', 'Serviço de WhatsApp reiniciado. Verifique a ligação.')}
              >
                Reiniciar a ligação
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isBusy || configuringWebhook}
                onClick={() => void handleConfigureWebhook()}
                className="border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                {configuringWebhook ? 'Registando…' : 'Registar Webhook'}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isBusy}
                onClick={() => void runAction('logout', 'Número desconectou: é preciso escanear o QR de novo.')}
              >
                Sair desta conta
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className={pageQuietCardClass}>
          <CardHeader>
            <CardTitle>QR</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {qrCode ? (
              <img
                src={qrCode}
                alt="Código para ligar o WhatsApp"
                className="mx-auto aspect-square w-full max-w-[18rem] rounded-lg border border-border bg-white p-2"
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Ainda não há código. Use “Pedir código (QR) para ligação” ao lado.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}
    </AppLayout>
  )
}

