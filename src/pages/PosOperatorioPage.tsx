import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CalendarHeart, PhoneCall, ShoppingBag, Stethoscope, UserX } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AppLayout } from '@/layouts/AppLayout'
import { mesAtual, rotuloDoMes } from '@/lib/periodo'
import { cn } from '@/lib/utils'
import {
  SITUACAO_LABEL,
  aniversarioDaCirurgia,
  filtrarPosOp,
  listarPosOperatorio,
  resumoPosOp,
  type FiltroPosOp,
  type MarcoRetorno,
  type PacientePosOp,
} from '@/services/posOperatorio'

/**
 * Pós-operatório — o acompanhamento que acabava no dia da alta.
 *
 * A clínica sabia quem operou (sala), quem voltou (Shosp) e quem comprou produto
 * (loja), em três lugares que nunca se olharam. Aqui vira uma fila de trabalho:
 * quem está devendo retorno, há quanto tempo, e quem faz um ano no mês que vem.
 *
 * O que a tela NÃO faz de propósito: acusar de falta quem não tem prontuário. Sem
 * prontuário não há como perguntar à Shosp se a pessoa voltou, então ela vai para o
 * balde "sem cadastro" — que é problema de vínculo, e tem tela própria.
 */

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const dataCurta = (iso: string | null) =>
  iso ? iso.split('-').reverse().join('/') : '—'

const CORES: Record<MarcoRetorno['situacao'], string> = {
  veio: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  agendado: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  nao_veio: 'bg-destructive/15 text-destructive',
  aguardando: 'bg-muted text-muted-foreground',
  sem_vinculo: 'bg-muted text-muted-foreground/60',
}

/** A régua de marcos de um paciente, em seis quadradinhos legíveis de longe. */
function Regua({ marcos }: { marcos: MarcoRetorno[] }) {
  return (
    <div className="flex gap-1">
      {marcos.map((m) => (
        <span
          key={m.ordem}
          title={`${m.marco}: ${SITUACAO_LABEL[m.situacao]}${
            m.veio_em ? ` em ${dataCurta(m.veio_em)}` : m.agendado_para ? ` para ${dataCurta(m.agendado_para)}` : ''
          } · previsto ${dataCurta(m.previsto)}`}
          className={cn('inline-block h-4 w-4 rounded-sm', CORES[m.situacao])}
          aria-label={`${m.marco}: ${SITUACAO_LABEL[m.situacao]}`}
        />
      ))}
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  loading,
  accent,
  onClick,
  ativo,
}: {
  label: string
  value: string | number
  sub?: string
  icon: typeof PhoneCall
  loading?: boolean
  accent?: string
  onClick?: () => void
  ativo?: boolean
}) {
  const conteudo = (
    <>
      <div className="absolute top-0 right-0 p-4 opacity-[0.05]" aria-hidden>
        <Icon className="size-14" />
      </div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1.5">
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <span className={cn('text-3xl font-semibold tracking-tighter tabular-nums', accent ?? 'text-foreground')}>
            {value}
          </span>
        )}
      </div>
      {sub ? <p className="mt-1 text-[12px] font-medium text-muted-foreground/70">{loading ? ' ' : sub}</p> : null}
    </>
  )
  const classe = cn(
    'relative overflow-hidden rounded-xl border border-border/40 bg-card/60 p-5 text-left',
    ativo && 'ring-2 ring-primary bg-primary/5',
  )
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={ativo} className={cn(classe, 'cursor-pointer hover:bg-muted/40')}>
      {conteudo}
    </button>
  ) : (
    <div className={classe}>{conteudo}</div>
  )
}

export function PosOperatorioPage() {
  const [lista, setLista] = useState<PacientePosOp[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroPosOp>('devendo')
  const [mesAniversario, setMesAniversario] = useState(() => mesAtual())
  const [termo, setTermo] = useState('')
  const buscaAdiada = useDeferredValue(termo)

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    setErro(null)
    listarPosOperatorio(400)
      .then((r) => !cancelado && setLista(r))
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : 'Falha ao carregar o pós-operatório.'))
      .finally(() => !cancelado && setLoading(false))
    return () => {
      cancelado = true
    }
  }, [])

  const resumo = useMemo(() => resumoPosOp(lista), [lista])
  const filtrada = useMemo(
    () => filtrarPosOp(lista, filtro, mesAniversario, buscaAdiada),
    [lista, filtro, mesAniversario, buscaAdiada],
  )

  const alternar = (alvo: FiltroPosOp) => setFiltro((a) => (a === alvo ? 'todos' : alvo))

  // Aniversário de 1 ano só passa a existir em nov/2026: a cirurgia mais antiga
  // registrada é de 17/11/2025. Sem dizer isso, "0 no mês" é lido como "em dia".
  const nenhumFazUmAno = useMemo(
    () => lista.length > 0 && lista.every((p) => aniversarioDaCirurgia(p.dia) > `${mesAniversario}-31`),
    [lista, mesAniversario],
  )

  return (
    <AppLayout
      title="Pós-operatório"
      subtitle="Quem operou, quem voltou, quem sumiu — e quem já comprou produto depois da cirurgia."
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Devendo retorno"
            value={resumo.devendo}
            sub="marco vencido sem consulta · clique para filtrar"
            icon={PhoneCall}
            loading={loading}
            accent="text-destructive"
            onClick={() => alternar('devendo')}
            ativo={filtro === 'devendo'}
          />
          <Kpi
            label="Comparecimento"
            value={resumo.comparecimentoPct == null ? '—' : `${resumo.comparecimentoPct}%`}
            sub={`${resumo.feitos} retornos feitos · ${resumo.perdidos} perdidos`}
            icon={Stethoscope}
            loading={loading}
          />
          <Kpi
            label="Compraram produto"
            value={resumo.compraram}
            sub={`${brl(resumo.receitaProdutoCents)} · ${resumo.pacientes - resumo.compraram} nunca compraram`}
            icon={ShoppingBag}
            loading={loading}
            onClick={() => alternar('sem-produto')}
            ativo={filtro === 'sem-produto'}
          />
          <Kpi
            label="Sem prontuário"
            value={resumo.semProntuario}
            sub="não dá para conferir retorno · clique para ver"
            icon={UserX}
            loading={loading}
            accent={resumo.semProntuario > 0 ? 'text-amber-600' : undefined}
            onClick={() => alternar('sem-prontuario')}
            ativo={filtro === 'sem-prontuario'}
          />
        </div>

        {erro ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : null}

        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-sm">
                {filtro === 'devendo'
                  ? 'Pacientes devendo retorno'
                  : filtro === 'aniversario'
                    ? `Fazem 1 ano de cirurgia em ${rotuloDoMes(mesAniversario)}`
                    : filtro === 'sem-produto'
                      ? 'Operados que nunca compraram produto'
                      : filtro === 'sem-prontuario'
                        ? 'Operados sem prontuário vinculado'
                        : 'Todos os operados'}{' '}
                <span className="font-normal text-muted-foreground">({filtrada.length})</span>
              </CardTitle>
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  size="sm"
                  variant={filtro === 'aniversario' ? 'default' : 'outline'}
                  aria-pressed={filtro === 'aniversario'}
                  onClick={() => alternar('aniversario')}
                >
                  <CalendarHeart className="size-3.5" aria-hidden /> Faz 1 ano
                </Button>
                {filtro === 'aniversario' ? (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="po-mes" className="text-[11px] text-muted-foreground">
                      Mês do aniversário
                    </Label>
                    <Input
                      id="po-mes"
                      type="month"
                      value={mesAniversario}
                      onChange={(e) => e.target.value && setMesAniversario(e.target.value)}
                      className="h-8 w-[150px]"
                    />
                  </div>
                ) : null}
                <Button size="sm" variant={filtro === 'todos' ? 'default' : 'ghost'} onClick={() => setFiltro('todos')}>
                  Todos
                </Button>
              </div>
            </div>

            <SearchField
              value={termo}
              onChange={setTermo}
              label="Buscar paciente"
              placeholder="Nome, telefone, prontuário, procedimento…"
              resultados={filtrada.length}
              className="w-full sm:max-w-sm"
            />

            {filtro === 'aniversario' && nenhumFazUmAno ? (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
                Nenhum paciente faz um ano em {rotuloDoMes(mesAniversario)} — e isso não quer dizer que está tudo em dia:
                a cirurgia mais antiga registrada no sistema é de novembro de 2025, então o primeiro aniversário só cai
                em novembro de 2026. Antes disso esta lista é legitimamente vazia.
              </p>
            ) : null}
          </CardHeader>

          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : filtrada.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Nenhum paciente neste recorte.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Paciente</TableHead>
                      <TableHead className="pb-2">Cirurgia</TableHead>
                      <TableHead className="pb-2">Retornos</TableHead>
                      <TableHead className="pb-2">Devendo</TableHead>
                      <TableHead className="hidden pb-2 lg:table-cell">Faz 1 ano</TableHead>
                      <TableHead className="pb-2 text-right">Produto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtrada.map((p) => (
                      <TableRow key={`${p.surgery_id ?? 's'}-${p.sale_id ?? p.dia}`} className="border-t border-border/20">
                        <TableCell className="py-1.5">
                          <span className="font-medium">{p.paciente ?? 'Sem nome'}</span>
                          {p.telefone ? (
                            <span className="block text-[11px] text-muted-foreground">{p.telefone}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-1.5 whitespace-nowrap">
                          {dataCurta(p.dia)}
                          <span className="block text-[11px] text-muted-foreground">
                            há {p.dias_desde} {p.dias_desde === 1 ? 'dia' : 'dias'}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Regua marcos={p.marcos} />
                        </TableCell>
                        <TableCell className="py-1.5">
                          {p.prontuario == null ? (
                            <span className="text-muted-foreground">sem prontuário</span>
                          ) : p.marco_devendo ? (
                            <span className="font-medium text-destructive">
                              {p.marco_devendo}
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                vencido há {p.vencido_ha} dias
                              </span>
                            </span>
                          ) : (
                            <span className="text-emerald-600">em dia</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden py-1.5 whitespace-nowrap lg:table-cell">
                          {dataCurta(aniversarioDaCirurgia(p.dia))}
                        </TableCell>
                        <TableCell className="py-1.5 text-right">
                          {p.comprou_produto ? (
                            <Badge variant="secondary" title={`Última compra em ${dataCurta(p.ultima_compra)}`}>
                              {brl(p.produto_cents)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">nunca comprou</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
              <span className="font-medium">Régua de retornos:</span>
              {(['veio', 'agendado', 'nao_veio', 'aguardando', 'sem_vinculo'] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <span className={cn('inline-block h-3 w-3 rounded-sm', CORES[s])} aria-hidden />
                  {SITUACAO_LABEL[s]}
                </span>
              ))}
              <span className="w-full">
                Curativo/1ª lavagem · 15 dias · 1 mês · 3 meses · 6 meses · 1 ano. As janelas saíram da distribuição real
                das consultas depois da cirurgia, não de um calendário ideal.
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-sm">De onde vem cada coluna</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <span className="font-semibold text-foreground">Cirurgia</span> vem do sistema do centro cirúrgico; quando
              a sala não registrou, vem da data marcada na venda.
            </p>
            <p>
              <span className="font-semibold text-foreground">Retornos</span> vêm da agenda da Shosp. Como a Shosp não
              tem status "atendido", conta como comparecimento a consulta cuja data já passou e que não foi desmarcada
              nem marcada como falta.
            </p>
            <p>
              <span className="font-semibold text-foreground">Produto</span> vem dos pagamentos confirmados na loja,
              casados por telefone (DDD + 8 dígitos finais, para o 9º dígito não separar a mesma pessoa em duas).
            </p>
            <p>
              <span className="font-semibold text-foreground">{resumo.semProntuario} pacientes sem prontuário</span> não
              têm como ser conferidos na agenda: eles aparecem em cinza na régua e ficam fora da taxa de comparecimento.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
