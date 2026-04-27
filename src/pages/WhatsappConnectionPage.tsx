import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { evolutionConnectionAction, evolutionInstanceLifecycle } from '@/services/evolutionConnection'
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
      if (!result.ok && result.error) {
        toast.error(result.error)
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
        toast.error(result.error ?? 'Falha ao executar ação na Evolution.')
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
      <AppLayout title="Conexão WhatsApp" subtitle="Sem permissão para acessar esta área.">
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
      toast.error('O identificador técnico gerado é inválido. Preencha o identificador ou ajuste o rótulo.')
      return
    }
    setSavingInstance(true)
    try {
      const res = await evolutionInstanceLifecycle('create_instance', { instanceName: instanceNameRequest })
      if (!res.ok) {
        toast.error(res.message || res.error || 'A Evolution rejeitou a criação da instância.')
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
      toast.success('Instância criada no Evolution e linha adicionada ao CRM. Gere o QR abaixo.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao guardar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleLinkExistingInstance = async () => {
    if (!linkLabel.trim() || !linkEvoName.trim()) {
      toast.error('Preencha o rótulo e o nome exato da instância que já existe na Evolution.')
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
      toast.error(e instanceof Error ? e.message : 'Falha ao guardar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleRemoveInstance = async (id: string) => {
    if (
      !window.confirm(
        'Remover esta linha? Será apagada no servidor Evolution (se ainda existir) e o registo sai do CRM.',
      )
    ) {
      return
    }
    setRemovingInstance(true)
    try {
      const res = await evolutionInstanceLifecycle('delete_instance', { instanceId: id })
      if (!res.ok) {
        toast.error(res.message || res.error || 'Falha ao apagar a instância no Evolution. O registo mantém-se.')
        return
      }
      await deleteWhatsappChannelInstance(id)
      if (selectedInstanceId === id) {
        setSelectedInstanceId(null)
      }
      await loadInstances()
      toast.success('Linha removida do Evolution (ou já inexistente) e do CRM.')
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
      toast.success('Roteamento guardado para esta linha.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao guardar roteamento.')
    } finally {
      setSavingRouteId(null)
    }
  }

  return (
    <AppLayout
      title="Conexão WhatsApp (Evolution)"
      subtitle="Crie linhas, defina em que funil e etapa entram os contactos, e acompanhe o handoff entre telefones (o mesmo lead continua a conversa ao mudar de instância)."
    >
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Telefones (linhas / instâncias)</CardTitle>
          <CardDescription>
            O passo normal é <strong>criar a instância no servidor Evolution</strong> a partir do botão (POST na API) e, em
            seguida, conectar o WhatsApp com o QR. Se a instância já existir noutro painel, abra a secção opcional para
            vinculá‑la só no CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
            <p className="m-0 text-sm text-muted-foreground">
              Ainda sem linhas. Use o formulário abaixo para criar a primeira instância no Evolution, ou o link opcional
              se já tiver o nome noutro painel.
            </p>
          )}

          {selectedInstance ? (
            <p className="m-0 text-sm text-muted-foreground">
              Selecionado: <strong>{selectedInstance.label}</strong> — Evolution:{' '}
              <code className="text-xs">{selectedInstance.evolutionInstanceName}</code>
              <Button
                type="button"
                variant="link"
                className="h-auto px-2 py-0 text-destructive"
                disabled={removingInstance}
                onClick={() => void handleRemoveInstance(selectedInstance.id)}
              >
                {removingInstance ? 'A remover…' : 'Remover'}
              </Button>
            </p>
          ) : null}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">1. Criar nova instância no Evolution</h3>
            <p className="text-xs text-muted-foreground">
              O rótulo é o que a equipa vê no CRM. O identificador técnico pode ficar vazio: será gerado (ex.{' '}
              <code className="text-[0.7rem]">il-recepcao-x7ab</code>) a partir do rótulo, ou preencha um nome único em
              letras minúsculas, números e hífen, compatível com a Evolution.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-create-label">Rótulo no CRM (obrigatório)</Label>
                <Input
                  id="wa-create-label"
                  value={createLabel}
                  onChange={(e) => setCreateLabel(e.target.value)}
                  placeholder="ex.: Recepção, Comercial, Campanha X"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-create-tech">Identificador na Evolution (opcional)</Label>
                <Input
                  id="wa-create-tech"
                  value={createTechId}
                  onChange={(e) => setCreateTechId(e.target.value)}
                  placeholder="vazio = gerado a partir do rótulo"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wa-create-phone">Telefone de referência (opcional)</Label>
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
                  {savingInstance ? 'A criar…' : 'Criar no Evolution e adicionar ao CRM'}
                </Button>
              </div>
            </div>
          </div>

          <Collapsible open={linkOpen} onOpenChange={setLinkOpen} className="border-t border-border/60 pt-4">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground hover:text-foreground">
              Já existe uma instância noutro painel — só vincular no CRM
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 block">
              <p className="mb-3 text-xs text-muted-foreground">
                Use quando a instância foi criada manualmente: indique o <strong>nome exatamente</strong> como na Evolution
                (webhook/QR).
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wa-link-label">Rótulo no CRM</Label>
                  <Input
                    id="wa-link-label"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    placeholder="ex.: Recepção"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wa-link-evo">Nome da instância na Evolution</Label>
                  <Input
                    id="wa-link-evo"
                    value={linkEvoName}
                    onChange={(e) => setLinkEvoName(e.target.value)}
                    placeholder="nome exato"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wa-link-phone">Telefone (opcional)</Label>
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
                    Só vincular no CRM
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {instances.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Roteamento: funil e etapa por telefone</CardTitle>
            <CardDescription>
              Contactos <strong>novos</strong> (primeira mensagem nesta linha) entram no funil/etapa escolhidos. O mesmo
              telefone no WhatsApp é <strong>um único lead</strong>: se o contacto passar a escrever por outra instância,
              escolha se mantém a etapa no Kanban ou se aplica de novo a entrada desta linha. Fica registo de mudança de
              linha no histórico do lead.
            </CardDescription>
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
                      <code className="text-[0.65rem]">{row.evolutionInstanceName}</code>
                    </p>
                  </div>
                  <div className="md:col-span-3">
                    <Label className="text-xs">Entrar no funil</Label>
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
                        <SelectValue placeholder="Padrão global" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__" className="text-xs">
                          Padrão (primeiro funil do CRM)
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
                    <Label className="text-xs">Etapa inicial</Label>
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
                    <Label className="text-xs">Responsável padrão</Label>
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
                        <SelectValue placeholder="Equilíbrio global" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__balance__" className="text-xs">
                          Equilíbrio (SDR)
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
                    <Label className="text-xs">Mudou de outro telefone</Label>
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
                          Manter etapa no Kanban
                        </SelectItem>
                        <SelectItem value="use_entry" className="text-xs">
                          Aplicar esta entrada
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
                      {savingRouteId === inst.id ? '…' : 'Guardar'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Status da instância</CardTitle>
            <CardDescription>Atualização em tempo real da conexão com a Evolution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="m-0 text-sm"><strong>Provider:</strong> {snapshot.provider}</p>
              <p className="m-0 text-sm"><strong>Instância:</strong> {snapshot.instance || 'Não informada'}</p>
              <p className="m-0 flex items-center gap-2 text-sm">
                <strong>Status:</strong>
                <Badge className={statusBadgeClass(snapshot.status)}>{statusLabel(snapshot.status)}</Badge>
              </p>
              <p className="m-0 text-sm">
                <strong>Conectado:</strong> {snapshot.connected === null ? 'Indefinido' : snapshot.connected ? 'Sim' : 'Não'}
              </p>
            </div>

            {snapshot.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {snapshot.error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={isBusy} onClick={() => void refreshSnapshot()}>
                {loadingAction === 'snapshot' ? 'Atualizando...' : 'Atualizar status'}
              </Button>
              <Button type="button" disabled={isBusy} onClick={() => void runAction('connect', 'Solicitação de conexão enviada.')}>
                Gerar conexão / QR
              </Button>
              <Button type="button" variant="outline" disabled={isBusy} onClick={() => void runAction('restart', 'Instância reiniciada.')}>
                Reiniciar instância
              </Button>
              <Button type="button" variant="destructive" disabled={isBusy} onClick={() => void runAction('logout', 'Instância desconectada.')}>
                Desconectar sessão
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>QR Code</CardTitle>
            <CardDescription>Escaneie com o WhatsApp para conectar a instância.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {qrCode ? (
              <img src={qrCode} alt="QR Code da conexão Evolution" className="mx-auto aspect-square w-full max-w-[18rem] rounded-lg border border-border bg-white p-2" />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Sem QR Code disponível no momento. Clique em "Gerar conexão / QR".
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}

