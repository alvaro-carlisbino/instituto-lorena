import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHelp } from '@/components/page/PageHelp'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { pageQuietCardClass } from '@/components/page/PageSection'
import { evolutionConnectionAction, evolutionInstanceLifecycle } from '@/services/evolutionConnection'
import { cn } from '@/lib/utils'
import {
  deleteWhatsappChannelInstance,
  fetchWhatsappChannelInstances,
  upsertWhatsappChannelInstance,
  type WhatsappChannelInstance,
} from '@/services/whatsappChannelInstances'

function statusLabel(status: string) {
  const normalized = status.toLowerCase()
  if (normalized.includes('open') || normalized.includes('connected')) return 'Conectado'
  if (normalized.includes('close') || normalized.includes('disconnected')) return 'Desconectado'
  if (normalized.includes('connecting') || normalized.includes('pair')) return 'Conectando'
  if (normalized.includes('error') || normalized.includes('unreachable')) return 'Com erro'
  return 'Indefinido'
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase()
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

type ConnectionAction = 'snapshot' | 'status' | 'qrcode' | 'connect' | 'logout' | 'restart'

export function WhatsappConnectionPage() {
  const crm = useCrm()
  const [instances, setInstances] = useState<WhatsappChannelInstance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [createLabel, setCreateLabel] = useState('')
  const [createTechId, setCreateTechId] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkEvoName, setLinkEvoName] = useState('')
  const [linkPhone, setLinkPhone] = useState('')
  const [savingInstance, setSavingInstance] = useState(false)
  const [removingInstance, setRemovingInstance] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [loadingAction, setLoadingAction] = useState<ConnectionAction | null>(null)
  const [routeDraft, setRouteDraft] = useState<Record<string, WhatsappChannelInstance>>({})
  const [savingRouteId, setSavingRouteId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState({
    ok: false,
    provider: 'evolution',
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
      setSnapshot({
        ok: result.ok,
        provider: result.provider,
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
    if (selectedInstanceId) {
      void refreshSnapshot()
    }
  }, [selectedInstanceId])

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleRemoveInstance = async (id: string) => {
    if (
      !window.confirm(
        'Apagar este telefone? O WhatsApp desta linha deixa de receber mensagens no CRM, e a sessão no servidor (se ainda existir) será removida.',
      )
    ) {
      return
    }
    setRemovingInstance(true)
    try {
      const res = await evolutionInstanceLifecycle('delete_instance', { instanceId: id })
      if (!res.ok) {
        toast.error(res.message || res.error || 'Não foi possível apagar no servidor. Tente de novo; o registro do CRM foi mantido.')
        return
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
          <p>QR: WhatsApp → Aparelhos conectados. Cada bloco abaixo é um número/linha; escolha o funil de entrada.</p>
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
                <p className="m-0 text-sm font-medium">Trabalhando com: {selectedInstance.label}</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  <span className="font-mono text-[0.7rem]">{selectedInstance.evolutionInstanceName}</span> — id interno
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
                <div
                  key={inst.id}
                  className="grid gap-3 border-b border-border/50 pb-4 last:border-0 last:pb-0 md:grid-cols-12 md:items-end"
                >
                  <div className="md:col-span-2">
                    <p className="m-0 text-sm font-medium">{row.label}</p>
                    <p className="m-0 text-xs text-muted-foreground">
                      Cód. sistema: <span className="font-mono text-[0.65rem]">{row.evolutionInstanceName}</span>
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
              )
            })}
          </CardContent>
        </Card>
      ) : null}

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
    </AppLayout>
  )
}

