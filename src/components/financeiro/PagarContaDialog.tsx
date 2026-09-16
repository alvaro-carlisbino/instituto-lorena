// Vincular uma conta a pagar ao pagamento, sem contar o mesmo dinheiro duas vezes.
//
// O botão antigo pedia "conta que pagou" e LANÇAVA uma saída nela. No Itaú, que entra sozinho
// pelo Open Finance, isso fazia o mesmo boleto aparecer duas vezes em Gastos: a saída lançada à
// mão e a que o banco trouxe. Aqui a ordem é a do dinheiro:
//
//   1. Procurar o pagamento no extrato. Achou, liga os dois (conciliação), com a data do banco.
//   2. Não passou pelo banco conectado (dinheiro, cartão, outra conta): marca como paga e, se
//      escolher uma conta SEM conexão (o caixa), lança a saída nela. Conta conectada nem aparece
//      como opção, porque o banco já traz esse lançamento sozinho.
//
// 16/set/2026 (Kauan): boleto pago depois do vencimento sai com juros e multa, e a nota ficava
// "sem pagamento no banco" com o pagamento dela ali do lado. O motor automático só casa valor
// exato, e este diálogo abria direto em "paguei de outro jeito" quando não havia valor exato,
// que é justamente esse caso. Agora os candidatos vêm do banco (crm_conciliacao_candidatos), com
// o mesmo fornecedor logo abaixo do mesmo valor, a diferença escrita na linha, e busca por nome
// ou valor para o que nenhuma regra acha. Vinculado com outro valor, o gasto que conta é o que
// saiu do banco: a parcela sai de Gastos e fica a linha do extrato.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link2, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import { type CandidatoPagamento, confirmarConciliacao, listCandidatosPagamento } from '@/services/conciliacaoAuto'
import { type Payable, setPayableStatus } from '@/services/estoqueCompras'
import { type FinAccount } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '')
const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const SEM_CONTA = '__sem_conta__'
const POR_GRUPO = 15

/** Abra com `key={parcela?.id}`: cada parcela começa com a busca e as escolhas limpas. */
export function PagarContaDialog({
  parcela,
  contas,
  onFechar,
  onPago,
}: {
  parcela: Payable | null
  contas: FinAccount[]
  onFechar: () => void
  onPago: () => void
}) {
  const [candidatos, setCandidatos] = useState<CandidatoPagamento[] | null>(null)
  const [busca, setBusca] = useState('')
  const [verParecidos, setVerParecidos] = useState(false)
  const [modo, setModo] = useState<'extrato' | 'fora'>('extrato')
  const [contaId, setContaId] = useState(SEM_CONTA)
  const [data, setData] = useState(hojeLocal())
  const [busy, setBusy] = useState(false)

  const semConexao = useMemo(() => contas.filter((c) => c.active && !c.ofAccountId), [contas])

  useEffect(() => {
    if (!parcela) return
    // O estado começa limpo porque quem abre passa `key` com o id da parcela (remonta).
    let vivo = true
    listCandidatosPagamento(parcela.id)
      .then((c) => {
        if (!vivo) return
        setCandidatos(c)
        // Só abre em "paguei de outro jeito" quando o extrato não tem NADA em volta do
        // vencimento. Sem valor exato não quer dizer sem pagamento: é o caso dos juros.
        if (c.length === 0) setModo('fora')
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setCandidatos([])
        toast.error(e instanceof Error ? e.message : 'Falha ao procurar no extrato')
      })
    return () => {
      vivo = false
    }
  }, [parcela])

  const grupos = useMemo(() => {
    const cs = candidatos ?? []
    const valor = parcela?.amountCents ?? 0
    // Juros, multa e desconto: até 5% ou R$ 30 de diferença entra como "parecido".
    const tolerancia = Math.max(3000, Math.round(valor * 0.05))
    return {
      exatos: cs.filter((c) => c.diferencaCents === 0),
      mesmoNome: cs.filter((c) => c.diferencaCents !== 0 && c.nomeBate).slice(0, POR_GRUPO),
      parecidos: cs
        .filter((c) => c.diferencaCents !== 0 && !c.nomeBate && Math.abs(c.diferencaCents) <= tolerancia)
        .slice(0, POR_GRUPO),
    }
  }, [candidatos, parcela])

  const achados = useMemo(() => {
    const termo = semAcento(busca.trim())
    if (!termo) return null
    const digitos = termo.replace(/\D/g, '')
    const temLetra = /[a-z]/.test(termo)
    return (candidatos ?? [])
      .filter((c) => {
        if (temLetra) return semAcento(`${c.descricao} ${c.conta}`).includes(termo)
        return digitos.length >= 2 && String(c.amountCents).includes(digitos)
      })
      .slice(0, 50)
  }, [busca, candidatos])

  const vincular = async (c: CandidatoPagamento) => {
    if (!parcela) return
    setBusy(true)
    try {
      const ok = await confirmarConciliacao(parcela.id, c.transacaoId)
      if (!ok) {
        toast.error('Esse lançamento do extrato já foi vinculado a outra conta. Escolha outro.')
        return
      }
      const d = c.diferencaCents
      toast.success(
        d === 0
          ? `Vinculada. Paga em ${dia(c.data)}.`
          : d > 0
            ? `Vinculada. Paga em ${dia(c.data)}, ${brl(d)} a mais que a nota (juros ou multa).`
            : `Vinculada. Paga em ${dia(c.data)}, ${brl(-d)} a menos que a nota (desconto).`,
      )
      onPago()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao vincular ao extrato')
    } finally {
      setBusy(false)
    }
  }

  const pagarFora = async () => {
    if (!parcela) return
    setBusy(true)
    try {
      const conta = contaId === SEM_CONTA ? null : contaId
      await setPayableStatus(parcela.id, 'pago', {
        accountId: conta,
        paidOn: data,
        amountCents: parcela.amountCents,
        categoryId: parcela.categoryId,
        description: parcela.description,
        supplierName: parcela.supplierName,
      })
      toast.success(conta ? 'Paga, saída lançada no caixa.' : 'Marcada como paga.')
      onPago()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao marcar como paga')
    } finally {
      setBusy(false)
    }
  }

  const nome = parcela ? parcela.counterparty || parcela.supplierName || parcela.description : ''

  const linha = (c: CandidatoPagamento) => (
    <div key={c.transacaoId} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0">
      <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{dia(c.data)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" title={c.descricao}>
          {c.descricao || 'Lançamento'}
        </div>
        {c.conta ? <div className="truncate text-[0.7rem] text-muted-foreground">{c.conta}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-medium tabular-nums">{brl(c.amountCents)}</div>
        {c.diferencaCents !== 0 ? (
          <div
            className={cn(
              'text-[0.7rem] tabular-nums',
              c.diferencaCents > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
            )}
            title={c.diferencaCents > 0 ? 'A mais que a nota: juros ou multa' : 'A menos que a nota: desconto'}
          >
            {c.diferencaCents > 0 ? '+' : '−'}
            {brl(Math.abs(c.diferencaCents))}
          </div>
        ) : null}
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void vincular(c)}>
        <Link2 className="size-3.5" /> Vincular
      </Button>
    </div>
  )

  const cabecalho = (texto: string) => (
    <div className="border-b border-border bg-muted/50 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {texto}
    </div>
  )

  const nadaPerto = grupos.exatos.length === 0 && grupos.mesmoNome.length === 0
  const mostrarParecidos = verParecidos || nadaPerto

  return (
    <Dialog open={parcela != null} onOpenChange={(o) => (!o ? onFechar() : null)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Vincular pagamento</DialogTitle>
          <DialogDescription>
            {nome} · vence {parcela ? dia(parcela.dueDate) : ''} · {brl(parcela?.amountCents ?? 0)}
          </DialogDescription>
        </DialogHeader>

        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group">
          {(
            [
              ['extrato', 'Saiu do banco'],
              ['fora', 'Paguei de outro jeito'],
            ] as const
          ).map(([m, rotulo]) => (
            <button
              key={m}
              type="button"
              aria-pressed={modo === m}
              onClick={() => setModo(m)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                modo === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {modo === 'extrato' ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Escolha o lançamento do extrato que pagou esta nota. Pagou com juros, multa ou desconto? Vincule mesmo
              assim: o gasto conta uma vez só, com o valor que saiu do banco.
            </p>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar no extrato por nome ou valor"
                className="h-9 pl-8"
              />
            </div>
            {candidatos == null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <Search className="mr-1 inline size-3.5" /> Procurando no extrato…
              </p>
            ) : (
              <div className="max-h-[45vh] overflow-y-auto rounded-md border border-border">
                {achados ? (
                  achados.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      Nada com {`"${busca.trim()}"`} no extrato entre 45 dias antes e 150 dias depois do vencimento, fora o
                      que já está vinculado a outra conta.
                    </p>
                  ) : (
                    <>
                      {cabecalho(`${achados.length === 50 ? 'Primeiros 50' : achados.length} encontrados`)}
                      {achados.map(linha)}
                    </>
                  )
                ) : (
                  <>
                    {grupos.exatos.length > 0 && (
                      <>
                        {cabecalho('Mesmo valor')}
                        {grupos.exatos.map(linha)}
                      </>
                    )}
                    {grupos.mesmoNome.length > 0 && (
                      <>
                        {cabecalho('Mesmo fornecedor, outro valor')}
                        {grupos.mesmoNome.map(linha)}
                      </>
                    )}
                    {nadaPerto && (
                      <p className="border-b border-border px-3 py-3 text-sm text-muted-foreground">
                        Nenhuma saída de {brl(parcela?.amountCents ?? 0)} nem com o nome do fornecedor perto do
                        vencimento. O extrato às vezes mostra outro nome (SISPAG, o banco do boleto): busque acima pelo
                        valor pago.
                      </p>
                    )}
                    {grupos.parecidos.length > 0 &&
                      (nadaPerto ? (
                        <>
                          {cabecalho('Valor parecido')}
                          {grupos.parecidos.map(linha)}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setVerParecidos((v) => !v)}
                            className="w-full border-b border-border bg-muted/30 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                          >
                            {mostrarParecidos ? 'Esconder' : 'Ver'} {grupos.parecidos.length} com valor parecido e outro nome
                          </button>
                          {mostrarParecidos && grupos.parecidos.map(linha)}
                        </>
                      ))}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Para o que não passou pelo banco conectado: dinheiro, cartão ou outra conta. Pagamento pelo Itaú não se
              marca aqui, porque o extrato já traz a saída e ela contaria duas vezes.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Data do pagamento</Label>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Lançar a saída em</Label>
                <Select value={contaId} onValueChange={(v) => setContaId(v ?? SEM_CONTA)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CONTA}>Não lançar (só marcar como paga)</SelectItem>
                    {semConexao.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={busy}>
            Cancelar
          </Button>
          {modo === 'fora' && (
            <Button onClick={() => void pagarFora()} disabled={busy}>
              {busy ? 'Salvando…' : 'Marcar como paga'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
