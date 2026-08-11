// Fechamento de caixa — onde foi parar o dinheiro vivo.
//
// Entre ago/2025 e ago/2026 a clínica recebeu R$ 882.738 em espécie e o extrato do Itaú não tem
// UM depósito em dinheiro. Não existe registro nenhum do destino desse dinheiro. Esta tela é o
// mínimo que fecha a conta: recebido em espécie − entregue = o que tem que estar na gaveta.
//
// A coluna "sobra" começa igual ao recebido, e é assim mesmo: enquanto ninguém registrar
// entrega, o número denuncia a ausência de rastro em vez de escondê-la atrás de um zero.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Banknote, Download, Plus, Trash2, Wallet } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTenant } from '@/context/TenantContext'
import { hojeLocal } from '@/lib/diaLocal'
import {
  createCashHandover,
  deleteCashHandover,
  listAccounts,
  listCaixaDinheiro,
  listCashHandovers,
  type CaixaMes,
  type CashDestination,
  type CashHandover,
  type FinAccount,
} from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—')
const mesLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })

const DESTINO_LABEL: Record<CashDestination, string> = {
  deposito: 'Depósito no banco',
  despesa: 'Pagamento de despesa',
  cofre: 'Cofre / caixa forte',
  outro: 'Outro',
}

/** Valor digitado em reais ("1.250,00") → centavos. */
function paraCentavos(v: string): number {
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function mesesAtras(n: number): string {
  const d = new Date(`${hojeLocal()}T12:00:00`)
  d.setMonth(d.getMonth() - n)
  return `${d.toISOString().slice(0, 8)}01`
}

const FORM_VAZIO = {
  handedAt: hojeLocal(),
  valor: '',
  fromPerson: '',
  toPerson: '',
  destination: 'deposito' as CashDestination,
  accountId: '',
  note: '',
}

export function CaixaDinheiroPage() {
  const { tenant } = useTenant()
  const [de, setDe] = useState(mesesAtras(12))
  const [ate, setAte] = useState(hojeLocal())
  const [meses, setMeses] = useState<CaixaMes[]>([])
  const [entregas, setEntregas] = useState<CashHandover[]>([])
  const [contas, setContas] = useState<FinAccount[]>([])
  const [form, setForm] = useState({ ...FORM_VAZIO })
  const [abrindo, setAbrindo] = useState(false)
  const [busy, setBusy] = useState(false)

  const carregar = async (d = de, a = ate) => {
    setBusy(true)
    try {
      const [m, e, c] = await Promise.all([listCaixaDinheiro(d, a), listCashHandovers(d, a), listAccounts()])
      setMeses(m)
      setEntregas(e)
      setContas(c)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao carregar o caixa')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = useMemo(
    () =>
      meses.reduce(
        (a, m) => ({
          recebido: a.recebido + m.recebidoCents,
          entregue: a.entregue + m.entregueCents,
          depositado: a.depositado + m.depositadoCents,
          sobra: a.sobra + m.sobraCents,
        }),
        { recebido: 0, entregue: 0, depositado: 0, sobra: 0 },
      ),
    [meses],
  )

  const salvar = async () => {
    const cents = paraCentavos(form.valor)
    if (cents <= 0) return toast.error('Informe o valor entregue.')
    if (!form.fromPerson.trim() || !form.toPerson.trim())
      return toast.error('Quem entregou e quem recebeu são obrigatórios — é isso que dá rastro.')
    setBusy(true)
    try {
      await createCashHandover({
        handedAt: form.handedAt,
        amountCents: cents,
        fromPerson: form.fromPerson,
        toPerson: form.toPerson,
        destination: form.destination,
        accountId: form.accountId || null,
        note: form.note,
      })
      setForm({ ...FORM_VAZIO })
      setAbrindo(false)
      await carregar()
      toast.success('Entrega registrada.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar')
    } finally {
      setBusy(false)
    }
  }

  const remover = async (id: string) => {
    setBusy(true)
    try {
      await deleteCashHandover(id)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover')
    } finally {
      setBusy(false)
    }
  }

  const baixarCsv = () => {
    const l = [
      ['Mês', 'Recebido em espécie', 'Entregue', 'Depositado', 'Despesa', 'Sobra em caixa'],
      ...meses.map((m) => [
        m.mes,
        brl(m.recebidoCents),
        brl(m.entregueCents),
        brl(m.depositadoCents),
        brl(m.despesaCents),
        brl(m.sobraCents),
      ]),
    ]
    const csv = l.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    // BOM: sem ele o Excel abre em latin-1 e come os acentos.
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `caixa-dinheiro-${de}-a-${ate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppLayout
      title="Caixa em dinheiro"
      subtitle="O que entrou em espécie, o que saiu do caixa e com quem. A diferença é o que tem que estar na gaveta."
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="de" className="text-xs">De</Label>
          <Input id="de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ate" className="text-xs">Até</Label>
          <Input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-[150px]" />
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void carregar()}>
          <Wallet className="size-4" /> Atualizar
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setAbrindo((v) => !v)}>
          <Plus className="size-4" /> Registrar entrega
        </Button>
        <Button size="sm" variant="outline" onClick={baixarCsv} disabled={meses.length === 0}>
          <Download className="size-4" /> CSV
        </Button>
      </div>

      {abrindo && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quem tirou dinheiro do caixa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="data" className="text-xs">Dia da entrega</Label>
                <Input
                  id="data"
                  type="date"
                  value={form.handedAt}
                  onChange={(e) => setForm({ ...form, handedAt: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="valor" className="text-xs">Valor</Label>
                <Input
                  id="valor"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form.valor}
                  onChange={(e) => setForm({ ...form, valor: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="destino" className="text-xs">Para onde foi</Label>
                <Select
                  value={form.destination}
                  onValueChange={(v) => setForm({ ...form, destination: (v as CashDestination) ?? 'deposito' })}
                >
                  <SelectTrigger id="destino">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['deposito', 'despesa', 'cofre', 'outro'] as CashDestination[]).map((d) => (
                      <SelectItem key={d} value={d}>
                        {DESTINO_LABEL[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="de-quem" className="text-xs">Quem entregou</Label>
                <Input
                  id="de-quem"
                  placeholder="Recepção, Aline…"
                  value={form.fromPerson}
                  onChange={(e) => setForm({ ...form, fromPerson: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pra-quem" className="text-xs">Quem recebeu</Label>
                <Input
                  id="pra-quem"
                  placeholder="Nome de quem levou o dinheiro"
                  value={form.toPerson}
                  onChange={(e) => setForm({ ...form, toPerson: e.target.value })}
                />
              </div>
              {form.destination === 'deposito' && (
                <div className="space-y-1">
                  <Label htmlFor="conta" className="text-xs">Conta do depósito</Label>
                  <Select value={form.accountId} onValueChange={(v) => setForm({ ...form, accountId: v ?? '' })}>
                    <SelectTrigger id="conta">
                      <SelectValue placeholder="Escolha a conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {contas.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="obs" className="text-xs">Observação</Label>
              <Input
                id="obs"
                placeholder="Opcional — nº do envelope, qual despesa, etc."
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            {/* Dizer isto aqui evita a pergunta "por que o depósito não aparece no extrato?" */}
            <p className="text-xs text-muted-foreground">
              Registrar aqui não cria lançamento no extrato: o depósito entra sozinho pelo Open Finance
              e lançar dos dois lados contaria o mesmo dinheiro duas vezes. Isto é o rastro de quem
              tirou do caixa; o extrato é o dinheiro.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void salvar()}>
                Registrar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAbrindo(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Banknote className="size-3.5" /> Recebido em espécie
            </div>
            <div className="mt-0.5 text-lg font-semibold">{brl(total.recebido)}</div>
            <div className="text-xs text-muted-foreground">no período escolhido</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Saiu do caixa, com responsável</div>
            <div className="mt-0.5 text-lg font-semibold">{brl(total.entregue)}</div>
            <div className="text-xs text-muted-foreground">
              {brl(total.depositado)} foram para depósito
            </div>
          </CardContent>
        </Card>
        <Card className={total.sobra > 0 ? 'border-amber-500/40 bg-amber-500/[0.04]' : ''}>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Sem destino registrado</div>
            <div className="mt-0.5 text-lg font-semibold">{brl(total.sobra)}</div>
            <div className="text-xs text-muted-foreground">
              {total.entregue === 0
                ? 'nenhuma entrega registrada no período'
                : 'entrou e ninguém declarou a saída'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Mês a mês</CardTitle>
          </CardHeader>
          <CardContent>
            {meses.length === 0 ? (
              <EmptyState title={busy ? 'Carregando…' : 'Sem dado no período'} description="Ajuste as datas." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Mês</TableHead>
                    <TableHead className="text-right">Entrou</TableHead>
                    <TableHead className="text-right">Saiu</TableHead>
                    <TableHead className="text-right">Sem destino</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meses.map((m) => (
                    <TableRow key={m.mes}>
                      <TableCell className="whitespace-nowrap text-xs">{mesLabel(m.mes)}</TableCell>
                      <TableCell className="text-right text-sm">{brl(m.recebidoCents)}</TableCell>
                      <TableCell className="text-right text-sm">{brl(m.entregueCents)}</TableCell>
                      <TableCell
                        className={`text-right text-sm font-medium ${m.sobraCents > 0 ? 'text-amber-600' : ''}`}
                      >
                        {brl(m.sobraCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Entregas registradas</CardTitle>
          </CardHeader>
          <CardContent>
            {entregas.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Nenhuma entrega registrada"
                description="Todo dinheiro que sai do caixa deveria passar por aqui, com quem entregou e quem recebeu."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Dia</TableHead>
                    <TableHead className="w-full">De quem → para quem</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entregas.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap text-xs">{dia(h.handedAt)}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {h.fromPerson} → {h.toPerson}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <Badge variant="secondary">{DESTINO_LABEL[h.destination]}</Badge>
                          {h.note && <span className="text-xs text-muted-foreground">{h.note}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{brl(h.amountCents)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-1.5"
                          disabled={busy}
                          onClick={() => void remover(h.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
