import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import { type ClinicSaleKind, type StaffMember, listAnesthesiaProviders } from '@/services/clinicSales'
import {
  type ModoRepasse,
  type PapelRepasse,
  type RegraRepasse,
  apagarRegraRepasse,
  calcularRepasse,
  chavePessoa,
  listRegrasRepasse,
  salvarRegraRepasse,
} from '@/services/repasseRegras'

type Linha = {
  papel: PapelRepasse
  pessoa: string
  /** Regra gravada hoje; null = a pessoa ainda não tem regra. */
  original: RegraRepasse | null
  modo: ModoRepasse | 'nenhuma'
  texto: string
}

const numero = (t: string) => {
  const n = Number(t.replace(/\s|R\$|%/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

const textoDaRegra = (r: RegraRepasse | null) =>
  !r
    ? ''
    : r.modo === 'fixo'
      ? ((r.fixoCents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      : String(r.percentual ?? 0).replace('.', ',')

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Venda de referência do exemplo ao lado de cada regra: o ticket comum de transplante. */
const EXEMPLO_CENTS = 3_000_000

type Props = {
  open: boolean
  kind: ClinicSaleKind
  staff: StaffMember[]
  onClose: () => void
  onSaved: () => void
}

/**
 * Onde a gerência diz quanto cada um recebe. Salvar recalcula as vendas da pessoa que não
 * tiveram o valor digitado à mão (trigger `clinic_payout_rules_reaplica`).
 */
export function RegrasRepasseDialog({ open, kind, staff, onClose, onSaved }: Props) {
  const { canViewFinance } = useTenant()
  const cirurgia = kind === 'cirurgia'
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const medicos = useMemo(() => staff.filter((s) => s.tipo === 'MEDICO').map((s) => s.nome), [staff])

  useEffect(() => {
    if (!open) return
    let vivo = true
    setCarregando(true)
    Promise.all([listRegrasRepasse(), cirurgia ? listAnesthesiaProviders() : Promise.resolve([])])
      .then(([regras, anestesias]) => {
        if (!vivo) return
        const doTipo = regras.filter((r) => r.kind === kind)
        const montar = (papel: PapelRepasse, nomes: string[]): Linha[] => {
          // Quem tem regra e saiu da lista continua aparecendo: sumir da tela não apaga a regra,
          // e ela seguiria valendo sem ninguém ver.
          const todos = [...nomes]
          for (const r of doTipo) {
            if (r.papel === papel && !todos.some((n) => chavePessoa(n) === chavePessoa(r.pessoa))) todos.push(r.pessoa)
          }
          return todos.map((pessoa) => {
            const original = doTipo.find((r) => r.papel === papel && chavePessoa(r.pessoa) === chavePessoa(pessoa)) ?? null
            return { papel, pessoa, original, modo: original?.modo ?? 'nenhuma', texto: textoDaRegra(original) }
          })
        }
        setLinhas([
          ...montar('medico', medicos),
          ...(cirurgia ? montar('anestesia', anestesias.map((a) => a.nome)) : []),
        ])
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao carregar as regras'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [open, kind, cirurgia, medicos])

  const mudou = (l: Linha) => {
    if (l.modo === 'nenhuma') return l.original != null
    if (!l.original || l.original.modo !== l.modo) return true
    return numero(l.texto) !== numero(textoDaRegra(l.original))
  }
  const alteradas = linhas.filter(mudou)

  const atualizar = (i: number, patch: Partial<Linha>) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const salvar = async () => {
    for (const l of alteradas) {
      if (l.modo === 'nenhuma') continue
      const n = numero(l.texto)
      if (!Number.isFinite(n) || n < 0 || (l.modo === 'percentual' && n > 100)) {
        toast.error(`Valor inválido para ${l.pessoa}.`)
        return
      }
    }
    setSalvando(true)
    try {
      for (const l of alteradas) {
        if (l.modo === 'nenhuma') {
          if (l.original) await apagarRegraRepasse(l.original.id)
          continue
        }
        const n = numero(l.texto)
        await salvarRegraRepasse(l.original?.id ?? null, {
          papel: l.papel,
          pessoa: l.pessoa,
          kind,
          modo: l.modo,
          percentual: l.modo === 'percentual' ? n : null,
          fixoCents: l.modo === 'fixo' ? Math.round(n * 100) : null,
        })
      }
      toast.success('Regras salvas. As vendas dessas pessoas foram recalculadas.')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const bloco = (papel: PapelRepasse, titulo: string, ajuda: string) => {
    const doPapel = linhas.map((l, i) => ({ l, i })).filter(({ l }) => l.papel === papel)
    return (
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{ajuda}</p>
        </div>
        {doPapel.length === 0 ? (
          <p className="text-xs text-muted-foreground">{carregando ? 'Carregando…' : 'Ninguém na lista.'}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {doPapel.map(({ l, i }) => {
              const n = numero(l.texto)
              const exemplo =
                l.modo === 'nenhuma' || !Number.isFinite(n)
                  ? null
                  : calcularRepasse(
                      {
                        id: '',
                        papel: l.papel,
                        pessoa: l.pessoa,
                        kind,
                        modo: l.modo,
                        percentual: l.modo === 'percentual' ? n : null,
                        fixoCents: l.modo === 'fixo' ? Math.round(n * 100) : null,
                      },
                      EXEMPLO_CENTS,
                    )
              return (
                <li key={`${l.papel}:${l.pessoa}`} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1 text-sm font-medium">{l.pessoa}</span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={l.modo}
                      disabled={!canViewFinance || salvando}
                      onValueChange={(v) => atualizar(i, { modo: (v as Linha['modo']) ?? 'nenhuma' })}
                    >
                      <SelectTrigger className="w-40" aria-label={`Regra de ${l.pessoa}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhuma">Sem regra</SelectItem>
                        <SelectItem value="percentual">% do valor</SelectItem>
                        <SelectItem value="fixo">Valor fixo</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={l.modo === 'nenhuma' ? '' : l.texto}
                      disabled={l.modo === 'nenhuma' || !canViewFinance || salvando}
                      onChange={(e) => atualizar(i, { texto: e.target.value })}
                      placeholder={l.modo === 'fixo' ? '2.500,00' : l.modo === 'percentual' ? '30' : ''}
                      inputMode="decimal"
                      className="w-28 text-right tabular-nums"
                      aria-label={l.modo === 'fixo' ? `Valor por venda de ${l.pessoa}` : `Percentual de ${l.pessoa}`}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground sm:w-36 sm:text-right">
                    {exemplo == null ? (l.modo === 'nenhuma' ? 'fica zero na venda' : '') : `venda de R$ 30 mil: ${brl(exemplo)}`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !salvando ? onClose() : null)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Regras de repasse · {cirurgia ? 'transplante' : 'protocolos'}</DialogTitle>
          <DialogDescription>
            Ao escolher o médico e o anestesista, a venda calcula o repasse sozinha. Mudar uma regra recalcula as
            vendas já registradas daquela pessoa, menos as que tiveram o valor digitado à mão.
          </DialogDescription>
        </DialogHeader>

        {!canViewFinance && (
          <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Só o financeiro e a gerência alteram estas regras.
          </p>
        )}

        <div className="space-y-5">
          {bloco(
            'medico',
            cirurgia ? 'Médico que opera' : 'Médico',
            cirurgia
              ? 'Vale para quem está em "Médico que vai operar" na venda.'
              : 'Vale para o médico que atendeu a venda de protocolo.',
          )}
          {cirurgia &&
            bloco('anestesia', 'Anestesia', 'Pessoa ou empresa escolhida no campo Anestesista da venda.')}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Fechar
          </Button>
          {canViewFinance && (
            <Button disabled={salvando || carregando || alteradas.length === 0} onClick={() => void salvar()}>
              {salvando
                ? 'Salvando…'
                : alteradas.length > 0
                  ? `Salvar ${alteradas.length} ${alteradas.length === 1 ? 'regra' : 'regras'}`
                  : 'Salvar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
