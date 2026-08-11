import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Activity, ChevronRight, LineChart, Link2, Link2Off, RefreshCw, Search } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/page/StatCard'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dia, nomePacienteLegivel } from '@/lib/tricoscopia'
import {
  type EstadoSync,
  type PacienteTricoscopia,
  type SugestaoLead,
  type VinculoStatus,
  estadoDoSync,
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

export function TricoscopiaPage() {
  const [filtro, setFiltro] = useState<'todos' | VinculoStatus>('todos')
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [linhas, setLinhas] = useState<PacienteTricoscopia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [sync, setSync] = useState<EstadoSync | null>(null)

  const navigate = useNavigate()

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

  return (
    <AppLayout
      title="Tricoscopia"
      subtitle="Exames do HairMetrix espelhados no CRM. Abra um paciente para ver o laudo de evolução: a comparação é sempre dentro da mesma região, e a área doadora entra junto como controle da medida."
      actions={
        <Button size="sm" variant="outline" onClick={() => void carregar()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Atualizar
        </Button>
      }
    >
      {sync && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Pacientes com exame"
              value={sync.pacientes.toLocaleString('pt-BR')}
              hint={`${sync.exames.toLocaleString('pt-BR')} exames · ${sync.medidas.toLocaleString('pt-BR')} medidas`}
            />
            {/* O número que importa: laudo de evolução só existe a partir do 2º exame. */}
            <StatCard
              label="Com evolução (2+ exames)"
              value={sync.comEvolucao.toLocaleString('pt-BR')}
              hint={sync.pacientes > 0 ? `${Math.round((sync.comEvolucao / sync.pacientes) * 100)}% da base` : undefined}
            />
            <StatCard
              label="Vinculados ao CRM"
              value={sync.vinculados.toLocaleString('pt-BR')}
              hint={`${sync.pendentes.toLocaleString('pt-BR')} pastas ainda sem paciente`}
            />
            <StatCard
              label="Acervo"
              value={`${dia(sync.primeiroExameEm)} →`}
              valueClassName="text-lg"
              hint={`até ${dia(sync.ultimoExameEm)}`}
            />
          </div>
          <p className="mt-2 mb-4 text-xs text-muted-foreground">
            Última sincronização do agente:{' '}
            {sync.ultimaRodada ? new Date(sync.ultimaRodada).toLocaleString('pt-BR') : 'nunca'}
          </p>
        </>
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
                  <TableHead className="w-24 text-right">Exames</TableHead>
                  <TableHead className="w-28">Primeiro</TableHead>
                  <TableHead className="w-28">Último</TableHead>
                  <TableHead className="w-32">Vínculo</TableHead>
                  <TableHead className="w-56 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/tricoscopia/${p.id}`)}
                  >
                    <TableCell className="font-medium">{nomePacienteLegivel(p.nomePasta)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.totalExames}
                      {/* Um exame só não tem evolução: dizer isso antes de abrir poupa clique. */}
                      {p.totalExames === 1 && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">único</span>
                      )}
                    </TableCell>
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); void abrirVinculo(p) }}
                        >
                          <Link2 className="mr-1.5 h-3.5 w-3.5" />
                          {p.vinculoStatus === 'vinculado' ? 'Trocar' : 'Vincular'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/tricoscopia/${p.id}`)}>
                          <LineChart className="mr-1.5 h-3.5 w-3.5" />Laudo
                          <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Vínculo */}
      <Dialog open={!!vinculando} onOpenChange={(o) => { if (!o) setVinculando(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vincular {vinculando ? nomePacienteLegivel(vinculando.nomePasta) : ''}</DialogTitle>
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
