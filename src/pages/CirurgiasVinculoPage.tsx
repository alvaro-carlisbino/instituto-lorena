import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Link2, Link2Off, RefreshCw, Search, Wand2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type CirurgiaVinculo,
  type MatchStatus,
  type SugestaoPaciente,
  estadoDoSync,
  listarCirurgias,
  rodarCasamentoAutomatico,
  sugerirPacientes,
  vincularPaciente,
} from '@/services/cirurgiasVinculo'

const FILTROS: Array<{ id: 'todas' | MatchStatus; label: string }> = [
  { id: 'sem_match', label: 'Sem paciente' },
  { id: 'pendente', label: 'Pendentes' },
  { id: 'auto', label: 'Casadas automático' },
  { id: 'manual', label: 'Casadas à mão' },
  { id: 'ignorado', label: 'Ignoradas' },
  { id: 'todas', label: 'Todas' },
]

const SELO: Record<MatchStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  auto: { label: 'automático', variant: 'default' },
  manual: { label: 'à mão', variant: 'default' },
  pendente: { label: 'pendente', variant: 'secondary' },
  sem_match: { label: 'sem paciente', variant: 'destructive' },
  ignorado: { label: 'ignorada', variant: 'outline' },
}

function dia(iso: string | null): string {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

export function CirurgiasVinculoPage() {
  const [filtro, setFiltro] = useState<'todas' | MatchStatus>('sem_match')
  const [linhas, setLinhas] = useState<CirurgiaVinculo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [sync, setSync] = useState<{ ultimaRodada: string | null; ok: boolean } | null>(null)
  const [alvo, setAlvo] = useState<CirurgiaVinculo | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const [l, s] = await Promise.all([listarCirurgias(filtro), estadoDoSync()])
      setLinhas(l)
      setSync(s)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para carregar as cirurgias.')
    } finally {
      setCarregando(false)
    }
  }, [filtro])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const resumo = useMemo(() => {
    const total = linhas.length
    const vinculadas = linhas.filter((l) => l.shospProntuario).length
    return { total, vinculadas }
  }, [linhas])

  async function casarAutomatico() {
    try {
      const r = await rodarCasamentoAutomatico()
      toast.success(
        r.casadas > 0
          ? `${r.casadas} cirurgia(s) vinculada(s) automaticamente.`
          : 'Nenhuma nova casou sozinha — o resto precisa de conferência.',
      )
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falhou.')
    }
  }

  return (
    <AppLayout
      title="Cirurgias sem prontuário"
      subtitle="Cirurgia que já aconteceu e não achou o paciente no CRM: no sistema do centro cirúrgico o nome é texto livre. Aqui você fecha o vínculo — é ele que faz a cirurgia aparecer no app do paciente. (Data de cirurgia esperando paciente é outra coisa, e mora na agenda cirúrgica.)"
    >
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
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void carregar()}>
            <RefreshCw className="size-4" /> Atualizar
          </Button>
          <Button size="sm" onClick={() => void casarAutomatico()}>
            <Wand2 className="size-4" /> Casar automático
          </Button>
        </div>
      </div>

      {sync && (
        <p className="mb-4 text-xs text-muted-foreground">
          Espelho do centro cirúrgico{' '}
          {sync.ultimaRodada
            ? `atualizado em ${new Date(sync.ultimaRodada).toLocaleString('pt-BR')}`
            : 'ainda não sincronizado'}
          {sync.ok ? '' : ' — última rodada falhou'}. Sincroniza sozinho a cada 2 horas.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {carregando ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : linhas.length === 0 ? (
            <EmptyState
              icon={Check}
              title="Nada para conferir aqui"
              description="Todas as cirurgias deste filtro já têm paciente vinculado."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Data</TableHead>
                  <TableHead>Paciente no sistema da cirurgia</TableHead>
                  <TableHead className="w-[110px] text-right">Folículos</TableHead>
                  <TableHead className="w-[150px]">Vínculo</TableHead>
                  <TableHead className="w-[160px]">Paciente do CRM</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-muted-foreground">{dia(l.dia)}</TableCell>
                    <TableCell className="font-medium">{l.pacienteNome}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.totalImplantados > 0 ? l.totalImplantados : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={SELO[l.matchStatus].variant}>{SELO[l.matchStatus].label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {l.shospProntuario ? `Prontuário ${l.shospProntuario}` : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setAlvo(l)}>
                        <Search className="size-4" /> Vincular
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!carregando && linhas.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {resumo.vinculadas} de {resumo.total} com paciente vinculado neste filtro.
        </p>
      )}

      <DialogVinculo
        cirurgia={alvo}
        aoFechar={() => setAlvo(null)}
        aoVincular={async () => {
          setAlvo(null)
          await carregar()
        }}
      />
    </AppLayout>
  )
}

function DialogVinculo({
  cirurgia,
  aoFechar,
  aoVincular,
}: {
  cirurgia: CirurgiaVinculo | null
  aoFechar: () => void
  aoVincular: () => void | Promise<void>
}) {
  const [sugestoes, setSugestoes] = useState<SugestaoPaciente[]>([])
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState<string | null>(null)

  useEffect(() => {
    if (!cirurgia) return
    setCarregando(true)
    sugerirPacientes(cirurgia.id)
      .then(setSugestoes)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falhou ao buscar sugestões.'))
      .finally(() => setCarregando(false))
  }, [cirurgia])

  async function vincular(prontuario: string | null) {
    if (!cirurgia) return
    setSalvando(prontuario ?? 'ignorar')
    try {
      await vincularPaciente(cirurgia.id, prontuario)
      toast.success(prontuario ? 'Paciente vinculado.' : 'Cirurgia marcada como ignorada.')
      await aoVincular()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para vincular.')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <Dialog open={!!cirurgia} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular “{cirurgia?.pacienteNome}”</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          As sugestões vêm do cadastro da Shosp, ranqueadas por semelhança de nome. Confira antes de
          confirmar: vincular errado faz o app mostrar a cirurgia de um paciente para outro.
        </p>

        {carregando ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : sugestoes.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Nenhum candidato parecido"
            description="Esse nome não bate com ninguém no cadastro da Shosp. Pode ser paciente antigo ou grafia muito diferente."
          />
        ) : (
          <div className="max-h-[380px] space-y-2 overflow-y-auto">
            {sugestoes.map((s) => (
              <div
                key={s.prontuario}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Prontuário {s.prontuario}
                    {s.cpf ? ` · CPF ${s.cpf}` : ''}
                    {s.celular ? ` · ${s.celular}` : ''}
                  </p>
                </div>
                <Badge variant={s.score >= 1 ? 'default' : 'secondary'}>
                  {Math.round(s.score * 100)}%
                </Badge>
                <Button
                  size="sm"
                  disabled={salvando !== null}
                  onClick={() => void vincular(s.prontuario)}
                >
                  <Link2 className="size-4" />
                  {salvando === s.prontuario ? 'Vinculando…' : 'É este'}
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <Button
            variant="ghost"
            disabled={salvando !== null}
            onClick={() => void vincular(null)}
          >
            <Link2Off className="size-4" /> Não é paciente do CRM
          </Button>
          <Button variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
