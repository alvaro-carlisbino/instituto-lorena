import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plugs, PlugsConnected, Package, CreditCard } from 'phosphor-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTenant } from '@/context/TenantContext'
import { fetchBlingStatus, startBlingConnect, disconnectBling, type BlingStatus } from '@/services/crmBling'

export function IntegrationsPage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const [bling, setBling] = useState<BlingStatus>({ connected: false, connectedAt: null, accountName: null })
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    // Volta do OAuth do Bling (?bling=ok|erro)
    const params = new URLSearchParams(window.location.search)
    const b = params.get('bling')
    if (b === 'ok') toast.success('Bling conectado com sucesso!')
    else if (b === 'erro') toast.error(`Falha ao conectar o Bling: ${params.get('msg') ?? ''}`)
    if (b) {
      params.delete('bling')
      params.delete('msg')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [])

  useEffect(() => {
    if (!isSalesPolo) return
    setLoading(true)
    fetchBlingStatus()
      .then(setBling)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao ler status'))
      .finally(() => setLoading(false))
  }, [isSalesPolo])

  if (!isSalesPolo) {
    return (
      <AppLayout title="Integrações">
        <PageHeader title="Integrações" />
        <Card className="mt-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            As integrações (Bling, Rede) são do polo de vendas. Troque para o polo <strong>Tricopill</strong> no
            seletor de polo (topo da barra lateral).
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await startBlingConnect(window.location.href)
    } catch (e) {
      setConnecting(false)
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar conexão')
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnectBling()
      setBling({ connected: false, connectedAt: null, accountName: null })
      toast.success('Bling desconectado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desconectar')
    }
  }

  return (
    <AppLayout title="Integrações">
      <PageHeader title="Integrações" description="Conecte o ERP e os meios de pagamento do Tricopill" />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Bling */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <Package className="size-4 text-primary" weight="bold" /> Bling (ERP)
              </span>
              <Badge
                variant={bling.connected ? 'default' : 'secondary'}
                className={bling.connected ? 'bg-emerald-500/15 text-emerald-600' : ''}
              >
                {loading ? '...' : bling.connected ? 'Conectado' : 'Desconectado'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Catálogo e estoque como fonte da verdade para a IA, e criação automática do pedido de venda quando o
              pagamento confirma.
            </p>
            {bling.connected ? (
              <div className="space-y-3">
                {bling.connectedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Conectado em {new Date(bling.connectedAt).toLocaleString('pt-BR')}
                    {bling.accountName ? ` · ${bling.accountName}` : ''}
                  </p>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => void handleDisconnect()}>
                  <Plugs className="mr-1.5 size-4" /> Desconectar
                </Button>
              </div>
            ) : (
              <Button onClick={() => void handleConnect()} disabled={connecting}>
                <PlugsConnected className="mr-1.5 size-4" />
                {connecting ? 'Redirecionando…' : 'Conectar Bling'}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Rede / Itaú (cartão) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <CreditCard className="size-4 text-primary" weight="bold" /> Rede / Itaú (cartão)
              </span>
              <Badge variant="secondary">Em preparação</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Link de pagamento via cartão de crédito pela Rede (e.Rede). Pix continua pelo PagBank. Em breve.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
