import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarClock, MessageCircle, PhoneCall, RotateCcw, Scissors, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_OUTCOMES,
  FUNIL_CIRURGICO,
  FUNIL_PROTOCOLOS,
  FUNIL_TRIAGEM,
  FUNIS_DA_CLINICA,
  KANBAN_COLUNAS,
  type KanbanCard,
  type KanbanColuna,
  completeFollowup,
  listFollowupKanban,
  moverLeadDeFunil,
  reabrirFollowup,
} from '@/services/leadFollowups'

const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const emDias = (dias: number) => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const soDigitos = (v: string | null) => (v ?? '').replace(/\D/g, '')

const dia = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'

/** Atalhos de reagendamento: é assim que ela fala, "volto nele daqui uma semana". */
const ATALHOS = [
  { label: 'Amanhã', dias: 1 },
  { label: '3 dias', dias: 3 },
  { label: '1 semana', dias: 7 },
  { label: '15 dias', dias: 15 },
  { label: '30 dias', dias: 30 },
]

/** Cor da faixa de cada coluna. Só o topo: card colorido em cinco cores vira festa. */
const FAIXA: Record<KanbanColuna, string> = {
  contato_1: 'bg-sky-500',
  contato_2: 'bg-violet-500',
  contato_3: 'bg-amber-500',
  nao_convertido: 'bg-muted-foreground',
  encerrado: 'bg-emerald-500',
}

const ABERTAS: KanbanColuna[] = ['contato_1', 'contato_2', 'contato_3']

/**
 * O follow-up em kanban, do desenho da gerente: 1º, 2º e 3º contato, não
 * convertido (potencial futuro) e encerrado.
 *
 * As três primeiras colunas são a fila viva, e o card anda sozinho quando o
 * contato é registrado — não tem arrastar. Arrastar seria repetir a planilha, em
 * que a coluna "2º contato" era preenchida sem que ligação nenhuma tivesse
 * acontecido, e ninguém sabia de qual das quatro colunas cobrar.
 */
export function FollowUpTab() {
  const [cards, setCards] = useState<KanbanCard[]>([])
  const [loading, setLoading] = useState(false)
  const [alvo, setAlvo] = useState<KanbanCard | null>(null)
  const [reabrindo, setReabrindo] = useState<KanbanCard | null>(null)
  const [outcome, setOutcome] = useState(FOLLOWUP_OUTCOMES[0])
  const [canal, setCanal] = useState(FOLLOWUP_CHANNELS[0])
  const [nota, setNota] = useState('')
  const [proxima, setProxima] = useState(emDias(7))
  const [semProxima, setSemProxima] = useState(false)
  const [salvando, setSalvando] = useState(false)
  // A fila da Aline é transplante; a da Ingrid é protocolo. Sem separar, cada uma
  // trabalhava no meio dos pacientes da outra.
  const [funil, setFunil] = useState<'cirurgia' | 'protocolo' | 'todos'>('cirurgia')
  const [movendo, setMovendo] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setCards(await listFollowupKanban())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar os follow-ups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const visiveis = useMemo(() => {
    // Primeiro corte: só funil da CLÍNICA. Quem enxerga os dois polos via 3 leads
    // do Tricopill no follow-up da clínica — a fila de vender cápsula no meio da
    // fila de transplante. Polo não se mistura nem na tela.
    const daClinica = cards.filter(
      (c) => c.pipelineId != null && FUNIS_DA_CLINICA.includes(c.pipelineId),
    )
    if (funil === 'todos') return daClinica
    const alvo = funil === 'cirurgia' ? FUNIL_CIRURGICO : FUNIL_PROTOCOLOS
    // Paciente que ainda não foi triado (funil da recepção) aparece nas duas
    // filas de propósito: se ele só aparecesse em "todos", ninguém o veria.
    return daClinica.filter((c) => c.pipelineId === alvo || c.pipelineId === FUNIL_TRIAGEM)
  }, [cards, funil])

  const porColuna = useMemo(() => {
    const mapa = new Map<KanbanColuna, KanbanCard[]>()
    for (const c of KANBAN_COLUNAS) mapa.set(c.id, [])
    for (const card of visiveis) mapa.get(card.coluna)?.push(card)
    // Atrasado primeiro dentro de cada coluna: é a fila do dia dela.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
    }
    return mapa
  }, [visiveis])

  const atrasados = useMemo(
    () => visiveis.filter((c) => ABERTAS.includes(c.coluna) && c.diasAtraso > 0).length,
    [visiveis],
  )

  /**
   * Troca o paciente de funil. É o caso da consulta de transplante que termina em
   * indicação de protocolo: o paciente sai da fila de quem vende transplante e
   * entra na de quem vende protocolo, com o follow-up dele intacto.
   */
  const trocarFunil = async (card: KanbanCard, destino: 'cirurgia' | 'protocolo') => {
    setMovendo(card.leadId)
    try {
      await moverLeadDeFunil(card.leadId, destino)
      toast.success(
        destino === 'protocolo'
          ? `${card.patientName} foi para o funil de protocolos. O follow-up continua marcado.`
          : `${card.patientName} foi para o funil cirúrgico. O follow-up continua marcado.`,
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao trocar de funil')
    } finally {
      setMovendo(null)
    }
  }

  const abrir = (card: KanbanCard) => {
    setAlvo(card)
    setOutcome(FOLLOWUP_OUTCOMES[0])
    setCanal(FOLLOWUP_CHANNELS[0])
    setNota('')
    setProxima(emDias(7))
    setSemProxima(false)
  }

  const registrar = async () => {
    if (!alvo) return
    setSalvando(true)
    try {
      await completeFollowup({
        id: alvo.followupId,
        leadId: alvo.leadId,
        outcome,
        note: nota,
        channel: canal,
        nextDate: semProxima ? null : proxima,
      })
      toast.success(
        semProxima
          ? `${alvo.patientName} saiu da fila de follow-up.`
          : `Contato registrado. Próximo em ${dia(proxima)}.`,
      )
      setAlvo(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar')
    } finally {
      setSalvando(false)
    }
  }

  const reabrir = async () => {
    if (!reabrindo) return
    setSalvando(true)
    try {
      await reabrirFollowup(reabrindo.leadId, proxima)
      toast.success(`${reabrindo.patientName} voltou para a fila em ${dia(proxima)}.`)
      setReabrindo(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reabrir')
    } finally {
      setSalvando(false)
    }
  }

  const cardDoPaciente = (c: KanbanCard) => (
    <div
      key={c.followupId}
      className={cn(
        'rounded-md border border-border bg-card p-2 text-sm',
        c.diasAtraso > 0 && ABERTAS.includes(c.coluna) && 'border-destructive/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link to={`/leads/${c.leadId}`} className="font-medium leading-tight hover:underline">
          {c.patientName}
        </Link>
        {c.diasAtraso > 0 && ABERTAS.includes(c.coluna) && (
          <Badge variant="destructive" className="shrink-0 text-[10px]">
            {c.diasAtraso}d
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {ABERTAS.includes(c.coluna)
          ? `contato em ${dia(c.scheduledFor)}`
          : c.cirurgiaEm
            ? `cirurgia em ${dia(c.cirurgiaEm)}`
            : (c.outcome ?? 'sem desfecho registrado')}
      </p>
      {c.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.note}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {soDigitos(c.phone).length >= 10 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            nativeButton={false}
            render={<a href={`https://wa.me/55${soDigitos(c.phone)}`} target="_blank" rel="noreferrer noopener" />}
          >
            <MessageCircle className="size-3" /> WhatsApp
          </Button>
        )}
        {ABERTAS.includes(c.coluna) ? (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => abrir(c)}>
            <PhoneCall className="size-3" /> Registrar
          </Button>
        ) : c.coluna === 'nao_convertido' ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setProxima(emDias(30))
              setReabrindo(c)
            }}
          >
            <RotateCcw className="size-3" /> Voltar para a fila
          </Button>
        ) : null}
        {/* Consulta de transplante que termina em indicação de protocolo (e o
            contrário). O paciente troca de fila e o follow-up dele vai junto —
            antes disto era pela ficha do paciente, em outra tela. */}
        {c.pipelineId !== FUNIL_PROTOCOLOS && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={movendo === c.leadId}
            title="Passar para o funil de protocolos e spa"
            onClick={() => void trocarFunil(c, 'protocolo')}
          >
            <Sparkles className="size-3" /> Protocolo
          </Button>
        )}
        {c.pipelineId !== FUNIL_CIRURGICO && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={movendo === c.leadId}
            title="Passar para o funil de transplante"
            onClick={() => void trocarFunil(c, 'cirurgia')}
          >
            <Scissors className="size-3" /> Transplante
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(
            [
              { id: 'cirurgia', label: 'Transplante' },
              { id: 'protocolo', label: 'Protocolos e spa' },
              { id: 'todos', label: 'Todos' },
            ] as const
          ).map((op) => (
            <Button
              key={op.id}
              size="sm"
              variant={funil === op.id ? 'default' : 'outline'}
              onClick={() => setFunil(op.id)}
            >
              {op.label}
            </Button>
          ))}
        </div>
        {atrasados > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-destructive">{atrasados}</span> paciente
            {atrasados > 1 ? 's' : ''} com contato atrasado.
          </p>
        )}
      </div>

      {loading && cards.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Carregando…" />
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {KANBAN_COLUNAS.map((col) => {
            const lista = porColuna.get(col.id) ?? []
            return (
              <Card key={col.id} className="flex flex-col gap-0 overflow-hidden pt-0">
                <div className={cn('h-1 w-full', FAIXA[col.id])} />
                <CardHeader className="pt-3 pb-2">
                  <CardTitle className="text-sm leading-tight">
                    {col.label}
                    <span className="ml-1.5 text-muted-foreground">{lista.length}</span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{col.hint}</p>
                </CardHeader>
                <CardContent className="flex-1 space-y-2 pb-3">
                  {lista.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Ninguém aqui.</p>
                  ) : (
                    lista.map(cardDoPaciente)
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={alvo != null} onOpenChange={(open) => (!open ? setAlvo(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Contato com {alvo?.patientName}</DialogTitle>
            <DialogDescription>
              {alvo ? `${alvo.attemptNo}ª tentativa. O que ficou combinado?` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Resultado</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(String(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOWUP_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Canal</Label>
                <Select value={canal} onValueChange={(v) => setCanal(String(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOWUP_CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Observação</Label>
              <Textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                placeholder="Pediu para chamar depois do dia 5, está juntando a entrada…"
              />
            </div>

            <div className="space-y-1.5 rounded-md border border-border p-3">
              <Label>Próximo contato</Label>
              <div className="flex flex-wrap gap-1.5">
                {ATALHOS.map((a) => (
                  <Button
                    key={a.label}
                    type="button"
                    size="sm"
                    variant={!semProxima && proxima === emDias(a.dias) ? 'default' : 'outline'}
                    onClick={() => {
                      setSemProxima(false)
                      setProxima(emDias(a.dias))
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="date"
                  value={proxima}
                  min={hojeIso()}
                  disabled={semProxima}
                  onChange={(e) => setProxima(e.target.value)}
                  className="w-44"
                />
                <Button
                  type="button"
                  size="sm"
                  variant={semProxima ? 'default' : 'ghost'}
                  onClick={() => setSemProxima((v) => !v)}
                >
                  Encerrar follow-up
                </Button>
              </div>
              {semProxima && (
                <p className="text-xs text-muted-foreground">
                  O paciente sai da fila e vai para "não convertido" — ou para "encerrado", se já tiver
                  venda registrada. Dá para trazer de volta depois.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAlvo(null)}>
              Cancelar
            </Button>
            <Button disabled={salvando} onClick={() => void registrar()}>
              {salvando ? 'Salvando…' : 'Registrar contato'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reabrindo != null} onOpenChange={(open) => (!open ? setReabrindo(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Voltar {reabrindo?.patientName} para a fila</DialogTitle>
            <DialogDescription>
              O potencial futuro só existe com data. Quando ela chegar, o paciente aparece na coluna de
              contato.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {[30, 60, 90, 180].map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={proxima === emDias(d) ? 'default' : 'outline'}
                  onClick={() => setProxima(emDias(d))}
                >
                  {d} dias
                </Button>
              ))}
            </div>
            <Input
              type="date"
              value={proxima}
              min={hojeIso()}
              onChange={(e) => setProxima(e.target.value)}
              className="w-44"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReabrindo(null)}>
              Cancelar
            </Button>
            <Button disabled={salvando} onClick={() => void reabrir()}>
              {salvando ? 'Salvando…' : 'Reabrir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
