import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Activity, Link2, Link2Off, RefreshCw, Search, TrendingDown, TrendingUp } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type EstadoSync,
  type PacienteTricoscopia,
  type PontoEvolucao,
  type SugestaoLead,
  type VinculoStatus,
  estadoDoSync,
  evolucaoDoPaciente,
  ignorarPaciente,
  listarPacientes,
  sugerirLeads,
  vincularLead,
} from '@/services/hairmetrix'

const FILTROS: Array<{ id: 'todos' | VinculoStatus; label: string }> = [
  { id: 'pendente', label: 'Sem paciente' },
  { id: 'vinculado', label: 'Vinculados' },
  { id: 'ignorado', label: 'Ignorados' },
  { id: 'todos', label: 'Todos' },
]

/**
 * Occipital é área doadora: não rala. Serve de controle interno — se ele oscila
 * entre exames, mudou a técnica de captura, não o tratamento. Por isso a região é
 * exibida sempre, e nunca se soma um ponto com o outro.
 */
const DOADORA = /occiput|occipital/i

function dia(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function nomeLegivel(nomePasta: string): string {
  // O Mirror grava "SOBRENOME, NOME". Vira "Nome Sobrenome" para leitura.
  const [sobrenome, nome] = nomePasta.split(',').map((s) => s.trim())
  const cru = nome ? `${nome} ${sobrenome}` : nomePasta
  return cru.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
}

function Delta({ valor, inverso = false }: { valor: number | null; inverso?: boolean }) {
  if (valor === null || Number.isNaN(valor)) return <span className="text-muted-foreground">—</span>
  const bom = inverso ? valor < 0 : valor > 0
  const neutro = Math.abs(valor) < 1
  const cor = neutro
    ? 'text-muted-foreground'
    : bom
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400'
  const Icone = valor > 0 ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${cor}`}>
      {!neutro && <Icone className="h-3 w-3" />}
      {valor > 0 ? '+' : ''}{valor.toFixed(1)}%
    </span>
  )
}

export function TricoscopiaPage() {
  const [filtro, setFiltro] = useState<'todos' | VinculoStatus>('todos')
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [linhas, setLinhas] = useState<PacienteTricoscopia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [sync, setSync] = useState<EstadoSync | null>(null)

  const [aberto, setAberto] = useState<PacienteTricoscopia | null>(null)
  const [evolucao, setEvolucao] = useState<PontoEvolucao[]>([])
  const [carregandoEvolucao, setCarregandoEvolucao] = useState(false)

  const [vinculando, setVinculando] = useState<PacienteTricoscopia | null>(null)
  const [sugestoes, setSugestoes] = useState<SugestaoLead[]>([])
  const [carregandoSugestoes, setCarregandoSugestoes] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const [l, s] = await Promise.all([listarPacientes(filtro, buscaAplicada), estadoDoSync()])
      setLinhas(l)
      setSync(s)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para carregar a tricoscopia.')
    } finally {
      setCarregando(false)
    }
  }, [filtro, buscaAplicada])

  useEffect(() => { void carregar() }, [carregar])

  const abrirEvolucao = useCallback(async (p: PacienteTricoscopia) => {
    setAberto(p)
    setCarregandoEvolucao(true)
    setEvolucao([])
    try {
      setEvolucao(await evolucaoDoPaciente(p.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para carregar a evolução.')
    } finally {
      setCarregandoEvolucao(false)
    }
  }, [])

  const abrirVinculo = useCallback(async (p: PacienteTricoscopia) => {
    setVinculando(p)
    setCarregandoSugestoes(true)
    setSugestoes([])
    try {
      setSugestoes(await sugerirLeads(p.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para buscar candidatos.')
    } finally {
      setCarregandoSugestoes(false)
    }
  }, [])

  const confirmarVinculo = useCallback(async (leadId: string) => {
    if (!vinculando) return
    try {
      await vincularLead(vinculando.id, leadId)
      toast.success('Exames vinculados ao paciente.')
      setVinculando(null)
      void carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para vincular.')
    }
  }, [vinculando, carregar])

  // Agrupa por região porque comparar vertex com occipital não significa nada.
  const porRegiao = useMemo(() => {
    const m = new Map<string, PontoEvolucao[]>()
    for (const p of evolucao) {
      const k = p.regiao ?? 'Sem região'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [evolucao])

  return (
    <AppLayout
      title="Tricoscopia"
      subtitle="Exames do HairMetrix espelhados no CRM. A comparação é sempre dentro da mesma região: occipital é área doadora e não rala, então ele serve de controle — se oscilar, mudou a captura, não o tratamento."
    >
      {sync && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span><strong className="text-foreground tabular-nums">{sync.pacientes}</strong> pacientes</span>
          <span><strong className="text-foreground tabular-nums">{sync.exames}</strong> exames</span>
          <span><strong className="text-foreground tabular-nums">{sync.medidas}</strong> medidas</span>
          <span><strong className="text-foreground tabular-nums">{sync.pendentes}</strong> sem paciente do CRM</span>
          <span className="ml-auto">
            Última sincronização: {sync.ultimaRodada ? new Date(sync.ultimaRodada).toLocaleString('pt-BR') : 'nunca'}
          </span>
          <Button size="sm" variant="outline" onClick={() => void carregar()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Atualizar
          </Button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filtro === f.id ? 'default' : 'outline'}
            onClick={() => setFiltro(f.id)}
          >
            {f.label}
          </Button>
        ))}
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca) }}
        >
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar paciente"
            className="h-8 w-56"
          />
          <Button size="sm" variant="outline" type="submit">
            <Search className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>

      <Card>
        <CardContent className="p-0">
          {carregando ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : linhas.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Nenhum exame por aqui"
              description="Se o agente da máquina da clínica já rodou, confira a última sincronização acima."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead className="w-20 text-right">Exames</TableHead>
                  <TableHead className="w-28">Primeiro</TableHead>
                  <TableHead className="w-28">Último</TableHead>
                  <TableHead className="w-32">Vínculo</TableHead>
                  <TableHead className="w-44 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => void abrirEvolucao(p)}>
                    <TableCell className="font-medium">{nomeLegivel(p.nomePasta)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.totalExames}</TableCell>
                    <TableCell className="tabular-nums">{dia(p.primeiroExameEm)}</TableCell>
                    <TableCell className="tabular-nums">{dia(p.ultimoExameEm)}</TableCell>
                    <TableCell>
                      {p.vinculoStatus === 'vinculado' ? (
                        <Badge>vinculado</Badge>
                      ) : p.vinculoStatus === 'ignorado' ? (
                        <Badge variant="outline">ignorado</Badge>
                      ) : (
                        <Badge variant="secondary">sem paciente</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" onClick={() => void abrirVinculo(p)}>
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        {p.vinculoStatus === 'vinculado' ? 'Trocar' : 'Vincular'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Evolução */}
      <Dialog open={!!aberto} onOpenChange={(o) => { if (!o) setAberto(null) }}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{aberto ? nomeLegivel(aberto.nomePasta) : ''}</DialogTitle>
          </DialogHeader>

          {carregandoEvolucao ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : porRegiao.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem medidas para este paciente.</p>
          ) : (
            <div className="space-y-6">
              {porRegiao.map(([regiao, pontos]) => (
                <div key={regiao}>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{regiao}</h3>
                    {DOADORA.test(regiao) && (
                      <Badge variant="outline" title="Área doadora: não rala. Serve de controle da técnica de captura.">
                        controle
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{pontos.length} exame(s)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-28">Data</TableHead>
                          <TableHead className="text-right">Fios/cm²</TableHead>
                          <TableHead className="text-right">Δ densidade</TableHead>
                          <TableHead className="text-right">Espessura</TableHead>
                          <TableHead className="text-right">Δ espessura</TableHead>
                          <TableHead className="text-right">% finos</TableHead>
                          <TableHead className="text-right">Fios/UF</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pontos.map((p) => (
                          <TableRow key={p.captureId}>
                            <TableCell className="tabular-nums">{dia(p.capturadoEm)}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.densidadeFiosCm2?.toFixed(1) ?? '—'}</TableCell>
                            <TableCell className="text-right"><Delta valor={p.deltaDensidadePct} /></TableCell>
                            <TableCell className="text-right tabular-nums">{p.espessuraMediaUm ? `${p.espessuraMediaUm.toFixed(1)} µm` : '—'}</TableCell>
                            <TableCell className="text-right"><Delta valor={p.deltaEspessuraPct} /></TableCell>
                            <TableCell className="text-right tabular-nums">{p.pctFiosFinos?.toFixed(1) ?? '—'}%</TableCell>
                            <TableCell className="text-right tabular-nums">{p.fiosPorUf?.toFixed(2) ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Vínculo */}
      <Dialog open={!!vinculando} onOpenChange={(o) => { if (!o) setVinculando(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vincular {vinculando ? nomeLegivel(vinculando.nomePasta) : ''}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            O HairMetrix guarda só o nome, e o CRM guarda o nome ao contrário. A lista abaixo é
            ordenada por quantas palavras batem, mas quem confirma é você: vincular o exame errado
            mostra o prontuário de um paciente para outro.
          </p>

          {carregandoSugestoes ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : sugestoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum candidato parecido no CRM.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente no CRM</TableHead>
                  <TableHead className="w-36">Telefone</TableHead>
                  <TableHead className="w-20 text-right">Match</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sugestoes.map((s) => (
                  <TableRow key={s.leadId}>
                    <TableCell className="font-medium">{s.patientName}</TableCell>
                    <TableCell className="tabular-nums">{s.phone ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.score}%</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => void confirmarVinculo(s.leadId)}>Vincular</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {vinculando?.vinculoStatus === 'vinculado' && (
              <Button
                variant="outline"
                onClick={async () => {
                  if (!vinculando) return
                  await vincularLead(vinculando.id, null)
                  toast.success('Vínculo desfeito.')
                  setVinculando(null)
                  void carregar()
                }}
              >
                <Link2Off className="mr-1.5 h-3.5 w-3.5" />Desfazer vínculo
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={async () => {
                if (!vinculando) return
                await ignorarPaciente(vinculando.id)
                toast.success('Marcado como ignorado.')
                setVinculando(null)
                void carregar()
              }}
            >
              Ignorar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
