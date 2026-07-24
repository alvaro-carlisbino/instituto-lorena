import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, Check, FileUp, Landmark, Link2, RefreshCw, X } from 'lucide-react'
import { PluggyConnect } from 'react-pluggy-connect'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { type Payable, listPayables } from '@/services/estoqueCompras'
import {
  type FinAccount,
  type FinTransaction,
  type MatchSuggestion,
  type Receivable,
  confirmMatch,
  importTransactions,
  listAccounts,
  listReceivables,
  listTransactions,
  suggestMatches,
} from '@/services/financeiro'
import { parseBankStatement } from '@/services/ofx'
import { getConnectToken, linkItem, syncOpenFinance, getBancoMcpStatus, linkBancoMcp, syncBancoMcp } from '@/services/openFinance'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

export function ConciliacaoPage() {
  const { tenant } = useTenant()
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [txns, setTxns] = useState<FinTransaction[]>([])
  const [payables, setPayables] = useState<Payable[]>([])
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Open Finance (Pluggy + Banco MCP): token do widget + estados de conexão/sync.
  const [connectToken, setConnectToken] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<string | null>(null)
  const [mcpReconnectUrl, setMcpReconnectUrl] = useState<string | null>(null)
  const [mcpBankName, setMcpBankName] = useState<string | null>(null)
  const hasOpenFinance = useMemo(() => accounts.some((a) => a.ofAccountId != null), [accounts])

  const refreshMcpStatus = async () => {
    try {
      const st = await getBancoMcpStatus()
      const conn = st.connections?.connections?.[0]
      setMcpBankName(conn?.connector_name ?? null)
      setMcpReconnectUrl(conn?.reconnect_url ?? null)
      const total = Number(st.accounts?.total ?? st.accounts?.results?.length ?? 0)
      if (st.accounts?.notice) setMcpNotice(st.accounts.notice)
      else if (conn && total === 0) {
        setMcpNotice(
          'Itaú Empresas conectado no Banco MCP, mas sem contas liberadas. Aprove o Open Finance no app do banco (múltipla alçada) ou reconecte selecionando as contas.',
        )
      } else if (conn) setMcpNotice(null)
    } catch {
      // silencioso — Pluggy segue disponível
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const [acc, t, p, r] = await Promise.all([
        listAccounts(),
        listTransactions({ onlyUnreconciled: true, limit: 500 }),
        listPayables(),
        listReceivables(),
      ])
      setAccounts(acc)
      setTxns(t)
      setPayables(p)
      setReceivables(r)
      if (!accountId && acc.length > 0) setAccountId(acc[0].id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar conciliação')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void refreshMcpStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openPayables = useMemo(() => payables.filter((p) => p.status === 'aberto'), [payables])
  const openReceivables = useMemo(() => receivables.filter((r) => r.status === 'aberto'), [receivables])

  const suggestions = useMemo(
    () => suggestMatches(txns, openPayables, openReceivables).filter((s) => !dismissed.has(s.transaction.id)),
    [txns, openPayables, openReceivables, dismissed],
  )
  const suggestedTxnIds = useMemo(() => new Set(suggestions.map((s) => s.transaction.id)), [suggestions])
  const unmatched = useMemo(
    () => txns.filter((t) => !suggestedTxnIds.has(t.id) && !t.reconciledRefId),
    [txns, suggestedTxnIds],
  )

  const handleFile = async (file: File | null) => {
    if (!file) return
    if (!accountId) {
      toast.error('Escolha primeiro a conta do extrato.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setImporting(true)
    try {
      const text = await file.text()
      const { txns: rows, format } = parseBankStatement(text, file.name)
      if (rows.length === 0) {
        toast.error('Não encontrei lançamentos nesse arquivo. Confira se é OFX ou CSV do extrato.')
        return
      }
      const { inserted, skipped } = await importTransactions(
        rows.map((b) => ({
          accountId,
          date: b.date,
          amountCents: Math.abs(b.amountCents),
          direction: b.amountCents >= 0 ? ('in' as const) : ('out' as const),
          description: b.description,
          counterparty: b.description,
          source: format,
          externalId: b.externalId,
        })),
      )
      toast.success(
        `Extrato (${format.toUpperCase()}): ${inserted} ${inserted === 1 ? 'lançamento novo' : 'lançamentos novos'}` +
          (skipped > 0 ? `, ${skipped} já importado${skipped === 1 ? '' : 's'} (ignorado${skipped === 1 ? '' : 's'})` : '') +
          '.',
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar extrato')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const confirm = async (s: MatchSuggestion) => {
    try {
      await confirmMatch(s.transaction.id, s.refType, s.refId, s.transaction.categoryId)
      toast.success(`Conciliado: ${s.refDescription}.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conciliar')
    }
  }

  // ── Open Finance (Pluggy) ────────────────────────────────────────────────
  const connectBank = async () => {
    setConnecting(true)
    try {
      const token = await getConnectToken()
      setConnectToken(token)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir conexão com o banco')
    } finally {
      setConnecting(false)
    }
  }

  const onPluggySuccess = async (data: unknown) => {
    setConnectToken(null)
    const itemId = (data as { item?: { id?: string } })?.item?.id
    if (!itemId) {
      toast.error('Conexão não retornou o identificador do banco.')
      return
    }
    setSyncing(true)
    try {
      const res = await linkItem(itemId)
      toast.success(`Banco conectado (${res.bankName}): ${res.accountsLinked} conta(s), ${res.inserted} lançamento(s).`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ligar as contas do banco')
    } finally {
      setSyncing(false)
    }
  }

  const doSync = async () => {
    setSyncing(true)
    try {
      let inserted = 0
      let accountsN = 0
      try {
        const pluggy = await syncOpenFinance()
        inserted += pluggy.inserted
        accountsN += pluggy.accounts
      } catch {
        // pode não ter Pluggy ligado
      }
      try {
        const mcp = await syncBancoMcp()
        inserted += mcp.inserted
        accountsN += mcp.accounts
      } catch {
        // pode não ter MCP ligado
      }
      toast.success(`Sincronizado: ${inserted} lançamento(s) novo(s) de ${accountsN} conta(s).`)
      await load()
      await refreshMcpStatus()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  const linkMcpBank = async () => {
    setSyncing(true)
    try {
      const res = await linkBancoMcp()
      if (!res.ok || (res.accountsLinked ?? 0) === 0) {
        setMcpNotice(res.notice ?? 'Sem contas liberadas no banco.')
        if (res.reconnectUrl) setMcpReconnectUrl(res.reconnectUrl)
        toast.error(res.notice ?? 'Conexão MCP sem contas. Autorize no app do banco.')
      } else {
        toast.success(
          `Banco MCP (${res.bankName}): ${res.accountsLinked} conta(s), ${res.inserted ?? 0} lançamento(s).`,
        )
        setMcpNotice(null)
      }
      await load()
      await refreshMcpStatus()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ligar Banco MCP')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <AppLayout
      title="Conciliação bancária"
      subtitle="Suba o extrato (OFX/CSV) e case cada lançamento com uma conta a pagar ou a receber. Open Finance automático vem na próxima fase."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_1fr]">
        <div className="space-y-4">
        <Card className="h-fit border-emerald-500/40 bg-emerald-500/[0.04]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Landmark className="size-4 text-emerald-600" /> Banco automático (Open Finance)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Conecte o banco uma vez (Pluggy ou Banco MCP) e o extrato entra sozinho — sem baixar arquivo.
              O login é no banco; a gente nunca vê a senha.
            </p>
            {mcpBankName ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
                <div className="font-medium">Banco MCP: {mcpBankName}</div>
                {mcpNotice ? <p className="mt-1 opacity-90">{mcpNotice}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void linkMcpBank()} disabled={syncing}>
                    Ligar ao sistema
                  </Button>
                  {mcpReconnectUrl ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => window.open(mcpReconnectUrl, '_blank', 'noopener,noreferrer')}
                    >
                      Reautorizar no banco
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={connectBank} disabled={connecting || syncing}>
                <Landmark className="size-4" /> {connecting ? 'Abrindo…' : hasOpenFinance ? 'Conectar outro banco' : 'Conectar banco'}
              </Button>
              <Button variant="outline" onClick={doSync} disabled={syncing}>
                <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
              </Button>
            </div>
            {hasOpenFinance ? (
              <div className="space-y-1 pt-1">
                {accounts
                  .filter((a) => a.ofAccountId)
                  .map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate">🔗 {a.name}</span>
                      <span className="shrink-0">
                        {a.ofLastSyncAt ? `sync ${new Date(a.ofLastSyncAt).toLocaleDateString('pt-BR')}` : 'aguardando'}
                      </span>
                    </div>
                  ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-fit border-primary/40 bg-primary/[0.03]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileUp className="size-4 text-primary" /> Importar extrato (OFX/CSV)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="conc-account">Conta do extrato</Label>
              <Select value={accountId} onValueChange={(v) => setAccountId(v ?? '')}>
                <SelectTrigger id="conc-account">
                  <SelectValue placeholder="Escolha a conta" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conc-file">Arquivo (OFX ou CSV)</Label>
              <Input
                id="conc-file"
                ref={fileRef}
                type="file"
                accept=".ofx,.csv,.txt,text/csv,text/plain"
                disabled={importing || !accountId}
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Reimportar o mesmo extrato é seguro: lançamentos repetidos são ignorados.
              </p>
            </div>
          </CardContent>
        </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Link2 className="size-4 text-primary" /> Sugestões de conciliação ({suggestions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {suggestions.length === 0 ? (
                <EmptyState
                  icon={ArrowLeftRight}
                  title={loading ? 'Carregando…' : 'Sem sugestões'}
                  description="Importe um extrato e as batidas com contas a pagar/receber aparecem aqui."
                />
              ) : (
                suggestions.map((s) => (
                  <div key={s.transaction.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className={s.refType === 'payable' ? '' : 'bg-emerald-500/15 text-emerald-600'}>
                            {s.refType === 'payable' ? 'a pagar' : 'a receber'}
                          </Badge>
                          <span className="truncate font-medium">{s.refDescription}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          extrato {formatDay(s.transaction.date)} · {s.transaction.description}
                          {s.dayGap > 0 ? ` · ${s.dayGap}d de diferença` : ' · mesma data'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-semibold">{formatBRL(s.refAmountCents)}</span>
                        <Button size="sm" onClick={() => void confirm(s)}>
                          <Check className="size-3.5" /> Conciliar
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Descartar sugestão"
                          onClick={() => setDismissed((d) => new Set(d).add(s.transaction.id))}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Lançamentos sem conciliação ({unmatched.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {unmatched.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Tudo conciliado (ou nada importado ainda).
                </p>
              ) : (
                unmatched.slice(0, 100).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{t.description ?? 'Lançamento'}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDay(t.date)} · {t.source.toUpperCase()}
                      </div>
                    </div>
                    <span className={`shrink-0 font-semibold ${t.amountCents < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                      {t.amountCents < 0 ? '−' : '+'}
                      {formatBRL(Math.abs(t.amountCents))}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {connectToken ? (
        <PluggyConnect
          connectToken={connectToken}
          onSuccess={onPluggySuccess}
          onError={(err) => {
            // Mostra o motivo REAL que a Pluggy devolveu (senão fica "não deu" sem pista).
            // eslint-disable-next-line no-console
            console.error('[pluggy] erro na conexão:', err)
            const msg = (err as { message?: string })?.message
            toast.error(msg ? `Banco: ${msg}` : 'Não foi possível concluir a conexão com o banco.')
          }}
          onLoadError={(err) => {
            setConnectToken(null)
            // eslint-disable-next-line no-console
            console.error('[pluggy] falha ao carregar o widget:', err)
            toast.error('Falha ao carregar o conector do banco. Tente novamente.')
          }}
          onClose={() => setConnectToken(null)}
        />
      ) : null}
    </AppLayout>
  )
}
