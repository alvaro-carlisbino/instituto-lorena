// O ÚNICO jeito de escolher centro de custo no financeiro.
//
// Antes eram dois: o Extrato perguntava "categoria" numa lista e o Gastos perguntava "centro de
// custo" em outra, com nomes quase iguais ("Impostos e taxas" × "Impostos", "Salários e
// pró-labore" × "Salários e encargos"). Quem classificava num lugar não via o número mexer no
// outro, e o financeiro pediu uma lista só: a de centro de custo, que é a da planilha da clínica.
//
// Abre em modal de busca, como todo seletor do CRM (ver search-picker): digita, vê a explicação
// de cada centro e confirma com Enter. A explicação fica AQUI porque é aqui que a dúvida
// acontece ("aluguel é Infraestrutura ou Administrativo?").
//
// "Aplicar aos iguais" mora dentro do modal, com o tamanho à vista ANTES de confirmar. Uma caixa
// solta na tela, ligada por padrão, é como dezenas de PIX QR-CODE para gente diferente viram uma coisa só.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { centroForaDoTotal, GRUPO_FORA_DO_TOTAL } from '@/lib/centroCusto'
import { cn } from '@/lib/utils'
import { contarIguaisSemCentro, type CostCenter, type CostDetail } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const normalizar = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

type Props = {
  centros: CostCenter[]
  /** Subclassificação por centro: "Salários e encargos" → para quem, "Benefícios" → qual. */
  detalhes?: CostDetail[]
  value: string | null
  /** O detalhe já escolhido, para o segundo passo abrir marcando o que está valendo. */
  valueDetalhe?: string | null
  onPick: (
    centro: CostCenter,
    opcoes: { aplicarIguais: boolean; detalhe: string | null },
  ) => void | Promise<void>
  /** O lançamento sendo classificado, para o modal dizer DO QUE se trata. */
  resumo?: { descricao: string; data?: string; amountCents?: number }
  /** Padrão de "aplicar aos iguais". `null` quando o lançamento não diz quem recebeu. */
  padrao?: string | null
  /** Oferece "aplicar aos iguais" (só saída do banco tem iguais). */
  permitirIguais?: boolean
  /** Lançamento que não entra na contagem dos iguais: ele mesmo. */
  excluirId?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  className?: string
}

export function CentroCustoPicker({
  centros,
  detalhes = [],
  value,
  valueDetalhe,
  onPick,
  resumo,
  padrao,
  permitirIguais = false,
  excluirId,
  size = 'default',
  disabled,
  className,
}: Props) {
  const [aberto, setAberto] = useState(false)
  // Segundo passo, no MESMO modal. Perguntar o detalhe numa coluna à parte seria uma segunda
  // passada na lista, e a segunda ninguém faz — pelo mesmo motivo a regra carimba os dois juntos.
  const [etapa, setEtapa] = useState<'centro' | 'detalhe'>('centro')
  const [escolhido, setEscolhido] = useState<{ centro: CostCenter; aplicarIguais: boolean } | null>(null)
  const [termoDetalhe, setTermoDetalhe] = useState('')
  const [termo, setTermo] = useState('')
  const [cursor, setCursor] = useState(0)
  const [iguais, setIguais] = useState<{ qtd: number; amountCents: number } | null>(null)
  const [aplicarIguais, setAplicarIguais] = useState(true)
  const listaRef = useRef<HTMLDivElement>(null)

  // Conta os iguais só quando o modal abre: contar para cada linha da tabela seria uma
  // consulta por lançamento sem ninguém ter pedido.
  useEffect(() => {
    if (!aberto || !permitirIguais || !padrao) return
    let vivo = true
    contarIguaisSemCentro(padrao, excluirId)
      .then((r) => vivo && setIguais(r))
      .catch(() => vivo && setIguais(null))
    return () => {
      vivo = false
    }
  }, [aberto, permitirIguais, padrao, excluirId])

  const filtrados = useMemo(() => {
    const q = normalizar(termo.trim())
    const base = centros.filter((c) => c.active)
    if (!q) return base
    return base.filter((c) => normalizar(`${c.name} ${c.description ?? ''} ${c.grupo ?? ''}`).includes(q))
  }, [centros, termo])

  // Grupos na ordem em que o primeiro centro de cada um aparece (a lista já vem por sort_order).
  const grupos = useMemo(() => {
    const m = new Map<string, CostCenter[]>()
    for (const c of filtrados) {
      const g = c.grupo || 'Outros centros'
      m.set(g, [...(m.get(g) ?? []), c])
    }
    return [...m.entries()]
  }, [filtrados])
  const plano = useMemo(() => grupos.flatMap(([, cs]) => cs), [grupos])

  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const escolher = (c: CostCenter) => {
    const comIguais = Boolean(permitirIguais && padrao && aplicarIguais && (iguais?.qtd ?? 0) > 0)
    setTermo('')
    setEscolhido({ centro: c, aplicarIguais: comIguais })
    setTermoDetalhe(value === c.name ? (valueDetalhe ?? '') : '')
    setEtapa('detalhe')
  }

  /** Fecha gravando. `detalhe` vazio é resposta legítima: o centro sozinho já classifica. */
  const concluir = (detalhe: string | null) => {
    if (!escolhido) return
    const { centro, aplicarIguais: comIguais } = escolhido
    setAberto(false)
    setEtapa('centro')
    setEscolhido(null)
    setTermoDetalhe('')
    void onPick(centro, { aplicarIguais: comIguais, detalhe: detalhe?.trim() || null })
  }

  const detalhesDoCentro = useMemo(() => {
    if (!escolhido) return []
    const q = normalizar(termoDetalhe.trim())
    const base = detalhes.filter((d) => normalizar(d.costCenter) === normalizar(escolhido.centro.name))
    if (!q) return base
    return base.filter((d) => normalizar(d.name).includes(q))
  }, [detalhes, escolhido, termoDetalhe])

  /** Digitou algo que ainda não existe: vira detalhe novo, criado ao classificar. */
  const detalheNovo = useMemo(() => {
    const t = termoDetalhe.trim()
    if (t.length < 2) return null
    return detalhesDoCentro.some((d) => normalizar(d.name) === normalizar(t)) ? null : t
  }, [termoDetalhe, detalhesDoCentro])

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, plano.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && plano[cursor]) {
      e.preventDefault()
      escolher(plano[cursor])
    }
  }

  const fora = centroForaDoTotal(centros, value)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={(e) => {
          // Dentro de linha clicável da tabela: abrir o seletor não pode abrir o editor junto.
          e.stopPropagation()
          setCursor(0)
          setAberto(true)
        }}
        className={cn(
          'min-w-0 justify-between gap-1.5 font-normal',
          size === 'sm' && 'h-7 px-2 text-xs',
          !value && 'border-dashed border-amber-500/60 text-amber-700 dark:text-amber-400',
          fora && 'text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{value ?? 'Classificar'}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
      </Button>

      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v)
          // Fechar no meio do caminho não grava nada: o centro sem o "em quê" seria uma escolha
          // que o usuário não confirmou.
          if (!v) {
            setEtapa('centro')
            setEscolhido(null)
            setTermoDetalhe('')
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {etapa === 'centro' ? 'Centro de custo' : `${escolhido?.centro.name}: em quê?`}
            </DialogTitle>
            {resumo ? (
              <DialogDescription className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-foreground">{resumo.descricao}</span>
                {resumo.data ? <span>{new Date(`${resumo.data}T12:00:00`).toLocaleDateString('pt-BR')}</span> : null}
                {resumo.amountCents != null ? <span className="tabular-nums">{brl(resumo.amountCents)}</span> : null}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          {etapa === 'centro' ? (
          <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={termo}
              onChange={(e) => {
                setTermo(e.target.value)
                setCursor(0)
              }}
              onKeyDown={teclado}
              placeholder="Buscar: aluguel, médico, imposto…"
              aria-label="Buscar centro de custo"
              className="h-10 pl-9"
            />
          </div>

          <div ref={listaRef} className="max-h-[46vh] overflow-y-auto rounded-md border border-border">
            {plano.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum centro com esse nome. Crie em Fechamento › Configuração.
              </p>
            ) : (
              grupos.map(([grupo, cs]) => (
                <div key={grupo}>
                  <div className="sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    {grupo}
                    {grupo === GRUPO_FORA_DO_TOTAL ? ' · fica fora do total' : ''}
                  </div>
                  {cs.map((c) => {
                    const idx = plano.indexOf(c)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        data-idx={idx}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => escolher(c)}
                        className={cn(
                          'flex w-full items-start justify-between gap-3 border-b border-border/50 px-3 py-2 text-left last:border-0',
                          idx === cursor && 'bg-muted',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{c.name}</span>
                          {c.description ? (
                            <span className="block text-xs text-muted-foreground">{c.description}</span>
                          ) : null}
                        </span>
                        {value === c.name ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {permitirIguais ? (
            padrao ? (
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-xs',
                  (iguais?.qtd ?? 0) === 0 && 'cursor-default opacity-70',
                )}
              >
                <Checkbox
                  checked={aplicarIguais && (iguais?.qtd ?? 0) > 0}
                  disabled={(iguais?.qtd ?? 0) === 0}
                  onCheckedChange={() => setAplicarIguais((v) => !v)}
                  className="mt-0.5"
                />
                <span>
                  <span className="flex items-center gap-1 font-medium">
                    <Wand2 className="size-3.5" /> Aplicar também aos iguais
                  </span>
                  <span className="text-muted-foreground">
                    {iguais == null
                      ? `Contando lançamentos com “${padrao}”…`
                      : iguais.qtd === 0
                        ? `Nenhum outro lançamento com “${padrao}” sem centro. Os próximos que chegarem do banco já entram classificados.`
                        : `${iguais.qtd} lançamento(s) com “${padrao}” sem centro, ${brl(iguais.amountCents)}. Os próximos que chegarem do banco também.`}
                  </span>
                </span>
              </label>
            ) : (
              <p className="rounded-md border border-border p-2.5 text-xs text-muted-foreground">
                Este lançamento não diz quem recebeu (PIX QR-CODE, transferência, pagamento em lote), então
                classifica só ele.
              </p>
            )
          ) : null}
          </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                O centro diz onde o dinheiro foi. Aqui é em quê — e é isto que faz o relatório
                responder mais que “{escolhido?.centro.name}”.
                {escolhido?.aplicarIguais ? ' Vale também para os iguais.' : ''}
              </p>

              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  autoFocus
                  value={termoDetalhe}
                  onChange={(e) => setTermoDetalhe(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      // Enter com um nome só na lista escolhe ele; com nome novo, cria.
                      concluir(detalhesDoCentro.length === 1 ? detalhesDoCentro[0].name : termoDetalhe)
                    }
                  }}
                  placeholder="Buscar ou escrever um novo: VT, Dra Lorena, Oxigênio…"
                  aria-label="Buscar subclassificação"
                  className="h-10 pl-9"
                />
              </div>

              <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border">
                {detalheNovo ? (
                  <button
                    type="button"
                    onClick={() => concluir(detalheNovo)}
                    className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <Wand2 className="size-3.5 shrink-0 text-primary" aria-hidden />
                    <span>
                      Usar <span className="font-medium">{detalheNovo}</span>
                      <span className="text-muted-foreground"> · entra na lista deste centro</span>
                    </span>
                  </button>
                ) : null}
                {detalhesDoCentro.length === 0 && !detalheNovo ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    Este centro ainda não tem subclassificação. Escreva a primeira acima.
                  </p>
                ) : (
                  detalhesDoCentro.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => concluir(d.name)}
                      className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
                    >
                      <span className="min-w-0 truncate">{d.name}</span>
                      {valueDetalhe === d.name ? <Check className="size-4 shrink-0 text-primary" /> : null}
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEtapa('centro')}>
                  Trocar o centro
                </Button>
                {/* Sair sem detalhe tem que ser fácil: o centro sozinho já é uma classificação
                    válida, e um passo obrigatório faria voltar a não classificar nada. */}
                <Button type="button" variant="outline" size="sm" onClick={() => concluir(null)}>
                  Salvar sem detalhar
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
