import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plugs, PlugsConnected, Package, CreditCard } from 'phosphor-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTenant } from '@/context/TenantContext'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  fetchBlingStatus,
  startBlingConnect,
  disconnectBling,
  fetchBlingCatalog,
  getBlingOrderConfig,
  setBlingOrderConfig,
  createBlingTestOrder,
  type BlingStatus,
  type BlingCatalogItem,
} from '@/services/crmBling'

export function IntegrationsPage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const [bling, setBling] = useState<BlingStatus>({ connected: false, connectedAt: null, accountName: null })
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [catalog, setCatalog] = useState<BlingCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [contatoId, setContatoId] = useState('')
  const [autoOrder, setAutoOrder] = useState(false)
  const [savingCfg, setSavingCfg] = useState(false)
  const [testingOrder, setTestingOrder] = useState(false)

  const loadOrderConfig = async () => {
    try {
      const cfg = await getBlingOrderConfig()
      setContatoId(cfg.defaultContatoId)
      setAutoOrder(cfg.autoOrderEnabled)
    } catch {
      // ignore
    }
  }

  const saveContato = async () => {
    setSavingCfg(true)
    try {
      await setBlingOrderConfig({ defaultContatoId: contatoId.trim() })
      toast.success('Contato padrão salvo.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSavingCfg(false)
    }
  }

  const toggleAuto = async (v: boolean) => {
    setAutoOrder(v)
    try {
      await setBlingOrderConfig({ autoOrderEnabled: v })
      toast.success(v ? 'Pedido automático ligado.' : 'Pedido automático desligado.')
    } catch (e) {
      setAutoOrder(!v)
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    }
  }

  const testOrder = async () => {
    setTestingOrder(true)
    try {
      const out = await createBlingTestOrder('3_meses')
      toast.success(`Pedido de teste criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos). Confira no Bling.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar pedido de teste')
    } finally {
      setTestingOrder(false)
    }
  }

  const loadCatalog = async (refresh = false) => {
    setCatalogLoading(true)
    try {
      const out = await fetchBlingCatalog(refresh)
      setCatalog(out.items)
      if (refresh) toast.success(`Catálogo atualizado (${out.items.length} produtos).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao listar catálogo')
    } finally {
      setCatalogLoading(false)
    }
  }

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
      .then((s) => {
        setBling(s)
        if (s.connected) {
          void loadCatalog(false)
          void loadOrderConfig()
        }
      })
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

      {/* Catálogo Bling */}
      {bling.connected ? (
        <Card className="mt-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Package className="size-4 text-primary" weight="bold" /> Catálogo do Bling
              <Badge variant="secondary">{catalog.length}</Badge>
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => void loadCatalog(true)} disabled={catalogLoading}>
              {catalogLoading ? 'Atualizando…' : 'Atualizar do Bling'}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {catalog.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {catalogLoading ? 'Carregando…' : 'Nenhum produto encontrado no Bling.'}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {catalog.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.codigo ? `Cód. ${p.codigo} · ` : ''}
                        {p.preco ? p.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'sem preço'}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        p.estoque == null
                          ? ''
                          : p.estoque <= 0
                            ? 'bg-red-500/15 text-red-600'
                            : 'bg-emerald-500/15 text-emerald-600'
                      }
                    >
                      {p.estoque == null ? 'estoque n/d' : `${p.estoque} un`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Pedido automático no Bling */}
      {bling.connected ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Package className="size-4 text-primary" weight="bold" /> Pedido automático no Bling
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Quando o pagamento confirma, cria o pedido de venda no Bling com o frasco{' '}
              <strong>Tricopill - Suplemento Capilar</strong> (1 / 4 / 5 frascos por kit) e valor igual ao pago.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="bl-contato">ID do contato padrão no Bling (cliente das vendas WhatsApp)</Label>
              <div className="flex gap-2">
                <Input
                  id="bl-contato"
                  value={contatoId}
                  onChange={(e) => setContatoId(e.target.value)}
                  placeholder="ex.: 16322942669"
                  className="font-mono text-xs"
                />
                <Button size="sm" variant="outline" onClick={() => void saveContato()} disabled={savingCfg}>
                  {savingCfg ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
              <p className="text-[0.7rem] text-muted-foreground">
                Cadastre um contato no Bling (ex.: “Cliente WhatsApp Tricopill”) e cole o ID dele aqui. É o cliente
                que vai constar nos pedidos automáticos.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div>
                <p className="text-sm font-medium">Criar pedido automaticamente na venda</p>
                <p className="text-xs text-muted-foreground">Ative só depois de validar com o pedido de teste.</p>
              </div>
              <Switch checked={autoOrder} onCheckedChange={(v) => void toggleAuto(v)} disabled={!contatoId.trim()} />
            </div>

            <Button variant="outline" size="sm" onClick={() => void testOrder()} disabled={testingOrder || !contatoId.trim()}>
              {testingOrder ? 'Criando…' : 'Criar pedido de teste (kit 3 meses)'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </AppLayout>
  )
}
