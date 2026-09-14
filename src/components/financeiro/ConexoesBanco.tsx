// Conexão com o banco: Open Finance (Pluggy e Banco MCP) e importação de extrato OFX/CSV.
//
// Morava em Conciliação, que é onde se casa extrato com conta. Conectar banco é de outra pergunta
// ("de onde vem o dinheiro que o sistema enxerga?"), e a resposta mora com os saldos, em Contas &
// caixa. O código saiu daqui sem mudar de comportamento.

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileUp, Landmark, RefreshCw } from 'lucide-react'
import { PluggyConnect } from 'react-pluggy-connect'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { bankSyncTrouble, sinceLabel } from '@/lib/bankSync'
import { type FinAccount, importTransactions } from '@/services/financeiro'
import { parseBankStatement } from '@/services/ofx'
import { getConnectToken, linkItem, syncOpenFinance, getBancoMcpStatus, linkBancoMcp, syncBancoMcp } from '@/services/openFinance'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}
function formatDayBR(iso?: string | null): string {
  return iso ? formatDay(String(iso).slice(0, 10)) : ''
}

export function ConexoesBanco({ accounts, onMudou }: { accounts: FinAccount[]; onMudou: () => void }) {
  // Open Finance (Pluggy + Banco MCP): token do widget + estados de conexão/sync.
  const [connectToken, setConnectToken] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<string | null>(null)
  const [mcpReconnectUrl, setMcpReconnectUrl] = useState<string | null>(null)
  const [mcpAddUrl, setMcpAddUrl] = useState<string | null>(null)
  const [mcpBankName, setMcpBankName] = useState<string | null>(null)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpIncidente, setMcpIncidente] = useState<string | null>(null)
  const hasOpenFinance = useMemo(() => accounts.some((a) => a.ofAccountId != null), [accounts])
  const [importing, setImporting] = useState(false)
  const [accountId, setAccountId] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const load = async () => onMudou()

  const refreshMcpStatus = async () => {
    try {
      const st = await getBancoMcpStatus()
      const conn = st.connections?.connections?.[0]
      setMcpError(null)
      setMcpBankName(conn?.connector_name ?? null)
      setMcpReconnectUrl(conn?.reconnect_url ?? null)
      setMcpAddUrl(st.connections?.add_connection_url ?? null)
      // Incidente aberto no provedor: a conexão fica UPDATED e mesmo assim saldo e limite
      // podem vir errados. Melhor avisar do que a clínica achar que o número está certo.
      setMcpIncidente(
        st.accounts?.provider_incident?.degraded
          ? 'O provedor de Open Finance está com incidente aberto: saldo e limite podem vir incompletos até normalizar.'
          : null,
      )
      const total = Number(st.accounts?.total ?? st.accounts?.results?.length ?? 0)
      // `notice` da edge é o motivo traduzido (ACCT_001/ACCT_002…); só cai no texto
      // longo do provedor quando não veio aviso nenhum.
      if (st.notice) setMcpNotice(st.notice)
      else if (st.accounts?.notice) setMcpNotice(st.accounts.notice)
      else if (conn && total === 0) {
        setMcpNotice(
          `${conn.connector_name ?? 'Banco'} conectado no Banco MCP, mas sem contas liberadas. Aprove o Open Finance no app do banco (múltipla alçada) ou reconecte selecionando as contas.`,
        )
      } else if (conn) setMcpNotice(null)
    } catch (e) {
      // Antes era silencioso: com o token vencido o cartão sumia e o erro só aparecia
      // (genérico) na hora de ligar. Agora o motivo fica na tela.
      setMcpError(e instanceof Error ? e.message : 'Banco MCP indisponível')
      setMcpIncidente(null)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshMcpStatus()
  }, [])

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
        if (res.addConnectionUrl) setMcpAddUrl(res.addConnectionUrl)
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
    <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-fit border-emerald-500/40 bg-emerald-500/[0.04]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Landmark className="size-4 text-emerald-600" /> Banco automático (Open Finance)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Conecte o banco uma vez (Pluggy ou Banco MCP) e o extrato entra sozinho, sem baixar arquivo.
              O login é no banco; a gente nunca vê a senha.
            </p>
            {mcpError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
                <div className="font-medium">Banco MCP fora do ar</div>
                <p className="mt-1 opacity-90">{mcpError}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void refreshMcpStatus()}>
                  Tentar de novo
                </Button>
              </div>
            ) : null}
            {mcpIncidente ? (
              <p className="rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">{mcpIncidente}</p>
            ) : null}
            {mcpBankName || mcpAddUrl ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
                <div className="font-medium">Banco MCP{mcpBankName ? `: ${mcpBankName}` : ' — nenhum banco conectado'}</div>
                {mcpNotice ? <p className="mt-1 opacity-90">{mcpNotice}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {mcpBankName ? (
                    <Button size="sm" variant="outline" onClick={() => void linkMcpBank()} disabled={syncing}>
                      Ligar ao sistema
                    </Button>
                  ) : null}
                  {mcpReconnectUrl ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => window.open(mcpReconnectUrl, '_blank', 'noopener,noreferrer')}
                    >
                      Reautorizar no banco
                    </Button>
                  ) : null}
                  {mcpAddUrl ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => window.open(mcpAddUrl, '_blank', 'noopener,noreferrer')}
                    >
                      {mcpBankName ? 'Conectar outro banco' : 'Conectar banco (Banco MCP)'}
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
              <div className="space-y-2 pt-1">
                {accounts
                  .filter((a) => a.ofAccountId)
                  .map((a) => {
                    const parada = bankSyncTrouble(a)
                    const fatura = a.ofMeta?.credit
                    return (
                      <div key={a.id} className="rounded-md border bg-background/60 p-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs font-medium">{a.name}</span>
                          {a.ofBalanceCents != null ? (
                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                              {formatBRL(a.ofBalanceCents)}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={`mt-0.5 text-[11px] ${parada ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
                        >
                          {parada ?? `atualizado ${sinceLabel(a.ofLastSyncAt)}`}
                        </div>
                        {fatura?.balanceDueDate ? (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            fatura fecha {formatDayBR(fatura.balanceCloseDate)} · vence{' '}
                            {formatDayBR(fatura.balanceDueDate)}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                <p className="text-[11px] text-muted-foreground">
                  Entra sozinho 3x por dia (5h, 12h e 19h). Se travar, o sino avisa.
                </p>
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
      {connectToken ? (
        <PluggyConnect
          connectToken={connectToken}
          onSuccess={onPluggySuccess}
          onError={(err) => {
            // Mostra o motivo REAL que a Pluggy devolveu (senão fica "não deu" sem pista).
            console.error('[pluggy] erro na conexão:', err)
            const msg = (err as { message?: string })?.message
            toast.error(msg ? `Banco: ${msg}` : 'Não foi possível concluir a conexão com o banco.')
          }}
          onLoadError={(err) => {
            setConnectToken(null)
            console.error('[pluggy] falha ao carregar o widget:', err)
            toast.error('Falha ao carregar o conector do banco. Tente novamente.')
          }}
          onClose={() => setConnectToken(null)}
        />
      ) : null}
    </div>
  )
}
