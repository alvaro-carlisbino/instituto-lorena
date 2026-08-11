import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, ArrowLeft, Presentation, TriangleAlert, User } from 'lucide-react'

import { CampoFolicular } from '@/components/tricoscopia/CampoFolicular'
import { GaleriaFotos } from '@/components/tricoscopia/GaleriaFotos'
import { MapaCouroCabeludo, type RegiaoNoMapa } from '@/components/tricoscopia/MapaCouroCabeludo'
import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  FAIXAS,
  RUIDO,
  baseRegiao,
  classificar,
  dia,
  ehAreaDoadora,
  faixasDoHistograma,
  glosaRegiao,
  nomePacienteLegivel,
  ordemRegiao,
  periodoLegivel,
  type Veredito,
} from '@/lib/tricoscopia'
import {
  cabecalhoDoPaciente,
  fotosDoPaciente,
  pedidoDeImagens,
  pedirImagens,
  serieDoPaciente,
  type CabecalhoPaciente,
  type FotoExame,
  type PedidoImagem,
  type PontoSerie,
} from '@/services/hairmetrix'
import { cn } from '@/lib/utils'

const n1 = (v: number | null | undefined, sufixo = '') =>
  v === null || v === undefined ? '—' : `${v.toFixed(1).replace('.', ',')}${sufixo}`

/**
 * As três métricas que o laudo mostra, em ordem de confiabilidade medida — não em
 * ordem de vistosidade. Densidade é a que todo mundo quer olhar e é a pior das
 * três: a própria área doadora, que não rala, varia 13,8% entre exames. Ver RUIDO
 * em @/lib/tricoscopia.
 */
type MetricaId = 'espessura' | 'finos' | 'densidade'

const METRICAS: Array<{
  id: MetricaId
  label: string
  curto: string
  unidade: string
  /** unidade da variação: '%' relativo, 'pp' ponto percentual */
  sufixoDelta: string
  /** true quando cair é melhorar (miniaturização) */
  inverso: boolean
  ruido: number
  explica: string
  valor: (p: PontoSerie) => number | null
  base: (p: PontoSerie) => number | null
}> = [
  {
    id: 'espessura',
    label: 'Espessura média do fio',
    curto: 'Espessura',
    unidade: ' µm',
    sufixoDelta: '%',
    inverso: false,
    ruido: RUIDO.espessuraPct,
    explica: 'Fio mais grosso é fio que saiu da miniaturização. É a medida mais estável do exame.',
    valor: (p) => p.espessuraMediaUm,
    base: (p) => p.baseEspessuraPct,
  },
  {
    id: 'finos',
    label: 'Fios finos (abaixo de 40 µm)',
    curto: 'Miniaturização',
    unidade: '%',
    sufixoDelta: ' pp',
    inverso: true,
    ruido: RUIDO.finosPp,
    explica: 'Proporção de fio em involução. Cair é melhorar, e é o primeiro sinal de que o tratamento pegou.',
    valor: (p) => p.pctFiosFinos,
    base: (p) => p.baseFinosPp,
  },
  {
    id: 'densidade',
    label: 'Densidade',
    curto: 'Densidade',
    unidade: ' fios/cm²',
    sufixoDelta: '%',
    inverso: false,
    ruido: RUIDO.densidadePct,
    explica:
      'Fios por centímetro quadrado. Depende de onde o ROI caiu na captura, então oscila muito: só vale quando o movimento é grande.',
    valor: (p) => p.densidadeFiosCm2,
    base: (p) => p.baseDensidadePct,
  },
]

const CLASSE_VEREDITO: Record<Veredito, string> = {
  ganho: 'text-[var(--viz-ganho)]',
  perda: 'text-[var(--viz-perda)]',
  estavel: 'text-muted-foreground',
  indefinido: 'text-muted-foreground',
}

const PALAVRA_VEREDITO: Record<Veredito, string> = {
  ganho: 'acima do ruído da medida',
  perda: 'acima do ruído da medida',
  estavel: 'dentro do ruído da medida',
  indefinido: 'sem comparação',
}

export function TricoscopiaPacientePage() {
  const { pacienteId = '' } = useParams()
  const navigate = useNavigate()

  /**
   * Carga guardada junto com o id que a originou. "Carregando" sai daí, em vez de
   * uma flag própria: trocar de paciente pela URL passa a mostrar o esqueleto na
   * hora, sem o frame em que o laudo antigo aparece sob o nome novo.
   */
  const [carga, setCarga] = useState<{
    id: string
    cabecalho: CabecalhoPaciente | null
    serie: PontoSerie[]
    erro: string | null
  } | null>(null)

  // Fotos carregam à parte da série: são uma RPC + assinatura de URL no storage, e
  // o laudo não pode ficar esperando isso para desenhar os números.
  const [fotos, setFotos] = useState<FotoExame[]>([])
  const [pedido, setPedido] = useState<PedidoImagem | null>(null)
  const [pedindo, setPedindo] = useState(false)

  const [regiaoEscolhida, setRegiaoEscolhida] = useState<string | null>(null)
  const [metrica, setMetrica] = useState<MetricaId>('espessura')
  const [apresentando, setApresentando] = useState(false)

  useEffect(() => {
    let vivo = true
    Promise.all([cabecalhoDoPaciente(pacienteId), serieDoPaciente(pacienteId)])
      .then(([c, s]) => {
        if (vivo) setCarga({ id: pacienteId, cabecalho: c, serie: s, erro: null })
      })
      .catch((e) => {
        if (!vivo) return
        const msg = e instanceof Error ? e.message : 'Não deu para carregar o laudo.'
        setCarga({ id: pacienteId, cabecalho: null, serie: [], erro: msg })
        toast.error(msg)
      })
    return () => { vivo = false }
  }, [pacienteId])

  useEffect(() => {
    let vivo = true
    if (!pacienteId) return
    Promise.all([fotosDoPaciente(pacienteId), pedidoDeImagens(pacienteId)])
      .then(([f, p]) => {
        if (!vivo) return
        setFotos(f)
        setPedido(p)
      })
      // foto é extra: se falhar, o laudo continua de pé com os números e o desenho
      .catch(() => {})
    return () => { vivo = false }
  }, [pacienteId])

  const solicitarFotos = useCallback(async () => {
    setPedindo(true)
    try {
      const { jaExistia } = await pedirImagens(pacienteId)
      setPedido(await pedidoDeImagens(pacienteId))
      toast.success(
        jaExistia
          ? 'Já havia um pedido em aberto para este paciente.'
          : 'Pedido registrado. O agente da clínica sobe as fotos na próxima rodada.',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para registrar o pedido.')
    } finally {
      setPedindo(false)
    }
  }, [pacienteId])

  const carregando = carga?.id !== pacienteId
  const cabecalho = carga?.cabecalho ?? null
  const erro = carga?.erro ?? null
  const serie = useMemo(() => carga?.serie ?? [], [carga])

  /**
   * Agrupa por região BASE: o worklist repete o ponto com sufixo `_1` quando o
   * operador recaptura, e sem juntar isso a série se parte em duas.
   */
  const porRegiao = useMemo(() => {
    const m = new Map<string, PontoSerie[]>()
    for (const p of serie) {
      if (!p.regiao) continue
      const k = baseRegiao(p.regiao)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    for (const pontos of m.values()) {
      pontos.sort((a, b) => a.capturadoEm.localeCompare(b.capturadoEm))
    }
    return Array.from(m.entries()).sort(
      (a, b) => ordemRegiao(a[0]) - ordemRegiao(b[0]) || b[1].length - a[1].length,
    )
  }, [serie])

  const doadora = useMemo(() => porRegiao.find(([r]) => ehAreaDoadora(r)) ?? null, [porRegiao])

  /**
   * A região em foco é derivada, não guardada por efeito: enquanto ninguém clicar,
   * vale a tratada com mais exames — é onde há mais o que mostrar, e a doadora só
   * assume se não houver nenhuma outra. Guardar isso em estado significaria abrir o
   * laudo do paciente seguinte com a região do anterior.
   */
  const regiaoPadrao = useMemo(() => {
    const tratadas = porRegiao.filter(([r]) => !ehAreaDoadora(r))
    const alvo = (tratadas.length > 0 ? tratadas : porRegiao)
      .slice()
      .sort((a, b) => b[1].length - a[1].length)[0]
    return alvo?.[0] ?? null
  }, [porRegiao])

  const regiaoSel = porRegiao.some(([r]) => r === regiaoEscolhida) ? regiaoEscolhida : regiaoPadrao

  const met = METRICAS.find((m) => m.id === metrica)!

  /** Δ contra o primeiro exame da região, que é o que o paciente quer saber. */
  const variacaoDaRegiao = useCallback(
    (pontos: PontoSerie[], m = met) => {
      const ultimo = pontos[pontos.length - 1]
      if (!ultimo || pontos.length < 2) return null
      return m.base(ultimo)
    },
    [met],
  )

  const regioesDoMapa: RegiaoNoMapa[] = useMemo(
    () =>
      porRegiao.map(([regiao, pontos]) => {
        const valor = variacaoDaRegiao(pontos)
        return {
          regiao,
          rotulo: regiao,
          valor,
          veredito: classificar(valor, met.ruido, met.inverso),
          temSerie: pontos.length >= 2,
        }
      }),
    [porRegiao, variacaoDaRegiao, met],
  )

  const pontosSel = useMemo(
    () => (regiaoSel ? (porRegiao.find(([r]) => r === regiaoSel)?.[1] ?? []) : []),
    [porRegiao, regiaoSel],
  )

  /** Série da região escolhida com a doadora do mesmo paciente sobreposta. */
  const dadosLinha = useMemo(() => {
    const controlePorDia = new Map<string, number | null>()
    for (const p of doadora?.[1] ?? []) controlePorDia.set(p.capturadoEm.slice(0, 10), met.valor(p))

    return pontosSel.map((p) => ({
      dataIso: p.capturadoEm,
      data: dia(p.capturadoEm),
      valor: met.valor(p),
      controle: controlePorDia.get(p.capturadoEm.slice(0, 10)) ?? null,
      serial: p.serialDispositivo,
    }))
  }, [pontosSel, doadora, met])

  /** Composição do fio por faixa de espessura, em % — conta bruta depende do ROI. */
  const dadosComposicao = useMemo(
    () =>
      pontosSel
        .map((p) => {
          const f = faixasDoHistograma(p.espessuraHist)
          if (!f) return null
          const total = Object.values(f).reduce((a, b) => a + b, 0)
          const linha: Record<string, string | number> = { data: dia(p.capturadoEm) }
          for (const faixa of FAIXAS) linha[faixa.id] = Math.round((f[faixa.id] / total) * 1000) / 10
          return linha
        })
        .filter((l): l is Record<string, string | number> => l !== null),
    [pontosSel],
  )

  const nome = cabecalho
    ? (cabecalho.leadNome ?? nomePacienteLegivel(cabecalho.nomePasta))
    : ''

  const trocouAparelho = (cabecalho?.aparelhos ?? 0) > 1

  if (carregando) {
    return (
      <AppLayout title="Laudo de evolução" subtitle="Carregando exames…">
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppLayout>
    )
  }

  if (erro || !cabecalho) {
    return (
      <AppLayout title="Laudo de evolução">
        <div className="space-y-4">
          <EmptyState
            icon={AlertTriangle}
            title="Não deu para abrir este laudo"
            description={erro ?? 'Paciente não encontrado no espelho do HairMetrix.'}
          />
          <div className="flex justify-center">
            <Button onClick={() => navigate('/tricoscopia')}>Voltar para a tricoscopia</Button>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={nome}
      subtitle={`${cabecalho.totalExames} exame${cabecalho.totalExames === 1 ? '' : 's'} · ${dia(cabecalho.primeiroExameEm)} a ${dia(cabecalho.ultimoExameEm)}`}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate('/tricoscopia')}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />Tricoscopia
          </Button>
          <Button
            size="sm"
            variant={apresentando ? 'default' : 'outline'}
            onClick={() => setApresentando((v) => !v)}
            title="Esconde a parte técnica e aumenta os gráficos, para mostrar ao paciente"
          >
            <Presentation className="mr-1.5 h-3.5 w-3.5" />
            {apresentando ? 'Sair da apresentação' : 'Apresentar'}
          </Button>
        </div>
      }
    >
      <div className="viz space-y-5">
        {/* --- identificação e avisos ------------------------------------- */}
        {!apresentando && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {cabecalho.leadId ? (
              <Button size="sm" variant="outline" onClick={() => navigate(`/leads/${cabecalho.leadId}`)}>
                <User className="mr-1.5 h-3.5 w-3.5" />Ficha do paciente
              </Button>
            ) : (
              <Badge variant="secondary">
                Pasta do Mirror sem paciente do CRM — o nome acima vem do disco, não do cadastro
              </Badge>
            )}
            {cabecalho.shospProntuario && (
              <span className="text-muted-foreground">Prontuário {cabecalho.shospProntuario}</span>
            )}
            <span className="text-muted-foreground">Pasta: {cabecalho.nomePasta}</span>
          </div>
        )}

        {(trocouAparelho || cabecalho.totalExames < 2) && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex gap-3 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="space-y-1">
                {cabecalho.totalExames < 2 && (
                  <p className="m-0">
                    Só existe um exame. Dá para ler o estado de hoje, não a evolução — a comparação
                    começa no segundo exame da mesma região.
                  </p>
                )}
                {trocouAparelho && (
                  <p className="m-0">
                    A série atravessa <strong>dois VISIOMED diferentes</strong>. Trocar de aparelho mexe na
                    calibração: nesses pares, a área analisada varia 12,8% em vez de 5,1%, e parte da
                    diferença é do equipamento, não do paciente.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* --- veredito ---------------------------------------------------- */}
        {regiaoSel && pontosSel.length >= 2 && (
          <Veredicto
            regiao={regiaoSel}
            pontos={pontosSel}
            doadora={doadora?.[1] ?? []}
            apresentando={apresentando}
          />
        )}

        {/* --- mapa --------------------------------------------------------- */}
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-sm">Onde mudou, desde o primeiro exame</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{met.explica}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {METRICAS.map((m) => (
                <Button
                  key={m.id}
                  size="sm"
                  variant={metrica === m.id ? 'default' : 'outline'}
                  onClick={() => setMetrica(m.id)}
                >
                  {m.curto}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {regioesDoMapa.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sem medidas para este paciente.</p>
            ) : (
              <>
                <MapaCouroCabeludo
                  regioes={regioesDoMapa}
                  selecionada={regiaoSel}
                  onSelecionar={(r) => setRegiaoEscolhida(r ?? regiaoPadrao)}
                  sufixo={met.sufixoDelta}
                />
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <Legenda cor="var(--viz-ganho)" texto={met.inverso ? 'melhorou' : 'ganhou'} />
                  <Legenda cor="var(--viz-estavel)" texto={`estável (variação abaixo de ${n1(met.ruido)}${met.sufixoDelta})`} />
                  <Legenda cor="var(--viz-perda)" texto={met.inverso ? 'piorou' : 'perdeu'} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* --- evolução no tempo -------------------------------------------- */}
        {regiaoSel && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {met.label} em {regiaoSel}
                {glosaRegiao(regiaoSel) && (
                  <span className="ml-2 font-normal text-muted-foreground">({glosaRegiao(regiaoSel)})</span>
                )}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {doadora
                  ? 'A linha tracejada é a área doadora do próprio paciente, medida no mesmo dia. Ela não rala: quando as duas linhas sobem juntas, quem mudou foi a captura, não o cabelo.'
                  : 'Sem área doadora medida neste paciente, não há controle interno — a leitura fica sem contraprova.'}
              </p>
            </CardHeader>
            <CardContent>
              {dadosLinha.length < 2 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Esta região tem um exame só. A evolução aparece a partir do segundo.
                </p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={apresentando ? 380 : 260}>
                    <LineChart data={dadosLinha} margin={{ top: 12, right: 16, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--viz-grade)" />
                      <XAxis
                        dataKey="data"
                        tick={{ fontSize: 11, fill: 'var(--viz-muted)' }}
                        stroke="var(--viz-linha)"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'var(--viz-muted)' }}
                        stroke="var(--viz-linha)"
                        width={46}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(v, nomeSerie) => [
                          v === null ? '—' : `${n1(Number(v))}${met.unidade}`,
                          nomeSerie === 'controle' ? 'área doadora (controle)' : regiaoSel,
                        ]}
                      />
                      {doadora && (
                        <Line
                          type="monotone"
                          dataKey="controle"
                          name="controle"
                          stroke="var(--viz-controle)"
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="valor"
                        name="regiao"
                        stroke="var(--viz-serie)"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <Legenda cor="var(--viz-serie)" texto={regiaoSel} />
                    {doadora && <Legenda cor="var(--viz-controle)" texto={`${doadora[0]} — controle`} tracejada />}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* --- fotos do exame -------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Fotos do exame</CardTitle>
          </CardHeader>
          <CardContent>
            <GaleriaFotos fotos={fotos} pedido={pedido} pedindo={pedindo} onPedir={() => void solicitarFotos()} />
          </CardContent>
        </Card>

        {/* --- campo folicular desenhado --------------------------------------- */}
        {regiaoSel && pontosSel.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Como está o campo em {regiaoSel}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                A parte que impressiona na tricoscopia é a imagem, e a imagem é o que não temos: são 32 mil
                capturas de 4 a 8 MB, entre 130 e 250 GB. Este desenho sai das medidas do próprio exame, custa
                zero de upload e mostra a mesma coisa que a foto mostraria: quantidade e calibre do fio.
              </p>
            </CardHeader>
            <CardContent>
              <CampoFolicular
                primeiro={{
                  captureId: pontosSel[0].captureId,
                  capturadoEm: pontosSel[0].capturadoEm,
                  regiao: pontosSel[0].regiao,
                  densidadeUfCm2: pontosSel[0].densidadeUfCm2,
                  densidadeFiosCm2: pontosSel[0].densidadeFiosCm2,
                  espessuraMediaUm: pontosSel[0].espessuraMediaUm,
                  espessuraHist: pontosSel[0].espessuraHist,
                }}
                ultimo={{
                  captureId: pontosSel[pontosSel.length - 1].captureId,
                  capturadoEm: pontosSel[pontosSel.length - 1].capturadoEm,
                  regiao: pontosSel[pontosSel.length - 1].regiao,
                  densidadeUfCm2: pontosSel[pontosSel.length - 1].densidadeUfCm2,
                  densidadeFiosCm2: pontosSel[pontosSel.length - 1].densidadeFiosCm2,
                  espessuraMediaUm: pontosSel[pontosSel.length - 1].espessuraMediaUm,
                  espessuraHist: pontosSel[pontosSel.length - 1].espessuraHist,
                }}
              />
            </CardContent>
          </Card>
        )}

        {/* --- composição do fio --------------------------------------------- */}
        {regiaoSel && dadosComposicao.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Composição do fio em {regiaoSel}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Cada barra é um exame: qual proporção dos fios estava em cada espessura. Tratamento que
                funciona empurra a barra para baixo — o fio fino vira fio grosso. Em porcentagem, e não em
                contagem, porque a área analisada muda de um exame para outro.
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={apresentando ? 380 : 280}>
                <BarChart data={dadosComposicao} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--viz-grade)" />
                  <XAxis dataKey="data" tick={{ fontSize: 11, fill: 'var(--viz-muted)' }} stroke="var(--viz-linha)" />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--viz-muted)' }}
                    stroke="var(--viz-linha)"
                    width={40}
                    unit="%"
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v, id) => [
                      `${n1(Number(v))}%`,
                      FAIXAS.find((f) => f.id === id)?.label ?? String(id),
                    ]}
                  />
                  {FAIXAS.map((f, i) => (
                    <Bar
                      key={f.id}
                      dataKey={f.id}
                      stackId="fio"
                      fill={`var(--viz-faixa-${i + 1})`}
                      stroke="var(--viz-surface)"
                      strokeWidth={2}
                      radius={i === FAIXAS.length - 1 ? [4, 4, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {FAIXAS.map((f, i) => (
                  <Legenda key={f.id} cor={`var(--viz-faixa-${i + 1})`} texto={`${f.label} · ${f.descricao}`} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* --- tabela por região --------------------------------------------- */}
        {!apresentando && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Exame por exame</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Δ é sempre contra o exame anterior da mesma região. Variação abaixo do ruído da medida
                aparece em cinza: espessura {n1(RUIDO.espessuraPct)}%, finos {n1(RUIDO.finosPp)} pp,
                densidade {n1(RUIDO.densidadePct)}%.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {porRegiao.map(([regiao, pontos]) => (
                <div key={regiao} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    onClick={() => setRegiaoEscolhida(regiao)}
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold hover:bg-muted/50',
                      regiaoSel === regiao && 'bg-muted',
                    )}
                  >
                    {regiao}
                    {ehAreaDoadora(regiao) && (
                      <Badge variant="outline" title="Área doadora: não rala. Serve de controle da técnica de captura.">
                        controle
                      </Badge>
                    )}
                    <span className="font-normal text-muted-foreground">{glosaRegiao(regiao)}</span>
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {pontos.length} exame{pontos.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28">Data</TableHead>
                          <TableHead className="w-24">Desde o 1º</TableHead>
                          <TableHead className="text-right">Espessura</TableHead>
                          <TableHead className="text-right">Δ</TableHead>
                          <TableHead className="text-right">% finos</TableHead>
                          <TableHead className="text-right">Δ</TableHead>
                          <TableHead className="text-right">Fios/cm²</TableHead>
                          <TableHead className="text-right">Δ</TableHead>
                          <TableHead className="text-right">Fios/UF</TableHead>
                          <TableHead className="w-20">Aparelho</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pontos.map((p) => (
                          <TableRow key={`${p.exameId}-${p.regiao}`}>
                            <TableCell className="tabular-nums">{dia(p.capturadoEm)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {periodoLegivel(p.diasDesdeBase)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{n1(p.espessuraMediaUm, ' µm')}</TableCell>
                            <TableCell className="text-right">
                              <Delta valor={p.deltaEspessuraPct} ruido={RUIDO.espessuraPct} sufixo="%" />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{n1(p.pctFiosFinos, '%')}</TableCell>
                            <TableCell className="text-right">
                              <Delta valor={p.deltaFinosPp} ruido={RUIDO.finosPp} sufixo=" pp" inverso />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{n1(p.densidadeFiosCm2)}</TableCell>
                            <TableCell className="text-right">
                              <Delta valor={p.deltaDensidadePct} ruido={RUIDO.densidadePct} sufixo="%" />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {p.fiosPorUf === null ? '—' : p.fiosPorUf.toFixed(2).replace('.', ',')}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground tabular-nums">
                              {p.serialDispositivo ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}

// ---------------------------------------------------------------------------

function Legenda({ cor, texto, tracejada }: { cor: string; texto: string; tracejada?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn('inline-block rounded-full border', tracejada ? 'h-0 w-4 border-t-2 border-dashed' : 'size-2.5')}
        style={tracejada ? { borderColor: cor } : { background: cor, borderColor: 'var(--viz-linha)' }}
      />
      {texto}
    </span>
  )
}

/** Δ que sabe a diferença entre mudança e ruído: dentro do piso, sai cinza e sem seta. */
function Delta({
  valor,
  ruido,
  sufixo,
  inverso = false,
}: {
  valor: number | null
  ruido: number
  sufixo: string
  inverso?: boolean
}) {
  if (valor === null || Number.isNaN(valor)) return <span className="text-muted-foreground">—</span>
  const v = classificar(valor, ruido, inverso)
  return (
    <span className={cn('tabular-nums', CLASSE_VEREDITO[v])} title={PALAVRA_VEREDITO[v]}>
      {valor > 0 ? '+' : ''}{valor.toFixed(1).replace('.', ',')}{sufixo}
    </span>
  )
}

/**
 * O parágrafo que o médico lê em voz alta. Compara o último exame com o primeiro
 * DA MESMA REGIÃO e coloca a área doadora do próprio paciente ao lado — se as duas
 * andaram junto, o que mudou foi a captura.
 */
function Veredicto({
  regiao,
  pontos,
  doadora,
  apresentando,
}: {
  regiao: string
  pontos: PontoSerie[]
  doadora: PontoSerie[]
  apresentando: boolean
}) {
  const ultimo = pontos[pontos.length - 1]
  const primeiro = pontos[0]
  const dias = ultimo.diasDesdeBase ?? 0

  const doadoraUltima = doadora[doadora.length - 1]
  const controleEspessura = doadora.length >= 2 ? (doadoraUltima?.baseEspessuraPct ?? null) : null

  const cartoes = METRICAS.map((m) => {
    const delta = m.base(ultimo)
    return {
      id: m.id,
      label: m.label,
      hoje: `${n1(m.valor(ultimo))}${m.unidade}`,
      antes: `${n1(m.valor(primeiro))}${m.unidade}`,
      delta,
      sufixo: m.sufixoDelta,
      veredito: classificar(delta, m.ruido, m.inverso),
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {regiao} — do primeiro exame até hoje
          <span className="ml-2 font-normal text-muted-foreground">
            {periodoLegivel(dias)}, {dia(primeiro.capturadoEm)} a {dia(ultimo.capturadoEm)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {cartoes.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-3">
              <p className="m-0 text-xs text-muted-foreground">{c.label}</p>
              <p className={cn('m-0 mt-1 font-semibold tabular-nums', apresentando ? 'text-4xl' : 'text-2xl')}>
                {c.hoje}
              </p>
              <p className={cn('m-0 mt-1 text-sm font-medium tabular-nums', CLASSE_VEREDITO[c.veredito])}>
                {c.delta === null
                  ? '—'
                  : `${c.delta > 0 ? '+' : ''}${c.delta.toFixed(1).replace('.', ',')}${c.sufixo}`}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {c.veredito === 'estavel' ? 'sem mudança real' : c.veredito === 'indefinido' ? '' : 'de verdade'}
                </span>
              </p>
              <p className="m-0 mt-0.5 text-[0.7rem] text-muted-foreground">era {c.antes}</p>
            </div>
          ))}
        </div>

        <p className="m-0 rounded-md bg-muted/50 p-3 text-sm">
          {controleEspessura === null ? (
            <>
              Sem área doadora com dois exames neste paciente, não há controle interno: os números acima
              não têm contraprova de que a captura foi igual nas duas datas.
            </>
          ) : (
            <>
              Controle: no mesmo período, a <strong>área doadora</strong> — que não rala — variou{' '}
              <strong className="tabular-nums">
                {controleEspessura > 0 ? '+' : ''}
                {controleEspessura.toFixed(1).replace('.', ',')}%
              </strong>{' '}
              de espessura.{' '}
              {Math.abs(controleEspessura) >= RUIDO.espessuraPct
                ? 'Ela deveria estar parada. Como se mexeu, parte da diferença acima é da captura, não do tratamento.'
                : 'Ficou parada, como se espera — o que a região tratada mudou, mudou de verdade.'}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
