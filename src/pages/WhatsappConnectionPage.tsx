import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { evolutionConnectionAction, type EvolutionAction } from '@/services/evolutionConnection'
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

export function WhatsappConnectionPage() {
  const crm = useCrm()
  const [instances, setInstances] = useState<WhatsappChannelInstance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newEvoName, setNewEvoName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [savingInstance, setSavingInstance] = useState(false)
  const [loadingAction, setLoadingAction] = useState<EvolutionAction | null>(null)
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

  const runAction = async (action: EvolutionAction, successMsg: string) => {
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

  const handleAddInstance = async () => {
    if (!newLabel.trim() || !newEvoName.trim()) {
      toast.error('Preencha o rótulo e o nome da instância na Evolution (ex.: nome no painel).')
      return
    }
    setSavingInstance(true)
    try {
      const id = `wa-${Date.now().toString(36)}`
      await upsertWhatsappChannelInstance({
        id,
        label: newLabel.trim(),
        evolutionInstanceName: newEvoName.trim().replace(/\s/g, '-'),
        phoneE164: newPhone.trim() || null,
        sortOrder: instances.length,
      })
      setNewLabel('')
      setNewEvoName('')
      setNewPhone('')
      await loadInstances()
      setSelectedInstanceId(id)
      toast.success('Telefone/instância guardado. Use os botões abaixo para o QR e estado desta linha.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao guardar.')
    } finally {
      setSavingInstance(false)
    }
  }

  const handleRemoveInstance = async (id: string) => {
    if (!window.confirm('Remover este registo? A Evolution no servidor não é apagada.')) return
    try {
      await deleteWhatsappChannelInstance(id)
      if (selectedInstanceId === id) {
        setSelectedInstanceId(null)
      }
      await loadInstances()
      toast.success('Removido.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover.')
    }
  }

  return (
    <AppLayout
      title="Conexão WhatsApp (Evolution)"
      subtitle="Várias instâncias (linhas) no mesmo CRM. O webhook usa o nome de instância no payload para vincular leads."
    >
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Telefones (instâncias Evolution)</CardTitle>
          <CardDescription>
            Cada registo mapeia o <strong>nome exato</strong> da instância na API Evolution para o envio/QR abaixo. A API
            (EVOLUTION_API_KEY) é partilhada; variam as instâncias.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              Ainda sem registos. Crie a primeira (ex.: o mesmo nome que <code>EVOLUTION_INSTANCE</code> no painel) ou
              adicione uma segunda linha.
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
                onClick={() => void handleRemoveInstance(selectedInstance.id)}
              >
                Remover
              </Button>
            </p>
          ) : null}

          <div className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="wa-label">Rótulo (equipa vê no CRM)</Label>
              <Input
                id="wa-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="ex.: Recepção, Comercial, Campanha X"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-evo">Nome instância Evolution</Label>
              <Input
                id="wa-evo"
                value={newEvoName}
                onChange={(e) => setNewEvoName(e.target.value)}
                placeholder="nome-no-evolution"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wa-phone">Telefone (referência, opcional)</Label>
              <Input id="wa-phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+55..." />
            </div>
            <div className="flex items-end">
              <Button type="button" disabled={savingInstance} onClick={() => void handleAddInstance()}>
                {savingInstance ? 'A guardar…' : 'Adicionar / atualizar'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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

