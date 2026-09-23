import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, ChevronDown, FlaskConical, PackageSearch, Printer, Settings2, Trash2, X } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { imprimirHtml } from '@/lib/exportar'
import { type TamanhoEtiqueta, folhaDeEtiquetas, guardarTamanhoEtiqueta, lerTamanhoEtiqueta } from '@/lib/etiquetaCme'
import { cn } from '@/lib/utils'
import {
  type Autoclave,
  type CicloCme,
  type Colaborador,
  type MaterialCme,
  type PacoteCme,
  SITUACAO_PACOTE,
  abrirCiclo,
  acharPacote,
  adicionarColaborador,
  listarAutoclaves,
  listarCiclos,
  listarColaboradores,
  listarMateriais,
  listarPacotesDoCiclo,
  listarPacotesVencendo,
  proximosNumeros,
  registrarResultado,
  retirarColaborador,
  retirarPacote,
  salvarMaterial,
} from '@/services/cme'

// /cme: esterilização. Abrir o ciclo já imprime as etiquetas (a etiqueta vai no pacote antes da
// autoclave); o resultado do ciclo libera ou bloqueia os pacotes; na montagem do kit o pacote é
// bipado e fica ligado ao paciente.

type Aba = 'ciclos' | 'pacotes' | 'cadastro'
const ABAS: Aba[] = ['ciclos', 'pacotes', 'cadastro']

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const data = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR')

const STATUS_CICLO: Record<CicloCme['status'], { rotulo: string; classe: string }> = {
  aberto: { rotulo: 'Aguardando resultado', classe: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  aprovado: { rotulo: 'Aprovado', classe: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  reprovado: { rotulo: 'Reprovado', classe: 'bg-red-500/15 text-red-700 dark:text-red-300' },
}

function imprimirPacotes(pacotes: PacoteCme[]) {
  if (pacotes.length === 0) {
    toast.error('Nenhum pacote para imprimir.')
    return
  }
  try {
    imprimirHtml(folhaDeEtiquetas(pacotes, lerTamanhoEtiqueta()))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha ao imprimir')
  }
}

/** Colaborador escolhido numa lista (o login é compartilhado: quem preparou é escolhido). */
function EscolherColaborador({
  id,
  valor,
  onChange,
  colaboradores,
}: {
  id: string
  valor: string
  onChange: (nome: string) => void
  colaboradores: Colaborador[]
}) {
  if (colaboradores.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum colaborador cadastrado. Cadastre na aba <b>Cadastro</b>.
      </p>
    )
  }
  return (
    <Select value={valor} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger id={id} className="h-10 w-full">
        <span className={cn('truncate', !valor && 'text-muted-foreground')}>{valor || 'Escolha o colaborador'}</span>
      </SelectTrigger>
      <SelectContent>
        {colaboradores.map((c) => (
          <SelectItem key={c.id} value={c.nome}>
            {c.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function NovoCiclo({
  autoclaves,
  colaboradores,
  materiais,
  onAberto,
}: {
  autoclaves: Autoclave[]
  colaboradores: Colaborador[]
  materiais: MaterialCme[]
  onAberto: () => void
}) {
  const [autoclave, setAutoclave] = useState('')
  const [numero, setNumero] = useState('')
  const [sugestoes, setSugestoes] = useState<Map<string, number>>(new Map())
  const [responsavel, setResponsavel] = useState('')
  const [qtd, setQtd] = useState<Record<string, number>>({})
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    void proximosNumeros().then(setSugestoes).catch(() => setSugestoes(new Map()))
  }, [])

  const sugerido = autoclave ? (sugestoes.get(autoclave) ?? 1) : null
  const total = Object.values(qtd).reduce((s, n) => s + n, 0)

  const abrir = async () => {
    if (!autoclave) return toast.error('Escolha a autoclave: 1 ou 2.')
    if (!responsavel) return toast.error('Escolha quem preparou os pacotes.')
    if (total === 0) return toast.error('Coloque a quantidade de pacotes de ao menos um material.')
    const n = numero.trim() ? Number(numero) : null
    if (n != null && !(Number.isInteger(n) && n > 0)) return toast.error('O número do ciclo é um número inteiro.')
    setSalvando(true)
    try {
      const cicloId = await abrirCiclo({
        autoclaveId: autoclave,
        numero: n,
        responsavel,
        itens: Object.entries(qtd).map(([materialId, q]) => ({ materialId, qtd: q })),
      })
      const pacotes = await listarPacotesDoCiclo(cicloId)
      toast.success(`Ciclo aberto com ${pacotes.length} ${pacotes.length === 1 ? 'pacote' : 'pacotes'}. Cole as etiquetas antes de colocar na autoclave.`)
      imprimirPacotes(pacotes)
      setQtd({})
      setNumero('')
      onAberto()
      setSugestoes(await proximosNumeros())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir o ciclo')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Novo ciclo</h2>
      <div className="space-y-1.5">
        <Label>Autoclave</Label>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Autoclave">
          {autoclaves.map((a) => (
            <Button
              key={a.id}
              type="button"
              variant={autoclave === a.id ? 'default' : 'outline'}
              className="h-12 text-base"
              aria-pressed={autoclave === a.id}
              onClick={() => setAutoclave(a.id)}
            >
              {a.nome}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cme-numero">Número do ciclo</Label>
          <Input
            id="cme-numero"
            inputMode="numeric"
            value={numero}
            onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))}
            placeholder={sugerido ? `${sugerido} (o seguinte)` : 'Escolha a autoclave'}
            className="h-10"
          />
          <p className="text-xs text-muted-foreground">Deixe vazio para usar o seguinte. Se a autoclave mostra outro número, digite o dela.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cme-resp">Quem preparou</Label>
          <EscolherColaborador id="cme-resp" valor={responsavel} onChange={setResponsavel} colaboradores={colaboradores} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Pacotes que entram no ciclo</Label>
        {materiais.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum material cadastrado. Cadastre as caixas e instrumentais na aba <b>Cadastro</b>.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {materiais.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{m.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[m.embalagem, `validade ${m.validadeDias} dias`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <QtyStepper value={qtd[m.id] ?? 0} label={`pacotes de ${m.nome}`} onChange={(n) => setQtd((s) => ({ ...s, [m.id]: n }))} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button className="h-11 w-full text-base" onClick={() => void abrir()} disabled={salvando}>
        <Printer className="size-4" aria-hidden />
        {salvando ? 'Abrindo…' : `Abrir ciclo e imprimir ${total > 0 ? `${total} ${total === 1 ? 'etiqueta' : 'etiquetas'}` : 'etiquetas'}`}
      </Button>
    </section>
  )
}

function ResultadoDoCiclo({ ciclo, colaboradores, onPronto }: { ciclo: CicloCme; colaboradores: Colaborador[]; onPronto: () => void }) {
  const [aprovado, setAprovado] = useState<boolean | null>(null)
  const [quimico, setQuimico] = useState('')
  const [biologico, setBiologico] = useState('')
  const [por, setPor] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    if (aprovado == null) return toast.error('Marque se o ciclo foi aprovado ou reprovado.')
    setSalvando(true)
    try {
      await registrarResultado({ cicloId: ciclo.id, aprovado, quimico, biologico, por, observacao: obs })
      toast.success(aprovado ? `Ciclo ${ciclo.lote} aprovado: os pacotes estão liberados.` : `Ciclo ${ciclo.lote} reprovado: os pacotes estão bloqueados.`)
      onPronto()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2">
        <Button variant={aprovado === true ? 'default' : 'outline'} className="h-11" onClick={() => setAprovado(true)}>
          <Check className="size-4" aria-hidden /> Aprovado
        </Button>
        <Button
          variant={aprovado === false ? 'destructive' : 'outline'}
          className="h-11"
          onClick={() => setAprovado(false)}
        >
          <X className="size-4" aria-hidden /> Reprovado
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`q-${ciclo.id}`}>Indicador químico</Label>
          <Input id={`q-${ciclo.id}`} value={quimico} onChange={(e) => setQuimico(e.target.value)} placeholder="Ex.: integrador classe 5 virou" className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`b-${ciclo.id}`}>Indicador biológico (se teve)</Label>
          <Input id={`b-${ciclo.id}`} value={biologico} onChange={(e) => setBiologico(e.target.value)} placeholder="Ex.: negativo" className="h-10" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`p-${ciclo.id}`}>Quem liberou</Label>
        <EscolherColaborador id={`p-${ciclo.id}`} valor={por} onChange={setPor} colaboradores={colaboradores} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`o-${ciclo.id}`}>{aprovado === false ? 'Motivo da reprovação' : 'Observação (opcional)'}</Label>
        <Textarea id={`o-${ciclo.id}`} value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
      </div>
      <Button className="h-10 w-full" onClick={() => void salvar()} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Registrar resultado'}
      </Button>
    </div>
  )
}

function CartaoCiclo({ ciclo, colaboradores, onMudou }: { ciclo: CicloCme; colaboradores: Colaborador[]; onMudou: () => void }) {
  const [aberto, setAberto] = useState<'pacotes' | 'resultado' | null>(null)
  const [pacotes, setPacotes] = useState<PacoteCme[] | null>(null)
  const st = STATUS_CICLO[ciclo.status]

  const carregarPacotes = useCallback(async () => {
    const lista = await listarPacotesDoCiclo(ciclo.id)
    setPacotes(lista)
    return lista
  }, [ciclo.id])

  useEffect(() => {
    if (aberto === 'pacotes' && pacotes == null) void carregarPacotes().catch(() => setPacotes([]))
  }, [aberto, pacotes, carregarPacotes])

  const reimprimir = async () => {
    try {
      imprimirPacotes((await carregarPacotes()).filter((p) => !p.usadoEm && !p.descartadoEm))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar os pacotes')
    }
  }

  const usados = (pacotes ?? []).filter((p) => p.paciente)

  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 p-3 sm:p-4">
        <div className="min-w-0">
          <p className="font-semibold">
            Lote {ciclo.lote} <span className="font-normal text-muted-foreground">· {ciclo.autoclave}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {dataHora(ciclo.iniciadoEm)} · {ciclo.pacotes} {ciclo.pacotes === 1 ? 'pacote' : 'pacotes'} · preparo: {ciclo.responsavel}
          </p>
          {ciclo.resultadoPor ? (
            <p className="text-xs text-muted-foreground">
              Resultado por {ciclo.resultadoPor}
              {ciclo.indicadorQuimico ? ` · químico: ${ciclo.indicadorQuimico}` : ''}
              {ciclo.indicadorBiologico ? ` · biológico: ${ciclo.indicadorBiologico}` : ''}
              {ciclo.observacao ? ` · ${ciclo.observacao}` : ''}
            </p>
          ) : null}
        </div>
        <Badge variant="secondary" className={st.classe}>
          {st.rotulo}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2 sm:px-4">
        {ciclo.status === 'aberto' ? (
          <Button size="sm" className="h-8" onClick={() => setAberto(aberto === 'resultado' ? null : 'resultado')}>
            <FlaskConical className="size-4" aria-hidden /> Registrar resultado
          </Button>
        ) : null}
        {ciclo.status !== 'reprovado' ? (
          <Button size="sm" variant="outline" className="h-8" onClick={() => void reimprimir()}>
            <Printer className="size-4" aria-hidden /> Imprimir etiquetas
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto h-8 text-muted-foreground" onClick={() => setAberto(aberto === 'pacotes' ? null : 'pacotes')}>
          {aberto === 'pacotes' ? 'Esconder pacotes' : 'Ver pacotes'}
          <ChevronDown className={cn('size-4 transition-transform', aberto === 'pacotes' && 'rotate-180')} aria-hidden />
        </Button>
      </div>
      {aberto === 'resultado' ? (
        <ResultadoDoCiclo
          ciclo={ciclo}
          colaboradores={colaboradores}
          onPronto={() => {
            setAberto(null)
            onMudou()
          }}
        />
      ) : null}
      {aberto === 'pacotes' ? (
        <div className="border-t border-border text-sm">
          {ciclo.status === 'reprovado' && usados.length > 0 ? (
            <p className="bg-red-500/10 px-4 py-2 text-red-700 dark:text-red-300">
              Pacientes que receberam pacotes deste ciclo: {[...new Set(usados.map((p) => p.paciente))].join(', ')}
            </p>
          ) : null}
          {pacotes == null ? (
            <p className="px-4 py-3 text-muted-foreground">Carregando…</p>
          ) : (
            <ul className="divide-y divide-border">
              {pacotes.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span className="min-w-0">
                    <span className="block font-medium">{p.materialNome}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {p.codigo} · validade {data(p.validade)}
                    </span>
                  </span>
                  <span className={cn('text-xs', SITUACAO_PACOTE[p.situacao].bom ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>
                    {p.paciente ? `Usado em ${p.paciente}` : SITUACAO_PACOTE[p.situacao].rotulo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  )
}

function AbaPacotes() {
  const [pacote, setPacote] = useState<PacoteCme | null>(null)
  const [naoAchou, setNaoAchou] = useState<string | null>(null)
  const [ultima, setUltima] = useState<string | null>(null)
  const [vencendo, setVencendo] = useState<PacoteCme[] | null>(null)

  const carregarVencendo = useCallback(() => {
    void listarPacotesVencendo(7).then(setVencendo).catch(() => setVencendo([]))
  }, [])
  useEffect(carregarVencendo, [carregarVencendo])

  const consultar = async (codigo: string) => {
    setUltima(codigo)
    try {
      const p = await acharPacote(codigo)
      setPacote(p)
      setNaoAchou(p ? null : codigo)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao consultar')
    }
  }

  const retirar = async (p: PacoteCme) => {
    try {
      await retirarPacote(p.codigo, p.situacao === 'vencido' ? 'Vencido: reprocessar' : 'Retirado para reprocessar')
      toast.success(`${p.materialNome} retirado. Reprocesse e coloque num ciclo novo.`)
      if (pacote?.id === p.id) setPacote(await acharPacote(p.codigo))
      carregarVencendo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao retirar')
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Consultar um pacote</h2>
        <ScanBar onCode={(c) => void consultar(c)} ultimaLeitura={ultima} placeholder="Bipe a etiqueta ou digite o código" />
        {naoAchou ? <p className="text-sm text-destructive">Nenhum pacote da CME com o código {naoAchou}.</p> : null}
        {pacote ? (
          <div className="space-y-1 rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-base font-semibold">{pacote.materialNome}</p>
              <Badge variant="secondary" className={SITUACAO_PACOTE[pacote.situacao].bom ? STATUS_CICLO.aprovado.classe : STATUS_CICLO.aberto.classe}>
                {SITUACAO_PACOTE[pacote.situacao].rotulo}
              </Badge>
            </div>
            <p>Lote {pacote.lote} · {pacote.autoclave} · {pacote.metodo}</p>
            <p>Esterilizado em {dataHora(pacote.esterilizadoEm)} · validade {data(pacote.validade)}</p>
            <p>Preparo: {pacote.responsavel}</p>
            {pacote.paciente ? (
              <p>
                Usado em <b>{pacote.paciente}</b>
                {pacote.usadoEm ? ` em ${dataHora(pacote.usadoEm)}` : ''}
                {pacote.kitId ? (
                  <>
                    {' '}
                    · <Link className="underline" to={`/kits/${pacote.kitId}/editar`}>abrir kit</Link>
                  </>
                ) : null}
              </p>
            ) : null}
            {!pacote.usadoEm && !pacote.descartadoEm ? (
              <Button size="sm" variant="outline" className="mt-2 h-8" onClick={() => void retirar(pacote)}>
                <Trash2 className="size-4" aria-hidden /> Retirar para reprocessar
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Vencidos ou vencendo em 7 dias</h2>
        {vencendo == null ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : vencendo.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum pacote na prateleira vence nos próximos 7 dias.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {vencendo.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{p.materialNome}</span>
                  <span className="block text-xs text-muted-foreground">
                    Lote {p.lote} · {p.codigo}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={cn('text-xs', p.situacao === 'vencido' ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                    {p.situacao === 'vencido' ? 'venceu' : 'vence'} {data(p.validade)}
                  </span>
                  <Button size="sm" variant="outline" className="h-8" onClick={() => void retirar(p)}>
                    Retirar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AbaCadastro({
  materiais,
  colaboradores,
  autoclaves,
  onMudou,
}: {
  materiais: MaterialCme[]
  colaboradores: Colaborador[]
  autoclaves: Autoclave[]
  onMudou: () => void
}) {
  const [editando, setEditando] = useState<{ id?: string; nome: string; embalagem: string; validade: string } | null>(null)
  const [novoColab, setNovoColab] = useState('')
  const [tamanho, setTamanho] = useState<TamanhoEtiqueta>(lerTamanhoEtiqueta)

  const salvarMat = async () => {
    if (!editando) return
    try {
      await salvarMaterial({ id: editando.id, nome: editando.nome, embalagem: editando.embalagem, validadeDias: Number(editando.validade) })
      toast.success('Material salvo.')
      setEditando(null)
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    }
  }

  const retirarMat = async (m: MaterialCme) => {
    try {
      await salvarMaterial({ id: m.id, nome: m.nome, embalagem: m.embalagem ?? '', validadeDias: m.validadeDias, ativo: false })
      toast.success(`${m.nome} saiu da lista. Os pacotes já feitos continuam no histórico.`)
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao retirar')
    }
  }

  const addColab = async () => {
    try {
      await adicionarColaborador(novoColab)
      setNovoColab('')
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    }
  }

  const testarEtiqueta = () => {
    guardarTamanhoEtiqueta(tamanho)
    try {
      imprimirHtml(
        folhaDeEtiquetas(
          [
            {
              codigo: '2900000000018',
              materialNome: 'ETIQUETA DE TESTE',
              lote: 'AC1-0000',
              autoclave: autoclaves[0]?.nome ?? 'Autoclave 1',
              metodo: autoclaves[0]?.metodo ?? 'Vapor saturado sob pressão',
              esterilizadoEm: new Date().toISOString(),
              validade: new Date().toLocaleDateString('sv-SE'),
              responsavel: colaboradores[0]?.nome ?? 'Nome do colaborador',
            },
          ],
          tamanho,
        ),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao imprimir')
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Materiais da CME</h2>
          <Button size="sm" onClick={() => setEditando({ nome: '', embalagem: '', validade: '30' })}>
            Novo material
          </Button>
        </div>
        {editando ? (
          <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_12rem_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="mat-nome">Nome</Label>
              <Input id="mat-nome" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} placeholder="Ex.: Caixa Transplante 1" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mat-emb">Embalagem</Label>
              <Input id="mat-emb" value={editando.embalagem} onChange={(e) => setEditando({ ...editando, embalagem: e.target.value })} placeholder="Ex.: Grau cirúrgico" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mat-val">Validade (dias)</Label>
              <Input id="mat-val" inputMode="numeric" value={editando.validade} onChange={(e) => setEditando({ ...editando, validade: e.target.value.replace(/\D/g, '') })} className="h-10" />
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <Button onClick={() => void salvarMat()}>Salvar material</Button>
              <Button variant="outline" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
        {materiais.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Cadastre cada caixa ou instrumental que passa pela autoclave, com a embalagem e a validade que vocês usam.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {materiais.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{m.nome}</span>
                  <span className="block text-xs text-muted-foreground">{[m.embalagem, `validade ${m.validadeDias} dias`].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setEditando({ id: m.id, nome: m.nome, embalagem: m.embalagem ?? '', validade: String(m.validadeDias) })}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => void retirarMat(m)}>
                    Tirar da lista
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Colaboradores da CME</h2>
        <p className="text-sm text-muted-foreground">Quem aparece como responsável pelo preparo na etiqueta e quem libera o ciclo.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addColab()
          }}
        >
          <Input value={novoColab} onChange={(e) => setNovoColab(e.target.value)} placeholder="Nome como vai sair na etiqueta" aria-label="Nome do colaborador" className="h-10" />
          <Button type="submit" className="h-10">
            Incluir
          </Button>
        </form>
        {colaboradores.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {colaboradores.map((c) => (
              <li key={c.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-sm">
                {c.nome}
                <button
                  type="button"
                  aria-label={`Tirar ${c.nome}`}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => void retirarColaborador(c.id).then(onMudou)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Etiqueta</h2>
        <p className="text-sm text-muted-foreground">
          Tamanho do rolo da Zebra, em milímetros. Imprima uma de teste para conferir antes de usar. Este tamanho fica guardado neste computador.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="et-l">Largura (mm)</Label>
            <Input id="et-l" inputMode="numeric" value={tamanho.larguraMm} onChange={(e) => setTamanho({ ...tamanho, larguraMm: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="h-10 w-24" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="et-a">Altura (mm)</Label>
            <Input id="et-a" inputMode="numeric" value={tamanho.alturaMm} onChange={(e) => setTamanho({ ...tamanho, alturaMm: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="h-10 w-24" />
          </div>
          <Button variant="outline" className="h-10" onClick={testarEtiqueta}>
            <Printer className="size-4" aria-hidden /> Imprimir etiqueta de teste
          </Button>
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="text-base font-semibold">Autoclaves</h2>
        <ul className="text-sm text-muted-foreground">
          {autoclaves.map((a) => (
            <li key={a.id}>
              {a.nome} ({a.codigo}) · {a.metodo}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function CmePage() {
  const [params, setParams] = useSearchParams()
  const aba: Aba = ABAS.includes(params.get('aba') as Aba) ? (params.get('aba') as Aba) : 'ciclos'
  const [autoclaves, setAutoclaves] = useState<Autoclave[]>([])
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([])
  const [materiais, setMateriais] = useState<MaterialCme[]>([])
  const [ciclos, setCiclos] = useState<CicloCme[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const [ac, co, ma, ci] = await Promise.all([listarAutoclaves(), listarColaboradores(), listarMateriais(), listarCiclos()])
      setAutoclaves(ac)
      setColaboradores(co)
      setMateriais(ma)
      setCiclos(ci)
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a CME')
    }
  }, [])
  useEffect(() => {
    void carregar()
  }, [carregar])

  const abertos = useMemo(() => (ciclos ?? []).filter((c) => c.status === 'aberto').length, [ciclos])

  return (
    <AppLayout title="CME · Esterilização" subtitle="Ciclos da autoclave, etiquetas dos pacotes e em qual paciente cada pacote foi usado.">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {erro ? (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {erro}
          </div>
        ) : null}
        <Tabs
          value={aba}
          onValueChange={(v) =>
            setParams(
              (atual) => {
                const n = new URLSearchParams(atual)
                n.set('aba', String(v))
                return n
              },
              { replace: true },
            )
          }
        >
          <TabsList>
            <TabsTrigger value="ciclos">
              <FlaskConical aria-hidden /> Ciclos
              {abertos > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">{abertos}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="pacotes">
              <PackageSearch aria-hidden /> Pacotes
            </TabsTrigger>
            <TabsTrigger value="cadastro">
              <Settings2 aria-hidden /> Cadastro
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ciclos" className="space-y-4">
            <NovoCiclo autoclaves={autoclaves} colaboradores={colaboradores} materiais={materiais} onAberto={() => void carregar()} />
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Ciclos</h2>
              {ciclos == null ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : ciclos.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhum ciclo ainda. O primeiro aparece aqui assim que for aberto.
                </p>
              ) : (
                <ul className="space-y-2">
                  {ciclos.map((c) => (
                    <CartaoCiclo key={c.id} ciclo={c} colaboradores={colaboradores} onMudou={() => void carregar()} />
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="pacotes">
            <AbaPacotes />
          </TabsContent>

          <TabsContent value="cadastro">
            <AbaCadastro materiais={materiais} colaboradores={colaboradores} autoclaves={autoclaves} onMudou={() => void carregar()} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}

export default CmePage
