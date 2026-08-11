// "Cirurgia foi paga?" — a regra da casa virando semáforo.
//
// A tela existe porque a resposta estava espalhada em três sistemas: o que foi feito na sala
// (srg_surgeries, espelho do sistema de cirurgia), o que foi cobrado (Shosp, via contas a
// receber) e o dinheiro que caiu (extrato). Ninguém conseguia responder "a cirurgia de ontem
// foi paga?" sem abrir os três.
//
// A decisão de projeto que faz ela prestar: SEPARAR "não pagou" de "não consigo saber". O
// cruzamento por nome dizia 44 cirurgias sem pagamento; por CPF são 2, e 42 são cirurgias que
// nem prontuário do Shosp têm. Misturar as duas coisas numa lista só faz ninguém auditar
// nenhuma — é a diferença entre uma pendência e um alarme falso.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Banknote, Download, HeartPulse, Link2Off, ShieldCheck } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTenant } from '@/context/TenantContext'
import { hojeLocal } from '@/lib/diaLocal'
import { listCirurgiasPagamento, type CirurgiaPagamento, type VinculoCirurgia } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—')

const VINCULO_LABEL: Record<VinculoCirurgia, string> = {
  cpf: 'Pago (casado por CPF)',
  nome: 'Pago (casado só por nome)',
  sem_pagamento: 'Nenhum pagamento no Shosp',
  sem_vinculo: 'Não dá pra saber',
}
const VINCULO_BADGE: Record<VinculoCirurgia, string> = {
  cpf: 'CPF',
  nome: 'Nome',
  sem_pagamento: 'Sem pagamento',
  sem_vinculo: 'Sem vínculo',
}

/** Meses pra trás a partir de hoje — o padrão cobre o ano corrente de cirurgias. */
function mesesAtras(n: number): string {
  const d = new Date(`${hojeLocal()}T12:00:00`)
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

export function CirurgiaPagamentoPage() {
  const { tenant } = useTenant()
  const [de, setDe] = useState(mesesAtras(12))
  const [ate, setAte] = useState(hojeLocal())
  const [linhas, setLinhas] = useState<CirurgiaPagamento[]>([])
  const [filtro, setFiltro] = useState<VinculoCirurgia | 'todas'>('todas')
  const [busy, setBusy] = useState(false)

  const carregar = async (d = de, a = ate) => {
    setBusy(true)
    try {
      setLinhas(await listCirurgiasPagamento(d, a))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cruzar cirurgia com pagamento')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resumo = useMemo(() => {
    const por = (v: VinculoCirurgia) => linhas.filter((l) => l.vinculo === v)
    const soma = (ls: CirurgiaPagamento[]) => ls.reduce((a, l) => a + l.recebidoCents, 0)
    const pagas = [...por('cpf'), ...por('nome')]
    return {
      total: linhas.length,
      pagas: pagas.length,
      recebido: soma(pagas),
      especie: pagas.reduce((a, l) => a + l.emEspecieCents, 0),
      semPagamento: por('sem_pagamento'),
      semVinculo: por('sem_vinculo').length,
      soNome: por('nome').length,
    }
  }, [linhas])

  const visiveis = useMemo(
    () => (filtro === 'todas' ? linhas : linhas.filter((l) => l.vinculo === filtro)),
    [linhas, filtro],
  )

  const baixarCsv = () => {
    const l = [
      ['Data', 'Paciente', 'Prontuário', 'Vínculo', 'Recebido', 'Lançamentos', 'Em espécie', 'Formas', 'Último pagamento'],
      ...visiveis.map((x) => [
        dia(x.dia),
        x.paciente,
        x.prontuario ?? '',
        VINCULO_LABEL[x.vinculo],
        brl(x.recebidoCents),
        String(x.recebidoQtd),
        brl(x.emEspecieCents),
        x.formas.join(' + '),
        dia(x.ultimoPagamento),
      ]),
    ]
    const csv = l.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    // BOM escapado, não literal: o caractere invisível no fonte é indistinguível de
    // um espaço e o lint reclama com razão. Sem ele o Excel abre em latin-1 e come os acentos.
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `cirurgia-pagamento-${de}-a-${ate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppLayout
      title="Cirurgia foi paga?"
      subtitle="Cada cirurgia realizada contra o dinheiro que entrou daquele paciente. A regra é 100% pago antes de operar."
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
        <Button size="sm" disabled={busy} onClick={() => void carregar()}>
          <HeartPulse className="size-4" /> Conferir
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={baixarCsv} disabled={visiveis.length === 0}>
          <Download className="size-4" /> CSV
        </Button>
      </div>

      {linhas.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="pt-6">
            <EmptyState
              icon={HeartPulse}
              title={busy ? 'Cruzando…' : 'Nenhuma cirurgia no período'}
              description="Escolha o período e clique em Conferir."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" /> Cirurgias com pagamento
                </div>
                <div className="mt-0.5 text-lg font-semibold">
                  {resumo.pagas} <span className="text-sm font-normal text-muted-foreground">de {resumo.total}</span>
                </div>
                <div className="text-xs text-muted-foreground">{brl(resumo.recebido)} recebidos</div>
              </CardContent>
            </Card>
            {/* O alarme de verdade: paciente identificado por CPF e nenhuma venda no Shosp. */}
            <Card className={resumo.semPagamento.length > 0 ? 'border-destructive/40 bg-destructive/[0.04]' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3.5" /> Operou e não pagou
                </div>
                <div className="mt-0.5 text-lg font-semibold">{resumo.semPagamento.length}</div>
                <div className="text-xs text-muted-foreground">paciente achado, zero venda no Shosp</div>
              </CardContent>
            </Card>
            {/* Separado de propósito: isto é falta de dado, não falta de dinheiro. */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Link2Off className="size-3.5" /> Não dá pra saber
                </div>
                <div className="mt-0.5 text-lg font-semibold">{resumo.semVinculo}</div>
                <div className="text-xs text-muted-foreground">cirurgia sem prontuário do Shosp</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Banknote className="size-3.5" /> Recebido em espécie
                </div>
                <div className="mt-0.5 text-lg font-semibold">{brl(resumo.especie)}</div>
                <div className="text-xs text-muted-foreground">dinheiro vivo ligado a cirurgia</div>
              </CardContent>
            </Card>
          </div>

          {resumo.soNome > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {resumo.soNome} cirurgia(s) casaram só pelo nome do paciente, porque não têm prontuário do
              Shosp. Nome não é chave — pagamento feito por cônjuge ou grafia diferente escapa. Vincule o
              prontuário para essas virarem conferência de verdade.
            </p>
          )}

          <Card className="mt-4">
            <CardContent className="pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{visiveis.length} cirurgia(s)</span>
                <Select value={filtro} onValueChange={(v) => setFiltro((v as VinculoCirurgia | 'todas') ?? 'todas')}>
                  <SelectTrigger className="h-8 w-[260px] text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas ({linhas.length})</SelectItem>
                    {(['sem_pagamento', 'sem_vinculo', 'nome', 'cpf'] as VinculoCirurgia[]).map((v) => (
                      <SelectItem key={v} value={v}>
                        {VINCULO_LABEL[v]} ({linhas.filter((l) => l.vinculo === v).length})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Cirurgia</TableHead>
                    <TableHead className="w-full">Paciente</TableHead>
                    <TableHead className="w-[130px]">Vínculo</TableHead>
                    <TableHead className="w-[120px] text-right">Recebido</TableHead>
                    <TableHead className="w-[150px]">Formas</TableHead>
                    <TableHead className="w-[100px]">Último pgto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((l) => (
                    <TableRow key={l.surgeryId}>
                      <TableCell className="whitespace-nowrap text-xs">{dia(l.dia)}</TableCell>
                      <TableCell>
                        <div className="text-sm">{l.paciente}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.prontuario ? `Prontuário ${l.prontuario}` : 'sem prontuário do Shosp'}
                          {l.recebidoQtd > 0 ? ` · ${l.recebidoQtd} lançamento(s)` : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            l.vinculo === 'sem_pagamento'
                              ? 'destructive'
                              : l.vinculo === 'cpf'
                                ? 'default'
                                : 'secondary'
                          }
                          title={VINCULO_LABEL[l.vinculo]}
                        >
                          {VINCULO_BADGE[l.vinculo]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {l.recebidoCents > 0 ? brl(l.recebidoCents) : '—'}
                        {l.emEspecieCents > 0 && (
                          <div className="text-xs font-normal text-muted-foreground">
                            {brl(l.emEspecieCents)} em espécie
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{l.formas.join(' + ') || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{dia(l.ultimoPagamento)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </AppLayout>
  )
}
