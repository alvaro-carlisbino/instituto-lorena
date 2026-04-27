import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { evolutionConnectionAction, type EvolutionAction } from '@/services/evolutionConnection'

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

  const refreshSnapshot = async () => {
    setLoadingAction('snapshot')
    try {
      const result = await evolutionConnectionAction('snapshot')
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
      const result = await evolutionConnectionAction(action)
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
    void refreshSnapshot()
  }, [])

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

  return (
    <AppLayout
      title="Conexão WhatsApp (Evolution)"
      subtitle="Conecte a instância, gere QR Code e acompanhe status sem sair do CRM."
    >
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

