import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Unplug, Plug, Package, CreditCard } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
import { getRedeConfig, setRedeConfig, testRedeTx, type RedeConfigStatus } from '@/services/crmRede'

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
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)

  // === Rede (ambos os polos) ===
  const [rede, setRede] = useState<RedeConfigStatus>({ configured: false, env: 'sandbox' })
  const [redePv, setRedePv] = useState('')
  const [redeToken, setRedeToken] = useState('')
  const [redeEnv, setRedeEnv] = useState('sandbox')
  const [savingRede, setSavingRede] = useState(false)
  const [testingRede, setTestingRede] = useState(false)
  const [redeTestMsg, setRedeTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

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
      await setRedeConfig({ pv: redePv.trim(), token: redeToken.trim(), env: redeEnv })
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

  const testRede = async () => {
    setTestingRede(true)
    setRedeTestMsg(null)
    try {
      const r = await testRedeTx()
      if (r.ok) {
        setRedeTestMsg({ ok: true, text: 'Autorização de teste aprovada (returnCode 00). Credenciais válidas.' })
        toast.success('Transação de teste aprovada! Credenciais OK.')
      } else {
        setRedeTestMsg({ ok: false, text: `returnCode ${r.returnCode}: ${r.message}` })
        toast.error(`Teste recusado (returnCode ${r.returnCode}).`)
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Falha no teste'
      setRedeTestMsg({ ok: false, text: m })
      toast.error(m)
    } finally {
      setTestingRede(false)
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
                  <Package className="size-4 text-primary" /> Bling (ERP)
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
                  <Button variant="outline" size="sm" onClick={() => setShowDisconnectConfirm(true)}>
                    <Unplug className="mr-1.5 size-4" /> Desconectar
                  </Button>
                </div>
              ) : (
                <Button onClick={() => void handleConnect()} disabled={connecting}>
                  <Plug className="mr-1.5 size-4" />
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
                <CreditCard className="size-4 text-primary" /> Rede / Itaú (cartão)
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
              Cartão de crédito via e.Rede (página de checkout própria).{' '}
              {isSalesPolo ? 'No Tricopill o Pix continua pelo PagBank.' : ''}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rede-pv">PV (clientId)</Label>
                <Input id="rede-pv" value={redePv} onChange={(e) => setRedePv(e.target.value)} placeholder="ex.: 41710257" className="font-mono text-xs" />
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
              <Label htmlFor="rede-token">Token (clientSecret)</Label>
              <Input id="rede-token" type="password" value={redeToken} onChange={(e) => setRedeToken(e.target.value)} placeholder="token (sensível)" className="font-mono text-xs" autoComplete="off" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void saveRede()} disabled={savingRede}>
                {savingRede ? 'Salvando…' : 'Salvar Rede'}
              </Button>
              {redeEnv === 'sandbox' && (
                <Button size="sm" variant="outline" onClick={() => void testRede()} disabled={testingRede || savingRede}>
                  {testingRede ? 'Testando…' : 'Testar transação (sandbox)'}
                </Button>
              )}
            </div>
            {redeTestMsg && (
              <p className={`text-xs ${redeTestMsg.ok ? 'text-emerald-600' : 'text-destructive'}`}>
                {redeTestMsg.ok ? '✓ ' : '✗ '}
                {redeTestMsg.text}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Catálogo Bling */}
      {isSalesPolo && bling.connected ? (
        <Card className="mt-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Package className="size-4 text-primary" /> Catálogo do Bling
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
              <Package className="size-4 text-primary" /> Pedido automático no Bling
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

      <ConfirmDialog
        open={showDisconnectConfirm}
        onOpenChange={setShowDisconnectConfirm}
        title="Desconectar o Bling?"
        description="A criação automática de pedidos de venda e a emissão de NF-e param até você reconectar o Bling. Tem certeza?"
        confirmLabel="Desconectar"
        cancelLabel="Cancelar"
        onConfirm={() => void handleDisconnect()}
      />
    </AppLayout>
  )
}
