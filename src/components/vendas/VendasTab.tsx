import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, FileSpreadsheet, Pencil, Plus, UserX } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { VendaFormDialog } from '@/components/vendas/VendaFormDialog'
import {
  type ClinicSale,
  type ClinicSaleKind,
  type StaffMember,
  cancelClinicSale,
  listClinicSales,
  listSurgicalStaff,
  salesByDoctor,
} from '@/services/clinicSales'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—')

const nomeDoMes = (m: string) => {
  const [ano, mes] = m.split('-')
  const d = new Date(Number(ano), Number(mes) - 1, 1)
  const nome = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

const STATUS_LABEL: Record<ClinicSale['status'], string> = {
  vendida: 'Vendida',
  agendada: 'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
}

export function VendasTab({ kind }: { kind: ClinicSaleKind }) {
  const [sales, setSales] = useState<ClinicSale[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<{ open: boolean; editing: ClinicSale | null }>({ open: false, editing: null })
  const [cancelando, setCancelando] = useState<ClinicSale | null>(null)
  const [motivo, setMotivo] = useState('')
  const [estorno, setEstorno] = useState('Em avaliação')
  const [obsCancel, setObsCancel] = useState('')
  const [soSemPaciente, setSoSemPaciente] = useState(false)
  const [mes, setMes] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const load = async () => {
    setLoading(true)
    try {
      const [s, st] = await Promise.all([listClinicSales(kind), listSurgicalStaff()])
      setSales(s)
      setStaff(st)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar as vendas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  /** Meses que existem nos dados, do mais novo para o mais velho. */
  const mesesDisponiveis = useMemo(() => {
    const set = new Set(sales.map((s) => s.soldAt.slice(0, 7)).filter(Boolean))
    return [...set].sort().reverse()
  }, [sales])

  // Venda sem paciente vinculado não move card nem recebe lembrete: fica órfã.
  // Acontece quando o telefone da planilha bate com dois leads (parente, cadastro
  // duplicado) e casar por semelhança em saúde é mostrar a cirurgia de um
  // paciente para outro. Então o sistema não adivinha, ele mostra a lista.
  const semPaciente = useMemo(() => sales.filter((s) => !s.leadId && s.status !== 'cancelada'), [sales])

  const doMes = useMemo(
    () =>
      sales.filter(
        (s) =>
          s.status !== 'cancelada' &&
          (soSemPaciente ? !s.leadId : s.soldAt.startsWith(mes)),
      ),
    [sales, mes, soSemPaciente],
  )

  const resumo = useMemo(() => {
    const total = doMes.reduce((acc, s) => acc + s.valueCents, 0)
    return {
      qtd: doMes.length,
      total,
      ticket: doMes.length > 0 ? Math.round(total / doMes.length) : 0,
      semData: sales.filter((s) => s.status !== 'cancelada' && !s.scheduledAt).length,
    }
  }, [doMes, sales])

  // O "por médico" acompanha o mês escolhido: é o fechamento que ela digita hoje
  // no rodapé da planilha ("4 fechamentos, 37% de conversão").
  const porMedico = useMemo(() => salesByDoctor(doMes), [doMes])

  const confirmarCancelamento = async () => {
    if (!cancelando) return
    try {
      await cancelClinicSale(cancelando.id, { reason: motivo, refundStatus: estorno, note: obsCancel })
      toast.success('Venda cancelada. Os lembretes pendentes saíram da fila.')
      setCancelando(null)
      setMotivo('')
      setObsCancel('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar')
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Vendas no mês</p>
            <p className="font-heading text-2xl">{resumo.qtd}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Faturamento do mês</p>
            <p className="font-heading text-2xl">{brl(resumo.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Ticket médio</p>
            <p className="font-heading text-2xl">{brl(resumo.ticket)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Vendidas sem data</p>
            <p className="font-heading text-2xl">{resumo.semData}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{kind === 'cirurgia' ? 'Vendas cirúrgicas' : 'Vendas de protocolo'}</CardTitle>
          <CardAction>
            <div className="flex items-center gap-2">
              {semPaciente.length > 0 && (
                <Button
                  size="sm"
                  variant={soSemPaciente ? 'default' : 'outline'}
                  onClick={() => setSoSemPaciente((v) => !v)}
                >
                  <UserX className="size-3.5" /> Sem paciente ({semPaciente.length})
                </Button>
              )}
              <Select value={mes} disabled={soSemPaciente} onValueChange={(v) => setMes(String(v ?? mes))}>
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mesesDisponiveis.map((m) => (
                    <SelectItem key={m} value={m}>
                      {nomeDoMes(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setForm({ open: true, editing: null })}>
                <Plus className="size-3.5" /> Nova venda
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {doMes.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title={loading ? 'Carregando…' : soSemPaciente ? 'Todas as vendas têm paciente' : `Nenhuma venda em ${nomeDoMes(mes)}`}
              description={loading ? undefined : 'Escolha outro mês ou registre a primeira venda.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venda</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead>{kind === 'cirurgia' ? 'Procedimento' : 'Protocolo'}</TableHead>
                    <TableHead>Médico</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>{kind === 'cirurgia' ? 'Cirurgia' : 'Agendado'}</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">NF</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doMes.map((s) => (
                    <TableRow key={s.id} className={s.status === 'cancelada' ? 'opacity-60' : undefined}>
                      <TableCell className="whitespace-nowrap">{dia(s.soldAt)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{s.patientName}</div>
                        {s.city && <div className="text-xs text-muted-foreground">{s.city}</div>}
                        {!s.leadId && (
                          <div className="text-xs text-destructive">sem paciente vinculado</div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{s.procedureLabel}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {s.attendingDoctor ?? s.sellerDoctor ?? '—'}
                        {s.performingDoctor && s.performingDoctor !== (s.attendingDoctor ?? s.sellerDoctor) && (
                          <span className="block text-xs">opera: {s.performingDoctor}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{brl(s.valueCents)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {s.scheduledAt ? (
                          new Date(s.scheduledAt).toLocaleDateString('pt-BR')
                        ) : (
                          <Badge variant="outline">a definir</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            s.status === 'cancelada'
                              ? 'destructive'
                              : s.status === 'realizada'
                                ? 'secondary'
                                : 'default'
                          }
                        >
                          {STATUS_LABEL[s.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{s.invoiceIssued ? 'Sim' : 'Não'}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setForm({ open: true, editing: s })}>
                            <Pencil className="size-3.5" />
                          </Button>
                          {s.status !== 'cancelada' && (
                            <Button size="sm" variant="ghost" onClick={() => setCancelando(s)}>
                              <Ban className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {porMedico.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por médico em {soSemPaciente ? 'toda a base' : nomeDoMes(mes)}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Quem vendeu, quanto vendeu e quantas executa. É o fechamento que hoje é digitado na mão no rodapé
              da planilha.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Médico</TableHead>
                    <TableHead className="text-right">Vendeu</TableHead>
                    <TableHead className="text-right">Faturamento</TableHead>
                    <TableHead className="text-right">Ticket médio</TableHead>
                    <TableHead className="text-right">Executa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porMedico.map((m) => (
                    <TableRow key={m.nome}>
                      <TableCell className="font-medium">{m.nome}</TableCell>
                      <TableCell className="text-right">{m.vendeu}</TableCell>
                      <TableCell className="text-right">{brl(m.valorCents)}</TableCell>
                      <TableCell className="text-right">{brl(m.ticketCents)}</TableCell>
                      <TableCell className="text-right">{m.executa}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <VendaFormDialog
        open={form.open}
        kind={kind}
        staff={staff}
        editing={form.editing}
        onClose={() => setForm({ open: false, editing: null })}
        onSaved={() => void load()}
      />

      <Dialog open={cancelando != null} onOpenChange={(v) => (!v ? setCancelando(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancelar a venda de {cancelando?.patientName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivos pessoais, não quis seguir, condição de saúde…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Estorno da entrada</Label>
              <Input value={estorno} onChange={(e) => setEstorno(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Textarea value={obsCancel} onChange={(e) => setObsCancel(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={() => void confirmarCancelamento()}>
              Cancelar venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
