import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, Upload } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { parseShopSpreadsheet, type ShopImportRow } from '@/services/importShop'
import { createPayablesFromImport } from '@/services/importShopPersist'

const formatBRL = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function ImportShopPage() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<ShopImportRow[]>([])
  const [skipped, setSkipped] = useState(0)
  const [headers, setHeaders] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [fileName, setFileName] = useState('')

  const totals = useMemo(() => {
    let custo = 0
    let pagamento = 0
    for (const r of rows) {
      if (r.kind === 'custo') custo += r.amountCents
      else if (r.kind === 'pagamento') pagamento += r.amountCents
    }
    return { custo, pagamento }
  }, [rows])

  const onFile = async (file: File | null) => {
    if (!file) return
    setFileName(file.name)
    const text = await file.text()
    const parsed = parseShopSpreadsheet(text)
    setRows(parsed.rows)
    setSkipped(parsed.skipped)
    setHeaders(parsed.headers)
    if (parsed.rows.length === 0) toast.error('Nenhuma linha válida. Exporte o Excel como CSV.')
    else toast.success(`${parsed.rows.length} linhas prontas (${parsed.skipped} ignoradas).`)
  }

  const persist = async () => {
    if (rows.length === 0) return
    setSaving(true)
    try {
      const { receivables, payables } = await createPayablesFromImport(rows)
      toast.success(`Importado: ${receivables} recebimentos · ${payables} custos.`)
      setRows([])
      setFileName('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gravar importação')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout
      title="Importar planilha do shop"
      subtitle="CSV do Excel com custos e pagamentos — mapeamento automático de colunas."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="size-4 text-primary" /> Arquivo CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="block w-full text-sm"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            No Excel: “Salvar como → CSV”. Colunas: data, descrição, valor, tipo, fornecedor/cliente.
            {fileName ? ` · ${fileName}` : ''}
          </p>
          {headers.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {headers.map((h) => (
                <Badge key={h} variant="secondary">
                  {h}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Prévia ({rows.length})
            {skipped > 0 ? ` · ${skipped} ignoradas` : ''}
          </CardTitle>
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Custos {formatBRL(totals.custo)}</span>
              <span>Pagamentos {formatBRL(totals.pagamento)}</span>
              <Button size="sm" onClick={() => void persist()} disabled={saving}>
                {saving ? 'Gravando…' : 'Gravar no financeiro'}
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-1.5">
          {rows.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma planilha carregada"
              description="Exporte a planilha do shop em CSV e selecione o arquivo acima."
            />
          ) : (
            rows.slice(0, 200).map((r, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.date ?? 'sem data'}
                    {r.counterparty ? ` · ${r.counterparty}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{r.kind}</Badge>
                  <span className="font-semibold">{formatBRL(r.amountCents)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
