import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CalendarClock,
  Eraser,
  EyeOff,
  MessageCircle,
  MoreHorizontal,
  PhoneCall,
  RotateCcw,
  Scissors,
  Sparkles,
  Undo2,
} from 'lucide-react'

import { BoardColumn } from '@/components/board/BoardColumn'
import { useColunasFechadas } from '@/components/board/useColunasFechadas'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { SearchField } from '@/components/ui/search-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { combinaBusca } from '@/lib/busca'
import { cn } from '@/lib/utils'
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_OUTCOMES,
  FUNIL_CIRURGICO,
  FUNIL_PROTOCOLOS,
  KANBAN_COLUNAS,
  type FollowupDispensado,
  type KanbanCard,
  type KanbanColuna,
  completeFollowup,
  devolverFollowupAoQuadro,
  dispensarFollowups,
  listFollowupKanban,
  listFollowupsDispensados,
  filaDoFunil,
  moverLeadDeFunil,
  reabrirFollowup,
} from '@/services/leadFollowups'

/**
 * Motivo que já vem escrito ao tirar do quadro, igual ao das filas da aba de
 * vendas: quase sempre é o mesmo caso, atendimento que terminou faz tempo.
 */
const MOTIVO_PADRAO_QUADRO = 'Atendimento encerrado, fora do quadro'

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

/** Cor da faixa de cada coluna. Só o topo: card colorido em seis cores vira festa. */
const FAIXA: Record<KanbanColuna, string> = {
  contato_1: 'bg-sky-500',
  contato_2: 'bg-violet-500',
  contato_3: 'bg-amber-500',
  em_acompanhamento: 'bg-teal-500',
  nao_convertido: 'bg-muted-foreground',
  encerrado: 'bg-emerald-500',
}

/**
 * As colunas de fila VIVA: têm data marcada, contam atraso e mostram "Registrar".
 *
 * "Em acompanhamento" entra aqui junto das três primeiras porque continua sendo
 * contato agendado — o que muda é que o paciente já passou da sequência padrão. Se
 * ficasse de fora, ele perderia o botão de registrar e o aviso de atraso, que é
 * exatamente o acompanhamento que se quis preservar ao criar a coluna.
 */
const ABERTAS: KanbanColuna[] = ['contato_1', 'contato_2', 'contato_3', 'em_acompanhamento']

/**
 * O follow-up em kanban: 1º, 2º e 3º contato, em acompanhamento, não convertido
 * (potencial futuro) e encerrado.
 *
 * As quatro primeiras colunas são a fila viva, e o card anda sozinho quando o
 * contato é registrado — não tem arrastar. Arrastar seria repetir a planilha, em
 * que a coluna "2º contato" era preenchida sem que ligação nenhuma tivesse
 * acontecido, e ninguém sabia de qual das quatro colunas cobrar.
 */
export function FollowUpTab() {
  const crm = useCrm()
  const { tenant } = useTenant()
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
  /** Quem saiu do quadro: continua no histórico, e o diálogo devolve qualquer um. */
  const [dispensados, setDispensados] = useState<FollowupDispensado[]>([])
  const [verDispensados, setVerDispensados] = useState(false)
  const [zerandoColuna, setZerandoColuna] = useState<KanbanColuna | null>(null)
  const [motivoQuadro, setMotivoQuadro] = useState(MOTIVO_PADRAO_QUADRO)
  const [termo, setTermo] = useState('')
  const buscaAdiada = useDeferredValue(termo)
  /** Liga a fila do dia: some quem tem contato marcado para depois de hoje. */
  const [soPendentes, setSoPendentes] = useState(false)
  /**
   * "Não convertido" e "Encerrado" nascem FECHADAS. Elas guardam 114 dos 174
   * pacientes da clínica e não têm ação diária nenhuma — abertas, empurravam as
   * quatro colunas de contato para fora da tela.
   */
  const { fechadas, alternar } = useColunasFechadas('crm-followup-colunas-fechadas', [
    'nao_convertido',
    'encerrado',
  ])

  const load = async () => {
    setLoading(true)
    try {
      const [quadro, fora] = await Promise.all([listFollowupKanban(), listFollowupsDispensados()])
      setCards(quadro)
      setDispensados(fora)
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
    // O quadro é da CLÍNICA porque o follow-up é da clínica: quem marca contato
    // aqui é a Aline ou a Ingrid, e nenhuma outra tela do sistema escreve nesta
    // tabela. O corte por funil que existia aqui prometia separar polo e na
    // prática comia paciente — quatro pacientes de consulta, com proposta de
    // R$ 5.800 anotada, ficaram invisíveis só porque o card deles foi parar no
    // funil de vendas do Tricopill depois de comprarem cápsula.
    //
    // Filtrar é escolher qual fila mostrar primeiro, nunca esconder card com
    // contato marcado.
    const doFunil =
      funil === 'todos'
        ? cards
        : // Paciente que ainda não foi triado (funil da recepção) — e qualquer um
          // em funil que esta tela não conhece — aparece nas duas filas de
          // propósito: se só aparecesse em "todos", ninguém o veria.
          cards.filter((c) => {
            const fila = filaDoFunil(c.pipelineId)
            return fila === 'ambas' || fila === funil
          })

    // A fila do dia: só quem já venceu ou vence hoje. É o corte que transforma
    // "todo mundo que existe" na lista do que ela precisa fazer agora.
    const doDia = soPendentes
      ? doFunil.filter((c) => ABERTAS.includes(c.coluna) && c.scheduledFor.slice(0, 10) <= hojeIso())
      : doFunil

    // A busca atravessa as seis colunas: quem procura um paciente não sabe (nem
    // deveria precisar saber) em qual coluna do kanban ele está parado hoje.
    return doDia.filter((c) => combinaBusca(buscaAdiada, c.patientName, c.phone, c.note, c.outcome))
  }, [cards, funil, buscaAdiada, soPendentes])

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
   * Card cujo funil é de OUTRO polo. Acontece com paciente de consulta que também
   * compra cápsula: a venda leva o card para o funil do Tricopill e o follow-up
   * da clínica continua sendo da clínica. O selo existe para ninguém achar que é
   * lead de cápsula vazando na fila de transplante e "consertar" escondendo de
   * novo — foi assim que quatro pacientes com proposta viva sumiram do quadro.
   */
  const funilDeOutroPolo = (c: KanbanCard) => {
    const p = crm.pipelineCatalog.find((x) => x.id === c.pipelineId)
    return p?.tenantId != null && p.tenantId !== tenant.id ? p.name : null
  }

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

  /**
   * Tira o paciente do quadro.
   *
   * A coluna "Encerrado" enche de quem já operou: o atendimento acabou, não há
   * contato para marcar, e o card fica ali para sempre porque a coluna é
   * consequência de ter venda. Isto não fecha follow-up nem apaga histórico, e
   * marcar um contato novo traz o paciente de volta sozinho.
   */
  const tirarDoQuadro = async (card: KanbanCard) => {
    setMovendo(card.leadId)
    try {
      await dispensarFollowups([card.followupId], MOTIVO_PADRAO_QUADRO)
      toast.success(`${card.patientName} saiu do quadro. O histórico continua na ficha dele.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao tirar do quadro')
    } finally {
      setMovendo(null)
    }
  }

  /** Zera a coluna inteira: sai o que está visível nela, com o motivo registrado. */
  const zerarColuna = async () => {
    if (!zerandoColuna) return
    const ids = (porColuna.get(zerandoColuna) ?? []).map((c) => c.followupId)
    setSalvando(true)
    try {
      const quantos = await dispensarFollowups(ids, motivoQuadro)
      setZerandoColuna(null)
      setMotivoQuadro(MOTIVO_PADRAO_QUADRO)
      toast.success(
        quantos === 0
          ? 'A coluna já estava vazia.'
          : `${quantos} paciente${quantos === 1 ? '' : 's'} fora do quadro. Nada foi apagado.`,
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao zerar a coluna')
    } finally {
      setSalvando(false)
    }
  }

  const devolver = async (d: FollowupDispensado) => {
    try {
      await devolverFollowupAoQuadro(d.followupId)
      toast.success(`${d.patientName} voltou para o quadro.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao devolver ao quadro')
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

  /**
   * O card do paciente, em duas linhas de texto e uma de ação.
   *
   * Trocar de funil saiu de botão para dentro do "⋯": eram até quatro botões por
   * card, o card ficava com três linhas de botão e a coluna virava um rolo. Ligar
   * é diário; mudar de funil acontece uma vez na vida do paciente.
   */
  const cardDoPaciente = (c: KanbanCard) => {
    const atrasado = c.diasAtraso > 0 && ABERTAS.includes(c.coluna)
    const fone = soDigitos(c.phone)
    return (
      <div
        className={cn(
          'rounded-md border border-border bg-card p-2 text-sm',
          atrasado && 'border-destructive/50',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <Link to={`/leads/${c.leadId}`} className="font-medium leading-tight hover:underline">
            {c.patientName}
          </Link>
          {atrasado && (
            <Badge variant="destructive" className="shrink-0 text-[10px]">
              {c.diasAtraso}d
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ABERTAS.includes(c.coluna)
            ? `contato em ${dia(c.scheduledFor)}`
            : c.cirurgiaEm
              ? // "cirurgia em 24/02" para quem já operou fazia a coluna parecer
                // fila de gente esperando. Data que passou vira "operou em".
                `${c.cirurgiaEm.slice(0, 10) < hojeIso() ? 'operou em' : 'cirurgia em'} ${dia(c.cirurgiaEm)}`
              : (c.outcome ?? 'sem desfecho registrado')}
        </p>
        {funilDeOutroPolo(c) && (
          <Badge
            variant="outline"
            className="mt-1 text-[10px] font-normal"
            title={`O card do paciente está no funil "${funilDeOutroPolo(c)}", de outro polo. O follow-up é da clínica e continua aqui.`}
          >
            card no funil {funilDeOutroPolo(c)}
          </Badge>
        )}
        {c.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.note}</p>}
        <div className="mt-1.5 flex items-center gap-1">
          {fone.length >= 10 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              nativeButton={false}
              render={<a href={`https://wa.me/55${fone}`} target="_blank" rel="noreferrer noopener" />}
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
          <DropdownMenu>
            <DropdownMenuTrigger
              title="Mais ações"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm' }),
                'ml-auto h-7 px-1.5 text-muted-foreground',
              )}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Consulta de transplante que termina em indicação de protocolo (e o
                  contrário). O paciente troca de fila e o follow-up dele vai junto. */}
              {c.pipelineId !== FUNIL_PROTOCOLOS && (
                <DropdownMenuItem
                  disabled={movendo === c.leadId}
                  onClick={() => void trocarFunil(c, 'protocolo')}
                >
                  <Sparkles className="size-4" /> Passar para protocolos e spa
                </DropdownMenuItem>
              )}
              {c.pipelineId !== FUNIL_CIRURGICO && (
                <DropdownMenuItem
                  disabled={movendo === c.leadId}
                  onClick={() => void trocarFunil(c, 'cirurgia')}
                >
                  <Scissors className="size-4" /> Passar para transplante
                </DropdownMenuItem>
              )}
              {/* Paciente que já operou não tem contato para marcar, e o card dele
                  fica no quadro para sempre. Sai daqui sem perder histórico. */}
              <DropdownMenuItem disabled={movendo === c.leadId} onClick={() => void tirarDoQuadro(c)}>
                <EyeOff className="size-4" /> Tirar do quadro
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          {/* A fila do dia em um clique. Sem isto, "quem eu tenho que ligar hoje"
              exigia ler quatro colunas e comparar data por data. */}
          <Button
            size="sm"
            variant={soPendentes ? 'default' : 'outline'}
            onClick={() => setSoPendentes((v) => !v)}
            title="Só quem tem contato marcado para hoje ou antes"
          >
            <CalendarClock className="size-4" />
            Contato de hoje
            {atrasados > 0 && !soPendentes ? ` (${atrasados} atrasado${atrasados > 1 ? 's' : ''})` : ''}
          </Button>
          <SearchField
            value={termo}
            onChange={setTermo}
            label="Buscar paciente no follow-up"
            placeholder="Paciente, telefone, anotação…"
            resultados={visiveis.length}
            className="w-full sm:w-64"
          />
          {/* Porta de entrada do que saiu do quadro. Sem ela, "zerar a coluna" seria
              um botão que some com paciente e não mostra para onde foi. */}
          {dispensados.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setVerDispensados(true)}>
              <EyeOff className="size-4" /> Fora do quadro ({dispensados.length})
            </Button>
          )}
          {atrasados > 0 && soPendentes && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-destructive">{atrasados}</span> atrasado
              {atrasados > 1 ? 's' : ''}.
            </p>
          )}
        </div>
      </div>

      {/* Coluna fechada vira etiqueta aqui em cima. Sem isto ela ficava fora da
          tela, à direita do quadro, e a tela parecia ter perdido pacientes. */}
      {fechadas.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Colunas fechadas:</span>
          {KANBAN_COLUNAS.filter((col) => fechadas.has(col.id)).map((col) => (
            <Button
              key={col.id}
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => alternar(col.id, false)}
            >
              {col.label}
              <span className="tabular-nums text-muted-foreground">
                {(porColuna.get(col.id) ?? []).length}
              </span>
            </Button>
          ))}
        </div>
      )}

      {loading && cards.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Carregando…" />
      ) : (
        // Quadro de verdade: rola para o lado, cada coluna com a altura da tela e
        // rolagem própria. O grid antigo jogava a sexta coluna para baixo de todas
        // as outras, e uma coluna de 58 cards esticava a linha inteira.
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {KANBAN_COLUNAS.map((col) => (
            <BoardColumn
              key={col.id}
              title={col.label}
              hint={col.hint}
              accentClass={FAIXA[col.id]}
              items={porColuna.get(col.id) ?? []}
              keyOf={(c) => c.followupId}
              renderItem={cardDoPaciente}
              emptyLabel={
                termo.trim().length > 0
                  ? 'Ninguém com esse termo.'
                  : soPendentes
                    ? ABERTAS.includes(col.id)
                      ? 'Nada para hoje.'
                      : 'Fora da fila de hoje.'
                    : 'Ninguém aqui.'
              }
              badge={
                // Só em "Encerrado": as colunas de contato são a fila viva da Aline,
                // e botão de zerar em cima da fila do dia é acidente esperando.
                col.id === 'encerrado' && (porColuna.get(col.id) ?? []).length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={() => setZerandoColuna('encerrado')}
                  >
                    <Eraser className="size-3" /> Zerar a coluna ({(porColuna.get(col.id) ?? []).length})
                  </Button>
                ) : undefined
              }
              collapsed={fechadas.has(col.id)}
              onCollapsedChange={(v) => alternar(col.id, v)}
            />
          ))}
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
                  venda registrada. Dá para trazer de volta depois. Enquanto houver próxima data, ele
                  segue na fila: do 3º contato em diante, em "Em acompanhamento".
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

      <Dialog open={zerandoColuna != null} onOpenChange={(open) => (!open ? setZerandoColuna(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Zerar a coluna Encerrado</DialogTitle>
            <DialogDescription>
              {(porColuna.get('encerrado') ?? []).length}{' '}
              {(porColuna.get('encerrado') ?? []).length === 1 ? 'paciente sai' : 'pacientes saem'} do
              quadro. Ninguém é apagado: o follow-up continua fechado do jeito que está, o histórico
              segue na ficha de cada um, e marcar um contato novo traz o paciente de volta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Input value={motivoQuadro} onChange={(e) => setMotivoQuadro(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Fica registrado com a data e com quem tirou, e aparece em "Fora do quadro". Sai o que
              está visível na coluna agora, ou seja, o filtro de funil e a busca valem aqui.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setZerandoColuna(null)}>
              Cancelar
            </Button>
            <Button disabled={salvando} onClick={() => void zerarColuna()}>
              {salvando ? 'Zerando…' : `Zerar ${(porColuna.get('encerrado') ?? []).length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={verDispensados} onOpenChange={(open) => setVerDispensados(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Fora do quadro</DialogTitle>
            <DialogDescription>
              Pacientes tirados do quadro de follow-up. O histórico deles continua inteiro na ficha, e
              qualquer um volta com um clique.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {dispensados.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguém fora do quadro.</p>
            ) : (
              dispensados.map((d) => (
                <div
                  key={d.followupId}
                  className="flex items-start justify-between gap-2 rounded-md border border-border p-2"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/leads/${d.leadId}`}
                      className="text-sm font-medium leading-tight hover:underline"
                    >
                      {d.patientName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      saiu em {dia(d.dismissedAt)}
                      {d.dismissedReason ? ` · ${d.dismissedReason}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => void devolver(d)}
                  >
                    <Undo2 className="size-3" /> Devolver
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVerDispensados(false)}>
              Fechar
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
