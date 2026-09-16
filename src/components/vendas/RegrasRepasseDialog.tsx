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
import { type ClinicSaleKind, type StaffMember } from '@/services/clinicSales'
import {
  type ModoRepasse,
  type PapelRepasse,
  type PoliticaRepasse,
  type RegraRepasse,
  apagarRegraRepasse,
  calcularRepasse,
  chavePessoa,
  getPoliticaRepasse,
  listRegrasRepasse,
  salvarPoliticaRepasse,
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
 * Onde a gerência diz quanto cada um recebe. Cirurgia segue a política da clínica (valores por
 * papel na venda e por procedimento); protocolo, a regra de cada médico.
 */
export function RegrasRepasseDialog(props: Props) {
  return props.kind === 'cirurgia' ? <PoliticaCirurgiaDialog {...props} /> : <RegrasPorPessoaDialog {...props} />
}

/**
 * Regra por médico, para protocolo. Salvar recalcula as vendas da pessoa que não tiveram o valor
 * digitado à mão (trigger `clinic_payout_rules_reaplica`).
 */
function RegrasPorPessoaDialog({ open, kind, staff, onClose, onSaved }: Props) {
  const { canViewFinance } = useTenant()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const medicos = useMemo(() => staff.filter((s) => s.tipo === 'MEDICO').map((s) => s.nome), [staff])

  useEffect(() => {
    if (!open) return
    let vivo = true
    setCarregando(true)
    listRegrasRepasse()
      .then((regras) => {
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
        setLinhas(montar('medico', medicos))
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao carregar as regras'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [open, kind, medicos])

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
          <DialogTitle>Regras de repasse · protocolos</DialogTitle>
          <DialogDescription>
            Ao escolher o médico, a venda calcula o repasse sozinha. Mudar uma regra recalcula as vendas já
            registradas daquela pessoa, menos as que tiveram o valor digitado à mão.
          </DialogDescription>
        </DialogHeader>

        {!canViewFinance && (
          <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Só o financeiro e a gerência alteram estas regras.
          </p>
        )}

        <div className="space-y-5">
          {bloco('medico', 'Médico', 'Vale para o médico que atendeu a venda de protocolo.')}
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

type CampoPolitica = Exclude<keyof PoliticaRepasse, 'tenantId'>

const reais = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

/** Texto de cada campo como aparece no input: % e UF como número, o resto em reais. */
function textosDaPolitica(p: PoliticaRepasse): Record<CampoPolitica, string> {
  return {
    medicoMesmoPct: String(p.medicoMesmoPct).replace('.', ','),
    medicoCirurgiaoCents: reais(p.medicoCirurgiaoCents),
    medicoIndicacaoCents: reais(p.medicoIndicacaoCents),
    anestSobrancelhaCents: reais(p.anestSobrancelhaCents),
    anestPadraoCents: reais(p.anestPadraoCents),
    anestMascPequenaCents: reais(p.anestMascPequenaCents),
    anestLimiteUf: String(p.anestLimiteUf),
    anestNanofatCents: reais(p.anestNanofatCents),
  }
}

/**
 * A política de cirurgia da clínica (16/09/2026, Luana). Salvar recalcula todas as cirurgias que
 * não tiveram o valor digitado à mão (trigger `clinic_payout_policy_reaplica`).
 */
function PoliticaCirurgiaDialog({ open, onClose, onSaved }: Props) {
  const { canViewFinance } = useTenant()
  const [original, setOriginal] = useState<PoliticaRepasse | null>(null)
  const [textos, setTextos] = useState<Record<CampoPolitica, string> | null>(null)
  // Só vira true no retorno da busca: ligar "carregando" dentro do efeito renderiza duas vezes.
  const [carregado, setCarregado] = useState(false)
  const carregando = !carregado
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) return
    let vivo = true
    getPoliticaRepasse()
      .then((p) => {
        if (!vivo) return
        setOriginal(p)
        setTextos(p ? textosDaPolitica(p) : null)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao carregar a política'))
      .finally(() => vivo && setCarregado(true))
    return () => {
      vivo = false
    }
  }, [open])

  const lida = useMemo(() => {
    if (!original || !textos) return null
    const valor = (c: CampoPolitica) => numero(textos[c])
    const politica: PoliticaRepasse = {
      tenantId: original.tenantId,
      medicoMesmoPct: valor('medicoMesmoPct'),
      medicoCirurgiaoCents: Math.round(valor('medicoCirurgiaoCents') * 100),
      medicoIndicacaoCents: Math.round(valor('medicoIndicacaoCents') * 100),
      anestSobrancelhaCents: Math.round(valor('anestSobrancelhaCents') * 100),
      anestPadraoCents: Math.round(valor('anestPadraoCents') * 100),
      anestMascPequenaCents: Math.round(valor('anestMascPequenaCents') * 100),
      anestLimiteUf: Math.round(valor('anestLimiteUf')),
      anestNanofatCents: Math.round(valor('anestNanofatCents') * 100),
    }
    const invalido = (Object.keys(textos) as CampoPolitica[]).find((c) => {
      const n = valor(c)
      return !Number.isFinite(n) || n < 0 || (c === 'medicoMesmoPct' && n > 100) || (c === 'anestLimiteUf' && n < 1)
    })
    const mudou = (Object.keys(textos) as CampoPolitica[]).some((c) => politica[c] !== original[c])
    return { politica, invalido, mudou }
  }, [original, textos])

  const salvar = async () => {
    if (!lida) return
    if (lida.invalido) {
      toast.error('Confira os valores: algum está vazio ou fora do limite.')
      return
    }
    setSalvando(true)
    try {
      await salvarPoliticaRepasse(lida.politica)
      toast.success('Política salva. As cirurgias foram recalculadas.')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const campo = (c: CampoPolitica, rotulo: string, ajuda: string, unidade: 'reais' | 'pct' | 'uf', exemplo?: string) => (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{rotulo}</div>
        <div className="text-xs text-muted-foreground">{ajuda}</div>
      </div>
      <div className="flex items-center gap-1.5">
        {unidade === 'reais' && <span className="text-sm text-muted-foreground">R$</span>}
        <Input
          value={textos?.[c] ?? ''}
          disabled={!canViewFinance || salvando || !textos}
          onChange={(e) => setTextos((t) => (t ? { ...t, [c]: e.target.value } : t))}
          inputMode="decimal"
          className="w-28 text-right tabular-nums"
          aria-label={rotulo}
        />
        {unidade === 'pct' && <span className="text-sm text-muted-foreground">%</span>}
        {unidade === 'uf' && <span className="text-sm text-muted-foreground">UF</span>}
      </div>
      {exemplo ? <span className="text-xs text-muted-foreground sm:w-32 sm:text-right">{exemplo}</span> : null}
    </li>
  )

  const pctExemplo = lida && Number.isFinite(lida.politica.medicoMesmoPct)
    ? `venda de R$ 30 mil: ${brl(Math.round((EXEMPLO_CENTS * lida.politica.medicoMesmoPct) / 100))}`
    : undefined
  const limite = lida && Number.isFinite(lida.politica.anestLimiteUf)
    ? lida.politica.anestLimiteUf.toLocaleString('pt-BR')
    : '…'

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !salvando ? onClose() : null)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Repasse de transplante</DialogTitle>
          <DialogDescription>
            A venda calcula sozinha pelo papel de cada médico e pelo procedimento. Mudar um valor recalcula todas as
            cirurgias já registradas, menos as que tiveram o valor digitado à mão.
          </DialogDescription>
        </DialogHeader>

        {!canViewFinance && (
          <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Só o financeiro e a gerência alteram estes valores.
          </p>
        )}

        {carregando || !textos ? (
          <p className="text-sm text-muted-foreground">{carregando ? 'Carregando…' : 'Este polo não tem política de repasse.'}</p>
        ) : (
          <div className="space-y-5">
            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Médico</h3>
                <p className="text-xs text-muted-foreground">Pelos campos "Médico que atendeu e vendeu" e "Médico que vai operar".</p>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {campo('medicoMesmoPct', 'Atendeu, vendeu e opera', 'O mesmo médico nos dois campos.', 'pct', pctExemplo)}
                {campo('medicoCirurgiaoCents', 'Só opera', 'A venda veio de outro médico.', 'reais')}
                {campo('medicoIndicacaoCents', 'Atendeu e passou para outro operar', 'Comissão de quem atendeu, somada ao repasse do cirurgião.', 'reais')}
              </ul>
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold">Anestesia</h3>
                <p className="text-xs text-muted-foreground">
                  Pelo procedimento da venda. Cirurgia combinada paga o maior valor; nanofat soma.
                </p>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {campo('anestSobrancelhaCents', 'Sobrancelha', 'Inclui sobrancelha com cílios.', 'reais')}
                {campo('anestPadraoCents', 'Feminina, e masculina sem raspagem', `Também a masculina com raspagem de ${limite} UF ou mais.`, 'reais')}
                {campo('anestMascPequenaCents', 'Masculina com raspagem, abaixo do limite', 'UF da sala quando a cirurgia está ligada; senão, a previsão da venda.', 'reais')}
                {campo('anestLimiteUf', 'Limite de unidades foliculares', 'Abaixo deste número, a masculina com raspagem paga o valor menor.', 'uf')}
                {campo('anestNanofatCents', 'Nanofat e células autólogas', 'Soma ao procedimento principal.', 'reais')}
              </ul>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Fechar
          </Button>
          {canViewFinance && (
            <Button disabled={salvando || carregando || !lida?.mudou} onClick={() => void salvar()}>
              {salvando ? 'Salvando…' : 'Salvar e recalcular'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
