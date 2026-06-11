import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plugs, PlugsConnected, Package, CreditCard } from 'phosphor-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
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
import { getRedeConfig, setRedeConfig, type RedeConfigStatus } from '@/services/crmRede'

export function IntegrationsPage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  // === Bling (só polo de vendas) ===
  const [bling, setBling] = useState<BlingStatus>({ connected: false, connectedAt: null, accountName: null })
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [catalog, setCatalog] = useState<BlingCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [contatoId, setContatoId] = useState('')
  const [autoOrder, setAutoOrder] = useState(false)
  const [savingCfg, setSavingCfg] = useState(false)
  const [testingOrder, setTestingOrder] = useState(false)

  // === Rede (ambos os polos) ===
  const [rede, setRede] = useState<RedeConfigStatus>({ configured: false, env: 'sandbox' })
  const [redeClientId, setRedeClientId] = useState('')
  const [redeClientSecret, setRedeClientSecret] = useState('')
  const [redeCompany, setRedeCompany] = useState('')
  const [redeCreatedBy, setRedeCreatedBy] = useState('')
  const [redeEnv, setRedeEnv] = useState('sandbox')
  const [savingRede, setSavingRede] = useState(false)

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

  const saveRede = async () => {
    setSavingRede(true)
    try {
      await setRedeConfig({
        clientId: redeClientId.trim(),
        clientSecret: redeClientSecret.trim(),
        companyNumber: redeCompany.trim(),
        createdBy: redeCreatedBy.trim(),
        env: redeEnv,
      })
      toast.success('Rede salva.')
      const cfg = await getRedeConfig()
      setRede(cfg)
      setRedeEnv(cfg.env)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar Rede')
    } finally {
      setSavingRede(false)
    }
  }

  useEffect(() => {
    // OAuth Bling de volta (?bling=ok|erro)
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
    // Rede em qualquer polo
    getRedeConfig()
      .then((cfg) => {
        setRede(cfg)
        setRedeEnv(cfg.env)
      })
      .catch(() => {})
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
      <PageHeader title="Integrações" description="Conecte ERP e meios de pagamento" />

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Bling — só polo de vendas */}
        {isSalesPolo ? (
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
        ) : null}

        {/* Rede / Itaú (cartão) — ambos os polos */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <CreditCard className="size-4 text-primary" weight="bold" /> Rede / Itaú (cartão)
              </span>
              <Badge
                variant={rede.configured ? 'default' : 'secondary'}
                className={rede.configured ? 'bg-emerald-500/15 text-emerald-600' : ''}
              >
                {rede.configured ? 'Configurada' : 'Pendente'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Link de pagamento por cartão (produto “Link de Pagamento” da Rede).{' '}
              {isSalesPolo ? 'No Tricopill o Pix continua pelo PagBank.' : ''}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rede-company">Company-number (PV) — exigido no create</Label>
                <Input id="rede-company" value={redeCompany} onChange={(e) => setRedeCompany(e.target.value)} placeholder="número da filiação" className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rede-env">Ambiente</Label>
                <Select value={redeEnv} onValueChange={(v) => setRedeEnv(v ?? 'sandbox')}>
                  <SelectTrigger id="rede-env">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                    <SelectItem value="prod">Produção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rede-cid">Client ID</Label>
              <Input id="rede-cid" value={redeClientId} onChange={(e) => setRedeClientId(e.target.value)} placeholder="client_id do app" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rede-secret">Client Secret</Label>
              <Input id="rede-secret" type="password" value={redeClientSecret} onChange={(e) => setRedeClientSecret(e.target.value)} placeholder="client_secret (sensível)" className="font-mono text-xs" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rede-by">E-mail do criador (createdBy)</Label>
              <Input id="rede-by" value={redeCreatedBy} onChange={(e) => setRedeCreatedBy(e.target.value)} placeholder="usuario@empresa.com.br" className="text-xs" />
            </div>
            <Button size="sm" onClick={() => void saveRede()} disabled={savingRede}>
              {savingRede ? 'Salvando…' : 'Salvar Rede'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Catálogo Bling */}
      {isSalesPolo && bling.connected ? (
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
              <div className="max-h-96 divide-y divide-border/40 overflow-y-auto">
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
                        p.estoque == null ? '' : p.estoque <= 0 ? 'bg-red-500/15 text-red-600' : 'bg-emerald-500/15 text-emerald-600'
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

      {/* Pedido automático Bling */}
      {isSalesPolo && bling.connected ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Package className="size-4 text-primary" weight="bold" /> Pedido automático no Bling
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Quando o pagamento confirma, cria o pedido com o frasco <strong>Tricopill - Suplemento Capilar</strong>{' '}
              (1 / 4 / 5 frascos por kit) e valor igual ao pago.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="bl-contato">ID do contato padrão no Bling (cliente das vendas WhatsApp)</Label>
              <div className="flex gap-2">
                <Input id="bl-contato" value={contatoId} onChange={(e) => setContatoId(e.target.value)} placeholder="ex.: 16322942669" className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => void saveContato()} disabled={savingCfg}>
                  {savingCfg ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
              <p className="text-[0.7rem] text-muted-foreground">
                Cadastre um contato no Bling (ex.: “Cliente WhatsApp Tricopill”) com CPF/CNPJ e cole o ID dele aqui.
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
