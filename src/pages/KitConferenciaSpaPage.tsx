import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Ban, Check, PackagePlus, Undo2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { EstadoDaTela } from '@/components/kits/TelaDoKit'
import { combinaBusca } from '@/lib/busca'
import { diaLocal } from '@/lib/diaLocal'
import { type AtendimentoSpa, type LinhaConferenciaSpa, type SituacaoSpa, agruparAtendimentos, resumoSpa } from '@/lib/conferenciaSpa'
import { cn } from '@/lib/utils'
import { desfazerSemMaterial, listarConferenciaSpa, marcarSemMaterial } from '@/services/spaConferencia'

// /kits/conferencia-spa: quem foi atendido no Spa Capilar (agenda do Shosp) e se o material saiu
// do estoque. Pedido da clínica em 23/09/2026: as conferências só olhavam a agenda cirúrgica, e o
// SPA atendia ~45 pessoas por dia com 4 kits montados no total.

type Filtro = SituacaoSpa | 'todos'

const diasAtras = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return diaLocal(d)
}

const dataLonga = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })

const SITUACAO: Record<SituacaoSpa, { rotulo: string; classe: string }> = {
  pendente: { rotulo: 'Sem baixa', classe: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  com_kit: { rotulo: 'Com kit', classe: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  sem_material: { rotulo: 'Não usa material', classe: 'bg-muted text-muted-foreground' },
}

export function KitConferenciaSpaPage() {
  const [de, setDe] = useState(diaLocal(new Date()))
  const [ate, setAte] = useState(diaLocal(new Date()))
  const [linhas, setLinhas] = useState<LinhaConferenciaSpa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('pendente')
  const [mexendo, setMexendo] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const termo = useDeferredValue(busca)

  const carregar = useCallback(async () => {
    if (!de || !ate) return
    try {
      setLinhas(await listarConferenciaSpa(de, ate))
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar a conferência')
    } finally {
      setCarregando(false)
    }
  }, [de, ate])

  useEffect(() => {
    setCarregando(true)
    void carregar()
  }, [carregar])

  const atendimentos = useMemo(() => agruparAtendimentos(linhas), [linhas])
  const resumo = resumoSpa(atendimentos)
  const kitsSemAgenda = linhas.filter((l) => l.tipo === 'kit_sem_agenda')
  // Paciente, prontuário, profissional ou kit: "sonia", "12345", "mariana".
  const visiveis = atendimentos.filter(
    (a) =>
      (filtro === 'todos' || a.situacao === filtro) &&
      combinaBusca(termo, a.paciente, a.prontuario, ...a.profissionais, ...a.kits.map((k) => k.nome)),
  )
  const porDia = useMemo(() => {
    const m = new Map<string, AtendimentoSpa[]>()
    for (const a of visiveis) m.set(a.data, [...(m.get(a.data) ?? []), a])
    return [...m.entries()]
  }, [visiveis])

  const periodo = (dias: number) => {
    setDe(diasAtras(dias))
    setAte(diaLocal(new Date()))
  }

  const semMaterial = async (a: AtendimentoSpa, marcar: boolean) => {
    setMexendo(a.chave)
    try {
      if (marcar) await marcarSemMaterial(a.agendamentos)
      else await desfazerSemMaterial(a.agendamentos)
      toast.success(marcar ? `${a.paciente}: marcado como sem material.` : `${a.paciente}: voltou para Sem baixa.`)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setMexendo(null)
    }
  }

  const chips: Array<[Filtro, string, number]> = [
    ['pendente', 'Sem baixa', resumo.pendentes],
    ['com_kit', 'Com kit', resumo.comKit],
    ['sem_material', 'Não usa material', resumo.semMaterial],
    ['todos', 'Todos', resumo.total],
  ]

  return (
    <AppLayout
      title="Conferência do SPA"
      subtitle="Quem foi atendido no Spa Capilar, pela agenda do Shosp, e se o material saiu do estoque."
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="spa-de">De</Label>
            <Input id="spa-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spa-ate">Até</Label>
            <Input id="spa-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-9" />
          </div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-9" onClick={() => periodo(0)}>
              Hoje
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => periodo(6)}>
              7 dias
            </Button>
          </div>
        </div>

        <SearchField
          value={busca}
          onChange={setBusca}
          label="Buscar paciente, prontuário ou profissional"
          resultados={termo ? visiveis.length : undefined}
        />

        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filtrar atendimentos">
          {chips.map(([f, rotulo, n]) => (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => setFiltro(f)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                filtro === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {rotulo} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>

        <EstadoDaTela carregando={carregando} erro={erro} vazio={null}>
          {visiveis.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {resumo.total === 0
                ? 'Ninguém na agenda do Spa Capilar neste período.'
                : termo
                  ? `Ninguém com "${termo}" ${filtro === 'todos' ? 'no período' : 'neste filtro'}.`
                  : filtro === 'pendente'
                    ? 'Todo atendimento do período tem kit ou está marcado como sem material.'
                    : 'Nada neste filtro.'}
            </p>
          ) : (
            <div className="space-y-5">
              {porDia.map(([dia, lista]) => (
                <section key={dia} className="space-y-2">
                  <h2 className="text-sm font-semibold capitalize text-muted-foreground">
                    {dataLonga(dia)} <span className="font-normal">· {lista.length}</span>
                  </h2>
                  <ul className="space-y-2">
                    {lista.map((a) => {
                      const sit = SITUACAO[a.situacao]
                      return (
                        <li key={a.chave} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold leading-snug">{a.paciente}</p>
                              <p className="text-xs text-muted-foreground">
                                {a.horarios.join(', ')}
                                {a.profissionais.length > 0 ? ` · ${a.profissionais.join(', ')}` : ''}
                                {a.prontuario ? ` · prontuário ${a.prontuario}` : ''}
                              </p>
                            </div>
                            <Badge variant="secondary" className={sit.classe}>
                              {sit.rotulo}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {a.situacao === 'com_kit'
                              ? a.kits.map((k) => (
                                  <Link
                                    key={k.id}
                                    to={k.status === 'montado' ? `/kits/${k.id}/uso` : `/kits/${k.id}/editar`}
                                    className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-8' })}
                                  >
                                    <Check className="size-4" aria-hidden /> {k.nome}
                                    {k.status === 'montado' ? ' · registrar uso' : ''}
                                  </Link>
                                ))
                              : null}
                            {a.situacao === 'pendente' && a.primeiroAgendamento ? (
                              <>
                                <Link
                                  to={`/kits/montar?agendamento=${encodeURIComponent(a.primeiroAgendamento)}`}
                                  className={buttonVariants({ size: 'sm', className: 'h-8' })}
                                >
                                  <PackagePlus className="size-4" aria-hidden /> Montar kit
                                </Link>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8"
                                  disabled={mexendo === a.chave}
                                  onClick={() => void semMaterial(a, true)}
                                >
                                  <Ban className="size-4" aria-hidden /> Não usa material
                                </Button>
                              </>
                            ) : null}
                            {a.situacao === 'sem_material' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-muted-foreground"
                                disabled={mexendo === a.chave}
                                onClick={() => void semMaterial(a, false)}
                              >
                                <Undo2 className="size-4" aria-hidden /> Desfazer
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {kitsSemAgenda.length > 0 ? (
            <section className="space-y-2 pt-2">
              <h2 className="text-sm font-semibold">Kits do SPA sem horário na agenda ({kitsSemAgenda.length})</h2>
              <p className="text-xs text-muted-foreground">
                Kit montado sem paciente da agenda, ou com o nome escrito diferente do Shosp. Abra e ligue ao paciente certo.
              </p>
              <ul className="space-y-2">
                {kitsSemAgenda.map((k) => (
                  <li key={k.kitId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{k.kitNome}</span>
                      <span className="text-muted-foreground"> · {k.paciente || 'sem paciente'} · {new Date(`${k.data}T12:00:00`).toLocaleDateString('pt-BR')}</span>
                    </span>
                    <Link to={`/kits/${k.kitId}/editar`} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-8' })}>
                      Abrir kit
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </EstadoDaTela>
      </div>
    </AppLayout>
  )
}

export default KitConferenciaSpaPage
